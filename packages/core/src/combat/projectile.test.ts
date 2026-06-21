import { describe, expect, test } from "bun:test";
import { spawnProjectile, stepProjectile } from "./projectile";
import type { HurtBox, HurtCircle } from "./hitbox";

const DT = 1 / 60;

const circle = (id: number, x: number, y = 0, radius = 10): HurtCircle => ({
  id,
  pos: { x, y },
  radius,
});

const box = (id: number, x: number, y = 0, w = 10, h = 10): HurtBox => ({
  id,
  box: { x, y, w, h },
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

  test("hits a box target in its path (circle-vs-box overlap)", () => {
    const p = spawn();
    // After one step p.pos≈(10,0); box spans x[7,17] so the point is inside it.
    const result = stepProjectile(p, DT, [box(1, 12)]);
    expect(result.hits).toEqual([1]);
    expect(result.expired).toBe(true);
  });

  test("misses a box just beyond the projectile's radius", () => {
    const p = spawn();
    // Box near face at y=10; projectile at (10,0) radius 5 → gap 10 > 5.
    const result = stepProjectile(p, DT, [box(1, 10, 15)]);
    expect(result.hits).toEqual([]);
    expect(result.expired).toBe(false);
  });

  test("resolves a box and a circle nearest-first", () => {
    const p = spawn({ pierce: 1 });
    // Circle centre at 9 (nearest), box centre at 14 (near face 9 too) — circle
    // edge is closer, so it lands first.
    const result = stepProjectile(p, DT, [box(2, 16, 0, 8, 8), circle(1, 9, 0, 4)]);
    expect(result.hits).toEqual([1, 2]);
  });
});
