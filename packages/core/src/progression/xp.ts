// XP and leveling (docs/design/characters-and-talents.md, progression.md):
// kills are the only XP source in v1. The curve is uncapped — content (the
// frontier zone's level-band), not a numeric ceiling, is what actually stops
// progression.
//
// Kill XP is PERCENT-BASED (decided 2026-07-03): a creature is authored as a
// fraction of a level (CreatureDef.xpFrac — "a zombie is worth 5% of a
// level"), paid against the player's CURRENT level requirement. Kills-per-
// level therefore stays constant as the character grows, and balancing a
// roster of hundreds of creatures is one relative number per creature instead
// of retuning absolutes against the curve. The level-gap multiplier then
// bends it both ways: trivial XP when the player has outgrown the creature,
// a modest bonus for punching up.

/**
 * The slice's tunables in one place. Every number is a placeholder to tune in
 * playtest — the docs fix the *shapes* (power curve, taper-to-floor, capped
 * punch-up bonus) but deliberately leave the constants open.
 */
export const XP_TUNING = {
  /**
   * XP_to_next = base × level^exp (uncapped). With percent-based kill XP this
   * is bookkeeping (awards scale with it, so pacing is set by xpFrac), but the
   * absolute ledger keeps saves simple and the HUD honest.
   */
  base: 50,
  exp: 1.5,
  /** The player may be this many levels above a creature and still earn full XP. */
  fullValueGap: 2,
  /** XP fraction lost per level beyond fullValueGap. */
  taperPerLevel: 0.25,
  /** Trivial-XP floor — "trivial", never zero, per the docs. */
  trivialFloor: 0.05,
  /** XP bonus per level the CREATURE is above the player (punching up). */
  underBonusPerLevel: 0.1,
  /** Cap on the punch-up bonus (the real reward for fighting up is better loot/frontier XP density). */
  underBonusCap: 0.5,
} as const;

/** XP required to go from `level` to `level + 1`. Strictly increasing, uncapped. */
export const xpToNext = (level: number): number =>
  Math.round(XP_TUNING.base * Math.pow(Math.max(1, level), XP_TUNING.exp));

/**
 * The level-gap multiplier for a kill. Full value inside the grace band (the
 * gold con — an even match always pays exactly full); beyond it, a linear
 * taper per level down to the trivial floor when the player has outgrown the
 * creature, and a small capped bonus per level of punching up.
 */
export const gapMultiplier = (playerLevel: number, creatureLevel: number): number => {
  const under = creatureLevel - playerLevel - XP_TUNING.fullValueGap;
  if (under > 0) return 1 + Math.min(XP_TUNING.underBonusCap, under * XP_TUNING.underBonusPerLevel);
  const over = playerLevel - creatureLevel - XP_TUNING.fullValueGap;
  if (over <= 0) return 1;
  return Math.max(XP_TUNING.trivialFloor, 1 - over * XP_TUNING.taperPerLevel);
};

/**
 * XP paid for one kill: the creature's authored fraction of the player's
 * current level requirement, bent by the level gap. Never below 1 — every
 * kill registers, however trivially.
 */
export const xpForKill = (xpFrac: number, playerLevel: number, creatureLevel: number): number =>
  Math.max(1, Math.round(xpFrac * xpToNext(playerLevel) * gapMultiplier(playerLevel, creatureLevel)));

export interface XpApplyResult {
  level: number;
  /** XP into the (possibly new) current level. */
  xp: number;
  /** How many level-ups this grant produced (0 for most kills; can exceed 1). */
  levelsGained: number;
}

/**
 * Fold an XP grant into level/xp, carrying overflow across as many level-ups
 * as it funds. Pure — the caller owns where the result is stored (character
 * record) and what a level-up triggers (banner, Talent pick).
 */
export const applyXp = (level: number, xp: number, gained: number): XpApplyResult => {
  let l = level;
  let x = xp + gained;
  let levelsGained = 0;
  while (x >= xpToNext(l)) {
    x -= xpToNext(l);
    l += 1;
    levelsGained += 1;
  }
  return { level: l, xp: x, levelsGained };
};
