import { describe, expect, test } from "bun:test";
import { buildNavGrid, type NavBlocker } from "./navgrid";
import { computeFlowField, createFlowField, flowAt, flowCostAt, flowCovers } from "./flowField";

/** A 5×5 grid of 10px cells; cell (col,row) centre is (col*10+5, row*10+5). */
const grid = (blockers: NavBlocker[] = []) => buildNavGrid(50, 10, blockers, 0, 50);
const centre = (col: number, row: number) => ({ x: col * 10 + 5, y: row * 10 + 5 });

describe("computeFlowField — open grid", () => {
  const nav = grid();
  const field = createFlowField(nav);
  computeFlowField(field, nav, centre(2, 2), 100); // source at the middle, big radius

  test("flow points back toward the source", () => {
    expect(flowAt(field, centre(4, 2)).x).toBeLessThan(0); // right of source → point left
    expect(flowAt(field, centre(0, 2)).x).toBeGreaterThan(0); // left of source → point right
    expect(flowAt(field, centre(2, 4)).y).toBeLessThan(0); // below source → point up
    expect(flowAt(field, centre(2, 0)).y).toBeGreaterThan(0); // above source → point down
  });

  test("the source cell itself has no flow", () => {
    expect(flowAt(field, centre(2, 2))).toEqual({ x: 0, y: 0 });
    expect(flowCostAt(field, centre(2, 2))).toBe(0);
  });

  test("cost grows with wall-free distance", () => {
    expect(flowCostAt(field, centre(3, 2))).toBeLessThan(flowCostAt(field, centre(4, 2)));
  });
});

describe("computeFlowField — bounded radius", () => {
  const nav = grid();
  const field = createFlowField(nav);
  computeFlowField(field, nav, centre(2, 2), 15); // radius 15px = 1.5 cells

  test("cells within the radius are covered, beyond it are not", () => {
    expect(flowCovers(field, centre(3, 2))).toBe(true); // 1 step away
    expect(flowCovers(field, centre(4, 2))).toBe(false); // 2 steps — outside 1.5
    expect(flowAt(field, centre(4, 2))).toEqual({ x: 0, y: 0 }); // → fall back
  });
});

describe("computeFlowField — walls", () => {
  // A vertical wall on column 2 (x∈[20,30]) covering rows 0..3, leaving row 4 open —
  // so the only way from the left half to the right half is around the bottom.
  const wall: NavBlocker = { x: 25, y: 20, w: 10, h: 40 };
  const nav = grid([wall]);
  const field = createFlowField(nav);
  computeFlowField(field, nav, centre(0, 2), 500); // source far left, ample radius

  test("a walled-off cell is never reached", () => {
    expect(flowCovers(field, centre(2, 0))).toBe(false); // inside the wall
  });

  test("a cell reachable only around the wall routes around it", () => {
    // (4,2) is directly across the wall; its path detours down through row 4.
    expect(flowCovers(field, centre(4, 2))).toBe(true);
    // Around-the-wall cost far exceeds the 4-cell straight-line Manhattan distance.
    expect(flowCostAt(field, centre(4, 2))).toBeGreaterThan(4 * nav.cellSize);
    // …and its flow heads DOWN toward the gap, not straight into the wall.
    expect(flowAt(field, centre(4, 2)).y).toBeGreaterThan(0);
  });
});

describe("computeFlowField — re-sweep reuse", () => {
  test("resets cells the previous flood reached but the new one doesn't", () => {
    const nav = grid();
    const field = createFlowField(nav);
    computeFlowField(field, nav, centre(2, 2), 100); // reaches everything
    expect(flowCovers(field, centre(4, 4))).toBe(true);
    computeFlowField(field, nav, centre(0, 0), 15); // small radius in the corner
    expect(flowCovers(field, centre(4, 4))).toBe(false); // stale cell cleared
    expect(flowCovers(field, centre(1, 0))).toBe(true); // new flood
  });
});
