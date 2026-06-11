import { describe, expect, it } from "bun:test";
import { gridFromMatrix } from "./grid";
import { findPath } from "./astar";

describe("findPath", () => {
  it("finds a straight path on an open grid", () => {
    const grid = gridFromMatrix([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("routes around a wall", () => {
    const grid = gridFromMatrix([
      [1, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path.at(-1)).toEqual({ x: 2, y: 0 });
    // Must dip down to row 2 to get around the wall in column 1.
    expect(path.some((c) => c.y === 2)).toBe(true);
  });

  it("returns an empty array when no path exists", () => {
    const grid = gridFromMatrix([
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 1],
    ]);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([]);
  });

  it("is deterministic", () => {
    const grid = gridFromMatrix([
      [1, 1, 1, 1],
      [1, 0, 0, 1],
      [1, 1, 1, 1],
    ]);
    const a = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 2 }, { diagonal: true });
    const b = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 2 }, { diagonal: true });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("takes a shorter route with diagonals enabled", () => {
    const grid = gridFromMatrix([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
    const cardinal = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 });
    const diagonal = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 }, { diagonal: true });
    expect(diagonal.length).toBeLessThan(cardinal.length);
  });
});
