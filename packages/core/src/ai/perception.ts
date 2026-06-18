import { angleDiff, angleTo, distance, type Vec2 } from "../math/vec2";
import type { NavGrid } from "../pathfinding/navgrid";
import type { RepathBudget } from "./pursue";

/**
 * Perception + the config every archetype shares (see
 * docs/design/enemy-behaviour.md, layer 2). Split out from the runtime so
 * archetype modules can import these without pulling in the brain wrapper.
 */

/** Everything an archetype is allowed to sense this tick. */
export interface EnemyPerception {
  selfPos: Vec2;
  playerPos: Vec2;
  /** The player's facing angle in radians (gameplay state, not physics). */
  playerFacing: number;
  /** Positions of nearby living allies, for separation. */
  neighbors: readonly Vec2[];
  /**
   * Clear straight line to the player? When false (a wall is between), the
   * runtime routes engaging movers around it via A* instead of steering into
   * the wall. Optional: omitted ⇒ treated as visible (no pathfinding) — keeps
   * archetypes and their tests oblivious to navigation.
   */
  hasLineOfSight?: boolean;
  /** The level's navigation grid, for routing when `hasLineOfSight` is false. */
  navGrid?: NavGrid | null;
  /**
   * Optional shared per-step A* allowance. Passed to `pursue` so the whole crowd
   * re-paths at most N times per step (the rest defer to a later step), bounding
   * the pathfinding cost when many movers lose sight together. Omitted ⇒ no cap.
   */
  repathBudget?: RepathBudget;
}

/**
 * The config slice the *runtime* needs from every creature, whatever its
 * archetype. Each archetype's own config extends this with its specifics
 * (aggro radius, orbit distance, …). Note: aggro is deliberately NOT here —
 * "what do I do when the player is far" varies per archetype, so it's
 * archetype-owned (a chaser idles, an ambusher lies dormant). The runtime
 * only owns separation + the speed clamp.
 */
export interface CommonConfig {
  /** Normal speed, px/s — the usual movement cap *and* the separation strength. */
  speed: number;
  /** Allies inside this radius push the enemy away (crowd spreading). */
  separationRadius: number;
  /**
   * Hard ceiling for committed bursts that exceed `speed` (e.g. a charger's
   * dash). Defaults to `speed`. Kept separate so separation stays scaled to the
   * *normal* speed — otherwise a fast dasher would shove allies at dash speed.
   */
  maxSpeed?: number;
}

/** Shared "no intent this tick" result; frozen so a returner can't be mutated. */
export const ZERO_VELOCITY: Vec2 = Object.freeze({ x: 0, y: 0 });

/** Convenience for the common "stand down when the player is beyond X" rule. */
export const beyondAggro = (p: EnemyPerception, aggroRadius: number): boolean =>
  distance(p.selfPos, p.playerPos) > aggroRadius;

/**
 * How far past `aggroRadius` an engaged creature will keep pursuing before it
 * gives up — the "leash", as a multiple of its notice range. Deliberately large:
 * once something aggros you it chases across (soon) a much bigger world, letting
 * go only if you get hopelessly far away (e.g. it's stuck behind geometry). One
 * knob for every pursuer; raise/lower to make hounding more or less relentless.
 */
export const LEASH_MULT = 30;

/**
 * Sticky aggro with hysteresis. Engages when the player first comes within
 * `aggroRadius`, then *stays* engaged — pursuing far past where it first noticed
 * — until the player passes `leashRadius` (default `aggroRadius × LEASH_MULT`),
 * at which point it releases. The gap between the two thresholds is the point: a
 * tight notice range can coexist with a huge give-up range, and a creature
 * loitering at the boundary can't flip-flop between chase and idle every step.
 *
 * Mutates and reads `state.engaged` (carry it on the archetype's per-instance
 * state), and returns the new engaged value — the caller acts when true, idles
 * when false. Stays deterministic: pure function of position + prior flag.
 */
export const updateAggro = (
  p: EnemyPerception,
  state: { engaged: boolean },
  aggroRadius: number,
  leashRadius: number = aggroRadius * LEASH_MULT,
): boolean => {
  const d = distance(p.selfPos, p.playerPos);
  state.engaged = state.engaged ? d <= leashRadius : d <= aggroRadius;
  return state.engaged;
};

/**
 * How far (radians, unsigned) the enemy sits from the centre of the player's
 * facing direction. 0 = dead ahead of the player. Drives the circler.
 */
export const angleOffPlayerFacing = (p: EnemyPerception): number =>
  Math.abs(angleDiff(angleTo(p.playerPos, p.selfPos), p.playerFacing));
