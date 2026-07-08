/**
 * stepSim — the whole game, one pure-ish tick over ArenaState. "Pure-ish":
 * it mutates the state it owns (movers, hp — matching core's mutate-in-place
 * primitives) but touches nothing else; same sim + same inputs ⇒ same states
 * and events, which is what the tests assert and the netcode relies on.
 *
 * Tick order (each stage feeds the next):
 *   round machine → locomotion → dash → crowd physics → targeting/facing →
 *   attack cycles → round-over check → tick++
 */
import {
  angleTo,
  approachVelocity,
  distance,
  hitsInArc,
  normalize,
  segmentClear,
  selectTarget,
  stepAbility,
  stepAttackCycle,
  stepCrowd,
  sub,
  resolveAttack,
  type HurtCircle,
  type Mover,
  type TargetCandidate,
} from "@heroic/core";
import {
  CROWD_PUSH,
  DASH,
  ENGAGEMENT_RADIUS,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  SWORD,
  SWORD_ARC_WIDTH,
  SWORD_KNOCKBACK,
} from "./config";
import { applyDashShove, beginDash, dashInvulnerable, dashVelocity, isDashing, tickDashInvuln } from "./dash";
import type { ArenaEvent } from "./events";
import { checkRoundOver, tickRoundMachine } from "./round";
import { IDLE_INPUT, sanitizeInput, type ArenaPlayer, type PlayerInput } from "./state";
import type { ArenaSim } from "./sim";

const moverScratch: Mover[] = [];
const candidateScratch: TargetCandidate[] = [];
const hurtScratch: HurtCircle[] = [];

/** Line of sight between two players, past the zone's sight-blocking walls. */
const canSee = (sim: ArenaSim, a: ArenaPlayer, b: ArenaPlayer): boolean =>
  segmentClear(a.mover.pos, b.mover.pos, sim.zone.occluders);

/** Edge distance (to the target's rim), matching hitsInArc's range rule. */
const edgeDistance = (a: ArenaPlayer, b: ArenaPlayer): number =>
  distance(a.mover.pos, b.mover.pos) - PLAYER_RADIUS;

/**
 * Advance the match by one fixed step. `inputs` maps playerId → the latest
 * input for this tick (missing ⇒ idle). Returns the tick's transient events.
 */
