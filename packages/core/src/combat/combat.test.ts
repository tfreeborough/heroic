import { describe, expect, it } from "bun:test";
import { createRng } from "../rng";
import { NEUTRAL_GAP_MODS, type GapAttackMods } from "../progression/levelGap";
import { isDead, makeCombatant, MIN_DAMAGE, resolveAttack, type CombatStats } from "./combat";

const stats = (over: Partial<CombatStats> = {}): CombatStats => ({
  maxHp: 100,
  attack: 20,
  defense: 5,
  critChance: 0,
  critMultiplier: 2,
  ...over,
});

describe("resolveAttack", () => {
  it("reduces defender hp and is reproducible for a given seed", () => {
    const a = makeCombatant(stats());
    const d1 = makeCombatant(stats());
    const d2 = makeCombatant(stats());

    const r1 = resolveAttack(a, d1, createRng(42));
    const r2 = resolveAttack(a, d2, createRng(42));

    expect(r1.damage).toBe(r2.damage);
    expect(d1.hp).toBe(d2.hp);
    expect(d1.hp).toBeLessThan(100);
  });

  it("never deals less than MIN_DAMAGE even against high defense", () => {
    const a = makeCombatant(stats({ attack: 1 }));
    const d = makeCombatant(stats({ defense: 999 }));
    const result = resolveAttack(a, d, createRng(1));
    expect(result.damage).toBeGreaterThanOrEqual(MIN_DAMAGE);
  });

  it("applies the crit multiplier when crit lands", () => {
    const a = makeCombatant(stats({ critChance: 1, critMultiplier: 3 }));
    const d = makeCombatant(stats({ defense: 0 }));
    const result = resolveAttack(a, d, createRng(7));
    expect(result.crit).toBe(true);
    // base 20 * variance(0.85..1.15) * 3 → comfortably above 40.
    expect(result.damage).toBeGreaterThan(40);
  });

  it("flags lethal hits and clamps hp at zero", () => {
    const a = makeCombatant(stats({ attack: 1000 }));
    const d = makeCombatant(stats({ maxHp: 10 }));
    const result = resolveAttack(a, d, createRng(3));
    expect(result.lethal).toBe(true);
    expect(result.defenderHp).toBe(0);
    expect(isDead(d)).toBe(true);
  });
});

describe("resolveAttack — level-gap mods", () => {
  const mods = (over: Partial<GapAttackMods> = {}): GapAttackMods => ({
    ...NEUTRAL_GAP_MODS,
    ...over,
  });

  it("neutral mods match no mods exactly, including the random stream", () => {
    const d1 = makeCombatant(stats());
    const d2 = makeCombatant(stats());
    const r1 = resolveAttack(makeCombatant(stats()), d1, createRng(42));
    const r2 = resolveAttack(makeCombatant(stats()), d2, createRng(42), mods());
    expect(r2).toEqual(r1);
  });

  it("a certain miss deals nothing, mutates nothing, and is never lethal", () => {
    const a = makeCombatant(stats({ attack: 1000 }));
    const d = makeCombatant(stats({ maxHp: 10 }));
    const result = resolveAttack(a, d, createRng(5), mods({ missChance: 1 }));
    expect(result.missed).toBe(true);
    expect(result.damage).toBe(0);
    expect(result.crit).toBe(false);
    expect(result.lethal).toBe(false);
    expect(d.hp).toBe(10);
  });

  it("damageMult scales the hit and MIN_DAMAGE still floors it", () => {
    const d1 = makeCombatant(stats({ defense: 0 }));
    const d2 = makeCombatant(stats({ defense: 0 }));
    const full = resolveAttack(makeCombatant(stats()), d1, createRng(9));
    const half = resolveAttack(makeCombatant(stats()), d2, createRng(9), mods({ damageMult: 0.5 }));
    expect(half.damage).toBe(Math.max(Math.round(full.damage * 0.5), MIN_DAMAGE));
    const chip = resolveAttack(
      makeCombatant(stats({ attack: 1 })),
      makeCombatant(stats({ defense: 999 })),
      createRng(9),
      mods({ damageMult: 0.2 }),
    );
    expect(chip.damage).toBe(MIN_DAMAGE);
  });

  it("critBonus raises the roll and critCap bounds the total", () => {
    const a = makeCombatant(stats({ critChance: 0 }));
    const sure = resolveAttack(a, makeCombatant(stats()), createRng(4), mods({ critBonus: 1 }));
    expect(sure.crit).toBe(true);
    // Cap wins even over a huge bonus: capped at 0 can never crit.
    for (let seed = 0; seed < 30; seed++) {
      const r = resolveAttack(
        makeCombatant(stats({ critChance: 0.5 })),
        makeCombatant(stats()),
        createRng(seed),
        mods({ critBonus: 5, critCap: 0 }),
      );
      expect(r.crit).toBe(false);
    }
  });
});
