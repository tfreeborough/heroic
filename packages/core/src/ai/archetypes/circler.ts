import { add, type Vec2 } from "../../math/vec2";
import { keepDistance, orbit, seek } from "../steering";
import { angleOffPlayerFacing, updateAggro, ZERO_VELOCITY, type CommonConfig } from "../perception";
import type { Archetype } from "../runtime";

/**
 * The circler (the wolf's archetype): a two-state FSM gated on the player's
 * front arc — APPROACH while the player faces away, CIRCLE (orbit at a slower
 * prowl speed + keep-distance) while watched. Literally a function of the
 * player-facing mechanic from the movement doc. Anti-thrash: an arc-edge
 * hysteresis margin plus a minimum time in each mode.
 */
export interface CirclerConfig extends CommonConfig {
  /** Beyond this distance to the player the circler idles. */
  aggroRadius: number;
  /** Distance it tries to circle at while the player watches it. */
  orbitDistance: number;
  /**
   * Speed multiplier (0–1) while circling. Full-tilt strafing is nearly
   * unhittable (ranged auto-aim leads to where it *was*), so the prowl is
   * slower — which also reads as menace. The lunge in/out stays full speed.
   */
  circleSpeedScale: number;
  /** Full width (radians) of the player's front arc that counts as "watched". */
  frontArcWidth: number;
  /** Arc-edge stickiness (radians): in/out switches need this much overshoot. */
  arcMargin: number;
  /** Minimum seconds in a mode before any switch (the other anti-thrash knob). */
  minModeTime: number;
}

export type CirclerMode = "approach" | "circle";

export interface CirclerState {
  mode: CirclerMode;
  /** Seconds spent in the current mode (hysteresis input). */
  modeTime: number;
  /** Which way this individual circles — fixed at spawn, reads as personality. */
  orbitDirection: 1 | -1;
  /** Sticky aggro flag for the leash hysteresis (see updateAggro). */
  engaged: boolean;
}

export const circler: Archetype<CirclerConfig, CirclerState> = {
  id: "circler",
  // Alternate circle direction per spawn so a pack doesn't all orbit one way.
  initState: (_config, index) => ({
    mode: "approach",
    modeTime: 0,
    orbitDirection: index % 2 === 0 ? 1 : -1,
    engaged: false,
  }),
  tick: (state, config, p, dt): Vec2 => {
    if (!updateAggro(p, state, config.aggroRadius)) return ZERO_VELOCITY;
    state.modeTime += dt;

    const off = angleOffPlayerFacing(p);
    const halfArc = config.frontArcWidth / 2;
    if (state.modeTime >= config.minModeTime) {
      const next: CirclerMode =
        state.mode === "approach"
          ? off <= halfArc - config.arcMargin
            ? "circle"
            : "approach"
          : off > halfArc + config.arcMargin
            ? "approach"
            : "circle";
      if (next !== state.mode) {
        state.mode = next;
        state.modeTime = 0;
      }
    }

    if (state.mode === "approach") return seek(p.selfPos, p.playerPos, config.speed);
    // Watched: circle at prowl speed, but the backpedal when the player pushes
    // well inside the ring stays full speed, so slowing the strafe doesn't
    // blunt the retreat (the runtime clamps the blend to full speed).
    return add(
      orbit(
        p.selfPos,
        p.playerPos,
        config.speed * config.circleSpeedScale,
        config.orbitDistance,
        state.orbitDirection,
      ),
      keepDistance(p.selfPos, p.playerPos, config.speed, config.orbitDistance * 0.6),
    );
  },
};
