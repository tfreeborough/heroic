import { randInt, type Rng } from "../rng";

export interface CombatStats {
  maxHp: number;
  attack: number;
  /** Flat mitigation applied after attack; never reduces a hit below `minDamage`. */
  defense: number;
  /** Chance in [0, 1] of a critical hit. */
  critChance: number;
  /** Multiplier applied to damage on a crit. */
  critMultiplier: number;
}

export interface Combatant {
  hp: number;
  stats: CombatStats;
}

export interface AttackResult {
  damage: number;
  crit: boolean;
  /** Defender hp after the hit (clamped at 0). */
  defenderHp: number;
  lethal: boolean;
}

export const MIN_DAMAGE = 1;

export const makeCombatant = (stats: CombatStats): Combatant => ({
  hp: stats.maxHp,
  stats,
});

/**
 * Resolves a single attack and mutates `defender.hp`. Randomness flows through
 * the injected `rng`, so combat is fully reproducible given a seed. ±15% damage
 * variance keeps fights from feeling robotic.
 */
export const resolveAttack = (attacker: Combatant, defender: Combatant, rng: Rng): AttackResult => {
  const base = Math.max(attacker.stats.attack - defender.stats.defense, MIN_DAMAGE);
  const variance = (randInt(rng, 85, 115) / 100); // ±15%
  const crit = rng.next() < attacker.stats.critChance;
  const critMul = crit ? attacker.stats.critMultiplier : 1;
  const damage = Math.max(Math.round(base * variance * critMul), MIN_DAMAGE);

  defender.hp = Math.max(defender.hp - damage, 0);
  return {
    damage,
    crit,
    defenderHp: defender.hp,
    lethal: defender.hp === 0,
  };
};

export const isDead = (c: Combatant): boolean => c.hp <= 0;
