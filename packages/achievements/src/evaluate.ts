/**
 * The one evaluation function: given the finished match summary and the
 * player's lifetime counters before/after it, which definitions newly
 * unlocked? Pure — the adapter reads state, calls this, and persists what
 * comes back. "New" is structural: milestones fire when the counter is AT
 * OR PAST the threshold and the deed isn't unlocked yet, feats only while
 * still locked; both are filtered against the already-unlocked set, which is
 * what guarantees once-only — a replayed evaluation can never re-award.
 *
 * Milestones were crossing-only (before < t ≤ after) until 2026-09-10. That
 * left a deed stuck forever whenever its counter moved past the line
 * OUTSIDE an evaluation: a retuned threshold moves the chain id under a
 * counter already past it (Lights Out 1→5, the tripled weapon tiers), and
 * an adapter-supplied counter can jump in a lump (glory_earned via a merge
 * or a code). "At or past" catches every one of those up on the next
 * accepted match — a one-time ceremony flood for veterans, and correct.
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
  const capstones: AchievementDef<S>[] = [];
  for (const def of input.defs) {
    if (input.unlocked.has(def.id)) continue;
    // An unregistered board is an authoring error — fail closed (no award).
    // The accepts gate binds EVERYTHING on the board. A non-accepted context
    // moving a counter past a threshold no longer loses the award (the old
    // crossing trap, achievements.md § M4 retired): the milestone simply
    // fires on the next accepted match, since "at or past" needs no
    // crossing to observe.
    const board = input.boards[def.board];
    if (!board || (board.accepts && !board.accepts(input.summary))) continue;
    const t = def.trigger;
    if (t.kind === "milestone") {
      if ((input.after[t.counter] ?? 0) >= t.threshold) fresh.push(def);
    } else if (t.kind === "feat") {
      if (t.test(input.summary, input.playerKey)) fresh.push(def);
    } else {
      capstones.push(def);
    }
  }
  // Second pass: capstones see everything unlocked so far INCLUDING this
  // match's fresh awards. Loop until a pass adds nothing, so a capstone that
  // requires another capstone still lands the same match.
  if (capstones.length > 0) {
    const have = new Set<string>(input.unlocked);
    for (const d of fresh) have.add(d.id);
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const def of capstones) {
        if (have.has(def.id)) continue;
        const t = def.trigger as Extract<typeof def.trigger, { kind: "capstone" }>;
        if (t.requires.every((id) => have.has(id))) {
          have.add(def.id);
          fresh.push(def);
          progressed = true;
        }
      }
    }
  }
  return fresh;
};
