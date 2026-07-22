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
 */
export const ensureSchema = async (db: Db): Promise<void> => {
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
    ],
    "write",
  );
};
