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
  applyStackingDot,
  stepStackingDot,
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
  stepBeamLink,
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
  applyFixedHit,
  damageFactorOf,
  applyImpulse,
  damageDummy,
  dashInvulnerable,
  inSandstorm,
  ironhideActive,
  isDashing,
  killPlayer,
  mirrorGuardActive,
  radiusOf,
  reachFactorOf,
  resolvePlayerHit,
  speedFactorOf,
  stepDeployables,
  stepHarpoonReels,
  stepPlayerAbilities,
  targetView,
} from "./abilities";
import type { ArenaEvent } from "./events";
import { checkRoundOver, tickRoundMachine } from "./round";
import { stepSafeCircle } from "./sands";
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

/**
 * Resolve one arc strike out to `reach`: enemies and straw men inside the
 * wedge take a full hit resolve (knockback, bleed/slow riders, kill).
 * `alreadyHit` non-null = a TRAVELLING thrust's ledger — bodies in it are
 * skipped and fresh ones recorded, so the expanding front strikes each
 * exactly once; null = the classic instant cleave.
 */
const resolveArcStrike = (
  sim: ArenaSim,
  p: ArenaPlayer,
  weapon: (typeof WEAPONS)[keyof typeof WEAPONS],
  reach: number,
  alreadyHit: number[] | null,
  events: ArenaEvent[],
): void => {
  const state = sim.state;
  const seats = state.players;
  hurtScratch.length = 0;
  for (const e of seatedPlayers(state)) {
    if (e.team === p.team || !e.alive) continue;
    hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: radiusOf(e) });
  }
  for (const d of state.deployables) {
    if (d.kind !== "straw-man" || d.team === p.team || d.hp <= 0) continue;
    hurtScratch.push({ id: d.id, pos: d.pos, radius: PLAYER_RADIUS });
  }
  // A titan's arms grow with the body: the whole band (reach AND minReach)
  // scales, so a thrust's travelling front and the trident's floating band
  // keep their character at giant size. `reach` arrives pre-progress from
  // the thrust caller — scaling here keeps that math intact.
  const reachF = reachFactorOf(p);
  const hits = hitsInArc(
    p.mover.pos,
    p.lockedFacing,
    reach * reachF,
    weapon.attack.arcWidth!,
    hurtScratch,
    (weapon.attack.minReach ?? 0) * reachF,
  );
  for (const hitId of hits) {
    if (alreadyHit) {
      if (alreadyHit.includes(hitId)) continue;
      alreadyHit.push(hitId);
    }
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

    const result = resolvePlayerHit(p, defender, sim.rng);
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
        // A refresh-flagged bleed (the trident) resets the wielder's existing
        // dot instead of stacking a second — re-pokes restart the drip.
        const prior = weapon.bleed.refresh
          ? defender.dots.find((d) => d.sourceId === p.id)
          : undefined;
        if (prior) {
          prior.ticksLeft = weapon.bleed.ticks;
          prior.tLeft = weapon.bleed.interval;
          prior.interval = weapon.bleed.interval;
          prior.damage = weapon.bleed.damage;
        } else {
          applyDot(defender.dots, {
            ticksLeft: weapon.bleed.ticks,
            tLeft: weapon.bleed.interval,
            interval: weapon.bleed.interval,
            damage: weapon.bleed.damage,
            sourceId: p.id,
          });
        }
      }
      if (weapon.poison) {
        // Stacking intensity, no rng draw (deterministic like the slow) and
        // no Ironhide gate (a damage rider, like bleed — the venom's in you).
        defender.poison = applyStackingDot(defender.poison, weapon.poison, p.id);
      }
      if (weapon.slow && !ironhideActive(defender)) {
        // Refresh, never stack — repeated hammer hits extend the window.
        defender.slowLeft = Math.max(defender.slowLeft, weapon.slow.duration);
        defender.slowFactor = weapon.slow.factor;
      }
    }
  }
};

/** The player's picked weapon config. The blade fallback only serves
 * hand-forced test states — real matches can't start with an empty pick. */
const weaponOf = (p: ArenaPlayer) => WEAPONS[p.weapon ?? "blade"];

/**
 * The Lifeline's tick (BeamWeaponConfig has the full rule set): nominate a
 * patient — the most-wounded wounded ally in range, sticky on the current
 * one — then advance the core link and pour this tick's heals. Allies or
 * NOTHING: the beam touches no enemy, ever (the snap hijack was cut,
 * Tom 2026-08-14 — counterplay is the healer's body, not the beam).
 * Eligibility is the standing rules everywhere: alive, line of sight, no
 * sandstorm at either end; a dashing ally keeps their heal (i-frames
 * dodge harm, and this is the opposite).
 */
