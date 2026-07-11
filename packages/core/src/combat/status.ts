/**
 * Damage-over-time container (the "bleed/burn" primitive from
 * docs/design/modifiers-and-effects.md). Pure data + pure functions, like the
 * projectile module: callers own the array, hp application, and events.
 *
 * Deliberately outside the resolveAttack pipeline: ticks deal FIXED damage —
 * no variance, no crit, no defense, and crucially no rng draws, so stacking
 * dots never perturbs a deterministic rng stream. The future talent effect
 * dispatch (onHitDealt handlers etc.) applies its dots through this same
 * container.
 */

export interface DotState {
  /** Ticks still to fire; the dot is removed when this reaches 0. */
  ticksLeft: number;
  /** Seconds until the next tick fires. */
  tLeft: number;
  /** Seconds between ticks (tLeft reloads from this). */
  interval: number;
  /** Fixed damage per tick. */
  damage: number;
  /** Who applied it — attribution for events/kill credit. */
  sourceId: number;
}

/** One fired tick — the caller applies it to hp and emits its event. */
export interface DotTick {
  damage: number;
  sourceId: number;
}

export const applyDot = (dots: DotState[], dot: DotState): void => {
  dots.push(dot);
};

/**
 * Advance every dot by dt, returning the ticks that fired (in array order —
 * deterministic). Finished dots are removed in place; a large dt can fire a
 * dot more than once.
 */
export const stepDots = (dots: DotState[], dt: number): DotTick[] => {
  const fired: DotTick[] = [];
  let write = 0;
  for (let read = 0; read < dots.length; read++) {
    const d = dots[read]!;
    d.tLeft -= dt;
    while (d.tLeft <= 0 && d.ticksLeft > 0) {
      fired.push({ damage: d.damage, sourceId: d.sourceId });
      d.ticksLeft -= 1;
      d.tLeft += d.interval;
    }
    if (d.ticksLeft > 0) dots[write++] = d;
  }
  dots.length = write;
  return fired;
};
