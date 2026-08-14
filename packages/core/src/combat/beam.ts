/**
 * The beam link — the third attack shape's lifecycle (the healing-gun
 * primitive from Blood in the Sand's store arms, built generic). A beam is
 * a maintained CONNECTION: while the wielder's game code keeps nominating
 * the same target, the link accumulates unbroken seconds and fires ticks on
 * a fixed interval; any change of target — including to none — resets the
 * link completely. That reset is the design load-bearing part: ramp-over-
 * link-time effects (heals that strengthen, damage that builds) get their
 * "protect the connection" gameplay from it for free.
 *
 * Pure data + a pure step, like status.ts: the caller owns target
 * eligibility, what a tick does, and where the state lives. No rng anywhere.
 */

export interface BeamState {
  /** The linked entity. The caller re-nominates every step; a different id
   * is a NEW link, never a transfer. */
  targetId: number;
  /** Unbroken seconds on this target — ramp effects read this. */
  linkSeconds: number;
  /** Seconds until the next tick fires (reloads from the interval). */
  tLeft: number;
  /** Grace countdown while NOTHING is nominated: the link remembers its
   * target — ramp and tick clocks frozen, no ticks — and resumes if the
   * SAME id is re-nominated before this runs out. 0 = live. */
  graceLeft: number;
}

export interface BeamStep {
  state: BeamState | null;
  /** Ticks that fired this step (a large dt can fire several). */
  ticks: number;
}

/**
 * Advance the link one step. `targetId` is this step's nomination (null =
 * no eligible target): same id accumulates and may tick, a different id
 * starts a fresh link (first tick a full interval later — a beam earns its
 * first tick by holding). A null nomination enters GRACE instead of
 * dropping (when graceSeconds > 0): the link holds its memory — ramp and
 * tick clocks frozen, no ticks — and resumes intact if the same target is
 * re-nominated in time; a DIFFERENT nomination during grace abandons the
 * memory for a fresh link (an eligible target now beats a remembered one).
 */
export const stepBeamLink = (
  prev: BeamState | null,
  targetId: number | null,
  interval: number,
  dt: number,
  graceSeconds = 0,
): BeamStep => {
  if (targetId === null) {
    if (prev === null) return { state: null, ticks: 0 };
    const graceLeft = (prev.graceLeft > 0 ? prev.graceLeft : graceSeconds) - dt;
    if (graceLeft <= 0) return { state: null, ticks: 0 };
    prev.graceLeft = graceLeft;
    return { state: prev, ticks: 0 };
  }
  if (prev === null || prev.targetId !== targetId) {
    return { state: { targetId, linkSeconds: dt, tLeft: interval - dt, graceLeft: 0 }, ticks: 0 };
  }
  prev.graceLeft = 0; // re-secured (or never lost)
  prev.linkSeconds += dt;
  prev.tLeft -= dt;
  let ticks = 0;
  // Epsilon: accumulated float dts (15 × 1/30 ≈ 0.49999…) must not leave a
  // tick stranded one ulp above zero — a beam ticking a frame late every
  // few seconds would drift audibly against its own interval.
  while (prev.tLeft <= 1e-9) {
    ticks += 1;
    prev.tLeft += interval;
  }
  return { state: prev, ticks };
};
