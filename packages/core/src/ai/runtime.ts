import { add, length, type Vec2 } from "../math/vec2";
import { clampSpeed, separation } from "./steering";
import { initPathState, pursue, type PathState } from "./pursue";
import type { CommonConfig, EnemyPerception } from "./perception";

/**
 * The archetype/runtime split (see docs/design/enemy-behaviour.md, layer 2).
 *
 * An `Archetype` is a reusable behaviour pattern (an FSM), named by what it
 * *does* — `chaser`, `circler` — not by which creature uses it. It owns its
 * states and transitions and returns an *intent* velocity. Every archetype
 * implements this one interface, so adding a new behaviour is writing a new
 * module — nothing here, and no central `switch`, changes. That uniformity is
 * also the escape hatch for bespoke bosses: a hand-written brain is just
 * another object with `initState` + `tick`.
 */
/**
 * A render hint a brain can expose about its current internal state (e.g. a
 * charge wind-up), so the app can draw a "tell" without reaching into the
 * opaque `state`. Mirrors how the app reads the ranged attack cycle.
 */
export interface Telegraph {
  /** What's being telegraphed, e.g. "charge". Open string so new kinds need no edits here. */
  kind: string;
  /** 0 → 1 over the tell's build-up. */
  progress: number;
  /** Optional aim/facing in radians, for directional tells. */
  dir?: number;
  /** Optional reach (px) of a directional tell, so the renderer can show how far it goes. */
  length?: number;
}

export interface Archetype<Config extends CommonConfig, State> {
  readonly id: string;
  /**
   * Fresh per-instance state. `index` is the spawn ordinal, so an archetype
   * can vary fixed quirks per individual (e.g. alternating circle direction)
   * deterministically, without an RNG.
   */
  initState(config: Config, index: number): State;
  /**
   * One fixed step. Returns the *intent* velocity (px/s) — pre-separation,
   * pre-clamp; the runtime applies those. Mutates `state` for FSM transitions
   * and timers. Deterministic: same (state, config, perception) in → same
   * intent out, which keeps enemy AI replayable and unit-testable.
   */
  tick(state: State, config: Config, perception: EnemyPerception, dt: number): Vec2;
  /**
   * Optional: a render hint for the brain's current internal state (a charge
   * wind-up, etc.), or null when there's nothing to show. Lets the renderer
   * draw a tell without decoding `state`.
   */
  telegraph?(state: State, config: Config): Telegraph | null;
}

/**
 * A live brain: an archetype bound to its config and per-instance state, with
 * the Config/State types erased so a heterogeneous list of enemies can share
 * one shape. Construction (`makeBrain`) is fully type-checked; thereafter only
 * the bound archetype ever touches its own state, so the erasure is safe.
 */
export interface Brain {
  readonly archetype: Archetype<CommonConfig, unknown>;
  readonly config: CommonConfig;
  state: unknown;
  /** Runtime-owned routing cache, used when the runtime pathfinds around walls. */
  nav: PathState;
}

/** Bind an archetype to a config and spawn an instance's starting state. */
export const makeBrain = <Config extends CommonConfig, State>(
  archetype: Archetype<Config, State>,
  config: Config,
  index = 0,
): Brain =>
  ({
    archetype: archetype as Archetype<CommonConfig, unknown>,
    config,
    state: archetype.initState(config, index),
    nav: initPathState(),
  });

/**
 * Advance a brain one fixed step and return its desired velocity. This is the
 * runtime wrapper: it ticks the archetype for intent, then applies the two
 * universal concerns — blend separation from nearby allies (on for everyone,
 * so crowds spread), and clamp to the creature's top speed so stacked
 * behaviours can't exceed it.
 */
export const tickBrain = (brain: Brain, perception: EnemyPerception, dt: number): Vec2 => {
  const intent = brain.archetype.tick(brain.state, brain.config, perception, dt);

  // Route around walls: when the archetype wants to engage (normal-speed intent)
  // but a wall blocks line of sight, replace its straight-line intent with an A*
  // path to the player. Skipped for idle intent (≈0, e.g. a dormant ambusher —
  // it stays hidden) and for committed bursts (intent above normal speed, e.g. a
  // charger's dash — it stays a dodgeable straight line). When it can see the
  // player, the archetype's own steering (orbit/kite/seek) runs untouched.
  let move = intent;
  const speed = length(intent);
  if (
    perception.hasLineOfSight === false &&
    perception.navGrid &&
    speed > 1 &&
    speed <= brain.config.speed + 1e-6
  ) {
    move = pursue(perception.selfPos, perception.playerPos, speed, perception.navGrid, brain.nav, dt);
  }

  // Separation is scaled to the *normal* speed (so a dasher doesn't shove allies
  // at dash speed); the final clamp allows a committed burst up to maxSpeed.
  const spread = separation(
    perception.selfPos,
    perception.neighbors,
    brain.config.speed,
    brain.config.separationRadius,
  );
  return clampSpeed(add(move, spread), brain.config.maxSpeed ?? brain.config.speed);
};

/** Read a brain's render-time telegraph, if its archetype exposes one. */
export const brainTelegraph = (brain: Brain): Telegraph | null =>
  brain.archetype.telegraph?.(brain.state, brain.config) ?? null;