const stepLifelineBeam = (
  sim: ArenaSim,
  p: ArenaPlayer,
  beam: NonNullable<(typeof WEAPONS)[keyof typeof WEAPONS]["beam"]>,
  players: readonly ArenaPlayer[],
  dt: number,
  events: ArenaEvent[],
): void => {
  const state = sim.state;
  let nominee: ArenaPlayer | null = null;

  if (!inSandstorm(state, p.mover.pos)) {
    const patient = (e: ArenaPlayer): boolean =>
      e.team === p.team &&
      e.id !== p.id &&
      e.alive &&
      !inSandstorm(state, e.mover.pos) &&
      canSeePos(sim, p, e.mover.pos) &&
      e.combatant.hp < e.combatant.stats.maxHp &&
      distance(p.mover.pos, e.mover.pos) - radiusOf(e) <= beam.range;
    // Sticky on the current patient while they stay eligible — re-picking
    // most-wounded every tick would reset the ramp whenever the tide
    // shifted, and the ramp would never mean anything.
    const held = p.beam === null ? undefined : players.find((e) => e.id === p.beam!.targetId);
    if (held && patient(held)) {
      nominee = held;
    } else {
      let worst = Infinity;
      for (const e of players) {
        if (!patient(e)) continue;
        const frac = e.combatant.hp / e.combatant.stats.maxHp;
        if (frac < worst) {
          worst = frac;
          nominee = e;
        }
      }
    }
  }

  const step = stepBeamLink(p.beam, nominee?.id ?? null, beam.tickInterval, dt, beam.graceSeconds);
  p.beam = step.state;
  if (step.ticks === 0 || nominee === null) return;

  for (let i = 0; i < step.ticks; i++) {
    if (!nominee.alive) break;
    // Ramp: base + growth per unbroken second, capped — read at the
    // link clock, so a protected healer climbs to font parity.
    const rate = Math.min(
      beam.healPerSecondMax,
      beam.healPerSecondBase + beam.healPerSecondRamp * p.beam!.linkSeconds,
    );
    const amount = Math.min(
      Math.round(rate * beam.tickInterval),
      nominee.combatant.stats.maxHp - nominee.combatant.hp,
    );
    if (amount <= 0) continue; // topped off — eligibility drops them next tick
    nominee.combatant.hp += amount;
    // casterId = the healer: healing credits its SOURCE (achievements.md).
    events.push({
      type: "heal",
      targetId: nominee.id,
      casterId: p.id,
      amount,
      x: nominee.mover.pos.x,
      y: nominee.mover.pos.y,
    });
  }
};

/** Loose one shot at `aim`'s position NOW, release event included — the
 * struck instant's projectile path, shared with the burst follow-ups. */
