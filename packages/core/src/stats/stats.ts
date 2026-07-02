// Canonical character stat block (docs/design/progression.md) — the substrate
// every progression system (levels, Talents, classes, gear) feeds and combat
// reads. The player is the first consumer; creatures keep their hand-tuned
// flat CombatStats until they grow levels of their own.
//
// Two stat families (docs/design/modifiers-and-effects.md):
// - RATING stats convert to a %/chance through a diminishing, level-relative
//   curve (strength → damage bonus, agility → crit chance, …). The same +N is
//   worth less as you level — the engine behind the item-band treadmill.
// - POOL / direct stats scale linearly (vitality → HP, renewal → HP regen).
//   speed / reach / attackSpeed are stored as points where 100 pts = 1.0×, so
//   flat "+5 speed" Talent chains stay integer-friendly.

export type StatId =
  | "vitality"
  | "strength"
  | "agility"
  | "intellect"
  | "wisdom"
  | "renewal"
  | "speed"
  | "reach"
  | "attackSpeed"
  | "armor"
  | "dodge"
  | "parry"
  | "block"
  | "luck";

export type BaseStats = Record<StatId, number>;

/** Points-per-1.0× for the multiplier-style pool stats (speed/reach/attackSpeed). */
export const MULTIPLIER_SCALE = 100;

/** HP granted per point of vitality. */
export const HP_PER_VITALITY = 10;

/** HP/sec per point of renewal and mana/sec per point of wisdom. */
export const REGEN_PER_POINT = 0.5;

/**
 * A zeroed stat block with sane multiplier baselines (100 pts = 1.0× so an
 * empty block still moves and attacks at normal cadence).
 */
export const statBlock = (overrides: Partial<BaseStats> = {}): BaseStats => ({
  vitality: 0,
  strength: 0,
  agility: 0,
  intellect: 0,
  wisdom: 0,
  renewal: 0,
  speed: MULTIPLIER_SCALE,
  reach: MULTIPLIER_SCALE,
  attackSpeed: MULTIPLIER_SCALE,
  armor: 0,
  dodge: 0,
  parry: 0,
  block: 0,
  luck: 0,
  ...overrides,
});

export interface RatingCurve {
  /** The stat whose flat total feeds this channel. */
  stat: StatId;
  /** Soft ceiling the curve approaches (0.5 = 50%). */
  maxBonus: number;
  /** K(level) = kPerLevel × level — how fast the same points devalue. */
  kPerLevel: number;
  /** Hard cap on the final channel value (after percent/more and luck). */
  cap?: number;
}

/**
 * Rating channels — one stat can feed more than one channel (intellect powers
 * magic damage AND magic crit, agility ranged damage AND physical crit — both
 * flagged for balance review in combat.md). Power splits three ways by combat
 * style (combat.md, 2026-07-02): melee ← strength, ranged physical ← agility,
 * magic ← intellect — the baseline the class specialisations exist to bend.
 * All numbers are placeholder tuning; the worked example in
 * modifiers-and-effects.md (strength: maxBonus 200%, K = 50 × level) is the
 * anchor the tests pin.
 */
export const RATING_CURVES = {
  meleePower: { stat: "strength", maxBonus: 2.0, kPerLevel: 50 },
  rangedPower: { stat: "agility", maxBonus: 2.0, kPerLevel: 50 },
  magicPower: { stat: "intellect", maxBonus: 2.0, kPerLevel: 50 },
  physicalCrit: { stat: "agility", maxBonus: 0.5, kPerLevel: 60, cap: 0.75 },
  magicCrit: { stat: "intellect", maxBonus: 0.5, kPerLevel: 60, cap: 0.75 },
  dodge: { stat: "dodge", maxBonus: 0.35, kPerLevel: 60, cap: 0.6 },
  parry: { stat: "parry", maxBonus: 0.35, kPerLevel: 60, cap: 0.6 },
  block: { stat: "block", maxBonus: 0.6, kPerLevel: 60, cap: 0.85 },
  armor: { stat: "armor", maxBonus: 0.75, kPerLevel: 40, cap: 0.85 },
} as const satisfies Record<string, RatingCurve>;

export type RatingChannel = keyof typeof RATING_CURVES;

/**
 * Luck's small nudge (progression.md): added onto both crit channels and the
 * dodge/parry/block trio, before their caps.
 */
export const LUCK_CURVE: RatingCurve = { stat: "luck", maxBonus: 0.1, kPerLevel: 80 };

/**
 * The generalised Armor formula (modifiers-and-effects.md): flat points →
 * effective bonus, diminishing and level-relative. Baseline power stays
 * stable while a fixed flat injection shrinks in relative value.
 */
export const ratingBonus = (flat: number, level: number, curve: RatingCurve): number => {
  if (flat <= 0) return 0;
  const k = curve.kPerLevel * Math.max(level, 1);
  return (curve.maxBonus * flat) / (flat + k);
};
