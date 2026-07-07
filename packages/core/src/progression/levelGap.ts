// The level-gap combat system (docs/design/creature-levels.md): a creature's
// level never scales its stats — its authored stat block IS the creature at
// every level. Difficulty comes from ONE global set of percentage modifiers
// applied at attack resolution, driven purely by the level gap. One gap
// definition feeds three consumers — combat mods here, XP's gapMultiplier
// (xp.ts, sharing the same grace band), and the con color — so what you see,
// what you fight, and what you're paid can never drift apart.

import { randInt, type Rng } from "../rng";
import { XP_TUNING } from "./xp";

/**
 * Outgoing-attack modifiers for one side of a gap fight, per level beyond the
 * grace band. "Up" = the defender is above the attacker; "down" = below.
 * Player and creature profiles are deliberately asymmetric (incoming crits
 * are capped low so being unlucky never feels rigged; the player's crit ramp
 * vs greys runs toward certainty because popping lowbies is the fantasy).
 */
export interface GapProfile {
  /** Damage lost per level attacking up. */
  upDamagePerLevel: number;
  /** Damage multiplier floor attacking up (never zero — you chip, visibly). */
  upDamageFloor: number;
  /** Miss chance gained per level attacking up (0 = this side never misses). */
  upMissPerLevel: number;
  upMissCap: number;
  /** Bonus damage per level attacking down, and its cap (a fraction: 0.5 = +50%). */
  downDamagePerLevel: number;
  downDamageCap: number;
  /** Bonus crit chance per level attacking down, and the TOTAL crit cap it ramps toward. */
  downCritPerLevel: number;
  downCritCap: number;
}

/** All placeholder — the shapes are the design, the numbers are playtest food. */
export const GAP_TUNING = {
  /** The even-match band, shared with XP (±fullValueGap = full-value, gold con). */
  grace: XP_TUNING.fullValueGap,
  /** Levels above the grace band that con orange before red takes over. */
  orangeSpan: 2,
  /** Levels below the grace band that con green before grey takes over. */
  greenSpan: 3,
  /** The player's outgoing swings. */
  player: {
    upDamagePerLevel: 0.15,
    upDamageFloor: 0.2,
    upMissPerLevel: 0.07,
    upMissCap: 0.35,
    downDamagePerLevel: 0.1,
    downDamageCap: 0.5,
    downCritPerLevel: 0.15,
    downCritCap: 0.95,
  } satisfies GapProfile,
  /** Creatures' outgoing attacks (they never miss — danger reads through damage/crits). */
  creature: {
    upDamagePerLevel: 0.2,
    upDamageFloor: 0.1,
    upMissPerLevel: 0,
    upMissCap: 0,
    downDamagePerLevel: 0.1,
    downDamageCap: 2,
    downCritPerLevel: 0.05,
    downCritCap: 0.4,
  } satisfies GapProfile,
} as const;

/** What one resolved attack applies on top of the attacker's stats. */
export interface GapAttackMods {
  damageMult: number;
  missChance: number;
  /** Added to the attacker's critChance; the profile's downCritCap bounds the total. */
  critBonus: number;
  critCap: number;
}

export const NEUTRAL_GAP_MODS: GapAttackMods = {
  damageMult: 1,
  missChance: 0,
  critBonus: 0,
  critCap: 1,
};

/**
 * The gap table for one attack: how `attackerLevel` swings at `defenderLevel`
 * under `profile`. Neutral inside the grace band.
 */
