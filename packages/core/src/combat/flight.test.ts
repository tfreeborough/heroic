import { describe, expect, test } from "bun:test";
import { distance, type Vec2 } from "../math/vec2";
import { spawnVolley, type VolleyConfig } from "./flight";
import { stepProjectile, type ProjectileState } from "./projectile";

const DT = 1 / 60;
const ORIGIN: Vec2 = { x: 0, y: 0 };
const TARGET: Vec2 = { x: 200, y: 0 };

const volley = (overrides: Partial<VolleyConfig> = {}) =>
  spawnVolley(ORIGIN, TARGET, {
    speed: 600,
    radius: 5,
    maxRange: 1000,
    ...overrides,
  });

/** Fly a projectile (no targets) and return its closest approach to a point. */
const closestApproach = (p: ProjectileState, point: Vec2): number => {
  let best = distance(p.pos, point);
  while (p.traveled < p.maxRange) {
    stepProjectile(p, DT, []);
    best = Math.min(best, distance(p.pos, point));
  }
  return best;
};

describe("spawnVolley", () => {
  test("defaults to a single straight shot identical to spawnProjectile", () => {
    const [p, ...rest] = volley();
    expect(rest).toHaveLength(0);
    expect(p!.dir.x).toBeCloseTo(1);
    expect(p!.dir.y).toBeCloseTo(0);
    expect(p!.turnRate).toBe(0);
    expect(p!.turnLeft).toBe(0);
  });

  test("pincer arms start mirrored off the aim line and turn back toward it", () => {
    const angle = Math.PI / 4;
    const [a, b] = volley({ flight: "pincer", count: 2, curveAngle: angle });
    expect(Math.atan2(a!.dir.y, a!.dir.x)).toBeCloseTo(-angle);
    expect(Math.atan2(b!.dir.y, b!.dir.x)).toBeCloseTo(angle);
    expect(a!.turnRate).toBeCloseTo(-b!.turnRate);
    expect(a!.turnRate).toBeGreaterThan(0); // upper arm curves back down
    expect(a!.turnLeft).toBeCloseTo(2 * angle);
  });

  test("odd-count pincers gain a straight centre shot", () => {
    const [a, mid, b] = volley({ flight: "pincer", count: 3 });
    expect(mid!.turnRate).toBe(0);
    expect(mid!.dir.x).toBeCloseTo(1);
    expect(a!.turnRate).toBeCloseTo(-b!.turnRate);
  });

  test("both pincer arms converge on the aim point", () => {
    const arms = volley({ flight: "pincer", count: 2 });
    for (const arm of arms) {
      // Within a step's travel (10px) of the target despite the curve.
      expect(closestApproach(arm, TARGET)).toBeLessThan(10);
    }
  });

  test("arms straighten after converging instead of orbiting", () => {
    const [arm] = volley({ flight: "pincer", count: 2 });
    while (arm!.turnLeft > 0) stepProjectile(arm!, DT, []);
    const dirAfter = { ...arm!.dir };
    stepProjectile(arm!, DT, []);
    expect(arm!.dir).toEqual(dirAfter);
  });

  test("a point-blank pincer degrades to straight flight without NaNs", () => {
    const arms = spawnVolley(ORIGIN, ORIGIN, {
      speed: 600,
      radius: 5,
      maxRange: 100,
      flight: "pincer",
      count: 2,
    });
    for (const arm of arms) {
      expect(arm.turnRate).toBe(0);
      expect(Number.isNaN(arm.dir.x)).toBe(false);
    }
  });
});