const fireShot = (
  state: ArenaSim["state"],
  p: ArenaPlayer,
  weapon: (typeof WEAPONS)[keyof typeof WEAPONS],
  aim: { id: number; pos: { x: number; y: number } },
  events: ArenaEvent[],
): void => {
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
  events.push({ type: "shoot", ownerId: p.id, weapon: p.weapon!, x: p.mover.pos.x, y: p.mover.pos.y });
};

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
    // The body IS the status (Titan's Draught): the mover's crowd/wall
    // radius tracks the grown size each tick — idempotent, and expiry or a
    // round reset shrinks it back on the next pass for free.
    p.mover.radius = radiusOf(p);
    // Ticked BEFORE the ability pass, so a taunt applied this tick keeps its
    // full duration through the targeting stage below.
    p.tauntLeft = Math.max(0, p.tauntLeft - dt);
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
        p.tauntLeft = 0; // can't take aim from inside the cloud — hold included
        p.tauntTargetId = null;
        const input = inputs.get(p.id);
        if (input) {
          const mag = Math.hypot(input.sx, input.sy);
          if (mag > 0.01) p.facing = Math.atan2(input.sy, input.sx);
        }
        continue;
      }
      // Straw Man's hold: while the taunt lasts AND the dummy would still be a
      // legal mark by this player's own rules (alive, seen, unsmoked, inside
      // THEIR weapon's engagement radius), the lock is not negotiable. Any
      // failed check releases the hold early — walking the dummy out of your
      // own reach is the intended counterplay (pvp-abilities.md § Straw Man).
      if (p.tauntLeft > 0) {
        const forced = targetView(state, p.tauntTargetId);
        if (
          forced !== null &&
          forced.alive &&
          distance(p.mover.pos, forced.pos) <= weaponOf(p).engagementRadius &&
          !inSandstorm(state, forced.pos) &&
          canSeePos(sim, p, forced.pos)
        ) {
          p.targetId = forced.id;
        } else {
          p.tauntLeft = 0;
          p.tauntTargetId = null;
        }
      }
      if (p.tauntLeft <= 0) {
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
      }

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

      // Follow-up volley bolts (the scorpion's burst): fired on their own
      // clock during recovery, each RE-AIMED at the mark's position at its
      // release instant — that's the harder-to-fully-sidestep promise.
      // Runs BEFORE the cycle step so the tick that arms a volley never
      // also advances its clock. The volley dies the MOMENT its mark dies
      // or smokes (either end) — the windup-lock rules, applied eagerly so
      // burst state never lingers on a corpse; a dead SHOOTER never
      // reaches here (the loop's alive-check), so theirs dies with them.
      if (p.burstLeft > 0 && weapon.burst) {
        const mark = targetView(state, p.burstTargetId);
        if (
          mark === null ||
          !mark.alive ||
          inSandstorm(state, mark.pos) ||
          inSandstorm(state, p.mover.pos)
        ) {
          p.burstLeft = 0;
          p.burstTargetId = null;
        } else {
          p.burstNext -= dt;
          while (p.burstNext <= 0 && p.burstLeft > 0) {
            fireShot(state, p, weapon, mark, events);
            p.burstLeft -= 1;
            p.burstNext += weapon.burst.interval;
          }
          if (p.burstLeft === 0) p.burstTargetId = null;
        }
      }

      // The beam weapon has NO cycle — its whole life is the link
      // (stepLifelineBeam); everything below is cycle machinery.
      if (weapon.attack.shape === "beam" && weapon.beam) {
        stepLifelineBeam(sim, p, weapon.beam, players, dt, events);
        continue;
      }

      const target = targetView(state, p.targetId);
      // Range mirrors hitsInArc's band rule: within reach AND overlapping the
      // weapon's minReach band (a body between the trident's prongs and the
      // hands never even triggers a swing — the dead zone is total safety).
      const targetGap = target === null ? Infinity : distance(p.mover.pos, target.pos);
      // Melee reach grows with Titan's Draught (arc weapons only — a
      // giant's bow is still the same bow); the strike resolve applies
      // the same factor, so the swing that starts is the swing that hits.
      const reachF = weapon.attack.shape === "arc" ? reachFactorOf(p) : 1;
      const targetInRange =
        target !== null &&
        target.alive &&
        targetGap - target.radius <= weapon.attack.reach * reachF &&
        targetGap + target.radius >= (weapon.attack.minReach ?? 0) * reachF;
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
          // Fire at the locked target's position NOW (the windup tracked
          // them). The release event rides fireShot — a shot went out (the
          // client's fire SFX; plays on every loose, hit or miss).
          const aim = locked ?? target;
          if (aim && weapon.shell) {
            // The bombard: mark the spot and lob a shell at it — the mark
            // is frozen at launch (walking off it is the counterplay).
            // Flight scales with distance: a close lob lands sooner (see
            // ShellConfig — the floor keeps the walk-out alive).
            const flight =
              weapon.shell.flightMin +
              Math.min(1, distance(p.mover.pos, aim.pos) / weapon.attack.reach) *
                (weapon.shell.flightMax - weapon.shell.flightMin);
            state.shells.push({
              id: state.nextProjectileId++,
              ownerId: p.id,
              team: p.team,
              from: { x: p.mover.pos.x, y: p.mover.pos.y },
              target: { x: aim.pos.x, y: aim.pos.y },
              landIn: flight,
              flightTime: flight,
              blastRadius: weapon.shell.blastRadius,
              // Stamped at launch — a titan's shell hits titan-hard even
              // if the draught runs out mid-flight.
              damage: Math.round(weapon.shell.damage * damageFactorOf(p)),
              knockback: weapon.shell.knockback,
            });
            events.push({ type: "shoot", ownerId: p.id, weapon: p.weapon!, x: p.mover.pos.x, y: p.mover.pos.y });
          } else if (aim) {
            fireShot(state, p, weapon, aim, events);
            if (weapon.burst) {
              // The volley's follow-ups fire on their own clock below.
              p.burstLeft = weapon.burst.count - 1;
              p.burstNext = weapon.burst.interval;
              p.burstTargetId = aim.id;
            }
          }
        } else if (weapon.attack.thrustDuration) {
          // The travelling thrust (the trident): arm the front — resolution
          // happens over the next few steps as it runs out (advanced below,
          // same tick included, so point-blank still feels instant).
          p.thrustLeft = weapon.attack.thrustDuration;
          p.thrustHits.length = 0;
        } else {
          resolveArcStrike(sim, p, weapon, weapon.attack.reach, null, events);
        }
        p.lockedTargetId = null;
      }

      // Advance an in-flight thrust: the front expands from the wielder to
      // full reach over thrustDuration, striking each body ONCE as it
      // crosses them — close targets are hit sooner, and a dash can slip
      // through the moving front. Anchored to the wielder's CURRENT
      // position (the spear travels with the hand) at the strike's locked
      // facing. A dead wielder's thrust dies with them.
      if (p.alive && p.thrustLeft > 0 && p.weapon) {
        const dur = weapon.attack.thrustDuration ?? 0;
        if (dur > 0) {
          p.thrustLeft = Math.max(0, p.thrustLeft - dt);
          const front = weapon.attack.reach * (1 - p.thrustLeft / dur);
          resolveArcStrike(sim, p, weapon, front, p.thrustHits, events);
        } else {
          p.thrustLeft = 0; // weapon swapped mid-thrust (lobby edge) — drop it
        }
      }
    }

    stepProjectiles(sim, players, events, dt);
    stepShells(state, players, events, dt);
    stepDeployables(state, players, events, dt);
    stepBleeds(players, events, dt);
    stepSafeCircle(sim, players, events, dt); // the Closing Sands' blood ticks
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
      hurtScratch.push({ id: e.id, pos: e.mover.pos, radius: radiusOf(e) });
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
        events.push({ type: "reflect", playerId: defender.id, attackerId: owner.id, x: shot.pos.x, y: shot.pos.y });
        break;
      }

      const rolled = resolvePlayerHit(owner, defender, sim.rng);
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
    p.poison = null;
    p.burstLeft = 0;
    p.burstNext = 0;
    p.burstTargetId = null;
    p.beam = null;
    p.slowLeft = 0;
    p.slowFactor = 1;
    p.alive = true;
  }
};

