/**
 * Dash effects — the worked example the ability slot generalised from
 * (docs/design/pvp-abilities.md). The lifecycle is core's stepAbility; these
 * are only the effects applied on its events, now operating on the player's
 * drafted dash slot instead of a dedicated DashState field.
 */
import { normalize, sub } from "@heroic/core";
import type { Vec2 } from "@heroic/core";
import { DASH_IFRAMES, DASH_KNOCKBACK, DASH_SHOVE_RADIUS, DASH_SPEED, PLAYER_RADIUS } from "../config";
import { slotOf, type AbilityRuntime, type ArenaPlayer } from "../state";
import { knockbackImmune } from "./statuses";

/** On-activate effect: lock the roll direction (unit) and open the i-frame window. */
export const beginDash = (slot: AbilityRuntime, dirX: number, dirY: number): void => {
  slot.dirX = dirX;
  slot.dirY = dirY;
  slot.invulnLeft = DASH_IFRAMES;
};

/** The committed velocity pinned on the player while the roll is active, px/s. */
export const dashVelocity = (slot: AbilityRuntime): Vec2 => ({
  x: slot.dirX * DASH_SPEED,
  y: slot.dirY * DASH_SPEED,
});

/** The player's dash slot while its committed-movement window is open. */
export const dashingSlot = (p: ArenaPlayer): AbilityRuntime | undefined => {
  const slot = slotOf(p, "dash");
  return slot?.ability.phase === "active" ? slot : undefined;
};

/** True while the roll's committed-movement window is open. */
export const isDashing = (p: ArenaPlayer): boolean => dashingSlot(p) !== undefined;

/** True while the player is dodge-invulnerable from a roll. */
export const dashInvulnerable = (p: ArenaPlayer): boolean =>
  (slotOf(p, "dash")?.invulnLeft ?? 0) > 0;

/**
 * Barge: while rolling, raise each nearby enemy's outward velocity UP TO
 * DASH_KNOCKBACK (never add on top — sustained contact shouldn't compound).
 * Mutates enemy velocities in place; the impulse decays through their decel.
 * Ironhide shrugs the shove off entirely.
 */
export const applyDashShove = (dasher: ArenaPlayer, enemies: readonly ArenaPlayer[]): void => {
  const slot = dashingSlot(dasher);
  if (!slot) return;
  const contact = DASH_SHOVE_RADIUS + PLAYER_RADIUS;
  for (const e of enemies) {
    if (!e.alive || knockbackImmune(e)) continue;
    const dx = e.mover.pos.x - dasher.mover.pos.x;
    const dy = e.mover.pos.y - dasher.mover.pos.y;
    if (Math.hypot(dx, dy) > contact) continue;
    let away = normalize(sub(e.mover.pos, dasher.mover.pos));
    // Dead-centre overlap has no outward direction — shove along the roll.
    if (away.x === 0 && away.y === 0) away = { x: slot.dirX, y: slot.dirY };
    const outward = e.mover.vel.x * away.x + e.mover.vel.y * away.y;
    if (outward < DASH_KNOCKBACK) {
      const boost = DASH_KNOCKBACK - outward;
      e.mover.vel.x += away.x * boost;
      e.mover.vel.y += away.y * boost;
    }
  }
};
