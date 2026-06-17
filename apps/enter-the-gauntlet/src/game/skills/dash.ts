/**
 * Dash / roll — the first entry in the player's skill roster, and the worked
 * example of the pattern every skill follows:
 *
 *   • lifecycle  — generic, pure, reusable: an AbilityState driven by
 *     stepAbility (@heroic/core). Ready → Active → Cooldown.
 *   • effects    — skill-specific, and they live here in the app because they
 *     touch game state: committed movement, dodge i-frames, and a barge that
 *     shoves enemies. GameScreen applies them on the lifecycle's events.
 *
 * The tuning numbers stay in constants.ts; this module only wires them to the
 * ability shape and implements the effects.
 */
import {
  distance,
  normalize,
  sub,
  ABILITY_READY,
  type AbilityConfig,
  type AbilityState,
  type Mover,
  type Vec2,
} from "@heroic/engine";
import {
  DASH_COOLDOWN,
  DASH_DURATION,
  DASH_IFRAMES,
  DASH_KNOCKBACK,
  DASH_SHOVE_RADIUS,
  DASH_SPEED,
  ENEMY_RADIUS,
} from "../constants";

/** Lifecycle timing → the generic ability machine. */
export const DASH_CONFIG: AbilityConfig = {
  activeDuration: DASH_DURATION,
  cooldown: DASH_COOLDOWN,
};

export interface DashRuntime {
  /** Generic lifecycle (ready/active/cooldown), advanced each step by stepAbility. */
  ability: AbilityState;
  /** Committed roll direction (unit); locked when the roll fires. */
  dirX: number;
  dirY: number;
  /**
   * Dodge-invulnerability timer, seconds. It's its OWN timer — not the ability's
   * active window — so the i-frames can outlast the movement by a forgiving
   * grace tail, and so a roll never trips the post-hit "hurt" flash (which keys
   * off the combat i-frame timer).
   */
  invulnLeft: number;
}

export const createDashRuntime = (): DashRuntime => ({
  ability: ABILITY_READY,
  dirX: 0,
  dirY: 0,
  invulnLeft: 0,
});

/** On-activate effect: lock the roll direction (unit) and open the i-frame window. */
export const beginDash = (rt: DashRuntime, dirX: number, dirY: number): void => {
  rt.dirX = dirX;
  rt.dirY = dirY;
  rt.invulnLeft = DASH_IFRAMES;
};

/** The committed velocity to pin on the player while the roll is active, px/s. */
export const dashVelocity = (rt: DashRuntime): Vec2 => ({
  x: rt.dirX * DASH_SPEED,
  y: rt.dirY * DASH_SPEED,
});

/** Tick the dodge i-frame timer once per fixed step. */
export const tickDashInvuln = (rt: DashRuntime, dt: number): void => {
  rt.invulnLeft = Math.max(0, rt.invulnLeft - dt);
};

/** True while the roll's committed-movement window is open. */
export const isDashing = (rt: DashRuntime): boolean => rt.ability.phase === "active";

/** True while the player is dodge-invulnerable from a roll. */
export const dashInvulnerable = (rt: DashRuntime): boolean => rt.invulnLeft > 0;

/** Cooldown fraction 1 → 0, for the button's clock overlay. */
export const dashCooldownFrac = (rt: DashRuntime): number =>
  rt.ability.cooldownRemaining / DASH_CONFIG.cooldown;

/**
 * Barge effect: while rolling, shove every enemy within the dash's *wide* sweep
 * radius (DASH_SHOVE_RADIUS, the "bowling ball") outward — no damage, it's a
 * reposition. The wide radius is what catches a whole clump and scatters it like
 * pins rather than nudging only the enemy you physically touch. Raises each
 * enemy's outward velocity UP TO DASH_KNOCKBACK rather than adding to it, so
 * plowing through a crowd gives each one firm push instead of flinging a
 * sustained-contact enemy off at compounding speed. Mutates enemy velocities in
 * place (an impulse that decays through their decel).
 */
export const applyDashShove = (
  rt: DashRuntime,
  playerPos: Vec2,
  enemies: readonly { mover: Mover }[],
): void => {
  if (!isDashing(rt)) return;
  const contact = DASH_SHOVE_RADIUS + ENEMY_RADIUS;
  for (const e of enemies) {
    if (distance(playerPos, e.mover.pos) > contact) continue;
    let away = normalize(sub(e.mover.pos, playerPos));
    // Dead-centre overlap has no outward direction — shove along the roll.
    if (away.x === 0 && away.y === 0) away = { x: rt.dirX, y: rt.dirY };
    const outward = e.mover.vel.x * away.x + e.mover.vel.y * away.y;
    if (outward < DASH_KNOCKBACK) {
      const boost = DASH_KNOCKBACK - outward;
      e.mover.vel.x += away.x * boost;
      e.mover.vel.y += away.y * boost;
    }
  }
};
