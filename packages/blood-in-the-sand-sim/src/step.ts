/**
 * stepSim — the whole game, one pure-ish tick over ArenaState. "Pure-ish":
 * it mutates the state it owns (movers, hp — matching core's mutate-in-place
 * primitives) but touches nothing else; same sim + same inputs ⇒ same states
 * and events, which is what the tests assert and the netcode relies on.
 *
 * Tick order (each stage feeds the next):
 *   round machine → locomotion → abilities → crowd physics → targeting/facing →
 *   attack cycles → projectiles → deployables → bleeds → round-over check → tick++
 */
import {
  angleDiff,
  angleTo,
  applyDot,
  approachVelocity,
  ATTACK_CYCLE_READY,
  distance,
  distanceToAabb,
  hitsInArc,
  normalize,
  projectileKnockback,
  rotate,
  segmentClear,
  selectTarget,
  spawnProjectile,
  stepAttackCycle,
  stepCrowd,
  stepDots,
  stepProjectile,
  sub,
  type HurtCircle,
  type Mover,
  type TargetCandidate,
  type Vec2,
} from "@heroic/core";
import {
  CROWD_PUSH,
  DUMMY_RESPAWN_SECONDS,
  MIRROR_GUARD,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  WEAPONS,
} from "./config";
import {
  applyDashShove,
  applyImpulse,
  damageDummy,
  dashInvulnerable,
  inSandstorm,
  ironhideActive,
  isDashing,
  killPlayer,
  mirrorGuardActive,
  resolvePlayerHit,
  speedFactorOf,
  stepDeployables,
  stepHarpoonReels,
  stepPlayerAbilities,
  targetView,
} from "./abilities";
import type { ArenaEvent } from "./events";
import { checkRoundOver, tickRoundMachine } from "./round";
import {
  createAbilitySlots,
  IDLE_INPUT,
  isDeployableId,
  sanitizeInput,
  seatedPlayers,
  type ArenaPlayer,
  type ArenaProjectile,
  type PlayerInput,
} from "./state";
import { spawnFacing, spawnSlotPos, teamSlotOf, type ArenaSim } from "./sim";

const moverScratch: Mover[] = [];
const candidateScratch: TargetCandidate[] = [];
const hurtScratch: HurtCircle[] = [];

