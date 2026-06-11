import { describe, expect, test } from "bun:test";
import { spawnProjectile, stepProjectile } from "./projectile";
import type { HurtCircle } from "./hitbox";

const DT = 1 / 60;

const circle = (id: number, x: number, y = 0, radius = 10): HurtCircle => ({
  id,
  pos: { x, y },
  radius,
});

const spawn = (overrides: Partial<Parameters<typeof spawnProjectile>[2]> = {}) =>
  spawnProjectile({ x: 0, y: 0 }, { x: 100, y: 0 }, {
    speed: 600,
    radius: 5,
    maxRange: 300,
    ...overrides,
  });

describe("spawnProjectile", () => {
  test("aims at the target position at fire-time", () => {
    const p = spawnProjectile({ x: 0, y: 0 }, { x: 30, y: 40 }, { speed: 1, radius: 1, maxRange: 1 });
    expect(p.dir.x).toBeCloseTo(0.6);
    expect(p.dir.y).toBeCloseTo(0.8);
  });
});

describe("stepProjectile", () => {
  test("travels along its direction", () => {
    const p = spawn();
    const result = stepProjectile(p, DT, []);
    expect(p.pos.x).toBeCloseTo(10);
    expect(p.traveled).toBeCloseTo(10);
    expect(result.expired).toBe(false);
  });

  test("hits the first overlapping target and expires without pierce", () => {
    const p = spawn();
    const result = stepProjectile(p, DT, [circle(1, 12)]);
    expect(result.hits).toEqual([1]);
    expect(result.expired).toBe(true);
  });

  test("pierces through targets until pierce is spent", () => {
    const p = spawn({ pierce: 1 });
    const first = stepProjectile(p, DT, [circle(1, 12)]);
    expect(first.hits).toEqual([1]);
    expect(first.expired).toBe(false);

    const second = stepProjectile(p, DT, [circle(1, 12), circle(2, 22)]);
    expect(second.hits).toEqual([2]);
    expect(second.expired).toBe(true);
  });

  test("never re-hits a target it already damaged", () => {
    const p = spawn({ pierce: 3 });
    stepProjectile(p, DT, [circle(1, 12)]);
    const result = stepProjectile(p, DT, [circle(1, 12)]);
    expect(result.hits).toEqual([]);
    expect(result.expired).toBe(false);
  });

  test("expires once it exceeds max range", () => {
    const p = spawn({ maxRange: 15 });
    expect(stepProjectile(p, DT, []).expired).toBe(false);
    expect(stepProjectile(p, DT, []).expired).toBe(true);
  });
});
