/**
 * Damage application shared by weapons and abilities, with the ability-layer
 * bends folded in: Ironhide's damage reduction and shove immunity, and the
 * fixed-damage pattern (no variance, no crit, no defense, NO rng draws — the
 * BleedConfig rule) that every ability number uses.
 */
import { resolveAttack, type AttackResult, type Combatant, type Rng } from "@heroic/core";
import { IRONHIDE } from "../config";
import type { ArenaEvent } from "../events";
import type { ArenaPlayer } from "../state";
import { ironhideActive, knockbackImmune } from "./statuses";

/** Stop a corpse: zero motion, drop riders, emit the death. */
export const killPlayer = (p: ArenaPlayer, events: ArenaEvent[]): void => {
  p.alive = false;
  p.mover.vel.x = 0;
  p.mover.vel.y = 0;
  p.dots.length = 0;
  events.push({ type: "death", playerId: p.id });
};

/**
 * resolveAttack with Ironhide folded in. The full roll happens either way —
 * identical rng draws whether the status is up or not, so the stream never
 * forks on a defender's buff — then the applied damage is re-scaled.
 */
export const resolvePlayerHit = (attacker: Combatant, defender: ArenaPlayer, rng: Rng): AttackResult => {
  if (!ironhideActive(defender)) return resolveAttack(attacker, defender.combatant, rng);
  const hpBefore = defender.combatant.hp;
  const rolled = resolveAttack(attacker, defender.combatant, rng);
  const damage = Math.max(1, Math.round(rolled.damage * IRONHIDE.damageTakenFactor));
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

/** A radial velocity impulse, gated by Ironhide's immunity. */
export const applyImpulse = (victim: ArenaPlayer, dirX: number, dirY: number, impulse: number): void => {
  if (knockbackImmune(victim)) return;
  victim.mover.vel.x += dirX * impulse;
  victim.mover.vel.y += dirY * impulse;
};
