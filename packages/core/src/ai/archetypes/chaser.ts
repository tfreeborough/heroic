import type { Vec2 } from "../../math/vec2";
import { createRng } from "../../rng";
import { seek } from "../steering";
import { updateAggro, ZERO_VELOCITY, type CommonConfig } from "../perception";
import type { Archetype } from "../runtime";

/**
 * The relentless walker (the zombie's archetype). One state, no transitions:
 * head straight at the player, forever. Engages within aggro and then chases on
 * a long leash (see updateAggro), standing down only once the player is far
 * enough away to slip it.
 *
 * Two bits of per-individual dynamism stop a horde feeling uniform:
 *  - Each one *spawns* at a slightly different speed — config.speed ±
 *    SPEED_VARIANCE — picked deterministically from its spawn index (via the
 *    shared seeded PRNG), so a wave looks varied yet replays identically.
 *  - While it's engaged it *accelerates*: +RAMP_PER_SEC of its spawn speed every
 *    second, capped at MAX_SPEED_MULT× that spawn speed. The gain lives in
 *    per-instance state, so it persists across the whole chase (and across brief
 *    losses of aggro), and only resets when the creature itself despawns. It
 *    neither accrues nor decays while idle (not engaged).
 */

/** Spawn-speed spread: each chaser starts within ±this fraction of config.speed. */
export const SPEED_VARIANCE = 0.2;
/** While chasing, speed grows by this fraction of the spawn speed per second (linear). */
export const RAMP_PER_SEC = 0.01;
/** Hard ceiling on the ramp: speed never exceeds this multiple of the spawn speed. */
export const MAX_SPEED_MULT = 2;

export interface ChaserConfig extends CommonConfig {
  /** Beyond this distance to the player the chaser idles. */
  aggroRadius: number;
}

export interface ChaserState {
  /** This individual's spawn speed (px/s): config.speed ±SPEED_VARIANCE. The ramp baseline. */
  baseSpeed: number;
  /** Current speed (px/s); ramps toward baseSpeed×MAX_SPEED_MULT while chasing. Persists per individual. */
  speed: number;
  /** Sticky aggro flag for the leash hysteresis (see updateAggro). */
  engaged: boolean;
}

export const chaser: Archetype<ChaserConfig, ChaserState> = {
  id: "chaser",
  // Deterministic per-spawn speed: seed the shared PRNG with the spawn index so a
  // horde varies yet replays identically (same idiom as combat's seeded rolls).
  initState: (config, index) => {
    const offset = (createRng(index).next() * 2 - 1) * SPEED_VARIANCE;
    const baseSpeed = config.speed * (1 + offset);
    return { baseSpeed, speed: baseSpeed, engaged: false };
  },
  tick: (state, config, p, dt): Vec2 => {
    if (!updateAggro(p, state, config.aggroRadius)) return ZERO_VELOCITY;
    // Accelerate the longer it stays on the player (linear in spawn speed), capped.
    const cap = state.baseSpeed * MAX_SPEED_MULT;
    state.speed = Math.min(cap, state.speed + state.baseSpeed * RAMP_PER_SEC * dt);
    return seek(p.selfPos, p.playerPos, state.speed);
  },
  // Expose the ramped speed so the runtime's clamp and wall-routing gate track it
  // instead of clipping back to the static config.speed.
  normalSpeed: (state) => state.speed,
};
