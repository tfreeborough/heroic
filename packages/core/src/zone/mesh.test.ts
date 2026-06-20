import { describe, expect, test } from "bun:test";
import { greedyMesh } from "./mesh";

/** Sort rects into a stable order so assertions don't depend on emission order. */
const sorted = (rects: { x: number; y: number; w: number; h: number }[]) =>
  [...rects].sort((a, b) => a.y - b.y || a.x - b.x);

describe("greedyMesh", () => {
  test("empty grid → no rects", () => {
    expect(greedyMesh([], 10)).toEqual([]);
    expect(greedyMesh([[0, 0], [0, 0]], 10)).toEqual([]);
  });

  test("a single solid cell → one centre-based rect", () => {
    expect(greedyMesh([[1]], 10)).toEqual([{ x: 5, y: 5, w: 10, h: 10 }]);
  });

  test("a horizontal run merges into one wide rect", () => {
    expect(greedyMesh([[1, 1, 1]], 10)).toEqual([{ x: 15, y: 5, w: 30, h: 10 }]);
  });

  test("a filled block merges into one rect (the big win)", () => {
    const cells = [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];
    expect(greedyMesh(cells, 10)).toEqual([{ x: 15, y: 15, w: 30, h: 30 }]);
  });

  test("an L-shape splits into two rects (width-first growth)", () => {
    // 1 1
    // 1 0   → top row is one 2-wide rect; the lone cell below is its own rect.
    const cells = [
      [1, 1],
      [1, 0],
    ];
    expect(sorted(greedyMesh(cells, 10))).toEqual([
      { x: 10, y: 5, w: 20, h: 10 }, // row 0, cols 0..1
      { x: 5, y: 15, w: 10, h: 10 }, // row 1, col 0
    ]);
  });

  test("non-zero (not just 1) counts as solid; cellSize scales the output", () => {
    expect(greedyMesh([[2, 7]], 32)).toEqual([{ x: 32, y: 16, w: 64, h: 32 }]);
  });

  test("ragged rows are treated as empty past their end", () => {
    // Row 1 is shorter; the missing column 1 must not merge downward.
    const cells = [[1, 1], [1]];
    expect(sorted(greedyMesh(cells, 10))).toEqual([
      { x: 10, y: 5, w: 20, h: 10 }, // row 0, cols 0..1 (width-first)
      { x: 5, y: 15, w: 10, h: 10 }, // row 1, col 0 — col 1 is absent, so no merge down
    ]);
  });

  test("rejects a non-positive cell size", () => {
    expect(() => greedyMesh([[1]], 0)).toThrow();
    expect(() => greedyMesh([[1]], -4)).toThrow();
  });
});
