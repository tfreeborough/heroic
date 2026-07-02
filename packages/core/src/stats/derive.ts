// The stats → combat bridge (docs/design/combat.md): an attack's style —
// shape × school — decides which channels supply its power and crit (melee ←
// strength, ranged physical ← agility, magic ← intellect; the baseline the
// class specialisations bend). Weapons carry base numbers; the character's
// effective stats scale them at derive time. resolveAttack stays the swappable
// "how much" placeholder — this layer just feeds it the right CombatStats, so
// damage math and stat math evolve independently.

import type { CombatStats } from "../combat/combat";
import type { AttackConfig } from "../combat/attack";
import type { EffectiveStats } from "./modifiers";

/** The stat side of a weapon: its base damage plus any innate crit feel. */
export interface WeaponContribution {
  attack: number;
  critChance?: number;
  critMultiplier?: number;
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/**
 * Attacker-side CombatStats for one attack: melee reads meleePower (strength),
 * physical projectiles rangedPower (agility), magic magicPower (intellect);
 * crit stays school-sourced (luck's nudge is already folded into the crit
 * channels upstream).
 */
export const deriveAttackerStats = (
  eff: EffectiveStats,
  weapon: WeaponContribution,
  attack: Pick<AttackConfig, "shape" | "school">,
): CombatStats => {
  const power =
    attack.school === "magic"
      ? eff.magicPower
      : attack.shape === "arc"
        ? eff.meleePower
        : eff.rangedPower;
  const crit = attack.school === "magic" ? eff.magicCrit : eff.physicalCrit;
  return {
    maxHp: 1, // attacker-side combatants never take hits
    attack: weapon.attack * (1 + power),
    defense: 0,
    critChance: clamp01((weapon.critChance ?? 0) + crit),
    critMultiplier: weapon.critMultiplier ?? 2,
  };
};

/**
 * Defender-side CombatStats for the player. defense stays 0 for now: Armor's
 * always-on reduction arrives with equipment, and the dodge/parry/block
 * intake pipeline (combat.md) is its own upcoming slice — the channels are
 * already computed and waiting on EffectiveStats.
 */
export const derivePlayerCombatStats = (eff: EffectiveStats): CombatStats => ({
  maxHp: Math.round(eff.maxHp),
  attack: 0,
  defense: 0,
  critChance: 0,
  critMultiplier: 1,
});
