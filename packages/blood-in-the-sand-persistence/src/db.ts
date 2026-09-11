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
      // Append-only Signet ledger (bits-store.md) — the universal unlock
      // voucher, mirroring glory_ledger exactly. Sources: store:exchange
      // (bought with Glory), iap:<store> (bought with money), dev-grant.
      `CREATE TABLE IF NOT EXISTS signet_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL REFERENCES players(id),
        amount INTEGER NOT NULL,
        source TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE INDEX IF NOT EXISTS idx_signet_ledger_player
        ON signet_ledger (player_id, amount)`,
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
        peak_rating INTEGER NOT NULL DEFAULT 0,
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
      // One row per PARTICIPANT per ranked match (bits-ranked.md § 2v2 solo
      // queue, 2026-08-24): the per-player truth once a side can hold more
      // than one subject — ranked_matches keeps its header shape (ids
      // comma-joined, team-mean ratings for team brackets) and this table
      // carries who was on which side with their own before/after. Written
      // for EVERY bracket from now on (1v1 included) so recent form and the
      // pick-rate analytics have one table to read; pre-existing 1v1 rows
      // are backfilled below.
      `CREATE TABLE IF NOT EXISTS ranked_match_players (
        match_id TEXT NOT NULL REFERENCES ranked_matches(id),
        subject_id TEXT NOT NULL,
        team INTEGER NOT NULL,
        won INTEGER NOT NULL,
        rating_before INTEGER NOT NULL,
        rating_after INTEGER NOT NULL,
        loadout TEXT,
        PRIMARY KEY (match_id, subject_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ranked_match_players_subject
        ON ranked_match_players (subject_id)`,
      // Achievements (achievements.md): permanent, cross-season, board-blind
      // — only counters and unlocks are ever stored; the per-match summary
      // is server memory. The PK is what makes a double-award impossible.
      `CREATE TABLE IF NOT EXISTS achievement_unlocks (
        player_id TEXT NOT NULL REFERENCES players(id),
        achievement_id TEXT NOT NULL,
        unlocked_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (player_id, achievement_id)
      )`,
      // Lifetime counters, absolute values (streak counters included — the
      // adapter computes reset/high-water semantics before writing).
      `CREATE TABLE IF NOT EXISTS achievement_counters (
        player_id TEXT NOT NULL,
        counter TEXT NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY (player_id, counter)
      )`,
      // The double-count guard: one row per (match, player) achievement
      // application — a retried settle that already applied is a no-op.
      `CREATE TABLE IF NOT EXISTS achievement_progress_marks (
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        PRIMARY KEY (match_id, player_id)
      )`,
      // Per-device bearer tokens (bits-accounts.md § A4): one player, many
      // credentials — an account restore ADDS a row here instead of rotating
      // players.token_hash, so a second device never logs out the first.
      // This table is the ONLY one token resolution reads; players.token_hash
      // is legacy (still written on register, backfilled below for old rows).
      `CREATE TABLE IF NOT EXISTS player_tokens (
        token_hash TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id),
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      // The prune query: newest N per player.
      `CREATE INDEX IF NOT EXISTS idx_player_tokens_player
        ON player_tokens (player_id, created_at)`,
      // Owned items — shared by achievements (source achievement:<id>) and
      // the future store (source purchase:<sku>); achievements.md § secret
      // items. One row per owned item regardless of how it arrived.
      `CREATE TABLE IF NOT EXISTS entitlements (
        player_id TEXT NOT NULL REFERENCES players(id),
        item_id TEXT NOT NULL,
        source TEXT NOT NULL,
        granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (player_id, item_id)
      )`,
      // Player feedback + bug reports (bits-feedback.md): append-only, one
      // row per report, stamped with the identity and the running version
      // so a "it broke" from a stale OTA is recognisable at a glance.
      `CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL REFERENCES players(id),
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        contact_email TEXT,
        player_name TEXT,
        platform TEXT,
        os_version TEXT,
        app_binary TEXT,
        app_bundle TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      // Who shared a skirmish room with whom (bits-skirmish-deeds.md): the
      // Regulars chain and Both Sides Now read it. Account ids only, no
      // names; written from each player's own perspective inside their
      // idempotent per-match apply (so a retry never double-counts).
      `CREATE TABLE IF NOT EXISTS skirmish_companions (
        player_id TEXT NOT NULL,
        other_id TEXT NOT NULL,
        with_count INTEGER NOT NULL DEFAULT 0,
        against_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, other_id)
      )`,
      // Redeem codes (bits-redeem-codes.md): promo (public, use-limited +
      // dated) and tester (single-use) codes paying Glory and/or Signets.
      // `code` is the normalised form (A–Z0–9 only); `display` is what was
      // minted, hyphens and all. NULL max_redemptions = unlimited.
      `CREATE TABLE IF NOT EXISTS codes (
        code TEXT PRIMARY KEY,
        display TEXT NOT NULL,
        kind TEXT NOT NULL,
        glory INTEGER NOT NULL DEFAULT 0,
        signets INTEGER NOT NULL DEFAULT 0,
        max_redemptions INTEGER,
        expires_at INTEGER,
        active INTEGER NOT NULL DEFAULT 1,
        note TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      // One row per (code, player) — the PRIMARY KEY is what makes "once per
      // code per player" true. Only linked players can hold a row (the API
      // refuses anonymous redeems), so the Clerk id is audit only.
      `CREATE TABLE IF NOT EXISTS code_redemptions (
        code TEXT NOT NULL REFERENCES codes(code),
        player_id TEXT NOT NULL REFERENCES players(id),
        clerk_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (code, player_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_code_redemptions_player
        ON code_redemptions (player_id)`,
      // Every ONLINE match, all modes (hq.md, 2026-09-11): the studio
      // console's "matches a day" — ranked has its own richer rows in
      // ranked_matches; this is the one table that also sees skirmish and
      // brawl, which otherwise leave only timestamp-less lifetime counters.
      // Written once per match end by the game server, keyed on the match
      // id so a retry is a no-op. Practice is offline and never lands here.
      `CREATE TABLE IF NOT EXISTS match_log (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        bracket TEXT,
        team_size INTEGER NOT NULL,
        team_count INTEGER NOT NULL,
        humans INTEGER NOT NULL,
        bots INTEGER NOT NULL,
        rounds INTEGER NOT NULL,
        duration_s INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE INDEX IF NOT EXISTS idx_match_log_created
        ON match_log (created_at)`,
    ],
    "write",
  );
  // Additive columns for tables that predate them (SQLite has no ADD COLUMN
  // IF NOT EXISTS — the duplicate-column error IS the "already applied"
  // signal). Readers treat peak_rating 0 as "no recorded peak" and fall back
  // to the live rating, so old rows need no backfill.
  await addColumnIfMissing(db, "ranked_ratings", "peak_rating INTEGER NOT NULL DEFAULT 0");
  // Latency records (bits-regions.md § Stage 1, 2026-09-09): the seat's
  // median server-measured round trip per ranked match, and the reporter's
  // last measured ping on a feedback row. NULL = unknown (bots, pre-column
  // rows, a probe that never answered). Analytics only — nothing reads
  // them on a hot path.
  await addColumnIfMissing(db, "ranked_match_players", "rtt_ms INTEGER");
  await addColumnIfMissing(db, "feedback", "rtt_ms INTEGER");
  // "Last seen" (hq.md, 2026-09-11): bumped by GET /wallet at most once per
  // ten minutes per player, so active-player counts (day/week/month) read
  // straight off this column. NULL = never seen since the column landed.
  await addColumnIfMissing(db, "players", "last_seen_at INTEGER");
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players (last_seen_at)`);
  // One player per Clerk account (bits-accounts.md) — partial so the unlinked
  // majority (NULL) never collide. Outside the batch: players predates it.
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_players_clerk_user
      ON players (clerk_user_id) WHERE clerk_user_id IS NOT NULL`,
  );
  // Backfill pre-A4 tokens into player_tokens so every stored device token
  // keeps working. Guarded on "player has no token rows yet" rather than a
  // bare OR IGNORE: registration writes both tables, so only genuinely
  // pre-A4 players ever match — and a legacy row later pruned by the device
  // cap can never be resurrected by a reboot.
  await db.execute(
    `INSERT INTO player_tokens (token_hash, player_id, created_at)
      SELECT token_hash, id, created_at FROM players p
      WHERE NOT EXISTS (SELECT 1 FROM player_tokens t WHERE t.player_id = p.id)`,
  );
  // Backfill ranked_match_players from 1v1 history rows that predate the
  // table (2026-08-24). Only header rows with no participant rows yet — and
  // only single-subject rows (team brackets were born WITH the table, and
  // their comma-joined header ids are not subject ids). Team numbers are a
  // convention here (winner 1, loser 2): pre-table rows never recorded them.
  await db.execute(
    `INSERT OR IGNORE INTO ranked_match_players
       (match_id, subject_id, team, won, rating_before, rating_after, loadout)
     SELECT id, winner_id, 1, 1, winner_rating_before, winner_rating_after, winner_loadout
       FROM ranked_matches m
      WHERE instr(m.winner_id, ',') = 0
        AND NOT EXISTS (SELECT 1 FROM ranked_match_players p WHERE p.match_id = m.id)`,
  );
  await db.execute(
    `INSERT OR IGNORE INTO ranked_match_players
       (match_id, subject_id, team, won, rating_before, rating_after, loadout)
     SELECT id, loser_id, 2, 0, loser_rating_before, loser_rating_after, loser_loadout
       FROM ranked_matches m
      WHERE instr(m.loser_id, ',') = 0
        AND NOT EXISTS (SELECT 1 FROM ranked_match_players p
                         WHERE p.match_id = m.id AND p.subject_id = m.loser_id)`,
  );
};

const addColumnIfMissing = async (db: Db, table: string, columnDdl: string): Promise<void> => {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
  } catch (err) {
    if (!String((err as Error).message).includes("duplicate column")) throw err;
  }
};
