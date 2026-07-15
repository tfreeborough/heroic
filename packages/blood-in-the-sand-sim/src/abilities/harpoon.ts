/**
 * Harpoon — an instant chain at its own long-range mark, then a REEL (Tom,
 * 2026-07-15): the chain lands the moment the near-zero windup closes, and
 * the victim is hauled in over the next second-plus, dragged against their
 * will while the caster stands ROOTED, pulling. Answers, by design: dash
 * i-frames — at the landing moment OR mid-reel, the roll snaps the chain —
 * Ironhide (the barb sticks, the pull doesn't), and Mirror Guard, which
 * reflects the chain and yanks the CASTER in instead (an instant counter-
 * slam, not a patient reel).
 */
import { distance, distanceToAabb, normalize, segmentClear, sub } from "@heroic/core";
import { HARPOON, PLAYER_RADIUS } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaSim } from "../sim";
import { slotOf, type AbilityRuntime, type ArenaPlayer } from "../state";
import { dashInvulnerable, isDashing } from "./dash";
import { applyFixedHit, killPlayer } from "./damage";
import { knockbackImmune, mirrorGuardActive } from "./statuses";
import { targetView } from "./targets";

/** Land the latched chain as the windup closes. A mark that died (or a dummy
 * that broke) during the windup wastes the throw — cooldown spent. */
export const fireHarpoon = (
  sim: ArenaSim,
  caster: ArenaPlayer,
  slot: AbilityRuntime,
  events: ArenaEvent[],
): void => {
  const aim = targetView(sim.state, slot.targetId);
  slot.targetId = null;
  if (!aim || !aim.alive || !caster.alive) return;

  // The chain flash draws whether or not it sticks — a dodged throw still
  // whips through the air the mark just left.
  events.push({
    type: "harpoon",
    casterId: caster.id,
    fromX: caster.mover.pos.x,
    fromY: caster.mover.pos.y,
    toX: aim.pos.x,
    toY: aim.pos.y,
  });

  // A straw man takes the barb but has nothing to drag.
  const dummy = sim.state.deployables.find((d) => d.id === aim.id);
  if (dummy) {
    dummy.hp = Math.max(0, dummy.hp - HARPOON.damage);
    events.push({
      type: "hit", attackerId: caster.id, targetId: dummy.id, damage: HARPOON.damage,
      crit: false, lethal: false, x: dummy.pos.x, y: dummy.pos.y,
    });
    return;
  }

  const victim = sim.state.players[aim.id];
  if (!victim) return;
  if (dashInvulnerable(victim)) return; // rolled through the landing moment

  if (mirrorGuardActive(victim)) {
    // Reflected: the guard catches the chain and YANKS — the caster eats the
    // barb and is slammed to the guard's feet at once. The counter-pick moment.
    const damage = applyFixedHit(caster, HARPOON.damage);
    const lethal = caster.combatant.hp <= 0;
    events.push({
      type: "hit", attackerId: victim.id, targetId: caster.id, damage,
      crit: false, lethal, x: caster.mover.pos.x, y: caster.mover.pos.y,
    });
    if (lethal) killPlayer(caster, events);
    else counterYank(sim, victim, caster);
    return;
  }

  const damage = applyFixedHit(victim, HARPOON.damage);
  const lethal = victim.combatant.hp <= 0;
  events.push({
    type: "hit", attackerId: caster.id, targetId: victim.id, damage,
    crit: false, lethal, x: victim.mover.pos.x, y: victim.mover.pos.y,
  });
  if (lethal) {
    killPlayer(victim, events);
  } else if (!knockbackImmune(victim)) {
    // The barb is in — start hauling. stepHarpoonReels does the dragging.
    slot.targetId = victim.id;
    slot.reelLeft = HARPOON.maxReelSeconds;
  }
};

/** Is this player's chain attached and hauling right now? (The client draws
 * the taut chain from snapshot data derived off this.) */
export const reelingTargetOf = (p: ArenaPlayer): number | null => {
  const slot = slotOf(p, "harpoon");
  return slot && slot.reelLeft > 0 ? slot.targetId : null;
};

/**
 * Advance every live reel one tick. The victim's velocity is overridden
 * wholesale toward the caster (committed, like a dash — dragged against
 * their will); the caster's is zeroed (rooted while hauling — it makes no
 * sense to sprint around mid-haul, Tom 2026-07-15). The chain SNAPS when:
 * either side dies · the victim gains dash i-frames (the roll cuts it) or
 * Ironhide (immune to the pull) · the CASTER dashes (they let go to move) ·
 * line of sight breaks (geometry cuts the chain) · the safety timeout runs
 * out (snagged on a corner). Arriving at pullGap plants the victim.
 */
export const stepHarpoonReels = (
  sim: ArenaSim,
  players: readonly ArenaPlayer[],
  dt: number,
): void => {
  const seats = sim.state.players;
  for (const caster of players) {
    const slot = slotOf(caster, "harpoon");
    if (!slot || slot.reelLeft <= 0 || slot.targetId === null) continue;
    const victim = seats[slot.targetId];

    const snapped =
      !victim ||
      !victim.alive ||
      !caster.alive ||
      dashInvulnerable(victim) ||
      knockbackImmune(victim) ||
      isDashing(caster) ||
      !segmentClear(caster.mover.pos, victim.mover.pos, sim.zone.occluders);
    if (snapped) {
      slot.targetId = null;
      slot.reelLeft = 0;
      continue;
    }

    if (distance(caster.mover.pos, victim.mover.pos) <= HARPOON.pullGap) {
      // Hauled all the way in: planted, not sliding.
      victim.mover.vel.x = 0;
      victim.mover.vel.y = 0;
      slot.targetId = null;
      slot.reelLeft = 0;
      continue;
    }

    const toCaster = normalize(sub(caster.mover.pos, victim.mover.pos));
    victim.mover.vel.x = toCaster.x * HARPOON.reelSpeed;
    victim.mover.vel.y = toCaster.y * HARPOON.reelSpeed;
    caster.mover.vel.x = 0;
    caster.mover.vel.y = 0;

    slot.reelLeft -= dt;
    if (slot.reelLeft <= 0) slot.targetId = null;
  }
};

/**
 * Mirror Guard's counter-slam: walk the yanked player along the straight
 * line toward the point HARPOON.pullGap in front of the guard, sampling
 * against the wall colliders so nobody passes through geometry. Instant —
 * the guard doesn't stand rooted for someone else's harpoon.
 */
const counterYank = (sim: ArenaSim, guard: ArenaPlayer, yanked: ArenaPlayer): void => {
  if (knockbackImmune(yanked)) return;
  const from = yanked.mover.pos;
  const anchor = guard.mover.pos;
  const dx = from.x - anchor.x;
  const dy = from.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= HARPOON.pullGap) return; // already in the guard's face
  const end = {
    x: anchor.x + (dx / dist) * HARPOON.pullGap,
    y: anchor.y + (dy / dist) * HARPOON.pullGap,
  };

  // Sample the path in half-radius steps; stop at the last clear spot.
  const span = Math.hypot(end.x - from.x, end.y - from.y);
  const steps = Math.max(1, Math.ceil(span / (PLAYER_RADIUS / 2)));
  let clear = { x: from.x, y: from.y };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const sample = { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t };
    if (sim.zone.collision.some((wall) => distanceToAabb(sample, wall) <= PLAYER_RADIUS)) break;
    clear = sample;
  }
  yanked.mover.pos.x = clear.x;
  yanked.mover.pos.y = clear.y;
  yanked.mover.vel.x = 0;
  yanked.mover.vel.y = 0;
};
