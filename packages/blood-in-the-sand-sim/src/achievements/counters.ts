/**
 * BITS's lifetime-counter vocabulary (achievements.md § content sketch) and
 * the one place a MatchSummary turns into counter deltas. Deltas are
 * ADDITIVE; streaks are not (reset/high-water) — the adapter folds
 * streakUpdates() from the engine in separately, and `glory_earned` is read
 * straight off the ledger rather than counted here.
 */
import type { AbilityId, WeaponId } from "../config";
import { wonMatch, type MatchSummary } from "./summary";

/**
 * The undying streak (Tom, 2026-08-25 — the first-win ceremony audit):
 * consecutive ranked WINS without dying once. BITS-specific — the engine's
 * streakUpdates() only knows won/lost — and folded in by the adapter the
 * same way: `_current` resets, `_best` high-waters, and Still Standing is a
 * milestone on `_best`. Any death (a lost round IS a death, so every loss
 * breaks it) resets the run.
 */
export const UNDYING_STREAK = "undying_streak";

export const undyingStreakUpdates = (
  before: Record<string, number>,
  summary: MatchSummary,
  playerId: number,
): Record<string, number> => {
  const undying = wonMatch(summary, playerId) && (summary.stats[playerId]?.deaths ?? 1) === 0;
  const now = undying ? (before[`${UNDYING_STREAK}_current`] ?? 0) + 1 : 0;
  return {
    [`${UNDYING_STREAK}_current`]: now,
    [`${UNDYING_STREAK}_best`]: Math.max(before[`${UNDYING_STREAK}_best`] ?? 0, now),
  };
};

export const COUNTERS = {
  rankedMatches: "ranked_matches",
  rankedWins: "ranked_wins",
  killingBlows: "killing_blows",
  damageDealt: "damage_dealt",
  healingDone: "healing_done",
  /** Supplied by the adapter from the Glory ledger (positive rows only) —
   * never accumulated here. */
  gloryEarned: "glory_earned",
  roundsWonWith: (weapon: WeaponId): string => `rounds_won:${weapon}`,
  castsOf: (ability: AbilityId): string => `cast:${ability}`,
  // ── Wave 3 (achievements.md § Wave-3, the 2v2 board) ──
  /** Per-bracket match/win tallies — `ranked_matches:2v2` roots the 2v2
   * board; the 1v1 pair is written too (unused today, cheap, and a 1v1-only
   * deed later needs no backfill). */
  rankedMatchesIn: (bracket: string): string => `ranked_matches:${bracket}`,
  rankedWinsIn: (bracket: string): string => `ranked_wins:${bracket}`,
  /** The partnership tallies. Every one is structurally zero in a 1v1
   * (no teammate, one enemy) — REQUIRED for the 2v2 board's `accepts` gate
   * to be sound: a 1v1 match must never move a counter a 2v2 milestone reads
   * (the crossing trap, achievements.md § M4 retired). */
  assists: "assists",
  doubleKills: "double_kills",
  clutchRounds: "clutch_rounds",
  revengeKills: "revenge_kills",
  // ── The Blood Tide (bits-sands-deeds.md) ──
  /** Rounds in which the tide rose — roots the chapter. */
  sandsRounds: "sands_rounds",
  /** Killing blows landed after the tide rose — the chapter's chain. */
  sandsKills: "sands_kills",
  // ── Skirmish (bits-skirmish-deeds.md) ──
  /** Every skirmish counter lives under this prefix, and ONLY skirmish
   * summaries write under it — the namespace is what keeps every board's
   * `accepts` gate sound without exempting milestones (the crossing trap,
   * achievements.md § M4 retired): a ranked match never moves a skirmish
   * counter and a skirmish match never moves a ranked one. Test-enforced. */
  skirmishMatches: "skirmish:matches",
  /** Brawl rooms only — structurally zero in every team-shaped room. */
  skirmishBrawlMatches: "skirmish:brawl_matches",
  /** Adapter-written from the companions table: the most matches shared
   * with any one other account (the Regulars chain). */
  skirmishCompanionBest: "skirmish:companion_best",
} as const;

export const SKIRMISH_COUNTER_PREFIX = "skirmish:";

/** The skirmish namespace's deltas — nothing ranked, ever. */
const skirmishDeltas = (summary: MatchSummary): Record<string, number> => {
  const deltas: Record<string, number> = { [COUNTERS.skirmishMatches]: 1 };
  if (summary.teamCount > 2) deltas[COUNTERS.skirmishBrawlMatches] = 1;
  return deltas;
};

/** Zero-valued deltas are omitted — no point writing rows for them. */
export const counterDeltas = (summary: MatchSummary, playerId: number): Record<string, number> => {
  const stats = summary.stats[playerId];
  const player = summary.players.find((p) => p.id === playerId);
  if (!stats || !player) return {};
  if (!summary.ranked) return skirmishDeltas(summary);
  const deltas: Record<string, number> = { [COUNTERS.rankedMatches]: 1 };
  const won = wonMatch(summary, playerId);
  if (won) deltas[COUNTERS.rankedWins] = 1;
  if (summary.bracket) {
    deltas[COUNTERS.rankedMatchesIn(summary.bracket)] = 1;
    if (won) deltas[COUNTERS.rankedWinsIn(summary.bracket)] = 1;
  }
  if (stats.assists > 0) deltas[COUNTERS.assists] = stats.assists;
  if (stats.doubleKills > 0) deltas[COUNTERS.doubleKills] = stats.doubleKills;
  if (stats.clutchRounds > 0) deltas[COUNTERS.clutchRounds] = stats.clutchRounds;
  if (stats.revengeKills > 0) deltas[COUNTERS.revengeKills] = stats.revengeKills;
  if (stats.tideRounds > 0) deltas[COUNTERS.sandsRounds] = stats.tideRounds;
  if (stats.tideKills > 0) deltas[COUNTERS.sandsKills] = stats.tideKills;
  if (stats.kills > 0) deltas[COUNTERS.killingBlows] = stats.kills;
  if (stats.damageDealt > 0) deltas[COUNTERS.damageDealt] = stats.damageDealt;
  // Wave 2: healing credits its SOURCE (heal events carry casterId) — a
  // font healing three allies is the caster's healing done, not theirs.
  if (stats.healingDealt > 0) deltas[COUNTERS.healingDone] = stats.healingDealt;
  if (player.weapon && stats.roundsWon > 0) deltas[COUNTERS.roundsWonWith(player.weapon)] = stats.roundsWon;
  for (const [ability, n] of Object.entries(stats.casts)) {
    if (n) deltas[COUNTERS.castsOf(ability as AbilityId)] = n;
  }
  return deltas;
};
