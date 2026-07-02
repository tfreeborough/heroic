// The modifier pipeline (docs/design/modifiers-and-effects.md): sources dump
// stat modifiers into per-stat buckets; computeEffectiveStats combines them
// into the final numbers combat reads. Order of operations per stat:
//
//   1. flatTotal  = base + Σ(flat)
//   2. effective  = curve(flatTotal)            ← rating channels only
//   3. final      = effective × (1 + Σ percent) × Π(1 + each "more")
//   4. caps
//
// Percent applies AFTER the curve so it doesn't get eaten by diminishing
// returns (flat = front-loaded power that fades; percent = scales forever).
// "more" multipliers each multiply separately — reserved for signature
// Relic/Talent effects.
//
// Recompute on change, not per frame: callers hold the source list and call
// computeEffectiveStats when it changes (Talent picked, equip/unequip, buff
// expires). A source's lifecycle never changes its math — it's bookkeeping
// for who owns/removes it.

import {
  HP_PER_VITALITY,
  LUCK_CURVE,
  MULTIPLIER_SCALE,
  RATING_CURVES,
  REGEN_PER_POINT,
  ratingBonus,
  type BaseStats,
  type StatId,
} from "./stats";

export type ModifierKind = "flat" | "percent" | "more";

/** How long a modifier source lives (the progression "layers"). */
export type ModifierLifecycle = "permanent" | "equipment" | "timed";

export interface StatModifier {
  stat: StatId;
  kind: ModifierKind;
  /** flat: points · percent: additive fraction (0.2 = +20%) · more: separate ×(1+value). */
  value: number;
}

export interface ModifierSource {
  /** Stable identity so the owner can remove/replace it (talent id, item id, buff id). */
  id: string;
  lifecycle: ModifierLifecycle;
  modifiers: readonly StatModifier[];
  /** timed sources only: seconds left. The owner ticks this and drops the source at 0. */
  remaining?: number;
}

/**
 * The final numbers combat and movement read. Rating channels are fractions
 * (meleePower 0.33 = +33% melee damage, physicalCrit 0.2 = 20% chance);
 * speed/reach/attackSpeed are multipliers (1 = base cadence).
 */
export interface EffectiveStats {
  level: number;
  maxHp: number;
  hpRegen: number;
  manaRegen: number;
  speed: number;
  reach: number;
  attackSpeed: number;
  meleePower: number;
  rangedPower: number;
  magicPower: number;
  physicalCrit: number;
  magicCrit: number;
  dodge: number;
  parry: number;
  block: number;
  armor: number;
}

const clampCap = (value: number, cap: number | undefined): number =>
  cap === undefined ? value : Math.min(value, cap);

export const computeEffectiveStats = (
  base: BaseStats,
  level: number,
  sources: readonly ModifierSource[] = [],
): EffectiveStats => {
  // Bucket pass: one walk over every modifier.
  const flat = {} as Record<StatId, number>;
  const percent = {} as Record<StatId, number>;
  const more = {} as Record<StatId, number>;
  for (const stat of Object.keys(base) as StatId[]) {
    flat[stat] = base[stat];
    percent[stat] = 0;
    more[stat] = 1;
  }
  for (const source of sources) {
    for (const mod of source.modifiers) {
      if (mod.kind === "flat") flat[mod.stat] += mod.value;
      else if (mod.kind === "percent") percent[mod.stat] += mod.value;
      else more[mod.stat] *= 1 + mod.value;
    }
  }

  // Steps 3 applied per source-stat: everything downstream of a stat's curve
  // (or its raw pool value) is scaled by that stat's percent/more buckets.
  const scale = (stat: StatId): number => (1 + percent[stat]) * more[stat];
  const pool = (stat: StatId): number => flat[stat] * scale(stat);
  const channel = (id: keyof typeof RATING_CURVES): number => {
    const curve = RATING_CURVES[id];
    return ratingBonus(flat[curve.stat], level, curve) * scale(curve.stat);
  };

  // Luck's nudge joins the avoidance/crit channels before their caps.
  const luck = ratingBonus(flat.luck, level, LUCK_CURVE) * scale("luck");

  return {
    level,
    maxHp: pool("vitality") * HP_PER_VITALITY,
    hpRegen: pool("renewal") * REGEN_PER_POINT,
    manaRegen: pool("wisdom") * REGEN_PER_POINT,
    speed: pool("speed") / MULTIPLIER_SCALE,
    reach: pool("reach") / MULTIPLIER_SCALE,
    attackSpeed: pool("attackSpeed") / MULTIPLIER_SCALE,
    meleePower: channel("meleePower"),
    rangedPower: channel("rangedPower"),
    magicPower: channel("magicPower"),
    physicalCrit: clampCap(channel("physicalCrit") + luck, RATING_CURVES.physicalCrit.cap),
    magicCrit: clampCap(channel("magicCrit") + luck, RATING_CURVES.magicCrit.cap),
    dodge: clampCap(channel("dodge") + luck, RATING_CURVES.dodge.cap),
    parry: clampCap(channel("parry") + luck, RATING_CURVES.parry.cap),
    block: clampCap(channel("block") + luck, RATING_CURVES.block.cap),
    armor: clampCap(channel("armor"), RATING_CURVES.armor.cap),
  };
};
