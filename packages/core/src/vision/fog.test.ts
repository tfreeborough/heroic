import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../math/vec2";
import { createFogGrid, markVisible, resetFog } from "./fog";

/** Centre of cell (col, row) in world space, for asserting on `seen`. */
const cellSeen = (fog: ReturnType<typeof createFogGrid>, col: number, row: number): boolean =>
  fog.seen[row * fog.cols + col] === 1;

describe("createFogGrid", () => {
  test("sizes the grid and starts fully unexplored", () => {
    const fog = createFogGrid(100, 10);
    expect(fog.cols).toBe(10);
    expect(fog.rows).toBe(10);
    expect(fog.seen).toHaveLength(100);
    expect(fog.seen.some((v) => v === 1)).toBe(false);
  });
});

describe("markVisible", () => {
  // A square covering world [20, 80] in both axes → cell centres 25..75.
  const square: Vec2[] = [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ];

  const wide = 1000; // radius large enough not to clip the small test polygons

  test("marks cells whose centre is inside the polygon", () => {
    const fog = createFogGrid(100, 10);
    expect(markVisible(fog, square, { x: 50, y: 50 }, wide)).toBe(true);
    // Cells 2..7 (centres 25..75) are covered; the rim cells are not.
    expect(cellSeen(fog, 2, 2)).toBe(true);
    expect(cellSeen(fog, 7, 7)).toBe(true);
    expect(cellSeen(fog, 0, 0)).toBe(false);
    expect(cellSeen(fog, 9, 9)).toBe(false);
  });

  test("is idempotent: re-marking the same area reports no change", () => {
    const fog = createFogGrid(100, 10);
    expect(markVisible(fog, square, { x: 50, y: 50 }, wide)).toBe(true);
    expect(markVisible(fog, square, { x: 50, y: 50 }, wide)).toBe(false);
  });

  test("accumulates: a new region adds to what was already seen", () => {
    const fog = createFogGrid(100, 10);
    markVisible(fog, square, { x: 50, y: 50 }, wide);
    const farCorner: Vec2[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(markVisible(fog, farCorner, { x: 10, y: 10 }, wide)).toBe(true);
    expect(cellSeen(fog, 0, 0)).toBe(true); // newly seen
    expect(cellSeen(fog, 5, 5)).toBe(true); // still seen from before
  });

  test("the radius clamps discovery inside the polygon", () => {
    const fog = createFogGrid(100, 10);
    // Polygon covers the whole grid, but a tight radius reveals only nearby cells.
    const whole: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(markVisible(fog, whole, { x: 50, y: 50 }, 15)).toBe(true);
    expect(cellSeen(fog, 5, 5)).toBe(true); // centre (55,55), ~7 from origin
    expect(cellSeen(fog, 0, 0)).toBe(false); // far corner, well beyond radius 15
    expect(cellSeen(fog, 9, 9)).toBe(false);
  });

  test("a degenerate polygon marks nothing", () => {
    const fog = createFogGrid(100, 10);
    expect(markVisible(fog, [{ x: 50, y: 50 }, { x: 60, y: 50 }], { x: 50, y: 50 }, wide)).toBe(false);
  });

  test("reports the indices that became seen this call, for incremental rendering", () => {
    const fog = createFogGrid(100, 10);
    const newly: number[] = [];
    markVisible(fog, square, { x: 50, y: 50 }, wide, newly);
    // Every reported index is one of the cells now marked seen, and the count matches.
    expect(newly.length).toBeGreaterThan(0);
    expect(newly.every((idx) => fog.seen[idx] === 1)).toBe(true);
    expect(newly.length).toBe(fog.seen.reduce((n, v) => n + v, 0));
    // Re-marking the same area sees nothing new → the buffer is cleared, not appended.
    markVisible(fog, square, { x: 50, y: 50 }, wide, newly);
    expect(newly).toHaveLength(0);
  });
});

describe("resetFog", () => {
  test("clears everything back to unexplored", () => {
    const fog = createFogGrid(100, 10);
    markVisible(
      fog,
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      { x: 50, y: 50 },
      1000,
    );
    expect(fog.seen.some((v) => v === 1)).toBe(true);
    resetFog(fog);
    expect(fog.seen.some((v) => v === 1)).toBe(false);
  });
});
