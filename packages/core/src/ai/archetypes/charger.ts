import { distance, normalize, scale, sub, type Vec2 } from "../../math/vec2";
import { seek } from "../steering";
import { updateAggro, ZERO_VELOCITY, type CommonConfig } from "../perception";
import type { Archetype, Telegraph } from "../runtime";

/**
 * The read-and-dodge bruiser. Approaches, then commits to a telegraphed dash in
 * a straight line that blows *past* a player who sidesteps — it can't
 * course-correct mid-dash, and that whiff is the counterplay.
 *
 * `CommonConfig.speed` is the approach speed (and separation strength);
 * `CommonConfig.maxSpeed` is the dash burst. The dash direction is locked when
 * WINDUP begins, so the telegraph shows a committed line for the whole wind-up.
 */
export interface ChargerConfig extends CommonConfig {
  /** Beyond this distance to the player the charger idles. */
  aggroRadius: number;
  /** Distance to the player that triggers a wind-up. */
  chargeRange: number;
  /** Telegraph duration before the dash commits, seconds. */
  windupTime: number;
  /** Seconds the committed dash lasts (dash distance = maxSpeed × this). */
  dashDuration: number;
  /** Vulnerable pause after a dash before re-approaching, seconds. */
  recoverTime: number;
}

export type ChargerMode = "approach" | "windup" | "dash" | "recover";

export interface ChargerState {
  mode: ChargerMode;
  /** Counts down within windup/dash/recover. */
  timer: number;
  /** Dash direction, locked when WINDUP begins. */
  dashDir: Vec2;
  /** Sticky aggro flag for the leash hysteresis (see updateAggro). */
  engaged: boolean;
}

export const charger: Archetype<ChargerConfig, ChargerState> = {
  id: "charger",
  initState: () => ({ mode: "approach", timer: 0, dashDir: { x: 1, y: 0 }, engaged: false }),
  tick: (state, config, p, dt): Vec2 => {
    switch (state.mode) {
      case "approach": {
        // Aggro is only evaluated while approaching; once committed to a charge
        // it sees the cycle through. The leash keeps it after you between dashes.
        if (!updateAggro(p, state, config.aggroRadius)) return ZERO_VELOCITY;
        if (distance(p.selfPos, p.playerPos) <= config.chargeRange) {
          // Commit: lock the dash line at the player's position now.
          state.dashDir = normalize(sub(p.playerPos, p.selfPos));
          state.mode = "windup";
          state.timer = config.windupTime;
          return ZERO_VELOCITY;
        }
        return seek(p.selfPos, p.playerPos, config.speed);
      }
      case "windup": {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.mode = "dash";
          state.timer = config.dashDuration;
        }
        return ZERO_VELOCITY; // held + telegraphing
      }
      case "dash": {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.mode = "recover";
          state.timer = config.recoverTime;
          return ZERO_VELOCITY;
        }
        return scale(state.dashDir, config.maxSpeed ?? config.speed); // committed straight line
      }
      case "recover": {
        state.timer -= dt;
        if (state.timer <= 0) state.mode = "approach";
        return ZERO_VELOCITY;
      }
    }
  },
  telegraph: (state, config): Telegraph | null =>
    state.mode === "windup"
      ? {
          kind: "charge",
          progress: 1 - state.timer / config.windupTime,
          dir: Math.atan2(state.dashDir.y, state.dashDir.x),
          length: (config.maxSpeed ?? config.speed) * config.dashDuration, // the actual dash reach
        }
      : null,
};
