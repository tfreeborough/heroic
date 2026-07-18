/**
 * The Deployable entity — Sandtrap, Straw Man, Blood Font and Sandstorm are
 * all kinds of this one thing (docs/design/pvp-abilities.md). Spawning is a
 * cast effect; stepDeployables runs after projectiles each tick and owns
 * arming, triggering, healing, and expiry. Everything is fixed-number and
 * rng-free except dummy hits, which route through resolveAttack elsewhere.
 */
import { distance, normalize, resolveAttack, sub, type AttackResult, type Rng } from "@heroic/core";
import { BLOOD_FONT, PLAYER_RADIUS, SANDSTORM, SANDTRAP, STRAW_MAN, STRAW_MAN_STATS, TREMOR } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaPlayer, ArenaState, Deployable, DeployableKind } from "../state";
import { dashInvulnerable } from "./dash";
import { applyFixedHit, applyImpulse, killPlayer } from "./damage";
import { ironhideActive } from "./statuses";

/** Place a deployable at the caster's feet. Sandtrap enforces its one-live-
 * mine rule here: planting a new one fizzles (removes) the old, silently. */
export const castDeployable = (state: ArenaState, kind: DeployableKind, caster: ArenaPlayer): void => {
  if (kind === "sandtrap") {
    const old = state.deployables.findIndex((d) => d.kind === "sandtrap" && d.ownerId === caster.id);
    if (old !== -1) state.deployables.splice(old, 1);
  }
  state.deployables.push({
    id: state.nextDeployableId++,
    kind,
    ownerId: caster.id,
    team: caster.team,
    pos: { x: caster.mover.pos.x, y: caster.mover.pos.y },
    armLeft: kind === "sandtrap" ? SANDTRAP.armSeconds : 0,
    lifeLeft:
      kind === "sandtrap"
        ? SANDTRAP.lifetime
        : kind === "straw-man"
          ? STRAW_MAN.lifetime
          : kind === "blood-font"
            ? BLOOD_FONT.duration
            : kind === "quake"
              ? TREMOR.duration
              : SANDSTORM.duration,
    hp: kind === "straw-man" ? STRAW_MAN.hp : 0,
    // The quake's 0 means its FIRST tick fires on the next step — the ground
    // bites the moment it opens, and all 4 ticks (0/1/2/3s) land safely
    // inside the 4s life (a tick riding exactly on expiry would be dropped).
    tickLeft: kind === "blood-font" ? BLOOD_FONT.tickInterval : 0,
  });
};

/**
 * Land a weapon hit on a straw man. The dummy is "a combatant that can't act":
 * the full resolveAttack roll runs against its stat sheet (identical rng
 * draws to hitting a player), then its hp carries the result.
 */
export const damageDummy = (
  attacker: ArenaPlayer,
  dummy: Deployable,
  rng: Rng,
): AttackResult => {
  const body = { hp: dummy.hp, stats: STRAW_MAN_STATS };
  const result = resolveAttack(attacker.combatant, body, rng);
  dummy.hp = body.hp;
  return result;
};

/** The mine goes off: fixed damage + radial shove to every enemy in the blast.
 * Dash i-frames dodge it (you can roll THROUGH your own mistake); Ironhide
 * tanks it. The triggering foot and the blast are both enemy-only. */