export const stepSim = (
  sim: ArenaSim,
  inputs: ReadonlyMap<number, PlayerInput>,
  dt: number,
): ArenaEvent[] => {
  const { state, zone } = sim;
  const events: ArenaEvent[] = [];
  const fighting = tickRoundMachine(sim, dt, events);
  const players = state.players;

  // ── Locomotion + dash ─────────────────────────────────────────────────────
  for (const p of players) {
    if (!p.alive) continue;
    const latest = inputs.get(p.id);
    if (latest !== undefined && Number.isFinite(latest.seq)) p.lastSeq = latest.seq;
    const input = sanitizeInput(fighting ? (latest ?? IDLE_INPUT) : IDLE_INPUT);

    const desired = { x: input.sx * PLAYER_MAX_SPEED, y: input.sy * PLAYER_MAX_SPEED };
    p.mover.vel = approachVelocity(p.mover.vel, desired, dt, PLAYER_ACCEL, PLAYER_DECEL);

    const step = stepAbility(p.dash.ability, DASH, dt, fighting && input.dash);
    p.dash.ability = step.state;
    if (step.activated) {
      const mag = Math.hypot(input.sx, input.sy);
      const dir =
        mag > 0.01
          ? { x: input.sx / mag, y: input.sy / mag }
          : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      beginDash(p.dash, dir.x, dir.y);
      events.push({ type: "dash", playerId: p.id });
    }
    tickDashInvuln(p.dash, dt);
    if (isDashing(p.dash)) p.mover.vel = dashVelocity(p.dash);
  }

  // Barge: dashers scatter the enemies they plow through.
  for (const p of players) {
    if (!p.alive || !isDashing(p.dash)) continue;
    applyDashShove(p, players.filter((e) => e.team !== p.team));
  }

  // ── Crowd physics (alive players only — corpses don't collide) ────────────
  moverScratch.length = 0;
  for (const p of players) if (p.alive) moverScratch.push(p.mover);
  stepCrowd(moverScratch, dt, {
    grid: sim.grid,
    walls: zone.collision,
    player: null, // symmetric PVP: everyone is just a mover
    worldSize: zone.size.x,
    worldHeight: zone.size.y,
    pushStrength: CROWD_PUSH,
  });

  if (fighting) {
    // ── Auto-targeting + facing ───────────────────────────────────────────
    for (const p of players) {
      if (!p.alive) continue;
      candidateScratch.length = 0;
      for (const e of players) {
        if (e.team === p.team || !e.alive) continue;
        if (!canSee(sim, p, e)) continue;
        candidateScratch.push({ id: e.id, pos: e.mover.pos });
      }
      p.targetId = selectTarget(candidateScratch, p.mover.pos, ENGAGEMENT_RADIUS, p.targetId);

      const target = p.targetId === null ? undefined : players[p.targetId];
      if (target) {
        p.facing = angleTo(p.mover.pos, target.mover.pos);
      } else {
        const input = inputs.get(p.id);
        if (input) {
          const mag = Math.hypot(input.sx, input.sy);
          if (mag > 0.01) p.facing = Math.atan2(input.sy, input.sx);
        }
      }
    }

    // ── Attack cycles, in id order (deterministic; the alive-check means a
    // player killed earlier this tick never gets their swing) ───────────────
    for (const p of players) {
      if (!p.alive) continue;

      const target = p.targetId === null ? undefined : players[p.targetId];
      const targetInRange =
        target !== undefined && target.alive && edgeDistance(p, target) <= SWORD.reach;
      const locked = p.lockedTargetId === null ? undefined : players[p.lockedTargetId];
      const lockValid =
        locked !== undefined &&
        locked.alive &&
        distance(p.mover.pos, locked.mover.pos) <= ENGAGEMENT_RADIUS &&
        canSee(sim, p, locked);

      const step = stepAttackCycle(p.attack, SWORD, dt, { targetInRange, lockValid });
      p.attack = step.state;

      if (step.windupStarted) p.lockedTargetId = p.targetId;
      // The windup TRACKS its target (facing already follows targetId above):
      // at melee range a strafing player orbits clear of a start-latched cone
      // every time, and fights whiff forever. Counterplay to the telegraph is
      // dash i-frames or breaking reach — not free sidesteps.
      if (p.attack.phase === "windup" || step.struck) p.lockedFacing = p.facing;
      if (step.lockBroken) p.lockedTargetId = null;

      if (step.struck) {
        hurtScratch.length = 0;
        for (const e of players) {
          if (e.team === p.team || !e.alive) continue;
          hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: PLAYER_RADIUS });
        }
        const hits = hitsInArc(p.mover.pos, p.lockedFacing, SWORD.reach, SWORD_ARC_WIDTH, hurtScratch);
        for (const hitId of hits) {
          const defender = players[hitId];
          if (!defender || dashInvulnerable(defender.dash)) continue; // dodged through it

          const result = resolveAttack(p.combatant, defender.combatant, sim.rng);
          let away = normalize(sub(defender.mover.pos, p.mover.pos));
          if (away.x === 0 && away.y === 0) {
            away = { x: Math.cos(p.lockedFacing), y: Math.sin(p.lockedFacing) };
          }
          defender.mover.vel.x += away.x * SWORD_KNOCKBACK;
          defender.mover.vel.y += away.y * SWORD_KNOCKBACK;

          events.push({
            type: "hit",
            attackerId: p.id,
            targetId: defender.id,
            damage: result.damage,
            crit: result.crit,
            lethal: result.lethal,
            x: defender.mover.pos.x,
            y: defender.mover.pos.y,
          });
          if (result.lethal) {
            defender.alive = false;
            defender.mover.vel.x = 0;
            defender.mover.vel.y = 0;
            events.push({ type: "death", playerId: defender.id });
          }
        }
        p.lockedTargetId = null;
      }
    }

    checkRoundOver(sim, events);
  }

  state.tick += 1;
  return events;
};
