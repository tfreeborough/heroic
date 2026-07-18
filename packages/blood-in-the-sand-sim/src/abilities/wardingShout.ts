/**
 * Warding Shout — the old tremor slam promoted to a defensive peel
 * (pvp-abilities.md §11): instant, NO damage, a cone of massive knockback out
 * of the caster's facing. Aimable and therefore whiffable on purpose — the
 * hurl is huge, so it has to be earned by pointing your mouth at them. Dash
 * i-frames ride through it; Ironhide plants; the numbers are fixed (no rng).
 */
import { distance, normalize, sub } from "@heroic/core";
import { PLAYER_RADIUS, WARDING_SHOUT } from "../config";
import type { ArenaPlayer } from "../state";
import { dashInvulnerable } from "./dash";
import { applyImpulse } from "./damage";

export const castWardingShout = (caster: ArenaPlayer, players: readonly ArenaPlayer[]): void => {
  const fx = Math.cos(caster.facing);
  const fy = Math.sin(caster.facing);
  for (const e of players) {
    if (e.team === caster.team || !e.alive || dashInvulnerable(e)) continue;
    if (distance(e.mover.pos, caster.mover.pos) - PLAYER_RADIUS > WARDING_SHOUT.range) continue;
    let away = normalize(sub(e.mover.pos, caster.mover.pos));
    if (away.x === 0 && away.y === 0) {
      // Standing dead-centre on the shouter: hurl them out along the facing
      // (the slam's old rule — dead-centre has no angle to gate on).
      away = { x: fx, y: fy };
    } else if (away.x * fx + away.y * fy < Math.cos(WARDING_SHOUT.halfAngle)) {
      continue; // outside the cone — a shout has a direction; flanks are safe
    }
    applyImpulse(e, away.x, away.y, WARDING_SHOUT.knockback);
  }
};
