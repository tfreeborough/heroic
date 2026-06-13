import { distance, type Vec2 } from "../../math/vec2";
import { seek } from "../steering";
import { ZERO_VELOCITY, type CommonConfig } from "../perception";
import type { Archetype } from "../runtime";

/**
 * The lurker: lies perfectly still until the player strays within its trigger
 * radius, then commits to a full-speed lunge. Demonstrates that "aggro" is
 * archetype-owned — there's no aggroRadius here; the trigger/release pair *is*
 * its engagement logic, and the two radii differ (release > trigger) so a
 * committed ambusher keeps chasing a little past where it woke rather than
 * flickering dormant on the threshold.
 */
export interface AmbusherConfig extends CommonConfig {
  /** Player within this distance wakes the ambusher into its lunge. */
  triggerRadius: number;
  /** While lunging, give up and re-arm if the player gets this far away. */
  releaseRadius: number;
}

export type AmbusherMode = "dormant" | "lunging";

export interface AmbusherState {
  mode: AmbusherMode;
}

export const ambusher: Archetype<AmbusherConfig, AmbusherState> = {
  id: "ambusher",
  initState: () => ({ mode: "dormant" }),
  tick: (state, config, p): Vec2 => {
    const d = distance(p.selfPos, p.playerPos);
    if (state.mode === "dormant") {
      if (d > config.triggerRadius) return ZERO_VELOCITY;
      state.mode = "lunging";
    } else if (d > config.releaseRadius) {
      state.mode = "dormant";
      return ZERO_VELOCITY;
    }
    return seek(p.selfPos, p.playerPos, config.speed);
  },
};
