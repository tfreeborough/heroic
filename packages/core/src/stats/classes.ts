// Class definitions (docs/design/characters-and-talents.md): a class is pure
// data — base stats (the "stat lean"), a starting weapon, and offer weights
// for the minor-Talent chains (unused until the Talent system lands, but the
// shape is fixed now so classes don't need reshaping later). Gear stays
// classless; class identity lives here and in the (future) ability kits.
//
// Classes differ ONLY across the six core attributes (vitality, strength,
// agility, intellect, wisdom, renewal — decided 2026-07-02). Dodge, parry,
// block, armor, luck, reach and speed start neutral for every class: those
// axes are grown through Talents and gear, not picked at creation.
//
// All base numbers are v1 placeholders to tune in playtest. Anchors at
// level 1 (K = 50): a primary stat of 12 ≈ +39% style damage; vitality is
// HP × 10 (warrior 120 / ranger 90 / mage 70 vs the old flat 100).

import { statBlock, type BaseStats, type StatId } from "./stats";

export type ClassId = "warrior" | "ranger" | "mage";

export interface ClassDef {
  id: ClassId;
  label: string;
  /** One-line fantasy for the creation screen. */
  blurb: string;
  base: BaseStats;
  /**
   * Starting weapon by app weapon id — an opaque string until the gear
   * system moves weapon defs into core.
   */
  startingWeapon: string;
  /** Minor-Talent chain offer weighting (characters-and-talents.md); higher = offered more. */
  offerWeights: Partial<Record<StatId, number>>;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: "warrior",
    label: "Warrior",
    blurb: "The wall that hits back.",
    base: statBlock({
      vitality: 12,
      strength: 12,
      agility: 6,
      intellect: 2,
      wisdom: 2,
      renewal: 2,
    }),
    startingWeapon: "sword",
    offerWeights: { vitality: 3, strength: 3, parry: 2, block: 2 },
  },
  ranger: {
    id: "ranger",
    label: "Ranger",
    blurb: "Keeps death at a comfortable distance.",
    base: statBlock({
      vitality: 9,
      strength: 6,
      agility: 12,
      intellect: 2,
      wisdom: 3,
      renewal: 1,
    }),
    startingWeapon: "bow",
    offerWeights: { agility: 3, speed: 3, dodge: 2, luck: 2 },
  },
  mage: {
    id: "mage",
    label: "Mage",
    blurb: "Made of glass. Full of thunder.",
    base: statBlock({
      vitality: 7,
      strength: 2,
      agility: 4,
      intellect: 14,
      wisdom: 8,
      renewal: 1,
    }),
    startingWeapon: "staff",
    offerWeights: { intellect: 3, wisdom: 3, reach: 2, vitality: 2 },
  },
};

export const CLASS_LIST: readonly ClassDef[] = [CLASSES.warrior, CLASSES.ranger, CLASSES.mage];
