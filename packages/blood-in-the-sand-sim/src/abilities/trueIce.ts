/**
 * Shard of True Ice — entomb the nearest enemy (config.ts TRUE_ICE has the
 * full design note). Acquisition is the harpoon's press-time grammar: a
 * press with no eligible mark neither fires nor costs. The freeze itself is
 * total stasis: the victim can't move, aim, swing or cast (step.ts gates all
 * four off frozenLeft), and damage.ts turns every hit and dot tick into an
 * IMMUNE while the ice holds. Diminishing returns per victim per round
 * answer the 2v2 chain-freeze (freezesTaken, reset with the round).
 */
import { distance, segmentClear } from "@heroic/core";
import { ATTACK_CYCLE_READY } from "@heroic/core";
import { TRUE_ICE } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaSim } from "../sim";
import { seatedPlayers, type ArenaPlayer } from "../state";
import { dashInvulnerable } from "./dash";
import { elvenCloakActive } from "./statuses";
import { inSandstorm } from "./targets";

/**
 * The shard's mark, resolved at press time: the NEAREST living enemy player
 * in range with line of sight — sandstorm rules both ways, a cloaked body
 * can't be marked, and straw men are skipped (ice is wasted on straw; the
 * shard seeks warm blood). Null = the press does nothing (the harpoon rule).
 */
export const trueIceMark = (sim: ArenaSim, p: ArenaPlayer): ArenaPlayer | null => {
  const { state, zone } = sim;
  if (inSandstorm(state, p.mover.pos)) return null; // no aiming out of the cloud

  let best: ArenaPlayer | null = null;
  let bestDist = Infinity;
  for (const e of seatedPlayers(state)) {
    if (e.team === p.team || !e.alive) continue;
    if (inSandstorm(state, e.mover.pos) || elvenCloakActive(e)) continue;
    if (!segmentClear(p.mover.pos, e.mover.pos, zone.occluders)) continue;
    const d = distance(p.mover.pos, e.mover.pos);
    if (d > TRUE_ICE.maxRange || d >= bestDist) continue;
    best = e;
    bestDist = d;
  }
  return best;
};

/**
 * Land the shard: entomb the victim for the diminished duration. Dash
 * i-frames at the throw instant slip it (the charge is spent — it flew).
 * Freezing is also an interrupt: an in-flight windup, thrust or volley dies
 * in the ice; riders (bleed/poison) keep their clocks and resume on thaw.
 */
export const applyFreeze = (victim: ArenaPlayer, events: ArenaEvent[]): void => {
  if (dashInvulnerable(victim)) return; // rolled through the throw
  const duration =
    TRUE_ICE.freezeSeconds * Math.pow(TRUE_ICE.diminishFactor, victim.freezesTaken);
  victim.freezesTaken += 1;
  victim.frozenLeft = duration;
  victim.mover.vel.x = 0;
  victim.mover.vel.y = 0;
  victim.attack = ATTACK_CYCLE_READY;
  victim.lockedTargetId = null;
  victim.thrustLeft = 0;
  victim.thrustHits.length = 0;
  victim.burstLeft = 0;
  victim.burstTargetId = null;
  events.push({
    type: "freeze",
    playerId: victim.id,
    duration,
    x: victim.mover.pos.x,
    y: victim.mover.pos.y,
  });
};
