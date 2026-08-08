/**
 * The one evaluation function: given the finished match summary and the
 * player's lifetime counters before/after it, which definitions newly
 * unlocked? Pure — the adapter reads state, calls this, and persists what
 * comes back. "New" is structural: milestones fire on the threshold crossing
 * (before < t ≤ after, exactly once), feats only while still locked; both
 * are additionally filtered against the already-unlocked set so a replayed
 * evaluation can never re-award.
 */
import type { AchievementDef, BoardDef, Counters } from "./types";

export interface EvaluateInput<S> {
  defs: readonly AchievementDef<S>[];
  boards: Readonly<Record<string, BoardDef<S>>>;
  summary: S;
  /** The player's key within the summary (BITS: the seat id). */
  playerKey: number;
  /** Lifetime counters before / after this match's deltas were applied. */
  before: Counters;
  after: Counters;
  unlocked: ReadonlySet<string>;
}

export const evaluate = <S>(input: EvaluateInput<S>): AchievementDef<S>[] => {
  const fresh: AchievementDef<S>[] = [];
  for (const def of input.defs) {
    if (input.unlocked.has(def.id)) continue;
    // An unregistered board is an authoring error — fail closed (no award).
    // The accepts gate binds EVERYTHING on the board — sound only while
    // every counter-moving apply also passes the gate (true today: deeds
    // are ranked-only, decided 2026-08-08 after a built-then-reverted
    // skirmish-counting experiment). If a non-accepted context ever applies
    // counters again, milestones must be exempted here or their crossings
    // are consumed without firing (evaluate sees each before/after once).
    const board = input.boards[def.board];
    if (!board || (board.accepts && !board.accepts(input.summary))) continue;
    const t = def.trigger;
    if (t.kind === "milestone") {
      const before = input.before[t.counter] ?? 0;
      const after = input.after[t.counter] ?? 0;
      if (before < t.threshold && after >= t.threshold) fresh.push(def);
    } else if (t.test(input.summary, input.playerKey)) {
      fresh.push(def);
    }
  }
  return fresh;
};
