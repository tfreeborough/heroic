import { angleDiff, angleTo, distance, type Vec2 } from "../math/vec2";

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
 * How far (radians, unsigned) the enemy sits from the centre of the player's
 * facing direction. 0 = dead ahead of the player. Drives the circler.
 */
export const angleOffPlayerFacing = (p: EnemyPerception): number =>
  Math.abs(angleDiff(angleTo(p.playerPos, p.selfPos), p.playerFacing));