/** Line of sight from a player to a point, past the zone's sight-blocking walls. */
const canSeePos = (sim: ArenaSim, from: ArenaPlayer, pos: Vec2): boolean =>
  segmentClear(from.mover.pos, pos, sim.zone.occluders);

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

  // ── Locomotion + abilities ────────────────────────────────────────────────
  for (const p of players) {
    if (!p.alive) continue;
    const latest = inputs.get(p.id);
    if (latest !== undefined && Number.isFinite(latest.seq)) p.lastSeq = latest.seq;
    const input = sanitizeInput(fighting ? (latest ?? IDLE_INPUT) : IDLE_INPUT);

    // Speed statuses cap run speed while they last (hammer slow, Ironhide's
    // self-slow, a War Drums aura). They deliberately do NOT touch dash: the
    // committed roll overwrites velocity wholesale (in stepPlayerAbilities),
    // so the escape hop stays a real answer to being slowed.
    p.slowLeft = Math.max(0, p.slowLeft - dt);
    const maxSpeed = PLAYER_MAX_SPEED * speedFactorOf(p, players);
    const desired = { x: input.sx * maxSpeed, y: input.sy * maxSpeed };
    p.mover.vel = approachVelocity(p.mover.vel, desired, dt, PLAYER_ACCEL, PLAYER_DECEL);

    // The drafted hand: lifecycles, cast effects, dash i-frames + velocity.
    stepPlayerAbilities(sim, p, input, fighting, dt, events, players);
  }

  // Harpoon reels: victims hauled toward their rooted casters. After the
  // ability pass (a chain landed this tick starts dragging this tick), before
  // the crowd step moves anyone.
  stepHarpoonReels(sim, players, dt);

  // Barge: dashers scatter the enemies they plow through.
  for (const p of players) {
    if (!p.alive || !isDashing(p)) continue;
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
    // The target pool is enemy players PLUS enemy straw men (a decoy is a
    // first-class mark), MINUS anyone stood in a sandstorm (no new locks).
    // The cloud blinds BOTH ways (Tom, 2026-07-15): stand in it and you
    // can't take aim either — no hiding inside while shooting out.
    for (const p of players) {
      if (!p.alive || p.dummy) continue; // a dummy never takes aim
      candidateScratch.length = 0;
      if (inSandstorm(state, p.mover.pos)) {
        p.targetId = null;
        const input = inputs.get(p.id);
        if (input) {
          const mag = Math.hypot(input.sx, input.sy);
          if (mag > 0.01) p.facing = Math.atan2(input.sy, input.sx);
        }
        continue;
      }
      for (const e of players) {
        if (e.team === p.team || !e.alive) continue;
        if (inSandstorm(state, e.mover.pos)) continue;
        if (!canSeePos(sim, p, e.mover.pos)) continue;
        candidateScratch.push({ id: e.id, pos: e.mover.pos });
      }
      for (const d of state.deployables) {
        if (d.kind !== "straw-man" || d.team === p.team || d.hp <= 0) continue;
        if (inSandstorm(state, d.pos)) continue;
        if (!canSeePos(sim, p, d.pos)) continue;
        candidateScratch.push({ id: d.id, pos: d.pos });
      }
      p.targetId = selectTarget(candidateScratch, p.mover.pos, weaponOf(p).engagementRadius, p.targetId);

      const target = targetView(state, p.targetId);
      if (target) {
        p.facing = angleTo(p.mover.pos, target.pos);
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
      if (!p.alive || p.dummy) continue; // a dummy never swings
      const weapon = weaponOf(p);

      const target = targetView(state, p.targetId);
      const targetInRange =
        target !== null &&
        target.alive &&
        distance(p.mover.pos, target.pos) - target.radius <= weapon.attack.reach;
      const locked = targetView(state, p.lockedTargetId);
      // A smoked mark counts as lost (the sandstorm rule) — mid-windup too,
      // and stepping into the cloud yourself breaks your own windup.
      const lockValid =
        locked !== null &&
        locked.alive &&
        distance(p.mover.pos, locked.pos) <= weapon.engagementRadius &&
        !inSandstorm(state, locked.pos) &&
        !inSandstorm(state, p.mover.pos) &&
        canSeePos(sim, p, locked.pos);

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
              ...spawnProjectile(p.mover.pos, aim.pos, {
                speed: weapon.attack.projectileSpeed!,
                radius: weapon.projectile!.radius,
                maxRange: weapon.projectile!.maxRange,
              }),
              id: state.nextProjectileId++,
              ownerId: p.id,
              kind: p.weapon ?? "blade",
              targetId: weapon.projectile!.homingTurnRate ? aim.id : null,
            };
            state.projectiles.push(shot);
            // The release — a shot went out (the client's fire SFX; plays on
            // every loose, hit or miss). `p.weapon` is set here (it's what
            // routed us into the projectile branch).
            events.push({ type: "shoot", ownerId: p.id, weapon: p.weapon!, x: p.mover.pos.x, y: p.mover.pos.y });
          }
        } else {
          hurtScratch.length = 0;
          for (const e of players) {
            if (e.team === p.team || !e.alive) continue;
            hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: PLAYER_RADIUS });
          }
          for (const d of state.deployables) {
            if (d.kind !== "straw-man" || d.team === p.team || d.hp <= 0) continue;
            hurtScratch.push({ id: d.id, pos: d.pos, radius: PLAYER_RADIUS });
          }
          const hits = hitsInArc(
            p.mover.pos,
            p.lockedFacing,
            weapon.attack.reach,
            weapon.attack.arcWidth!,
            hurtScratch,
          );
          for (const hitId of hits) {
            if (isDeployableId(hitId)) {
              // The decoy soaks it: a full resolve against the dummy sheet.
              const dummy = state.deployables.find((d) => d.id === hitId);
              if (!dummy) continue;
              const result = damageDummy(p, dummy, sim.rng);
              events.push({
                type: "hit",
                attackerId: p.id,
                targetId: dummy.id,
                damage: result.damage,
                crit: result.crit,
                lethal: false, // dummies break, they don't die
                x: dummy.pos.x,
                y: dummy.pos.y,
              });
              continue;
            }
            const defender = seats[hitId];
            if (!defender || dashInvulnerable(defender)) continue; // dodged through it

            const result = resolvePlayerHit(p.combatant, defender, sim.rng);
            const knockback = weapon.attack.knockback ?? 0;
            let away = normalize(sub(defender.mover.pos, p.mover.pos));
            if (away.x === 0 && away.y === 0) {
              away = { x: Math.cos(p.lockedFacing), y: Math.sin(p.lockedFacing) };
            }
            applyImpulse(defender, away.x, away.y, knockback);

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
              killPlayer(defender, events);
            } else {
              if (weapon.bleed && sim.rng.next() < weapon.bleed.chance) {
                applyDot(defender.dots, {
                  ticksLeft: weapon.bleed.ticks,
                  tLeft: weapon.bleed.interval,
                  interval: weapon.bleed.interval,
                  damage: weapon.bleed.damage,
                  sourceId: p.id,
                });
              }
              if (weapon.slow && !ironhideActive(defender)) {
                // Refresh, never stack — repeated hammer hits extend the window.
                defender.slowLeft = Math.max(defender.slowLeft, weapon.slow.duration);
                defender.slowFactor = weapon.slow.factor;
              }
            }
          }
        }
        p.lockedTargetId = null;
      }
    }

    stepProjectiles(sim, players, events, dt);
    stepDeployables(state, players, events, dt);
    stepBleeds(players, events, dt);
    if (state.training) respawnDummies(sim, players, dt);
    checkRoundOver(sim, events); // stands down in training — rounds never end
  }

  state.tick += 1;
  return events;
};

