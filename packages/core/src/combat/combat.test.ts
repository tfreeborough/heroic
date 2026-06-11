import { describe, expect, it } from "bun:test";
import { createRng } from "../rng";
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
