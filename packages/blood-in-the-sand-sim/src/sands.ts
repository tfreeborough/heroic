/**
 * The Closing Sands (docs/design/bits-sand-circle.md) — the shrinking safe
 * circle that gives rounds their only clock. At CLOSING_SANDS.delaySeconds of
 * active round time a circle rolls at a randomized walkable spot and shrinks
 * over closeSeconds to finalRadius; everyone outside it takes ramping blood
 * ticks. Sim-owned like the round machine itself: the server stays transport,
 * clients read the circle off RoundSnapshot.sands.
 */
import { distance, type Aabb, type Vec2 } from "@heroic/core";
import { CLOSING_SANDS, PLAYER_RADIUS, SANDS_ATTACKER_ID } from "./config";
import type { ArenaEvent } from "./events";
import { killPlayer } from "./abilities/damage";
import type { ArenaPlayer, RoundState } from "./state";
import type { ArenaSim } from "./sim";

/** Close progress 0 (just rolled) → 1 (holding at finalRadius). */
export const sandsProgress = (round: RoundState): number => {
  const t = (round.elapsed - CLOSING_SANDS.delaySeconds) / CLOSING_SANDS.closeSeconds;
  return Math.min(1, Math.max(0, t));
};

/** The CURRENT safe radius — derived, never stored (elapsed + the config
 * table are the whole truth, so a restored state re-derives it exactly). */
export const sandsRadius = (round: RoundState): number => {
  if (!round.sands) return 0;
  const p = sandsProgress(round);
  return round.sands.r0 + (CLOSING_SANDS.finalRadius - round.sands.r0) * p;
};

/** Distance from a point to a collision box (Aabbs are centre + full size),
 * 0 inside — the circle-vs-box test the centre roll scores candidates with. */
const boxGap = (x: number, y: number, box: Aabb): number => {
  const dx = Math.max(Math.abs(x - box.x) - box.w / 2, 0);
  const dy = Math.max(Math.abs(y - box.y) - box.h / 2, 0);
  return Math.hypot(dx, dy);
};

/** How much room a candidate FINAL circle has: min clearance beyond the final
 * radius to every collision box and the arena edge. ≥ 0 means the last ring
 * sits fully on walkable sand. */
const clearanceAt = (sim: ArenaSim, x: number, y: number): number => {
  const need = CLOSING_SANDS.finalRadius;
  let clear = Math.min(x, y, sim.zone.size.x - x, sim.zone.size.y - y) - need;
  for (const box of sim.zone.collision) {
    clear = Math.min(clear, boxGap(x, y, box) - need);
  }
  return clear;
};

/** A body's rim sits outside the safe ring — the membership test every blood
 * tick (and the bot brain's margin math) agrees on. */
export const outsideSands = (pos: Vec2, cx: number, cy: number, r: number): boolean =>
  distance(pos, { x: cx, y: cy }) - PLAYER_RADIUS > r;

/**
 * Roll the centre from the sim rng: EXACTLY centerDraws candidates (the draw
 * count never forks on map luck — the seed/rngDraws restore contract), first
 * with real clearance wins, else the best of the batch. finalRadius margins
 * keep the whole batch off the arena rim, so even a degenerate map yields a
 * sane fallback rather than a ring in the void.
 */
const rollCentre = (sim: ArenaSim): { cx: number; cy: number } => {
  const margin = CLOSING_SANDS.finalRadius + PLAYER_RADIUS;
  const w = sim.zone.size.x - margin * 2;
  const h = sim.zone.size.y - margin * 2;
  let best = { cx: sim.zone.size.x / 2, cy: sim.zone.size.y / 2 };
  let bestClear = -Infinity;
  for (let i = 0; i < CLOSING_SANDS.centerDraws; i++) {
    const cx = margin + sim.rng.next() * w;
    const cy = margin + sim.rng.next() * h;
    const clear = clearanceAt(sim, cx, cy);
    if (clear > bestClear) {
      best = { cx, cy };
      bestClear = clear;
    }
  }
  return best;
};

/**
 * Advance the sands one tick (called from stepSim's active block): burn the
 * fuse down, roll the circle at its moment, then pour ramping blood ticks on
 * everyone outside. Ambient damage like bleed — no i-frames, no Ironhide, no
 * crit, no rng — and the ticks carry SANDS_ATTACKER_ID: the sands claim
 * kills, they credit no one.
 */
export const stepSafeCircle = (
  sim: ArenaSim,
  players: readonly ArenaPlayer[],
  events: ArenaEvent[],
  dt: number,
): void => {
  if (!CLOSING_SANDS.enabled) return;
  const { round } = sim.state;
  // The range's rounds never end (checkRoundOver stands down) — a circle
  // there would just grind the dummies forever.
  if (sim.state.training || round.phase !== "active") return;
  if (round.elapsed < CLOSING_SANDS.delaySeconds) return;

  if (round.sands === null) {
    const { cx, cy } = rollCentre(sim);
    // Everyone starts inside: the opening radius reaches the farthest arena
    // corner from the rolled centre, plus a body.
    const r0 =
      Math.max(
        Math.hypot(cx, cy),
        Math.hypot(sim.zone.size.x - cx, cy),
        Math.hypot(cx, sim.zone.size.y - cy),
        Math.hypot(sim.zone.size.x - cx, sim.zone.size.y - cy),
      ) + PLAYER_RADIUS;
    round.sands = { cx, cy, r0, tickLeft: CLOSING_SANDS.tickInterval };
    events.push({ type: "sandsStart", cx, cy });
  }

  const sands = round.sands;
  const r = sandsRadius(round);
  const p = sandsProgress(round);
  const damage = Math.round(CLOSING_SANDS.damageMin + (CLOSING_SANDS.damageMax - CLOSING_SANDS.damageMin) * p);
  sands.tickLeft -= dt;
  while (sands.tickLeft <= 0) {
    for (const player of players) {
      if (!player.alive) continue;
      if (!outsideSands(player.mover.pos, sands.cx, sands.cy, r)) continue;
      player.combatant.hp = Math.max(0, player.combatant.hp - damage);
      const lethal = player.combatant.hp <= 0;
      events.push({
        type: "hit",
        attackerId: SANDS_ATTACKER_ID,
        targetId: player.id,
        damage,
        crit: false,
        lethal,
        bleed: true, // ambient red tick — no ring, no haptic, no strike SFX
        x: player.mover.pos.x,
        y: player.mover.pos.y,
      });
      if (lethal) killPlayer(player, events);
    }
    sands.tickLeft += CLOSING_SANDS.tickInterval;
  }
};
