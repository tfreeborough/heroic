/**
 * Tremor — the anti-dogpile slam: an instant, self-centred resolve against
 * every enemy in radius (the arc resolve's 360° degenerate case). No windup
 * on purpose (it's a panic tool); dash i-frames still dodge it, Ironhide
 * still tanks it, and the numbers are fixed (no rng draws).
 */
import { distance, normalize, sub } from "@heroic/core";
import { PLAYER_RADIUS, TREMOR } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaPlayer } from "../state";
import { dashInvulnerable } from "./dash";
import { applyFixedHit, applyImpulse, killPlayer } from "./damage";

export const castTremor = (
  caster: ArenaPlayer,
  players: readonly ArenaPlayer[],
  events: ArenaEvent[],
): void => {
  for (const e of players) {
    if (e.team === caster.team || !e.alive || dashInvulnerable(e)) continue;
    if (distance(e.mover.pos, caster.mover.pos) - PLAYER_RADIUS > TREMOR.radius) continue;
    const damage = applyFixedHit(e, TREMOR.damage);
    const lethal = e.combatant.hp <= 0;
    events.push({
      type: "hit",
      attackerId: caster.id,
      targetId: e.id,
      damage,
      crit: false,
      lethal,
      x: e.mover.pos.x,
      y: e.mover.pos.y,
    });
    if (lethal) {
      killPlayer(e, events);
    } else {
      let away = normalize(sub(e.mover.pos, caster.mover.pos));
      // Standing dead-centre on the caster: hurl them out along the facing.
      if (away.x === 0 && away.y === 0) away = { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
      applyImpulse(e, away.x, away.y, TREMOR.knockback);
    }
  }
};
