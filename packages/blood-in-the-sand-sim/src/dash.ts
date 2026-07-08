/**
 * Dash effects for the arena — ported from the Gauntlet's worked example
 * (apps/enter-the-gauntlet/src/game/skills/dash.ts), reshaped for symmetric
 * player-vs-player: the barge shoves enemy *players*, and the numbers come
 * from the PvP tuning table. The lifecycle itself stays core's stepAbility;
 * these are only the effects applied on its events.
 */
import { normalize, sub } from "@heroic/core";
import type { Vec2 } from "@heroic/core";
import { DASH_IFRAMES, DASH_KNOCKBACK, DASH_SHOVE_RADIUS, DASH_SPEED, PLAYER_RADIUS } from "./config";
import type { ArenaPlayer, DashState } from "./state";

/** On-activate effect: lock the roll direction (unit) and open the i-frame window. */
export const beginDash = (dash: DashState, dirX: number, dirY: number): void => {
  dash.dirX = dirX;
  dash.dirY = dirY;
  dash.invulnLeft = DASH_IFRAMES;
};

/** The committed velocity pinned on the player while the roll is active, px/s. */
export const dashVelocity = (dash: DashState): Vec2 => ({
  x: dash.dirX * DASH_SPEED,
  y: dash.dirY * DASH_SPEED,
});

export const tickDashInvuln = (dash: DashState, dt: number): void => {
  dash.invulnLeft = Math.max(0, dash.invulnLeft - dt);
};

/** True while the roll's committed-movement window is open. */
export const isDashing = (dash: DashState): boolean => dash.ability.phase === "active";

/** True while the player is dodge-invulnerable from a roll. */
export const dashInvulnerable = (dash: DashState): boolean => dash.invulnLeft > 0;

/**
 * Barge: while rolling, raise each nearby enemy's outward velocity UP TO
 * DASH_KNOCKBACK (never add on top — sustained contact shouldn't compound).
 * Mutates enemy velocities in place; the impulse decays through their decel.
 */
export const applyDashShove = (
  dasher: ArenaPlayer,
  enemies: readonly ArenaPlayer[],
): void => {
  if (!isDashing(dasher.dash)) return;
  const contact = DASH_SHOVE_RADIUS + PLAYER_RADIUS;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.mover.pos.x - dasher.mover.pos.x;
    const dy = e.mover.pos.y - dasher.mover.pos.y;
    if (Math.hypot(dx, dy) > contact) continue;
    let away = normalize(sub(e.mover.pos, dasher.mover.pos));
    // Dead-centre overlap has no outward direction — shove along the roll.
    if (away.x === 0 && away.y === 0) away = { x: dasher.dash.dirX, y: dasher.dash.dirY };
    const outward = e.mover.vel.x * away.x + e.mover.vel.y * away.y;
    if (outward < DASH_KNOCKBACK) {
      const boost = DASH_KNOCKBACK - outward;
      e.mover.vel.x += away.x * boost;
      e.mover.vel.y += away.y * boost;
    }
  }
};
