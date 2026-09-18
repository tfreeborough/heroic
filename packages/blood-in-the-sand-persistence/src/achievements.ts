/**
 * Achievement persistence (achievements.md § award pipeline): reads for the
 * evaluation pass and the one idempotent writer that lands a match's whole
 * achievement outcome — the per-match guard mark, counter upserts, unlock
 * rows, Glory rewards, and entitlement grants — in a single batch (one
 * libsql transaction). Deliberately knows nothing about definitions or
 * boards: the engine decides WHAT unlocked; this module only records it.
 */
import type { Db } from "./db";

export interface AchievementUnlockRecord {
  id: string;
  unlockedAt: number;
}

export interface EntitlementRecord {
  itemId: string;
  source: string;
  grantedAt: number;
}

/** All lifetime counters for a player — absent counters are simply 0. */
export const achievementCounters = async (db: Db, playerId: string): Promise<Record<string, number>> => {
  const result = await db.execute({
    sql: "SELECT counter, value FROM achievement_counters WHERE player_id = ?",
    args: [playerId],
  });
  const counters: Record<string, number> = {};
  for (const row of result.rows) counters[String(row["counter"])] = Number(row["value"]);
  return counters;
};

export const achievementUnlocks = async (db: Db, playerId: string): Promise<AchievementUnlockRecord[]> => {
  const result = await db.execute({
    sql: "SELECT achievement_id, unlocked_at FROM achievement_unlocks WHERE player_id = ? ORDER BY unlocked_at, achievement_id",
    args: [playerId],
  });
  return result.rows.map((row) => ({
    id: String(row["achievement_id"]),
    unlockedAt: Number(row["unlocked_at"]),
  }));
};

export const entitlementsOf = async (db: Db, playerId: string): Promise<EntitlementRecord[]> => {
  const result = await db.execute({
    sql: "SELECT item_id, source, granted_at FROM entitlements WHERE player_id = ? ORDER BY granted_at, item_id",
    args: [playerId],
  });
  return result.rows.map((row) => ({
    itemId: String(row["item_id"]),
    source: String(row["source"]),
    grantedAt: Number(row["granted_at"]),
  }));
};

/** LIFETIME Glory earned FROM RANKED MATCHES — the settle's `ranked:<match>`
 * rows only, never netted against spending (balance breaks as a milestone
 * counter the day debits exist). Merges, codes, dev grants and achievement
 * rewards are excluded (2026-09-10): the glory chain reads "from ranked
 * matches", and a lump from any of those carried the counter past a tier
 * outside any evaluation. */
export const gloryEarned = async (db: Db, playerId: string): Promise<number> => {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS earned FROM glory_ledger WHERE player_id = ? AND amount > 0 AND source LIKE 'ranked:%'",
    args: [playerId],
  });
  return Number(result.rows[0]?.["earned"] ?? 0);
};

/** One newly-fired unlock, with its rewards flattened for recording (the
 * definition's shape stays in the sim/engine — this layer records
 * outcomes). Rewards stack (Tom, 2026-08-04): one Glory total plus any
 * number of entitlement grants — hidden items and wearable titles
 * (`title:<deed-id>`) alike, one row each. */
export interface AchievementAward {
  id: string;
  glory?: number;
  entitlements?: readonly string[];
}

/** One other account this player shared a skirmish match with, from this
 * player's side: beside them (`with`) or across the sand (`against`). */
export interface CompanionDelta {
  otherId: string;
  with: number;
  against: number;
}

export interface CompanionRecord {
  otherId: string;
  withCount: number;
  againstCount: number;
}

export interface MatchAchievementsInput {
  /** The settle's idempotency root — same id recordRankedMatch keyed on. */
  matchId: string;
  playerId: string;
  /** ABSOLUTE post-match counter values (the adapter applied deltas +
   * streak semantics before calling). */
  counters: Record<string, number>;
  unlocks: AchievementAward[];
  /** Skirmish only (bits-skirmish-deeds.md): the humans this player shared
   * the room with. Rides the same guarded batch, so a retried apply can't
   * count a companion twice. */
  companions?: readonly CompanionDelta[];
}

/** Everyone this player has ever shared a skirmish room with. */
export const companionsOf = async (db: Db, playerId: string): Promise<CompanionRecord[]> => {
  const result = await db.execute({
    sql: "SELECT other_id, with_count, against_count FROM skirmish_companions WHERE player_id = ?",
    args: [playerId],
  });
  return result.rows.map((row) => ({
    otherId: String(row["other_id"]),
    withCount: Number(row["with_count"]),
    againstCount: Number(row["against_count"]),
  }));
};

