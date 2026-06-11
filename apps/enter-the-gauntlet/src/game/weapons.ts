import type { AttackConfig, CombatStats } from "@heroic/core";

/**
 * Test weapons, one per attack feel: melee cleave, fast physical projectile,
 * slow piercing magic projectile, and a two-arm pincer volley (flight-pattern
 * bank demo). Each weapon *is* its basic attack (config, per equipment.md)
 * plus the stats that feed the damage formula — in the real game those stats
 * come from the character + gear; here they're per-weapon placeholders so
 * each archetype lands differently.
 */
export interface WeaponDef {
  id: "sword" | "bow" | "staff" | "talons";
  label: string;
  /** Short shape × school tag shown in the picker (e.g. "arc · physical"). */
  tag: string;
  config: AttackConfig;
  /** Attacker-side stats fed to resolveAttack. maxHp is unused for attacking. */
  stats: CombatStats;
  /** Projectile visual size; arcs ignore it. */
  projectileRadius: number;
  color: string;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: "sword",
    label: "Sword",
    tag: "arc · physical",
    config: {
      shape: "arc",
      school: "physical",
      reach: 80,
      arcWidth: (110 * Math.PI) / 180,
      windup: 0.15,
      recovery: 0.34,
      knockback: 820,
    },
    stats: { maxHp: 1, attack: 13, defense: 0, critChance: 0.15, critMultiplier: 2 },
    projectileRadius: 0,
    color: "#e8e3d4",
  },
  {
    id: "bow",
    label: "Bow",
    tag: "projectile · physical",
    config: {
      shape: "projectile",
      school: "physical",
      // The camera zooms out to fit the longest reach on screen, so raising
      // this shrinks the whole world — keep ranged reach moderate.
      reach: 220,
      projectileSpeed: 980,
      pierce: 0,
      windup: 0.22,
      recovery: 0.42,
      knockback: 120,
    },
    stats: { maxHp: 1, attack: 10, defense: 0, critChance: 0.25, critMultiplier: 2.2 },
    projectileRadius: 4,
    color: "#d8e6f2",
  },
  {
    id: "staff",
    label: "Staff",
    tag: "projectile · magic",
    config: {
      shape: "projectile",
      school: "magic",
      reach: 180,
      projectileSpeed: 540,
      pierce: 2,
      windup: 0.34,
      recovery: 0.55,
      knockback: 200,
      manaCost: 5, // carried per combat.md, not yet enforced (no mana pool)
    },
    stats: { maxHp: 1, attack: 17, defense: 0, critChance: 0.1, critMultiplier: 2 },
    projectileRadius: 7,
    color: "#7fb7ff",
  },
  {
    id: "talons",
    label: "Talons",
    tag: "2× pincer · physical",
    config: {
      shape: "projectile",
      school: "physical",
      reach: 220,
      projectileSpeed: 620,
      pierce: 0,
      projectileCount: 2,
      flight: "pincer",
      curveAngle: Math.PI / 4,
      windup: 0.26,
      recovery: 0.48,
      knockback: 140,
    },
    // Per-shot damage is roughly half the bow's: landing BOTH arms on one
    // target is the payoff, splitting them across two targets the fallback.
    stats: { maxHp: 1, attack: 7, defense: 0, critChance: 0.15, critMultiplier: 2 },
    projectileRadius: 5,
    color: "#ff9d6f",
  },
];

export type WeaponId = WeaponDef["id"];
