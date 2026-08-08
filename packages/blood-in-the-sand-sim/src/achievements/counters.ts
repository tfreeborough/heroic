/**
 * BITS's lifetime-counter vocabulary (achievements.md § content sketch) and
 * the one place a MatchSummary turns into counter deltas. Deltas are
 * ADDITIVE; streaks are not (reset/high-water) — the adapter folds
 * streakUpdates() from the engine in separately, and `glory_earned` is read
 * straight off the ledger rather than counted here.
 */
import type { AbilityId, WeaponId } from "../config";
import { wonMatch, type MatchSummary } from "./summary";

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
} as const;

/** Zero-valued deltas are omitted — no point writing rows for them. */
export const counterDeltas = (summary: MatchSummary, playerId: number): Record<string, number> => {
  const stats = summary.stats[playerId];
  const player = summary.players.find((p) => p.id === playerId);
  if (!stats || !player) return {};
  const deltas: Record<string, number> = { [COUNTERS.rankedMatches]: 1 };
  if (wonMatch(summary, playerId)) deltas[COUNTERS.rankedWins] = 1;
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