/**
 * Advance every live shot: steer (staff homing / reflected fire), move,
 * resolve body hits, stop on walls. Homing lives HERE, not in core —
 * flight.ts deliberately defers mid-flight steering to the caller.
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
    const weapon = WEAPONS[shot.kind];

    // Steer toward the fire-time target while it lives, capped per tick — a
    // low cap is the "slightly homing" feel: real at range, outrunnable close.
    // Reflected shots home HARD (Mirror Guard's return fire is a real threat).
    const homingRate = shot.reflected
      ? MIRROR_GUARD.homingTurnRate
      : (weapon.projectile?.homingTurnRate ?? 0);
    const target = targetView(state, shot.targetId);
    if (homingRate > 0 && target && target.alive) {
      const desired = angleTo(shot.pos, target.pos);
      const current = Math.atan2(shot.dir.y, shot.dir.x);
      const turnCap = homingRate * dt;
      const turn = Math.max(-turnCap, Math.min(turnCap, angleDiff(desired, current)));
      shot.dir = rotate(shot.dir, turn);
    }

    // Dash i-frames exclude you from the shot's targets entirely — you can
    // dash THROUGH an arrow, matching the melee i-frame rule. Straw men are
    // bodies too: a decoy eats arrows exactly like the player it imitates.
    hurtScratch.length = 0;
    for (const e of players) {
      if (e.team === owner.team || !e.alive || dashInvulnerable(e)) continue;
      hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: PLAYER_RADIUS });
    }
    for (const d of state.deployables) {
      if (d.kind !== "straw-man" || d.team === owner.team || d.hp <= 0) continue;
      hurtScratch.push({ id: d.id, pos: d.pos, radius: PLAYER_RADIUS });
    }

    const result = stepProjectile(shot, dt, hurtScratch);
    let reflected = false;
    for (const hitId of result.hits) {
      if (isDeployableId(hitId)) {
        const dummy = state.deployables.find((d) => d.id === hitId);
        if (!dummy) continue;
        const rolled = damageDummy(owner, dummy, sim.rng);
        events.push({
          type: "hit", attackerId: shot.ownerId, targetId: dummy.id, damage: rolled.damage,
          crit: rolled.crit, lethal: false, x: dummy.pos.x, y: dummy.pos.y,
        });
        continue;
      }
      const defender = seats[hitId];
      if (!defender) continue;

      if (mirrorGuardActive(defender)) {
        // The bounce is a field swap, not a new system: ownership flips, the
        // shot turns on its shooter with strong homing and a fresh range
        // budget. hitIds already holds the reflector, so it can't re-hit them.
        shot.ownerId = defender.id;
        shot.targetId = owner.id;
        shot.reflected = true;
        shot.traveled = 0;
        let back = normalize(sub(owner.mover.pos, shot.pos));
        if (back.x === 0 && back.y === 0) back = { x: -shot.dir.x, y: -shot.dir.y };
        shot.dir = back;
        reflected = true;
        break;
      }

      const rolled = resolvePlayerHit(owner.combatant, defender, sim.rng);
      const impulse = projectileKnockback(shot, weapon.attack.knockback ?? 0);
      applyImpulse(defender, impulse.x, impulse.y, 1);
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
      if (rolled.lethal) killPlayer(defender, events);
    }

    // Walls stop shots (core leaves level geometry to the caller).
    let expired = result.expired && !reflected;
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
 * Training mode: a dead dummy stands back up after DUMMY_RESPAWN_SECONDS —
 * full hp, statuses dropped, back on its spawn slot ("another one spawns in
 * its place"), so the firing range never empties. No rng draws, no events:
 * the client just sees the player flip back to alive.
 */
const respawnDummies = (sim: ArenaSim, players: readonly ArenaPlayer[], dt: number): void => {
  for (const p of players) {
    if (!p.dummy || p.alive) continue;
    if (p.respawnLeft === 0) {
      p.respawnLeft = DUMMY_RESPAWN_SECONDS; // just died — start the beat
      continue;
    }
    p.respawnLeft = Math.max(0, p.respawnLeft - dt);
    if (p.respawnLeft > 0) continue;
    const spawn = spawnSlotPos(sim, p.team, teamSlotOf(sim.state, p));
    p.mover.pos.x = spawn.x;
    p.mover.pos.y = spawn.y;
    p.mover.vel.x = 0;
    p.mover.vel.y = 0;
    p.facing = spawnFacing(sim, spawn);
    p.combatant.hp = p.combatant.stats.maxHp;
    p.attack = ATTACK_CYCLE_READY;
    p.targetId = null;
    p.lockedTargetId = null;
    p.lockedFacing = p.facing;
    p.slots = createAbilitySlots(p.abilities);
    p.dots.length = 0;
    p.slowLeft = 0;
    p.slowFactor = 1;
    p.alive = true;
  }
};

/**
 * Tick bleeds. Dot damage is fixed (no rng draws, no defense — see core
 * status.ts) and deliberately ignores dash i-frames AND Ironhide: the blade's
 * already in you.
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
      if (lethal) killPlayer(p, events);
    }
  }
};
