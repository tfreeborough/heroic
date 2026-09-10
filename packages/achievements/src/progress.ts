/**
 * Progress views over a board (achievements.md § The Chronicle v2 — the
 * celebration band): pure helpers the deeds screen ranks with. Nothing here
 * awards anything; it only reads counters and unlock state the engine and
 * server already own.
 */
import type { AchievementDef, Counters, NodeVisibility } from "./types";

export interface NearlyThere<S> {
  def: AchievementDef<S>;
  value: number;
  threshold: number;
  /** value / threshold, clamped to [0, 1). */
  fraction: number;
}

/**
 * The frontier milestone deeds closest to landing: ranked by fraction
 * descending, then by threshold ascending (ties at 0 — a fresh player — put
 * the smallest goals first, so the first three things on the band are the
 * first three things worth doing), then by board order for a stable list.
 * Feats and capstones have no measurable progress and never appear.
 */
export const nearlyThere = <S>(
  defs: readonly AchievementDef<S>[],
  vis: ReadonlyMap<string, NodeVisibility>,
  counters: Counters,
  limit: number,
): NearlyThere<S>[] => {
  const out: NearlyThere<S>[] = [];
  for (const def of defs) {
    if (vis.get(def.id) !== "frontier" || def.trigger.kind !== "milestone") continue;
    const threshold = def.trigger.threshold;
    const value = Math.min(counters[def.trigger.counter] ?? 0, threshold);
    out.push({ def, value, threshold, fraction: Math.min(value / threshold, 0.999) });
  }
  out.sort((a, b) => b.fraction - a.fraction || a.threshold - b.threshold);
  return out.slice(0, Math.max(0, limit));
};

/** Unlocks newest-first, capped — the band's "latest deeds" strip. */
export const latestUnlocks = <T extends { unlockedAt: number }>(unlocks: readonly T[], limit: number): T[] =>
  [...unlocks].sort((a, b) => b.unlockedAt - a.unlockedAt).slice(0, Math.max(0, limit));
