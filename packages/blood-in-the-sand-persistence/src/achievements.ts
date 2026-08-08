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

/** LIFETIME Glory earned — credits only, never netted against spending
 * (balance breaks as a milestone counter the day debits exist). */
export const gloryEarned = async (db: Db, playerId: string): Promise<number> => {
  const result = await db.execute({
    sql: "SELECT COALESCE(SUM(amount), 0) AS earned FROM glory_ledger WHERE player_id = ? AND amount > 0",
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

export interface MatchAchievementsInput {
  /** The settle's idempotency root — same id recordRankedMatch keyed on. */
  matchId: string;
  playerId: string;
  /** ABSOLUTE post-match counter values (the adapter applied deltas +
   * streak semantics before calling). */
  counters: Record<string, number>;
  unlocks: AchievementAward[];
}

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
  ];
  await db.batch(statements, "write");
  return true;
};
