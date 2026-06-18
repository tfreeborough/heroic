import { distance, type Vec2 } from "../../math/vec2";
import { flee, seek } from "../steering";
import { updateAggro, ZERO_VELOCITY, type CommonConfig } from "../perception";
import type { Archetype } from "../runtime";

/**
 * The circler inverted, and the natural foil to *melee*: it holds at a
 * preferred range, closing when too far and backing off when too close, and
 * just holds inside a tolerance band (where, once enemy ranged attacks exist,
 * it would shoot). Stateless — purely a function of distance.
 *
 * Note: spawning a kiter only becomes interesting once enemies can attack at
 * range; until then it merely keeps its distance.
 */
export interface KiterConfig extends CommonConfig {
  /** Beyond this distance to the player the kiter idles. */
  aggroRadius: number;
  /** The standoff distance it wants to hold. */
  preferredRange: number;
  /** Tolerance either side of preferredRange before it re-positions. */
  rangeBand: number;
}

export interface KiterState {
  /** Sticky aggro flag for the leash hysteresis (see updateAggro). */
  engaged: boolean;
}

export const kiter: Archetype<KiterConfig, KiterState> = {
  id: "kiter",
  initState: () => ({ engaged: false }),
  tick: (state, config, p): Vec2 => {
    if (!updateAggro(p, state, config.aggroRadius)) return ZERO_VELOCITY;
    // No shot through a wall: when sight is blocked, close in to find a clear
    // line (the runtime routes this around the obstacle) rather than holding a
    // useless standoff. Resumes ranging the moment it can see the player again.
    if (p.hasLineOfSight === false) return seek(p.selfPos, p.playerPos, config.speed);
    const d = distance(p.selfPos, p.playerPos);
    if (d > config.preferredRange + config.rangeBand) return seek(p.selfPos, p.playerPos, config.speed);
    if (d < config.preferredRange - config.rangeBand) return flee(p.selfPos, p.playerPos, config.speed);
    return ZERO_VELOCITY; // inside the band, clear shot: hold and fire
  },
};
