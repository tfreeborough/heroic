import { describe, expect, test } from "bun:test";
import { clampOffset, hitTest, offsetBounds, offsetFor, routeEdge, screenToCanvas, worldBounds } from "./mapMath";

describe("worldBounds", () => {
  test("pads the extremes", () => {
    const b = worldBounds([{ x: -100, y: 0 }, { x: 300, y: 50 }], 90);
    expect(b).toEqual({ minX: -190, minY: -90, width: 580, height: 230 });
  });

  test("empty input yields a pad-sized world", () => {
    expect(worldBounds([], 50)).toEqual({ minX: -50, minY: -50, width: 100, height: 100 });
  });
});

describe("clampOffset", () => {
  // world 1000, view 400, scale 1: canvas larger — t ranges [-600, 0].
  test("edges clamp flush against the viewport", () => {
    expect(clampOffset(50, 1, 1000, 400)).toBe(0);
    expect(clampOffset(-900, 1, 1000, 400)).toBe(-600);
    expect(clampOffset(-300, 1, 1000, 400)).toBe(-300);
  });

  test("a canvas smaller than the viewport centres", () => {
    // world 1000 at scale 0.2 → 200 wide in a 400 view: centred regardless of t.
    const centred = clampOffset(999, 0.2, 1000, 400);
    expect(clampOffset(-999, 0.2, 1000, 400)).toBe(centred);
    // Screen-space left edge = t + base where base = 500·(1−0.2) = 400… the
    // centred canvas must start at (400−200)/2 = 100 on screen.
    const base = (1000 / 2) * (1 - 0.2);
    expect(centred + base).toBe(100);
  });

  test("scaling keeps the clamp in screen space", () => {
    // world 1000 at scale 2 → 2000 wide in 400: left flush means screen edge 0.
    const max = clampOffset(9999, 2, 1000, 400);
    const base = (1000 / 2) * (1 - 2);
    expect(max + base).toBe(0); // screen-space left edge
    const min = clampOffset(-9999, 2, 1000, 400);
    expect(min + base + 1000 * 2).toBe(400); // screen-space right edge
  });
});

describe("offsetBounds", () => {
  test("agrees with clampOffset at the edges", () => {
    const [min, max] = offsetBounds(1, 1000, 400);
    expect(min).toBe(-600);
    expect(max).toBe(0);
    expect(clampOffset(min - 50, 1, 1000, 400)).toBe(min);
    expect(clampOffset(max + 50, 1, 1000, 400)).toBe(max);
  });

  test("collapses to the centred point when smaller than the viewport", () => {
    const [min, max] = offsetBounds(0.2, 1000, 400);
    expect(min).toBe(max);
    expect(min).toBe(clampOffset(0, 0.2, 1000, 400));
  });
});

describe("screenToCanvas / offsetFor round-trip", () => {
  const world = { minX: 0, minY: 0, width: 1000, height: 800 };

  test("inverse of the view transform", () => {
    // Place canvas point (200, 300) at container point (50, 60) at scale 1.5…
    const { tx, ty } = offsetFor(200, 300, 50, 60, 1.5, world);
    // …then the inverse maps that container point straight back.
    const p = screenToCanvas(50, 60, tx, ty, 1.5, world);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(300);
  });

  test("identity at scale 1 centred", () => {
    const p = screenToCanvas(500, 400, 0, 0, 1, world);
    expect(p).toEqual({ x: 500, y: 400 });
  });
});

describe("routeEdge", () => {
  test("aligned nodes get a straight segment", () => {
    expect(routeEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toHaveLength(2);
    expect(routeEdge({ x: 0, y: 0 }, { x: 0, y: 100 }, [])).toHaveLength(2);
  });

  test("offset nodes get an L-elbow avoiding third-party discs", () => {
    // Horizontal-first would pass through the obstacle at (100, 0).
    const obstacle = { id: "z", x: 100, y: 0, radius: 26 };
    const route = routeEdge({ id: "a", x: 0, y: 0 }, { id: "b", x: 140, y: -95 }, [obstacle]);
    expect(route).toHaveLength(3);
    expect(route[1]).toEqual({ x: 0, y: -95 }); // vertical-first dodges it
  });

  test("endpoints' own discs never count as crossings", () => {
    const nodes = [
      { id: "a", x: 0, y: 0, radius: 26 },
      { id: "b", x: 140, y: -95, radius: 26 },
    ];
    const route = routeEdge({ id: "a", x: 0, y: 0 }, { id: "b", x: 140, y: -95 }, nodes);
    expect(route[1]).toEqual({ x: 140, y: 0 }); // horizontal-first default
  });
});

describe("hitTest", () => {
  const nodes = [
    { id: "a", x: 100, y: 100, radius: 26 },
    { id: "b", x: 160, y: 100, radius: 26 },
  ];

  test("hits within the disc + slop, nearest wins the overlap", () => {
    expect(hitTest(nodes, 100, 102)).toBe("a");
    expect(hitTest(nodes, 131, 100)).toBe("b"); // midpoint-ish, b nearer
    expect(hitTest(nodes, 129, 100)).toBe("a");
    expect(hitTest(nodes, 300, 300)).toBeNull();
  });
});
