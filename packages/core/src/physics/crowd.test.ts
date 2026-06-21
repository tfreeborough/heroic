import { describe, expect, test } from "bun:test";
import {
  clampCircleToBounds,
  closestPointOnAabb,
  createMover,
  distanceToAabb,
  pushApartCrowd,
  resolveCircleAabb,
  resolveCircleVsCircle,
  stepCrowd,
  type Aabb,
  type Mover,
} from "./crowd";
import { createSpatialGrid, rebuildGrid } from "../spatial/grid";

describe("closestPointOnAabb / distanceToAabb", () => {
  const box: Aabb = { x: 100, y: 100, w: 40, h: 40 }; // spans [80,120]×[80,120]

  test("clamps an outside point to the nearest face", () => {
    expect(closestPointOnAabb({ x: 50, y: 100 }, box)).toEqual({ x: 80, y: 100 });
    expect(distanceToAabb({ x: 50, y: 100 }, box)).toBeCloseTo(30);
  });

  test("clamps to the nearest corner past the diagonal", () => {
    expect(closestPointOnAabb({ x: 140, y: 140 }, box)).toEqual({ x: 120, y: 120 });
    expect(distanceToAabb({ x: 140, y: 140 }, box)).toBeCloseTo(Math.hypot(20, 20));
  });

  test("a point inside the box maps to itself, distance 0", () => {
    expect(closestPointOnAabb({ x: 105, y: 95 }, box)).toEqual({ x: 105, y: 95 });
    expect(distanceToAabb({ x: 105, y: 95 }, box)).toBe(0);
  });
});

describe("resolveCircleAabb", () => {
  const box: Aabb = { x: 100, y: 100, w: 40, h: 40 }; // spans [80,120]×[80,120]

  test("no-op when the circle is clear of the box", () => {
    const pos = { x: 200, y: 200 };
    expect(resolveCircleAabb(pos, 10, box)).toBe(false);
    expect(pos).toEqual({ x: 200, y: 200 });
  });

  test("pushes a circle overlapping the left face straight out", () => {
    const pos = { x: 75, y: 100 }; // 5 px inside the left face for a r=10 circle
    expect(resolveCircleAabb(pos, 10, box)).toBe(true);
    expect(pos.x).toBeCloseTo(70); // edge at x=80, minus radius 10
    expect(pos.y).toBeCloseTo(100);
  });

  test("pushes a circle whose centre is inside the box out the nearest face", () => {
    const pos = { x: 115, y: 100 }; // inside, nearest the right face
    expect(resolveCircleAabb(pos, 10, box)).toBe(true);
    expect(pos.x).toBeCloseTo(130); // right edge 120 + radius 10
  });

  test("ignores a near-corner that the circle doesn't actually reach", () => {
    // Just outside the corner (120,120): within the radius-expanded bounding box
    // on both axes, but farther than the radius from the corner itself.
    const pos = { x: 128, y: 128 };
    expect(resolveCircleAabb(pos, 10, box)).toBe(false);
    expect(pos).toEqual({ x: 128, y: 128 });
  });

  test("pushes out of a corner along the diagonal when actually overlapping", () => {
    const pos = { x: 124, y: 124 }; // ~5.7px from corner (120,120), inside r=10
    expect(resolveCircleAabb(pos, 10, box)).toBe(true);
    // After the push the centre is exactly the radius from the corner.
    const d = Math.hypot(pos.x - 120, pos.y - 120);
    expect(d).toBeCloseTo(10);
  });
});

describe("resolveCircleVsCircle", () => {
  test("no-op when the circles don't overlap", () => {
    const pos = { x: 50, y: 0 };
    expect(resolveCircleVsCircle(pos, 10, { x: 0, y: 0 }, 10)).toBe(false);
    expect(pos).toEqual({ x: 50, y: 0 });
  });

  test("pushes out to exactly touching, away from the other centre", () => {
    const pos = { x: 6, y: 0 }; // overlapping a r=10 circle at origin (sum 20)
    expect(resolveCircleVsCircle(pos, 10, { x: 0, y: 0 }, 10)).toBe(true);
    expect(pos.x).toBeCloseTo(20); // pushed to sum-of-radii along +x
    expect(pos.y).toBeCloseTo(0);
  });

  test("exact overlap shoves deterministically along +x", () => {
    const pos = { x: 0, y: 0 };
    expect(resolveCircleVsCircle(pos, 10, { x: 0, y: 0 }, 8)).toBe(true);
    expect(pos.x).toBeCloseTo(18);
  });
});