/**
 * Advance bombard shells; land the due ones. The blast is the sandtrap
 * idiom (deployables.ts detonate) with ONE deliberate break: it hits
 * EVERYONE in the zone — enemies, allies, the gunner themself (Tom,
 * 2026-08-10: artillery doesn't care). The game's first friendly-fire
 * source, scoped to this weapon: it's what makes point-blank pressure on
 * a gunner real — shelling a diver means shelling your own feet. Fixed
 * damage (applyFixedHit runs Ironhide's reduction), radial shove, dash
 * i-frames dodge the whole thing. The detonate event reuses the mine's
 * boom FX/SFX on the client. Compacts in place (the projectile pattern).
 */
const stepShells = (
  state: ArenaSim["state"],
  players: readonly ArenaPlayer[],
  events: ArenaEvent[],
  dt: number,
): void => {
  if (state.shells.length === 0) return;
  let write = 0;
  for (let read = 0; read < state.shells.length; read++) {
    const s = state.shells[read]!;
    s.landIn -= dt;
    if (s.landIn > 0) {
      state.shells[write++] = s;
      continue;
    }
    events.push({ type: "detonate", x: s.target.x, y: s.target.y });
    for (const p of players) {
      if (!p.alive || dashInvulnerable(p)) continue;
      if (distance(p.mover.pos, s.target) - PLAYER_RADIUS > s.blastRadius) continue;
      const damage = applyFixedHit(p, s.damage);
      const lethal = p.combatant.hp <= 0;
      events.push({
        type: "hit",
        attackerId: s.ownerId,
        targetId: p.id,
        damage,
        crit: false,
        lethal,
        x: p.mover.pos.x,
        y: p.mover.pos.y,
      });
      if (lethal) {
        killPlayer(p, events);
      } else {
        let away = normalize(sub(p.mover.pos, s.target));
        if (away.x === 0 && away.y === 0) away = { x: 1, y: 0 };
        applyImpulse(p, away.x, away.y, s.knockback);
      }
    }
  }
  state.shells.length = write;
};

/**
 * Tick bleeds + poisons. Dot damage is fixed (no rng draws, no defense — see
 * core status.ts) and deliberately ignores dash i-frames AND Ironhide: the
 * blade's already in you, and so is the venom.
 */
const stepBleeds = (players: readonly ArenaPlayer[], events: ArenaEvent[], dt: number): void => {
  const applyTick = (p: ArenaPlayer, damage: number, sourceId: number, poison: boolean): void => {
    p.combatant.hp = Math.max(0, p.combatant.hp - damage);
    const lethal = p.combatant.hp <= 0;
    events.push({
      type: "hit",
      attackerId: sourceId,
      targetId: p.id,
      damage,
      crit: false,
      lethal,
      ...(poison ? { poison: true as const } : { bleed: true as const }),
      x: p.mover.pos.x,
      y: p.mover.pos.y,
    });
    if (lethal) killPlayer(p, events);
  };
  for (const p of players) {
    if (!p.alive) continue;
    if (p.dots.length > 0) {
      for (const tick of stepDots(p.dots, dt)) {
        if (!p.alive) break; // an earlier tick this step was lethal
        applyTick(p, tick.damage, tick.sourceId, false);
      }
    }
    if (p.poison !== null && p.alive) {
      for (const tick of stepStackingDot(p.poison, dt)) {
        if (!p.alive) break;
        applyTick(p, tick.damage, tick.sourceId, true);
      }
      if (p.poison.expiresLeft <= 0) p.poison = null;
    }
  }
};
