/**
 * stepSim — the whole game, one pure-ish tick over ArenaState. "Pure-ish":
 * it mutates the state it owns (movers, hp — matching core's mutate-in-place
 * primitives) but touches nothing else; same sim + same inputs ⇒ same states
 * and events, which is what the tests assert and the netcode relies on.
 *
 * Tick order (each stage feeds the next):
 *   round machine → locomotion → dash → crowd physics → targeting/facing →
 *   attack cycles → projectiles → bleeds → round-over check → tick++
 */
import {
  angleDiff,
  angleTo,
  applyDot,
  approachVelocity,
  distance,
  distanceToAabb,
  hitsInArc,
  normalize,
  projectileKnockback,
  rotate,
  segmentClear,
  selectTarget,
  spawnProjectile,
  stepAbility,
  stepAttackCycle,
  stepCrowd,
  stepDots,
  stepProjectile,
  sub,
  resolveAttack,
  type HurtCircle,
  type Mover,
  type TargetCandidate,
} from "@heroic/core";
import {
  CROWD_PUSH,
  DASH,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  WEAPONS,
} from "./config";
import { applyDashShove, beginDash, dashInvulnerable, dashVelocity, isDashing, tickDashInvuln } from "./dash";
import type { ArenaEvent } from "./events";
import { checkRoundOver, tickRoundMachine } from "./round";
import {
  IDLE_INPUT,
  sanitizeInput,
  seatedPlayers,
  type ArenaPlayer,
  type ArenaProjectile,
  type PlayerInput,
} from "./state";
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

/** The player's picked weapon config. The blade fallback only serves
 * hand-forced test states — real matches can't start with an empty pick. */
const weaponOf = (p: ArenaPlayer) => WEAPONS[p.weapon ?? "blade"];

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
  // `seats` for id lookups (id = seat index, may be null); `players` for iteration.
  const seats = state.players;
  const players = seatedPlayers(state);

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
      p.targetId = selectTarget(candidateScratch, p.mover.pos, weaponOf(p).engagementRadius, p.targetId);

      const target = p.targetId === null ? undefined : (seats[p.targetId] ?? undefined);
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
      const weapon = weaponOf(p);

      const target = p.targetId === null ? undefined : (seats[p.targetId] ?? undefined);
      const targetInRange =
        target !== undefined && target.alive && edgeDistance(p, target) <= weapon.attack.reach;
      const locked = p.lockedTargetId === null ? undefined : (seats[p.lockedTargetId] ?? undefined);
      const lockValid =
        locked !== undefined &&
        locked.alive &&
        distance(p.mover.pos, locked.mover.pos) <= weapon.engagementRadius &&
        canSee(sim, p, locked);

      const step = stepAttackCycle(p.attack, weapon.attack, dt, { targetInRange, lockValid });
      p.attack = step.state;

      if (step.windupStarted) p.lockedTargetId = p.targetId;
      // The windup TRACKS its target (facing already follows targetId above):
      // at melee range a strafing player orbits clear of a start-latched cone
      // every time, and fights whiff forever. Counterplay to the telegraph is
      // dash i-frames or breaking reach — not free sidesteps.
      if (p.attack.phase === "windup" || step.struck) p.lockedFacing = p.facing;
      if (step.lockBroken) p.lockedTargetId = null;

      if (step.struck) {
        if (weapon.attack.shape === "projectile") {
          // Fire at the locked target's position NOW (the windup tracked them).
          const aim = locked ?? target;
          if (aim) {
            const shot: ArenaProjectile = {
              ...spawnProjectile(p.mover.pos, aim.mover.pos, {
                speed: weapon.attack.projectileSpeed!,
                radius: weapon.projectile!.radius,
                maxRange: weapon.projectile!.maxRange,
              }),
              id: state.nextProjectileId++,
              ownerId: p.id,
              weapon: p.weapon ?? "blade",
              targetId: weapon.projectile!.homingTurnRate ? aim.id : null,
            };
            state.projectiles.push(shot);
          }
        } else {
          hurtScratch.length = 0;
          for (const e of players) {
            if (e.team === p.team || !e.alive) continue;
            hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: PLAYER_RADIUS });
          }
          const hits = hitsInArc(
            p.mover.pos,
            p.lockedFacing,
            weapon.attack.reach,
            weapon.attack.arcWidth!,
            hurtScratch,
          );
          for (const hitId of hits) {
            const defender = seats[hitId];
            if (!defender || dashInvulnerable(defender.dash)) continue; // dodged through it

            const result = resolveAttack(p.combatant, defender.combatant, sim.rng);
            const knockback = weapon.attack.knockback ?? 0;
            let away = normalize(sub(defender.mover.pos, p.mover.pos));
            if (away.x === 0 && away.y === 0) {
              away = { x: Math.cos(p.lockedFacing), y: Math.sin(p.lockedFacing) };
            }
            defender.mover.vel.x += away.x * knockback;
            defender.mover.vel.y += away.y * knockback;

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
            } else if (weapon.bleed && sim.rng.next() < weapon.bleed.chance) {
              applyDot(defender.dots, {
                ticksLeft: weapon.bleed.ticks,
                tLeft: weapon.bleed.interval,
                interval: weapon.bleed.interval,
                damage: weapon.bleed.damage,
                sourceId: p.id,
              });
            }
          }
        }
        p.lockedTargetId = null;
      }
    }

    stepProjectiles(sim, players, events, dt);
    stepBleeds(players, events, dt);
    checkRoundOver(sim, events);
  }

  state.tick += 1;
  return events;
};

