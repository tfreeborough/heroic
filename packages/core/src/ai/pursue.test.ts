import { describe, expect, test } from "bun:test";
import { buildNavGrid } from "../pathfinding/navgrid";
import { distance, type Vec2 } from "../math/vec2";
import { initPathState, pursue } from "./pursue";

const DT = 1 / 60;

describe("pursue", () => {
  test("heads straight at the goal when there's nothing in the way", () => {
    const nav = buildNavGrid(600, 40, [], 10);
    const v = pursue({ x: 0, y: 300 }, { x: 200, y: 300 }, 50, nav, initPathState(), DT);
    expect(v.x).toBeGreaterThan(0);
    expect(Math.abs(v.y)).toBeLessThan(1e-6);
  });

  test("routes around a wall to reach a goal a straight line can't", () => {
    // A vertical wall across the middle (world y 100..500), leaving gaps top/bottom.
    const nav = buildNavGrid(600, 40, [{ x: 300, y: 300, w: 80, h: 400 }], 12);
    const goal: Vec2 = { x: 500, y: 300 };
    const path = initPathState();
    let self: Vec2 = { x: 100, y: 300 };

    let detoured = false;
    let steps = 0;
    for (; steps < 2000; steps++) {
      const v = pursue(self, goal, 200, nav, path, DT);
      self = { x: self.x + v.x * DT, y: self.y + v.y * DT };
      if (Math.abs(self.y - 300) > 60) detoured = true; // left the straight line
      if (distance(self, goal) < nav.cellSize) break;
    }

    expect(distance(self, goal)).toBeLessThan(nav.cellSize); // arrived
    expect(detoured).toBe(true); // by going around, not through
    expect(steps).toBeLessThan(2000); // didn't get stuck
  });
});
