/**
 * Magic Mirror — swap places with the enemy furthest from you, after a loud
 * one-second telegraph (config.ts MAGIC_MIRROR has the full design note).
 * The ability's ACTIVE window is the delay (the harpoon's windup grammar):
 * the mark is latched on activation into the slot's targetId scratch, the
 * swap fires on `step.ended`. The mirror sees everything — no range, no
 * line of sight, sandstorm and cloak included (it's a reflection, not an
 * aim) — the victim's answer is the telegraph itself: dash i-frames or
 * planted feet (Ironhide / true-ice stasis) at the swap instant refuse it.
 */
import { MAGIC_MIRROR } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaSim } from "../sim";
import { seatedPlayers, type AbilityRuntime, type ArenaPlayer } from "../state";
import { dashInvulnerable } from "./dash";
import { frozenSolid, knockbackImmune } from "./statuses";

/** The mirror's mark: the FURTHEST living enemy player. Null only when no
 * enemy stands (can't happen mid-fight — a wiped team ends the round). */
export const mirrorMark = (sim: ArenaSim, p: ArenaPlayer): ArenaPlayer | null => {
  let best: ArenaPlayer | null = null;
  let bestDist = -1;
  for (const e of seatedPlayers(sim.state)) {
    if (e.team === p.team || !e.alive) continue;
    const dx = e.mover.pos.x - p.mover.pos.x;
    const dy = e.mover.pos.y - p.mover.pos.y;
    const d = dx * dx + dy * dy;
    if (d > bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
};

/** The body this player's mirror is about to swap with, or null — the
 * client swirls both ends off snapshot data derived from this (the
 * harpoon's reelingTargetOf pattern). */
export const mirrorTargetOf = (p: ArenaPlayer): number | null => {
  const slot = p.slots.find((s) => s.id === "magic-mirror");
  return slot && slot.ability.phase === "active" ? slot.targetId : null;
};

/** Open the telegraph: latch the mark and announce it over both bodies. */
export const beginMirror = (
  sim: ArenaSim,
  caster: ArenaPlayer,
  slot: AbilityRuntime,
  events: ArenaEvent[],
): void => {
  const mark = mirrorMark(sim, caster);
  slot.targetId = mark ? mark.id : null;
  if (!mark) return;
  events.push({
    type: "mirror",
    casterId: caster.id,
    targetId: mark.id,
    delay: MAGIC_MIRROR.delaySeconds,
  });
};

/**
 * The delay closed — resolve the swap. Fizzles (silently — the swirl just
 * dissipates) when either body is dead, or the victim refuses it: dash
 * i-frames at this instant, or planted feet (Ironhide / frozen in ice).
 * Both movers trade exact positions with velocities zeroed — two valid
 * spots stay two valid spots, no clamping needed.
 */
export const fireMirrorSwap = (
  sim: ArenaSim,
  caster: ArenaPlayer,
  slot: AbilityRuntime,
  events: ArenaEvent[],
): void => {
  const targetId = slot.targetId;
  slot.targetId = null;
  if (targetId === null) return;
  const victim = sim.state.players[targetId];
  if (!victim || !victim.alive || !caster.alive) return;
  if (dashInvulnerable(victim) || knockbackImmune(victim)) return;
  // A caster iced mid-delay stays put — stasis is stasis. Their own
  // Ironhide does NOT refuse it: they asked for this trip (mirror-under-
  // ironhide is a legitimate dive combo).
  if (frozenSolid(caster)) return;

  const cx = caster.mover.pos.x;
  const cy = caster.mover.pos.y;
  caster.mover.pos.x = victim.mover.pos.x;
  caster.mover.pos.y = victim.mover.pos.y;
  victim.mover.pos.x = cx;
  victim.mover.pos.y = cy;
  caster.mover.vel.x = 0;
  caster.mover.vel.y = 0;
  victim.mover.vel.x = 0;
  victim.mover.vel.y = 0;

  events.push({
    type: "mirror-swap",
    casterId: caster.id,
    targetId: victim.id,
    cx: caster.mover.pos.x,
    cy: caster.mover.pos.y,
    tx: victim.mover.pos.x,
    ty: victim.mover.pos.y,
  });
};
