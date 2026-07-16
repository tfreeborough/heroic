/**
 * Harpoon — an instant chain at its own long-range mark, then a REEL (Tom,
 * 2026-07-15): the chain lands the moment the near-zero windup closes, and
 * the victim is hauled in over the next second-plus, dragged against their
 * will while the caster stands ROOTED, pulling. Answers, by design: dash
 * i-frames — at the landing moment OR mid-reel, the roll snaps the chain —
 * Ironhide (the barb sticks, the pull doesn't), and Mirror Guard, which
 * reflects the chain and reels the CASTER in instead — the same slow haul,
 * just reversed (the caster is dragged, the guard stays free to move).
 */
import { distance, normalize, segmentClear, sub } from "@heroic/core";
import { HARPOON } from "../config";
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
  slot.reelReversed = false; // clear any stale reflect state before a fresh land
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
    // Reflected: the guard catches the chain and turns it around — the caster
    // eats the barb and is reeled to the guard's feet with the SAME slow haul
    // as a normal cast (Tom, 2026-07-16), only reversed: the caster is the one
    // dragged, and the guard stays free to move (their counter, not their
    // commitment). Reuses the caster's own harpoon slot, flipped.
    const damage = applyFixedHit(caster, HARPOON.damage);
    const lethal = caster.combatant.hp <= 0;
    events.push({
      type: "hit", attackerId: victim.id, targetId: caster.id, damage,
      crit: false, lethal, x: caster.mover.pos.x, y: caster.mover.pos.y,
    });
    if (lethal) {
      killPlayer(caster, events);
    } else if (!knockbackImmune(caster)) {
      // The return chain: guard → caster, drawn back the other way.
      events.push({
        type: "harpoon", casterId: victim.id,
        fromX: victim.mover.pos.x, fromY: victim.mover.pos.y,
        toX: caster.mover.pos.x, toY: caster.mover.pos.y,
      });
      slot.targetId = victim.id;
      slot.reelLeft = HARPOON.maxReelSeconds;
      slot.reelReversed = true;
    }
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
  for (const owner of players) {
    const slot = slotOf(owner, "harpoon");
    if (!slot || slot.reelLeft <= 0 || slot.targetId === null) continue;
    const other = seats[slot.targetId];
    if (!other) {
      slot.targetId = null;
      slot.reelLeft = 0;
      slot.reelReversed = false;
      continue;
    }
    // Normal: `owner` is the rooted puller, `other` the hauled victim.
    // Reversed (Mirror Guard reflect): `owner` is the one hauled, toward
    // `other` (the guard) — who is NOT rooted; they reflected it, they didn't
    // commit to it. Everything else about the reel is identical.
    const dragged = slot.reelReversed ? owner : other;
    const anchor = slot.reelReversed ? other : owner;

    const snapped =
      !dragged.alive ||
      !anchor.alive ||
      dashInvulnerable(dragged) ||
      knockbackImmune(dragged) ||
      isDashing(anchor) ||
      !segmentClear(anchor.mover.pos, dragged.mover.pos, sim.zone.occluders);
    if (snapped) {
      slot.targetId = null;
      slot.reelLeft = 0;
      slot.reelReversed = false;
      continue;
    }

    if (distance(anchor.mover.pos, dragged.mover.pos) <= HARPOON.pullGap) {
      // Hauled all the way in: planted, not sliding.
      dragged.mover.vel.x = 0;
      dragged.mover.vel.y = 0;
      slot.targetId = null;
      slot.reelLeft = 0;
      slot.reelReversed = false;
      continue;
    }

    const toAnchor = normalize(sub(anchor.mover.pos, dragged.mover.pos));
    dragged.mover.vel.x = toAnchor.x * HARPOON.reelSpeed;
    dragged.mover.vel.y = toAnchor.y * HARPOON.reelSpeed;
    // The anchor roots only when they're the one doing the pulling.
    if (!slot.reelReversed) {
      anchor.mover.vel.x = 0;
      anchor.mover.vel.y = 0;
    }

    slot.reelLeft -= dt;
    if (slot.reelLeft <= 0) {
      slot.targetId = null;
      slot.reelReversed = false;
    }
  }
};