/**
 * Advance every live shot: steer (staff homing), move, resolve body hits,
 * stop on walls. Homing lives HERE, not in core — flight.ts deliberately
 * defers mid-flight steering to the caller.
 */
const stepProjectiles = (
  sim: ArenaSim,
  players: readonly ArenaPlayer[],
  events: ArenaEvent[],
  dt: number,
): void => {
  const { state, zone } = sim;
  if (state.projectiles.length === 0) return;
  const seats = state.players;

  let write = 0;
  for (let read = 0; read < state.projectiles.length; read++) {
    const shot = state.projectiles[read]!;
    const owner = seats[shot.ownerId];
    if (!owner) continue; // seat vanished (lobby edge) — drop the shot
    const weapon = WEAPONS[shot.weapon];

    // Steer toward the fire-time target while it lives, capped per tick — a
    // low cap is the "slightly homing" feel: real at range, outrunnable close.
    const homingRate = weapon.projectile?.homingTurnRate ?? 0;
    const target = shot.targetId === null ? null : seats[shot.targetId];
    if (homingRate > 0 && target && target.alive) {
      const desired = angleTo(shot.pos, target.mover.pos);
      const current = Math.atan2(shot.dir.y, shot.dir.x);
      const turnCap = homingRate * dt;
      const turn = Math.max(-turnCap, Math.min(turnCap, angleDiff(desired, current)));
      shot.dir = rotate(shot.dir, turn);
    }

    // Dash i-frames exclude you from the shot's targets entirely — you can
    // dash THROUGH an arrow, matching the melee i-frame rule.
    hurtScratch.length = 0;
    for (const e of players) {
      if (e.team === owner.team || !e.alive || dashInvulnerable(e.dash)) continue;
      hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: PLAYER_RADIUS });
    }

    const result = stepProjectile(shot, dt, hurtScratch);
    for (const hitId of result.hits) {
      const defender = seats[hitId];
      if (!defender) continue;
      const rolled = resolveAttack(owner.combatant, defender.combatant, sim.rng);
      const impulse = projectileKnockback(shot, weapon.attack.knockback ?? 0);
      defender.mover.vel.x += impulse.x;
      defender.mover.vel.y += impulse.y;
      events.push({
        type: "hit",
        attackerId: shot.ownerId,
        targetId: defender.id,
        damage: rolled.damage,
        crit: rolled.crit,
        lethal: rolled.lethal,
        x: defender.mover.pos.x,
        y: defender.mover.pos.y,
      });
      if (rolled.lethal) {
        defender.alive = false;
        defender.mover.vel.x = 0;
        defender.mover.vel.y = 0;
        events.push({ type: "death", playerId: defender.id });
      }
    }

    // Walls stop shots (core leaves level geometry to the caller).
    let expired = result.expired;
    if (!expired) {
      for (const wall of zone.collision) {
        if (distanceToAabb(shot.pos, wall) <= shot.radius) {
          expired = true;
          break;
        }
      }
    }
    if (!expired) state.projectiles[write++] = shot;
  }
  state.projectiles.length = write;
};

/**
 * Tick bleeds. Dot damage is fixed (no rng draws, no defense — see core
 * status.ts) and deliberately ignores dash i-frames: the blade's already in you.
 */
const stepBleeds = (players: readonly ArenaPlayer[], events: ArenaEvent[], dt: number): void => {
  for (const p of players) {
    if (!p.alive || p.dots.length === 0) continue;
    for (const tick of stepDots(p.dots, dt)) {
      if (!p.alive) break; // an earlier tick this step was lethal
      p.combatant.hp = Math.max(0, p.combatant.hp - tick.damage);
      const lethal = p.combatant.hp <= 0;
      events.push({
        type: "hit",
        attackerId: tick.sourceId,
        targetId: p.id,
        damage: tick.damage,
        crit: false,
        lethal,
        bleed: true,
        x: p.mover.pos.x,
        y: p.mover.pos.y,
      });
      if (lethal) {
        p.alive = false;
        p.mover.vel.x = 0;
        p.mover.vel.y = 0;
        p.dots.length = 0;
        events.push({ type: "death", playerId: p.id });
      }
    }
  }
};