export const gapAttackMods = (
  attackerLevel: number,
  defenderLevel: number,
  profile: GapProfile,
): GapAttackMods => {
  const delta = defenderLevel - attackerLevel;
  if (delta > GAP_TUNING.grace) {
    // Attacking up: chip damage, maybe whiff. No crit bonus in this direction.
    const levels = delta - GAP_TUNING.grace;
    return {
      damageMult: Math.max(profile.upDamageFloor, 1 - levels * profile.upDamagePerLevel),
      missChance: Math.min(profile.upMissCap, levels * profile.upMissPerLevel),
      critBonus: 0,
      critCap: 1,
    };
  }
  if (delta < -GAP_TUNING.grace) {
    // Attacking down: modest damage bonus, crits ramp toward the cap.
    const levels = -delta - GAP_TUNING.grace;
    return {
      damageMult: 1 + Math.min(profile.downDamageCap, levels * profile.downDamagePerLevel),
      missChance: 0,
      critBonus: levels * profile.downCritPerLevel,
      critCap: profile.downCritCap,
    };
  }
  return NEUTRAL_GAP_MODS;
};

/** The player's outgoing swing at a creature. */
export const playerAttackGapMods = (playerLevel: number, creatureLevel: number): GapAttackMods =>
  gapAttackMods(playerLevel, creatureLevel, GAP_TUNING.player);

/** A creature's outgoing attack at the player. */
export const creatureAttackGapMods = (creatureLevel: number, playerLevel: number): GapAttackMods =>
  gapAttackMods(creatureLevel, playerLevel, GAP_TUNING.creature);

/**
 * The con read (docs/design/creature-levels.md): grey → green → gold →
 * orange → red, derived from the same thresholds as the combat/XP gap.
 * Gold is the grace band; grey starts where the XP taper sits at its trivial
 * floor (grace + greenSpan matches taperPerLevel/trivialFloor at current
 * tunables), so a grey creature is by definition a worthless kill.
 */
export type ConTier = "grey" | "green" | "gold" | "orange" | "red";

export const conTier = (creatureLevel: number, playerLevel: number): ConTier => {
  const delta = creatureLevel - playerLevel;
  if (delta > GAP_TUNING.grace + GAP_TUNING.orangeSpan) return "red";
  if (delta > GAP_TUNING.grace) return "orange";
  if (delta >= -GAP_TUNING.grace) return "gold";
  if (delta >= -(GAP_TUNING.grace + GAP_TUNING.greenSpan)) return "green";
  return "grey";
};

/** An inclusive level range — zones, creature species, and authored overrides all speak this. */
export interface LevelRange {
  min: number;
  max: number;
}

/**
 * Roll a spawn's level (docs/design/creature-levels.md): uniform in the
 * intersection of the spawn window and the creature's own bounds, where the
 * window is the zone's range unless an authored per-placement `override`
 * replaces it (the micro-cosm dial: a spawner at the zone's far end can run
 * hotter than the door you came in through — and a placed boss may exceed the
 * zone range outright, which is why the override replaces rather than
 * intersects). The creature's bounds always hold: a wizard is never a wizard
 * below its floor, so an empty intersection (authoring mismatch) clamps to
 * the creature's nearest edge instead of breaking species identity.
 * Deterministic through the injected rng like every other sim input.
 */
export const rollCreatureLevel = (
  zone: LevelRange,
  creature: LevelRange,
  rng: Rng,
  override?: LevelRange,
): number => {
  const window = override ?? zone;
  const min = Math.max(window.min, creature.min);
  const max = Math.min(window.max, creature.max);
  if (min > max) return window.min > creature.max ? creature.max : creature.min;
  return randInt(rng, min, max);
};

/**
 * Read an authored level override out of a zone object's `props` bag
 * (`levelMin` / `levelMax`) — shared by the game (placed creatures, spawner
 * configs) and Realmsmith (the fields it edits). Absent props → undefined
 * (the zone range applies); one side alone pins both ends to it; a reversed
 * pair is swapped rather than rejected.
 */
export const parseLevelRange = (
  props: Record<string, string | number | boolean>,
): LevelRange | undefined => {
  const read = (v: string | number | boolean | undefined): number | undefined => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const lo = read(props.levelMin);
  const hi = read(props.levelMax);
  if (lo === undefined && hi === undefined) return undefined;
  const min = lo ?? hi!;
  const max = hi ?? lo!;
  return min <= max ? { min, max } : { min: max, max: min };
};