/**
 * Land one player's whole match outcome atomically. Returns false when this
 * (match, player) was already applied — the crash-retry no-op, so a settle
 * retry can never double-count a counter or re-pay a reward. Single-writer
 * by design (the one game server process); the pre-check is not a
 * cross-process lock.
 */
export const applyMatchAchievements = async (db: Db, input: MatchAchievementsInput): Promise<boolean> => {
  const already = await db.execute({
    sql: "SELECT 1 FROM achievement_progress_marks WHERE match_id = ? AND player_id = ?",
    args: [input.matchId, input.playerId],
  });
  if (already.rows.length > 0) return false;

  const statements = [
    {
      sql: "INSERT OR IGNORE INTO achievement_progress_marks (match_id, player_id) VALUES (?, ?)",
      args: [input.matchId, input.playerId] as (string | number)[],
    },
    ...Object.entries(input.counters).map(([counter, value]) => ({
      sql: `INSERT INTO achievement_counters (player_id, counter, value) VALUES (?, ?, ?)
            ON CONFLICT (player_id, counter) DO UPDATE SET value = excluded.value`,
      args: [input.playerId, counter, value] as (string | number)[],
    })),
    ...input.unlocks.flatMap((unlock) => {
      const rows = [
        {
          sql: "INSERT OR IGNORE INTO achievement_unlocks (player_id, achievement_id) VALUES (?, ?)",
          args: [input.playerId, unlock.id] as (string | number)[],
        },
      ];
      if (unlock.glory) {
        rows.push({
          sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
                VALUES (?, ?, ?, ?)`,
          args: [input.playerId, unlock.glory, `achievement:${unlock.id}`, `achievement:${input.playerId}:${unlock.id}`],
        });
      }
      for (const itemId of unlock.entitlements ?? []) {
        rows.push({
          sql: `INSERT OR IGNORE INTO entitlements (player_id, item_id, source) VALUES (?, ?, ?)`,
          args: [input.playerId, itemId, `achievement:${unlock.id}`],
        });
      }
      return rows;
    }),
    ...(input.companions ?? []).map((c) => ({
      sql: `INSERT INTO skirmish_companions (player_id, other_id, with_count, against_count) VALUES (?, ?, ?, ?)
            ON CONFLICT (player_id, other_id) DO UPDATE SET
              with_count = with_count + excluded.with_count,
              against_count = against_count + excluded.against_count`,
      args: [input.playerId, c.otherId, c.with, c.against] as (string | number)[],
    })),
  ];
  await db.batch(statements, "write");
  return true;
};

export interface OwedBounties {
  /** Ledger rows written (or, on a dry run, that would be). */
  payments: number;
  glory: number;
  players: number;
}

/**
 * Pay every deed bounty that was earned but never paid (bits-deed-glory.md
 * § rollout) — for the day bounties land on deeds players already hold, or
 * a later pass starts paying a deed that used to pay nothing. Writes the
 * SAME ledger row the live award writes (same source, same idempotency
 * key), so it can never pay a deed twice and is safe to run again. It only
 * ever ADDS missing payments; a bounty that was raised is not topped up.
 * Takes plain `deedId → Glory` so this package stays blind to definitions.
 */
export const payOwedBounties = async (
  db: Db,
  bounties: Readonly<Record<string, number>>,
  opts: { apply: boolean },
): Promise<OwedBounties> => {
  const paying = Object.entries(bounties).filter(([, glory]) => glory > 0);
  const owed = { payments: 0, glory: 0, players: new Set<string>() };
  for (const [deedId, glory] of paying) {
    const rows = await db.execute({
      sql: `SELECT u.player_id FROM achievement_unlocks u
            WHERE u.achievement_id = ?
              AND NOT EXISTS (SELECT 1 FROM glory_ledger l
                              WHERE l.idempotency_key = 'achievement:' || u.player_id || ':' || u.achievement_id)`,
      args: [deedId],
    });
    for (const row of rows.rows) owed.players.add(String(row["player_id"]));
    owed.payments += rows.rows.length;
    owed.glory += rows.rows.length * glory;
  }
  if (opts.apply && owed.payments > 0) {
    await db.batch(
      paying.map(([deedId, glory]) => ({
        sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
              SELECT player_id, ?, 'achievement:' || achievement_id, 'achievement:' || player_id || ':' || achievement_id
              FROM achievement_unlocks WHERE achievement_id = ?`,
        args: [glory, deedId] as (string | number)[],
      })),
      "write",
    );
  }
  return { payments: owed.payments, glory: owed.glory, players: owed.players.size };
};
