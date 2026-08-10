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

// ── Stacking-intensity dot (the "poison" primitive) ────────────────────────
// Where DotState is a fixed drip with its own clock per application, a
// stacking dot is ONE state per victim: every application adds a stack
// (capped) and refreshes a single shared expiry clock; damage per tick
// scales with stacks and ALL stacks fall off together when the clock runs
// out. Bleed punishes getting tagged once; this punishes staying in reach.

export interface StackingDotConfig {
  /** Cap on concurrent stacks. */
  maxStacks: number;
  /** Seconds between ticks. */
  interval: number;
  /** Fixed damage per tick PER STACK — no variance, crit, defense, or rng. */
  damagePerStack: number;
  /** Seconds until every stack expires together; refreshed on application. */
  duration: number;
}

export interface StackingDotState {
  stacks: number;
  /** Seconds until the whole stack expires (≤ 0 = spent; caller removes). */
  expiresLeft: number;
  /** Seconds until the next tick fires. */
  tLeft: number;
  interval: number;
  damagePerStack: number;
  /** LAST applier — kill credit follows the freshest hand (one shared state
   * means two poisoners on one victim pool their stacks; acceptable, and it
   * keeps the victim's ring/stack read singular). */
  sourceId: number;
}

/**
 * One application: +1 stack (capped) on the existing state, or a fresh
 * 1-stack state when `prior` is null/spent. Always refreshes the shared
 * clock and re-attributes to the latest applier. Returns the live state —
 * the caller stores it back.
 */
export const applyStackingDot = (
  prior: StackingDotState | null,
  config: StackingDotConfig,
  sourceId: number,
): StackingDotState => {
  if (prior === null || prior.expiresLeft <= 0) {
    return {
      stacks: 1,
      expiresLeft: config.duration,
      tLeft: config.interval,
      interval: config.interval,
      damagePerStack: config.damagePerStack,
      sourceId,
    };
  }
  prior.stacks = Math.min(config.maxStacks, prior.stacks + 1);
  prior.expiresLeft = config.duration;
  prior.sourceId = sourceId;
  return prior;
};

/**
 * Advance a stacking dot by dt, returning the ticks that fired (a large dt
 * can fire several). Time is walked in sub-steps so a tick scheduled past
 * the expiry instant never lands; when `expiresLeft` reaches 0 the state is
 * spent and the caller drops it.
 */
export const stepStackingDot = (dot: StackingDotState, dt: number): DotTick[] => {
  const fired: DotTick[] = [];
  let t = dt;
  while (t > 0 && dot.expiresLeft > 0) {
    const step = Math.min(t, dot.tLeft, dot.expiresLeft);
    dot.tLeft -= step;
    dot.expiresLeft -= step;
    t -= step;
    if (dot.tLeft <= 0) {
      fired.push({ damage: dot.stacks * dot.damagePerStack, sourceId: dot.sourceId });
      dot.tLeft += dot.interval;
    }
  }
  return fired;
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