const detonate = (
  mine: Deployable,
  players: readonly ArenaPlayer[],
  events: ArenaEvent[],
): void => {
  events.push({ type: "detonate", x: mine.pos.x, y: mine.pos.y });
  for (const p of players) {
    if (p.team === mine.team || !p.alive || dashInvulnerable(p)) continue;
    if (distance(p.mover.pos, mine.pos) - PLAYER_RADIUS > SANDTRAP.blastRadius) continue;
    const damage = applyFixedHit(p, SANDTRAP.damage);
    const lethal = p.combatant.hp <= 0;
    events.push({
      type: "hit",
      attackerId: mine.ownerId,
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
      let away = normalize(sub(p.mover.pos, mine.pos));
      if (away.x === 0 && away.y === 0) away = { x: 1, y: 0 };
      applyImpulse(p, away.x, away.y, SANDTRAP.knockback);
    }
  }
};

/**
 * Advance every deployable one tick: arm/trigger mines, pour font heals,
 * expire lifetimes, sweep broken dummies. Compacts the array in place
 * (write-index, the projectile pattern).
 */
export const stepDeployables = (
  state: ArenaState,
  players: readonly ArenaPlayer[],
  events: ArenaEvent[],
  dt: number,
): void => {
  if (state.deployables.length === 0) return;
  let write = 0;
  for (let read = 0; read < state.deployables.length; read++) {
    const d = state.deployables[read]!;
    d.lifeLeft -= dt;
    let spent = d.lifeLeft <= 0;

    if (d.kind === "sandtrap" && !spent) {
      if (d.armLeft > 0) {
        d.armLeft = Math.max(0, d.armLeft - dt);
      } else {
        const tripped = players.some(
          (p) =>
            p.team !== d.team &&
            p.alive &&
            distance(p.mover.pos, d.pos) - PLAYER_RADIUS <= SANDTRAP.triggerRadius,
        );
        if (tripped) {
          detonate(d, players, events);
          spent = true;
        }
      }
    } else if (d.kind === "blood-font" && !spent) {
      d.tickLeft -= dt;
      while (d.tickLeft <= 0) {
        for (const p of players) {
          if (p.team !== d.team || !p.alive) continue;
          if (distance(p.mover.pos, d.pos) > BLOOD_FONT.radius) continue;
          const amount = Math.min(BLOOD_FONT.healPerTick, p.combatant.stats.maxHp - p.combatant.hp);
          if (amount <= 0) continue;
          p.combatant.hp += amount;
          events.push({ type: "heal", targetId: p.id, amount, x: p.mover.pos.x, y: p.mover.pos.y });
        }
        d.tickLeft += BLOOD_FONT.tickInterval;
      }
    } else if (d.kind === "quake" && !spent) {
      // The quake: Blood Font inverted — fixed chip ticks on enemies inside —
      // plus a slow refreshed EVERY step (step out and it lingers slowLinger).
      // Dash i-frames dodge both; Ironhide takes reduced ticks, no slow.
      for (const p of players) {
        if (p.team === d.team || !p.alive || dashInvulnerable(p) || ironhideActive(p)) continue;
        if (distance(p.mover.pos, d.pos) - PLAYER_RADIUS > TREMOR.radius) continue;
        // Strongest factor wins while a hammer slow (0.5) overlaps this one.
        p.slowFactor = p.slowLeft > 0 ? Math.min(p.slowFactor, TREMOR.slowFactor) : TREMOR.slowFactor;
        p.slowLeft = Math.max(p.slowLeft, TREMOR.slowLinger);
      }
      d.tickLeft -= dt;
      while (d.tickLeft <= 0) {
        for (const p of players) {
          if (p.team === d.team || !p.alive || dashInvulnerable(p)) continue;
          if (distance(p.mover.pos, d.pos) - PLAYER_RADIUS > TREMOR.radius) continue;
          const damage = applyFixedHit(p, TREMOR.damagePerTick);
          const lethal = p.combatant.hp <= 0;
          events.push({
            type: "hit",
            attackerId: d.ownerId,
            targetId: p.id,
            damage,
            crit: false,
            lethal,
            x: p.mover.pos.x,
            y: p.mover.pos.y,
          });
          if (lethal) killPlayer(p, events);
        }
        d.tickLeft += TREMOR.tickInterval;
      }
    } else if (d.kind === "straw-man" && d.hp <= 0) {
      spent = true;
    }

    if (!spent) state.deployables[write++] = d;
  }
  state.deployables.length = write;
};
