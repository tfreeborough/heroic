/**
 * Damage application shared by weapons and abilities, with the ability-layer
 * bends folded in: Ironhide's damage reduction and shove immunity, and the
 * fixed-damage pattern (no variance, no crit, no defense, NO rng draws — the
 * BleedConfig rule) that every ability number uses.
 */
import { resolveAttack, type AttackResult, type Rng } from "@heroic/core";
import { IRONHIDE, SANDS_SHOVE_WINDOW } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaPlayer } from "../state";
import { damageFactorOf, ironhideActive, knockbackImmune } from "./statuses";

/** Stop a corpse: zero motion, drop riders, emit the death. */
export const killPlayer = (p: ArenaPlayer, events: ArenaEvent[]): void => {
  p.alive = false;
  p.mover.vel.x = 0;
  p.mover.vel.y = 0;
  p.dots.length = 0;
  events.push({ type: "death", playerId: p.id });
};

/**
 * resolveAttack with the status bends folded in: the attacker's Titan's
 * Draught (outgoing ×) and the defender's Ironhide (incoming ×). The full
 * roll happens either way — identical rng draws whether any status is up
 * or not, so the stream never forks on a buff — then the applied damage
 * is re-scaled. Takes the attacking PLAYER now (it needs their statuses).
 */
export const resolvePlayerHit = (attacker: ArenaPlayer, defender: ArenaPlayer, rng: Rng): AttackResult => {
  const out = damageFactorOf(attacker);
  const taken = ironhideActive(defender) ? IRONHIDE.damageTakenFactor : 1;
  if (out === 1 && taken === 1) return resolveAttack(attacker.combatant, defender.combatant, rng);
  const hpBefore = defender.combatant.hp;
  const rolled = resolveAttack(attacker.combatant, defender.combatant, rng);
  const damage = Math.max(1, Math.round(rolled.damage * out * taken));
  const hp = Math.max(0, hpBefore - damage);
  defender.combatant.hp = hp;
  return { ...rolled, damage, defenderHp: hp, lethal: hp === 0 };
};

/**
 * A fixed ability hit (Tremor, Sandtrap, Harpoon): deterministic damage that
 * only Ironhide bends. Mutates hp; returns the damage actually dealt — the
 * caller emits the event and checks lethality.
 */
export const applyFixedHit = (victim: ArenaPlayer, base: number): number => {
  const damage = ironhideActive(victim)
    ? Math.max(1, Math.round(base * IRONHIDE.damageTakenFactor))
    : base;
  victim.combatant.hp = Math.max(0, victim.combatant.hp - damage);
  return damage;
};

/** Stamp `victim` as displaced by `byId` — every shove/pull/drag calls it so
 * a shoreline crossing inside SANDS_SHOVE_WINDOW credits the right player
 * (bits-sands-deeds.md: Undertow). Self-displacement never counts. */
export const markShoved = (victim: ArenaPlayer, byId: number): void => {
  if (byId === victim.id) return;
  victim.shovedBy = byId;
  victim.shoveLeft = SANDS_SHOVE_WINDOW;
};

/** A radial velocity impulse, gated by Ironhide's immunity. `byId` = who
 * threw it (the shove credit). */
export const applyImpulse = (victim: ArenaPlayer, dirX: number, dirY: number, impulse: number, byId: number): void => {
  if (knockbackImmune(victim)) return;
  victim.mover.vel.x += dirX * impulse;
  victim.mover.vel.y += dirY * impulse;
  markShoved(victim, byId);
};
