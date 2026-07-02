import { describe, expect, test } from "bun:test";
import { computeEffectiveStats } from "./modifiers";
import { deriveAttackerStats, derivePlayerCombatStats } from "./derive";
import { CLASSES } from "./classes";
import { statBlock } from "./stats";

const MELEE = { shape: "arc", school: "physical" } as const;
const RANGED = { shape: "projectile", school: "physical" } as const;
const MAGIC = { shape: "projectile", school: "magic" } as const;

describe("deriveAttackerStats — the style table from combat.md", () => {
  test("melee scales weapon damage by strength, not agility or intellect", () => {
    const eff = computeEffectiveStats(statBlock({ strength: 10, agility: 50, intellect: 50 }), 1);
    const melee = deriveAttackerStats(eff, { attack: 12 }, MELEE);
    expect(melee.attack).toBeCloseTo(12 * 1.3333, 2);
  });

  test("ranged physical scales by agility, not strength", () => {
    const eff = computeEffectiveStats(statBlock({ strength: 50, agility: 10 }), 1);
    const ranged = deriveAttackerStats(eff, { attack: 10 }, RANGED);
    expect(ranged.attack).toBeCloseTo(10 * 1.3333, 2);
  });

  test("magic reads intellect for power AND crit, regardless of shape", () => {
    const eff = computeEffectiveStats(statBlock({ intellect: 10 }), 1);
    const magic = deriveAttackerStats(eff, { attack: 17 }, MAGIC);
    expect(magic.attack).toBeCloseTo(17 * 1.3333, 2);
    expect(magic.critChance).toBeCloseTo(eff.magicCrit, 5);
    const arcMagic = deriveAttackerStats(eff, { attack: 17 }, { shape: "arc", school: "magic" });
    expect(arcMagic.attack).toBe(magic.attack);
  });

  test("weapon crit feel adds to the stat channel and clamps to [0,1]", () => {
    const eff = computeEffectiveStats(statBlock({ agility: 12 }), 1);
    const derived = deriveAttackerStats(eff, { attack: 10, critChance: 0.25 }, RANGED);
    expect(derived.critChance).toBeCloseTo(0.25 + eff.physicalCrit, 5);
    const silly = deriveAttackerStats(eff, { attack: 10, critChance: 5 }, RANGED);
    expect(silly.critChance).toBe(1);
  });

  test("a stat-less character deals exactly weapon damage (behaviour-neutral floor)", () => {
    const eff = computeEffectiveStats(statBlock(), 1);
    const derived = deriveAttackerStats(eff, { attack: 13, critChance: 0.15 }, MELEE);
    expect(derived.attack).toBe(13);
    expect(derived.critChance).toBe(0.15);
    expect(derived.critMultiplier).toBe(2);
  });
});

describe("derivePlayerCombatStats", () => {
  test("maxHp comes from vitality, rounded; defense stays 0 until Armor lands", () => {
    const eff = computeEffectiveStats(CLASSES.warrior.base, 1);
    const stats = derivePlayerCombatStats(eff);
    expect(stats.maxHp).toBe(120);
    expect(stats.defense).toBe(0);
    expect(stats.attack).toBe(0);
  });
});
