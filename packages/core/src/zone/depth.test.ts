import { describe, expect, test } from "bun:test";
import { extrudeRect, voidRimBands, wallLeanVector, ZONE_DEPTH } from "./depth";

const box = { x: 0, y: 0, w: 10, h: 10 }; // x∈[-5,5], y∈[-5,5]

describe("extrudeRect", () => {
  test("a pure-south drop yields one quad: the bottom edge, extruded down", () => {
    expect(extrudeRect(box, 0, 10)).toEqual([[-5, 5, 5, 5, 5, 15, -5, 15]]);
  });

  test("a diagonal vector lights two faces (bottom + side)", () => {
    expect(extrudeRect(box, 4, 6)).toHaveLength(2); // south + east
    expect(extrudeRect(box, -4, 6)).toHaveLength(2); // south + west
  });

  test("a zero vector has no side faces", () => {
    expect(extrudeRect(box, 0, 0)).toEqual([]);
  });
});

describe("wallLeanVector — south tilt + parallax", () => {
  test("a wall under the focus shows the pure south tilt (wallBase)", () => {
    expect(wallLeanVector(box, 0, 0)).toEqual({ x: 0, y: ZONE_DEPTH.wallBase });
  });

  test("every wall keeps a south face (the camera tilt), wherever the focus is", () => {
    // Focus dead left → a sideways lean, but the south tilt still holds the y face.
    const v = wallLeanVector(box, -100, 0);
    expect(v.x).toBeLessThan(0); // leans toward the focus (west)
    expect(v.y).toBeCloseTo(ZONE_DEPTH.wallBase, 6); // …on top of the constant south tilt
  });

  test("the parallax lean lengthens with distance from the focus", () => {
    const near = wallLeanVector(box, 200, 0).x;
    const far = wallLeanVector(box, 600, 0).x;
    expect(Math.abs(far)).toBeGreaterThan(Math.abs(near));
  });

  test("leanScale 0 drops the parallax — a fixed south tilt, camera-independent", () => {
    // Used for the baked, fixed-depth world (no per-frame camera tracking).
    for (const [cx, cy] of [[-100, 0], [600, 400]] as const) {
      const v = wallLeanVector(box, cx, cy, 0);
      expect(v.x).toBeCloseTo(0, 6); // no parallax lean, whatever the focus
      expect(v.y).toBeCloseTo(ZONE_DEPTH.wallBase, 6); // just the fixed south tilt
    }
  });
});

describe("voidRimBands — south-tilt wall + parallax", () => {
  const rect = { x: 0, y: 0, w: 20, h: 20 };
  // The void's NORTH edge (its inner wall faces south, toward the camera).
  const northEdge = (bands: ReturnType<typeof voidRimBands>) => bands.find((b) => b.y0 === -10)!;

  test("every exposed edge is returned (the lip outlines the whole hole)", () => {
    const bands = voidRimBands(rect, [rect], -100, -100); // lone rect → all 4 edges exposed
    expect(bands).toHaveLength(4);
    for (const b of bands) expect(b.lipW).toBeGreaterThan(0); // each carries a lit lip
  });

  test("the south-facing (north) wall shows from the tilt even when you stand north of the pit", () => {
    // Focus due north of the void (you're standing just above it) — the near, north
    // edge faces the camera, yet still shows a wall thanks to the tilt baseline.
    const bands = voidRimBands(rect, [rect], 0, -100);
    expect(northEdge(bands).intensity).toBeGreaterThan(0.5); // ≈ voidTilt
  });

  test("the far wall (parallax) shifts with the camera; the tilt wall does not", () => {
    // South edge is a far wall when you're north, and hidden when you're south.
    const south = (cy: number) => voidRimBands(rect, [rect], 0, cy).find((b) => b.y0 === 10)!.intensity;
    expect(south(-200)).toBeGreaterThan(south(200)); // parallax: lit from the north, not the south
    // North edge holds its tilt baseline from both sides.
    expect(northEdge(voidRimBands(rect, [rect], 0, -200)).intensity).toBeGreaterThan(0.5);
    expect(northEdge(voidRimBands(rect, [rect], 0, 200)).intensity).toBeGreaterThan(0.5);
  });

  test("leanScale 0 makes the cliff camera-independent (fixed depth for the baked world)", () => {
    const south = (cy: number) => voidRimBands(rect, [rect], 0, cy, 0).find((b) => b.y0 === 10)!.intensity;
    expect(south(-200)).toBeCloseTo(south(200), 6); // no parallax shift with the camera
  });

  test("skips an edge that borders another void rect (a meshed seam, not a real rim)", () => {
    const neighbourEast = { x: 20, y: 0, w: 20, h: 20 }; // abuts rect's right edge
    const bands = voidRimBands(rect, [rect, neighbourEast], -100, -100);
    expect(bands.some((b) => b.x0 === 10)).toBe(false); // the shared east edge is gone
  });

  test("rims only the EXPOSED part of a partially-shared edge (no interior seam line)", () => {
    // A wide void rect above a playable island, with narrow void rects either side of
    // the gap — the classic greedy-mesh layout that drew seams. Its bottom edge spans
    // x∈[-30,30]; only the island gap x∈[-10,10] is a real rim.
    const wide = { x: 0, y: -20, w: 60, h: 20 }; // bottom edge at y = -10
    const leftBelow = { x: -20, y: 0, w: 20, h: 20 }; // covers x∈[-30,-10] below
    const rightBelow = { x: 20, y: 0, w: 20, h: 20 }; // covers x∈[10,30] below
    const voids = [wide, leftBelow, rightBelow];
    const bottomBands = voidRimBands(wide, voids, 0, -100).filter((b) => b.y0 === -10);
    expect(bottomBands).toHaveLength(1); // one span, not the whole edge
    expect(bottomBands[0]!.x).toBeCloseTo(-10, 6); // starts at the island, not -30
    expect(bottomBands[0]!.w).toBeCloseTo(20, 6); // spans only the 20-wide gap
  });
});
