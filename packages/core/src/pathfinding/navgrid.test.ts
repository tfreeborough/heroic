import { describe, expect, test } from "bun:test";
import { buildNavGrid, cellCentre, nearestWalkable, worldToCell } from "./navgrid";

describe("buildNavGrid", () => {
  const blocker = { x: 100, y: 100, w: 40, h: 40 }; // spans world 80..120

  test("marks cells whose centre is inside a blocker unwalkable", () => {
    const nav = buildNavGrid(200, 20, [blocker], 0);
    expect(nav.cols).toBe(10);
    expect(nav.grid.isWalkable(4, 4)).toBe(false); // centre (90,90), inside the block
    expect(nav.grid.isWalkable(0, 0)).toBe(true); // centre (10,10), clear
  });

  test("inflation expands the blocked region by the agent radius", () => {
    const clear = buildNavGrid(200, 20, [blocker], 0);
    const fat = buildNavGrid(200, 20, [blocker], 20);
    // Cell (3,3) centre (70,70): clear at inflate 0, blocked once inflated by 20.
    expect(clear.grid.isWalkable(3, 3)).toBe(true);
    expect(fat.grid.isWalkable(3, 3)).toBe(false);
  });

  test("supports a non-square (width × height) world", () => {
    const nav = buildNavGrid(3200, 64, [], 0, 768); // 50 × 12 tiles — wide, thin
    expect(nav.cols).toBe(50);
    expect(nav.rows).toBe(12);
    expect(nav.grid.isWalkable(49, 11)).toBe(true); // last cell exists and is clear
  });
});

describe("worldToCell / cellCentre", () => {
  test("round-trips a point to its cell's centre", () => {
    const nav = buildNavGrid(200, 20, [], 0);
    const cell = worldToCell(nav, { x: 53, y: 67 });
    expect(cell).toEqual({ x: 2, y: 3 });
    expect(cellCentre(nav, cell)).toEqual({ x: 50, y: 70 });
  });
});

describe("nearestWalkable", () => {
  test("returns the cell itself when already walkable", () => {
    const nav = buildNavGrid(200, 20, [{ x: 100, y: 100, w: 40, h: 40 }], 0);
    expect(nearestWalkable(nav, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  test("escapes a blocked cell to the nearest open one", () => {
    const nav = buildNavGrid(200, 20, [{ x: 100, y: 100, w: 40, h: 40 }], 0);
    const out = nearestWalkable(nav, { x: 4, y: 4 }); // blocked
    expect(out).not.toBeNull();
    expect(nav.grid.isWalkable(out!.x, out!.y)).toBe(true);
  });
});
