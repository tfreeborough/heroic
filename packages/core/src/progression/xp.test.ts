import { describe, expect, test } from "bun:test";
import { XP_TUNING, applyXp, gapMultiplier, xpForKill, xpToNext } from "./xp";

describe("xpToNext — the leveling curve", () => {
  test("strictly increasing and uncapped through level 60", () => {
    for (let level = 1; level < 60; level++) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });

  test("level 1 cost matches the tunables anchor", () => {
    expect(xpToNext(1)).toBe(Math.round(XP_TUNING.base));
  });

  test("silly inputs clamp to the level-1 cost instead of going negative", () => {
    expect(xpToNext(0)).toBe(xpToNext(1));
    expect(xpToNext(-3)).toBe(xpToNext(1));
  });
});

describe("applyXp — folding grants into level/xp", () => {
  test("a grant below the threshold just accrues", () => {
    const r = applyXp(1, 10, 20);
    expect(r).toEqual({ level: 1, xp: 30, levelsGained: 0 });
  });

  test("a single level-up carries the remainder", () => {
    const cost = xpToNext(1);
    const r = applyXp(1, cost - 5, 12);
    expect(r).toEqual({ level: 2, xp: 7, levelsGained: 1 });
  });

  test("one huge grant funds multiple level-ups with exact carry", () => {
    const grant = xpToNext(1) + xpToNext(2) + 3;
    const r = applyXp(1, 0, grant);
    expect(r).toEqual({ level: 3, xp: 3, levelsGained: 2 });
  });

  test("landing exactly on the threshold levels with zero leftover", () => {
    const r = applyXp(4, 0, xpToNext(4));
    expect(r).toEqual({ level: 5, xp: 0, levelsGained: 1 });
  });
});

describe("gapMultiplier — the level-gap bend", () => {
  test("full value across the whole grace band (an even match pays exactly full)", () => {
    expect(gapMultiplier(5, 5)).toBe(1); // at band
    expect(gapMultiplier(5 + XP_TUNING.fullValueGap, 5)).toBe(1); // outgrown edge
    expect(gapMultiplier(5 - XP_TUNING.fullValueGap, 5)).toBe(1); // punching-up edge
  });

  test("punching up past the grace band pays a small bonus per level, capped", () => {
    const grace = XP_TUNING.fullValueGap;
    expect(gapMultiplier(5 - grace - 1, 5)).toBeCloseTo(1 + XP_TUNING.underBonusPerLevel);
    expect(gapMultiplier(5 - grace - 2, 5)).toBeCloseTo(1 + 2 * XP_TUNING.underBonusPerLevel);
    expect(gapMultiplier(1, 50)).toBeCloseTo(1 + XP_TUNING.underBonusCap);
  });

  test("linear taper past the grace band", () => {
    const creature = 1;
    const first = XP_TUNING.fullValueGap + 1;
    expect(gapMultiplier(creature + first, creature)).toBeCloseTo(1 - XP_TUNING.taperPerLevel);
    expect(gapMultiplier(creature + first + 1, creature)).toBeCloseTo(
      1 - 2 * XP_TUNING.taperPerLevel,
    );
  });

  test("holds at the trivial floor, never zero, however wide the gap", () => {
    expect(gapMultiplier(50, 1)).toBe(XP_TUNING.trivialFloor);
    expect(gapMultiplier(999, 1)).toBe(XP_TUNING.trivialFloor);
  });
});

describe("xpForKill — percent of the current level requirement", () => {
  test("a full-value kill pays the creature's fraction of xpToNext(playerLevel)", () => {
    expect(xpForKill(0.08, 1, 1)).toBe(Math.round(0.08 * xpToNext(1)));
    expect(xpForKill(0.08, 20, 20)).toBe(Math.round(0.08 * xpToNext(20)));
  });

  test("kills-per-level stays constant as the player grows", () => {
    const killsAt = (level: number) => xpToNext(level) / xpForKill(0.08, level, level);
    expect(killsAt(30)).toBeCloseTo(killsAt(2), 0);
  });

  test("never drops below 1, even a trivial kill registers", () => {
    expect(xpForKill(0.04, 50, 1)).toBeGreaterThanOrEqual(1);
    expect(xpForKill(0.001, 1, 1)).toBe(1);
  });
});
