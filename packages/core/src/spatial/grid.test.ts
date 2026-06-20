import { describe, expect, test } from "bun:test";
import {
  clearGrid,
  createSpatialGrid,
  forEachNeighbor,
  insertItem,
  rebuildGrid,
} from "./grid";
import { vec2, type Vec2 } from "../math/vec2";

/** Collect the indices forEachNeighbor visits around a point, for assertions. */
const neighborsAt = (grid: ReturnType<typeof createSpatialGrid>, x: number, y: number): number[] => {
  const out: number[] = [];
  forEachNeighbor(grid, x, y, (i) => out.push(i));
  return out.sort((a, b) => a - b);
};

describe("createSpatialGrid", () => {
  test("sizes the grid by world size / cell size, all cells empty", () => {
    const grid = createSpatialGrid(640, 64);
    expect(grid.cols).toBe(10);
    expect(grid.rows).toBe(10);
    expect(grid.cells.length).toBe(100);
    expect(grid.cells.every((c) => c.length === 0)).toBe(true);
  });

  test("rounds up partial cells and never has zero columns", () => {
    expect(createSpatialGrid(650, 64).cols).toBe(11); // ceil(650/64)
    expect(createSpatialGrid(10, 64).cols).toBe(1);
  });

  test("supports a non-square (width × height) grid", () => {
    const grid = createSpatialGrid(3200, 64, 768); // 50 × 12 tiles — a wide, thin zone
    expect(grid.cols).toBe(50);
    expect(grid.rows).toBe(12);
    expect(grid.cells.length).toBe(600);
  });

  test("rejects a non-positive cell size", () => {
    expect(() => createSpatialGrid(640, 0)).toThrow();
    expect(() => createSpatialGrid(640, -8)).toThrow();
  });
});

describe("insert + forEachNeighbor", () => {
  test("finds an item in the same cell, including the query's own cell", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 7, 100, 100); // cell (1, 1)
    expect(neighborsAt(grid, 100, 100)).toEqual([7]);
  });

  test("finds items in any of the 8 surrounding cells", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, 100, 100); // cell (1, 1) — the query cell
    insertItem(grid, 1, 40, 40); // cell (0, 0) — diagonal
    insertItem(grid, 2, 160, 160); // cell (2, 2) — opposite diagonal
    expect(neighborsAt(grid, 100, 100)).toEqual([0, 1, 2]);
  });

  test("excludes items two or more cells away", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, 100, 100); // cell (1, 1)
    insertItem(grid, 1, 300, 100); // cell (4, 1) — 3 cells east
    insertItem(grid, 2, 100, 300); // cell (1, 4) — 3 cells south
    expect(neighborsAt(grid, 100, 100)).toEqual([0]);
  });

  test("visits each item exactly once", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, 100, 100);
    const seen: number[] = [];
    forEachNeighbor(grid, 100, 100, (i) => seen.push(i));
    expect(seen).toEqual([0]);
  });

  test("clamps out-of-bounds positions into edge cells (no crash, still found)", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, -50, -50); // clamps to cell (0, 0)
    insertItem(grid, 1, 99999, 99999); // clamps to cell (9, 9)
    expect(neighborsAt(grid, 10, 10)).toEqual([0]);
    expect(neighborsAt(grid, 630, 630)).toEqual([1]);
  });
});

describe("clearGrid / rebuildGrid", () => {
  test("clearGrid empties every cell", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, 100, 100);
    clearGrid(grid);
    expect(neighborsAt(grid, 100, 100)).toEqual([]);
  });

  test("rebuildGrid clears then repopulates from positions", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 99, 500, 500); // stale entry, should be gone after rebuild
    const positions: Vec2[] = [vec2(100, 100), vec2(120, 100), vec2(400, 400)];
    rebuildGrid(grid, positions.length, (i) => positions[i]!);
    expect(neighborsAt(grid, 100, 100)).toEqual([0, 1]); // 0 and 1 are neighbours; 2 is far
    expect(neighborsAt(grid, 400, 400)).toEqual([2]);
    expect(neighborsAt(grid, 500, 500)).not.toContain(99); // the stale pre-rebuild entry is gone
  });
});

describe("the 3×3 radius guarantee (cellSize ≥ query radius)", () => {
  // With cellSize 64 ≥ any radius ≤ 64, two points within that radius must land
  // in each other's 3×3 block — even right across a cell boundary.
  test("two points within one cell of each other are mutually found across a boundary", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, 127, 100); // cell (1, 1) — just inside the boundary
    insertItem(grid, 1, 128, 100); // cell (2, 1) — just past it, 1px away
    expect(neighborsAt(grid, 127, 100)).toContain(1);
    expect(neighborsAt(grid, 128, 100)).toContain(0);
  });

  test("a neighbour exactly at the radius (= cellSize) is still in the 3×3", () => {
    const grid = createSpatialGrid(640, 64);
    insertItem(grid, 0, 100, 100);
    insertItem(grid, 1, 156, 100); // 56 px east (the demo separationRadius)
    expect(neighborsAt(grid, 100, 100)).toContain(1);
  });
});
