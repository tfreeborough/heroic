import { describe, expect, test } from "bun:test";
import { computeEffectiveStats, type ModifierSource } from "./modifiers";
import { CLASSES } from "./classes";
import { statBlock } from "./stats";

const source = (over: Partial<ModifierSource> = {}): ModifierSource => ({
  id: "test",
  lifecycle: "permanent",
  modifiers: [],
  ...over,
});

describe("computeEffectiveStats — the rating curve", () => {
  // The worked example from modifiers-and-effects.md (MaxBonus 200%, K = 50 × level):
  // it anchors the whole treadmill, so pin the exact numbers.
  test("level 1: 10 str → 33.3% damage, 20 str → 57.1%", () => {
    const ten = computeEffectiveStats(statBlock({ strength: 10 }), 1);
    const twenty = computeEffectiveStats(statBlock({ strength: 20 }), 1);
    expect(ten.meleePower).toBeCloseTo(0.3333, 3);
    expect(twenty.meleePower).toBeCloseTo(0.5714, 3);
  });

  test("level 20: 200 str → 33.3% — same points, higher K, baseline stable", () => {
    const eff = computeEffectiveStats(statBlock({ strength: 200 }), 20);
    expect(eff.meleePower).toBeCloseTo(0.3333, 3);
  });

  test("a +10 flat injection is huge at level 1, a rounding error at 20", () => {
    const early = computeEffectiveStats(statBlock({ strength: 20 }), 1).meleePower
      - computeEffectiveStats(statBlock({ strength: 10 }), 1).meleePower;
    const late = computeEffectiveStats(statBlock({ strength: 210 }), 20).meleePower
      - computeEffectiveStats(statBlock({ strength: 200 }), 20).meleePower;
    expect(early).toBeGreaterThan(0.2);
    expect(late).toBeLessThan(0.02);
  });

  test("zero and negative flat totals produce no bonus", () => {
    expect(computeEffectiveStats(statBlock(), 1).meleePower).toBe(0);
    expect(computeEffectiveStats(statBlock({ strength: -5 }), 1).meleePower).toBe(0);
  });
});

describe("computeEffectiveStats — order of operations", () => {
  test("flat modifiers join base before the curve", () => {
    const eff = computeEffectiveStats(statBlock({ strength: 4 }), 1, [
      source({ modifiers: [{ stat: "strength", kind: "flat", value: 6 }] }),
    ]);
    expect(eff.meleePower).toBeCloseTo(0.3333, 3); // identical to 10 base
  });

  test("percent applies after the curve, so it isn't eaten by diminishing returns", () => {
    const eff = computeEffectiveStats(statBlock({ strength: 10 }), 1, [
      source({ modifiers: [{ stat: "strength", kind: "percent", value: 0.5 }] }),
    ]);
    expect(eff.meleePower).toBeCloseTo(0.3333 * 1.5, 3);
  });

  test("more multipliers stack multiplicatively with each other", () => {
    const eff = computeEffectiveStats(statBlock({ strength: 10 }), 1, [
      source({ id: "a", modifiers: [{ stat: "strength", kind: "more", value: 0.5 }] }),
      source({ id: "b", modifiers: [{ stat: "strength", kind: "more", value: 0.5 }] }),
    ]);
    expect(eff.meleePower).toBeCloseTo(0.3333 * 2.25, 3);
  });

  test("all lifecycles contribute the same math", () => {
    const mods = [{ stat: "vitality", kind: "flat", value: 5 } as const];
    const eff = computeEffectiveStats(statBlock({ vitality: 10 }), 1, [
      source({ id: "talent", lifecycle: "permanent", modifiers: mods }),
      source({ id: "ring", lifecycle: "equipment", modifiers: mods }),
      source({ id: "potion", lifecycle: "timed", remaining: 3, modifiers: mods }),
    ]);
    expect(eff.maxHp).toBe(250); // (10 + 5×3) × HP_PER_VITALITY
  });
});

describe("computeEffectiveStats — pool stats and caps", () => {
  test("vitality → maxHp linearly, percent scales it", () => {
    const eff = computeEffectiveStats(statBlock({ vitality: 10 }), 1, [
      source({ modifiers: [{ stat: "vitality", kind: "percent", value: 0.2 }] }),
    ]);
    expect(eff.maxHp).toBe(120);
  });

  test("speed/reach/attackSpeed are 100-pts-per-1.0× multipliers", () => {
    const eff = computeEffectiveStats(statBlock({ speed: 108, reach: 105 }), 1);
    expect(eff.speed).toBeCloseTo(1.08);
    expect(eff.reach).toBeCloseTo(1.05);
    expect(eff.attackSpeed).toBe(1);
  });

  test("chance channels respect their hard caps even under huge stacking", () => {
    const eff = computeEffectiveStats(statBlock({ agility: 1_000_000, luck: 1_000_000 }), 1, [
      source({ modifiers: [{ stat: "agility", kind: "percent", value: 9 }] }),
    ]);
    expect(eff.physicalCrit).toBe(0.75);
  });

  test("luck nudges crit even with zero agility", () => {
    const eff = computeEffectiveStats(statBlock({ luck: 80 }), 1);
    expect(eff.physicalCrit).toBeCloseTo(0.05, 3); // 0.1 × 80/(80+80)
    expect(eff.dodge).toBeCloseTo(0.05, 3);
  });
});

describe("classes", () => {
  test("stat leans point the right way", () => {
    const warrior = computeEffectiveStats(CLASSES.warrior.base, 1);
    const ranger = computeEffectiveStats(CLASSES.ranger.base, 1);
    const mage = computeEffectiveStats(CLASSES.mage.base, 1);
    expect(warrior.meleePower).toBeGreaterThan(mage.meleePower);
    expect(ranger.rangedPower).toBeGreaterThan(warrior.rangedPower);
    expect(mage.magicPower).toBeGreaterThan(warrior.magicPower);
    expect(ranger.physicalCrit).toBeGreaterThan(warrior.physicalCrit);
    expect(warrior.maxHp).toBeGreaterThan(ranger.maxHp);
    expect(ranger.maxHp).toBeGreaterThan(mage.maxHp);
    // Classes differ only across core attributes — everything else is neutral.
    expect(ranger.speed).toBe(1);
    expect(warrior.dodge).toBe(0);
    expect(mage.reach).toBe(1);
  });
});
