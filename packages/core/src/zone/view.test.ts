import { describe, expect, test } from "bun:test";
import { chunksInView } from "./view";

// A 4 × 3 grid of 100px chunks (world 400 × 300). Index = row * 4 + col.
const grid = { chunkCols: 4, chunkRows: 3, chunkSize: 100 };

describe("chunksInView", () => {
  test("a view inside one chunk returns just that chunk", () => {
    expect(chunksInView(grid, 120, 120, 180, 180)).toEqual([5]); // row 1, col 1
  });

  test("a view spanning a 2×2 block returns those four chunks", () => {
    // x 150..250 → cols 1..2; y 150..250 → rows 1..2.
    expect(chunksInView(grid, 150, 150, 250, 250)).toEqual([5, 6, 9, 10]);
  });

  test("a view covering everything returns all chunks, row-major", () => {
    const all = chunksInView(grid, 0, 0, 400, 300);
    expect(all).toHaveLength(12);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("clamps a view that overhangs the zone edges", () => {
    // Far past the right/bottom edge, but starting mid-grid → clamps to the corner.
    expect(chunksInView(grid, 350, 250, 9999, 9999)).toEqual([11]); // last chunk only
  });

  test("a view entirely outside the zone returns nothing", () => {
    expect(chunksInView(grid, -500, -500, -100, -100)).toEqual([]);
    expect(chunksInView(grid, 1000, 1000, 2000, 2000)).toEqual([]);
  });

  test("a chunk straddled by the view's edge is included", () => {
    // x just past the 100px boundary into col 1; still includes col 0 (starts at 90).
    expect(chunksInView(grid, 90, 10, 110, 10)).toEqual([0, 1]);
  });
});
