/**
 * The one place a database connection is made (glory-economy.md). Both the
 * API and (post-v1) the game server call createDb with their own env-provided
 * Turso credentials — services share the database, never each other's HTTP.
 */
import { createClient, type Client } from "@libsql/client";

export type Db = Client;

/** `url` is a Turso libsql URL in production, `file:…` (or `:memory:` in
 * tests) for local dev — no Turso account needed to run the stack locally. */
export const createDb = (url: string, authToken?: string): Db =>
  createClient({ url, authToken });

/**
 * Idempotent schema — every statement is IF NOT EXISTS, so services run this
 * unconditionally on boot. Additive changes append statements here; anything
 * destructive gets promoted to a real migration step when we first need one.
 *
 * Two services boot this against the same LOCAL file (the game server and the
 * API share dev.db), and simultaneous DDL trips SQLITE_BUSY on the file
 * driver — the statements are idempotent, so a short retry settles the race.
 * Turso in production has no file lock; the retry simply never fires.
 */
export const ensureSchema = async (db: Db): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await applySchema(db);
    } catch (err) {
      if (attempt >= 4 || (err as { code?: string }).code !== "SQLITE_BUSY") throw err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
};

const applySchema = async (db: Db): Promise<void> => {
  await db.batch(
    [
      // The anonymous player identity (primary identity forever — Clerk
      // linking later just stamps clerk_user_id onto this row).
      `CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        clerk_user_id TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      // Append-only Glory ledger: balance = SUM(amount). `source` is an open
      // namespace (match:…, achievement:…, app-review:…) so new earn sources
      // are just new writers; the UNIQUE idempotency key is what makes
      // retried credits harmless.
      `CREATE TABLE IF NOT EXISTS glory_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL REFERENCES players(id),
        amount INTEGER NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      // Covering index: the balance query is answered entirely from
      // (player_id, amount) without touching the table.
      `CREATE INDEX IF NOT EXISTS idx_glory_ledger_player
        ON glory_ledger (player_id, amount)`,
      // Per-bracket ladder rows (bits-ranked.md): one row per rated subject
      // per season per bracket — a 1v1 rating and a 2v2 rating are simply two
      // rows, fully independent. `subject_id` is a player id in solo-queue
      // brackets and a team id in future premade brackets; the bracket key
      // tells you which, so no subject_type column.
      `CREATE TABLE IF NOT EXISTS ranked_ratings (
        subject_id TEXT NOT NULL,
        season INTEGER NOT NULL,
        bracket TEXT NOT NULL,
        rating INTEGER NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (subject_id, season, bracket)
      )`,
      // The ladder read: ORDER BY rating DESC within one season+bracket.
      `CREATE INDEX IF NOT EXISTS idx_ranked_ratings_ladder
        ON ranked_ratings (season, bracket, rating)`,
      // Every ranked result — the audit trail (win-trading shows up here) AND
      // the pick-rate/win-rate analytics tap monetisation.md asked for
      // (loadouts as JSON, queried offline). The server-minted match id is
      // the idempotency root: recording is a no-op when the id exists.
      `CREATE TABLE IF NOT EXISTS ranked_matches (
        id TEXT PRIMARY KEY,
        season INTEGER NOT NULL,
        bracket TEXT NOT NULL,
        winner_id TEXT NOT NULL,
        loser_id TEXT NOT NULL,
        winner_rating_before INTEGER NOT NULL,
        winner_rating_after INTEGER NOT NULL,
        loser_rating_before INTEGER NOT NULL,
        loser_rating_after INTEGER NOT NULL,
        winner_loadout TEXT,
        loser_loadout TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
    ],
    "write",
  );
};
