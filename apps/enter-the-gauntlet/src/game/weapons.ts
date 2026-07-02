import type { AttackConfig, CombatStats, EffectiveStats } from "@heroic/core";
import type { HapticWeight } from "./haptics";

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
  /**
   * Tactile weight of the basic attack — melee feels it on connect, ranged
   * on release (recoil). null = silent: fast light weapons say nothing on a
   * normal hit so their crit pulse has contrast (and so frequent attackers
   * never turn the phone into a rumble box).
   */
  haptic: HapticWeight | null;
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
    haptic: "light", // mid-weight blade; "heavy" is saved for warhammer-class
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
    haptic: null, // light fast shooter: crit-only, the "dagger" pattern
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
    haptic: "medium", // slowest cycle, heaviest hit — the cast should thump
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
    haptic: "soft", // two light arms loosed at once: a gentle flick
  },
];

export type WeaponId = WeaponDef["id"];

/**
 * A weapon as one particular character swings it: reach scaled by the reach
 * multiplier, cycle timing divided by attack speed (higher = faster cadence).
 * Derived once at equip time so every downstream reader of the equipped
 * config — targeting, camera framing, the HUD windup ring — sees the same
 * numbers and can't disagree. Damage/crit scaling is separate (the school
 * channels via deriveAttackerStats); this handles the config side.
 */
export const scaleWeaponForStats = (def: WeaponDef, eff: EffectiveStats): WeaponDef => ({
  ...def,
  config: {
    ...def.config,
    reach: def.config.reach * eff.reach,
    windup: def.config.windup / eff.attackSpeed,
    recovery: def.config.recovery / eff.attackSpeed,
  },
});
