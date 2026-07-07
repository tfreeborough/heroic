import { randInt, type Rng } from "../rng";
import type { GapAttackMods } from "../progression/levelGap";

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
  /** The swing whiffed entirely (level-gap miss) — no damage, no crit. */
  missed: boolean;
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
 *
 * `mods` is the level-gap bend (progression/levelGap.ts): a miss roll, a crit
 * bonus/cap, and a damage multiplier. Omitted (or neutral) it changes nothing —
 * the miss roll only draws from the rng when a miss is actually possible, so
 * callers without mods keep the exact same random stream as before.
 */
export const resolveAttack = (
  attacker: Combatant,
  defender: Combatant,
  rng: Rng,
  mods?: GapAttackMods,
): AttackResult => {
  if (mods && mods.missChance > 0 && rng.next() < mods.missChance) {
    return { damage: 0, crit: false, missed: true, defenderHp: defender.hp, lethal: false };
  }
  const base = Math.max(attacker.stats.attack - defender.stats.defense, MIN_DAMAGE);
  const variance = (randInt(rng, 85, 115) / 100); // ±15%
  const critChance = mods
    ? Math.min(attacker.stats.critChance + mods.critBonus, mods.critCap)
    : attacker.stats.critChance;
  const crit = rng.next() < critChance;
  const critMul = crit ? attacker.stats.critMultiplier : 1;
  const damage = Math.max(Math.round(base * variance * critMul * (mods?.damageMult ?? 1)), MIN_DAMAGE);

  defender.hp = Math.max(defender.hp - damage, 0);
  return {
    damage,
    crit,
    missed: false,
    defenderHp: defender.hp,
    lethal: defender.hp === 0,
  };
};

export const isDead = (c: Combatant): boolean => c.hp <= 0;