describe("clampCircleToBounds", () => {
  test("clamps a circle poking past each edge back inside", () => {
    const a = { x: -5, y: 5 };
    clampCircleToBounds(a, 10, 200);
    expect(a).toEqual({ x: 10, y: 10 });
    const b = { x: 250, y: 100 };
    clampCircleToBounds(b, 10, 200);
    expect(b).toEqual({ x: 190, y: 100 });
  });

  test("leaves an interior circle alone", () => {
    const a = { x: 100, y: 100 };
    clampCircleToBounds(a, 10, 200);
    expect(a).toEqual({ x: 100, y: 100 });
  });

  test("clamps to a non-square (width × height) world", () => {
    // Wide, thin world 3200 × 768: y past the short axis is pulled in, x is fine.
    const a = { x: 100, y: 900 };
    clampCircleToBounds(a, 10, 3200, 768);
    expect(a).toEqual({ x: 100, y: 758 }); // 768 - radius 10
  });
});

describe("pushApartCrowd", () => {
  const grid = createSpatialGrid(640, 64);

  test("separates two overlapping movers symmetrically", () => {
    const movers: Mover[] = [createMover(100, 100, 18), createMover(110, 100, 18)];
    rebuildGrid(grid, movers.length, (i) => movers[i]!.pos);
    pushApartCrowd(movers, grid, 1);
    // Symmetric: both move the same distance, in opposite directions, gap grows.
    expect(movers[0]!.pos.x).toBeLessThan(100);
    expect(movers[1]!.pos.x).toBeGreaterThan(110);
    expect(movers[0]!.pos.y).toBeCloseTo(100);
    const gap = movers[1]!.pos.x - movers[0]!.pos.x;
    expect(gap).toBeCloseTo(36); // strength 1 → fully separated to sum-of-radii
  });

  test("leaves non-overlapping movers untouched", () => {
    const movers: Mover[] = [createMover(100, 100, 18), createMover(300, 100, 18)];
    rebuildGrid(grid, movers.length, (i) => movers[i]!.pos);
    pushApartCrowd(movers, grid, 1);
    expect(movers[0]!.pos).toEqual({ x: 100, y: 100 });
    expect(movers[1]!.pos).toEqual({ x: 300, y: 100 });
  });

  test("each pair is resolved once (no double-application)", () => {
    const movers: Mover[] = [createMover(100, 100, 18), createMover(110, 100, 18)];
    rebuildGrid(grid, movers.length, (i) => movers[i]!.pos);
    pushApartCrowd(movers, grid, 1);
    // 10px overlap of a 36 sum → each moves 13; if applied twice it'd overshoot.
    expect(movers[0]!.pos.x).toBeCloseTo(87);
    expect(movers[1]!.pos.x).toBeCloseTo(123);
  });
});

describe("stepCrowd", () => {
  const grid = createSpatialGrid(640, 64);
  const params = (player: { pos: { x: number; y: number }; radius: number } | null) => ({
    grid,
    walls: [] as Aabb[],
    player,
    worldSize: 640,
    pushStrength: 1,
  });

  test("integrates velocity into position", () => {
    const m = createMover(100, 100, 18);
    m.vel = { x: 60, y: -30 };
    stepCrowd([m], 0.5, params(null));
    expect(m.pos.x).toBeCloseTo(130); // 100 + 60*0.5
    expect(m.pos.y).toBeCloseTo(85); // 100 - 30*0.5
  });

  test("rings movers out of the player after integrating", () => {
    const m = createMover(100, 100, 18);
    m.vel = { x: 0, y: 0 };
    // Player sitting right on top of the mover; it must be pushed to touching.
    stepCrowd([m], 1, params({ pos: { x: 100, y: 100 }, radius: 18 }));
    const d = Math.hypot(m.pos.x - 100, m.pos.y - 100);
    expect(d).toBeCloseTo(36); // sum of radii — just touching, not overlapping
  });

  test("keeps movers inside the arena bounds", () => {
    const m = createMover(620, 100, 18);
    m.vel = { x: 200, y: 0 }; // would carry it past the right edge
    stepCrowd([m], 1, params(null));
    expect(m.pos.x).toBeLessThanOrEqual(640 - 18 + 1e-6);
  });
});
