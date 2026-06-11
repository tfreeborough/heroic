import { describe, expect, test } from "bun:test";
import { selectTarget, type TargetCandidate } from "./targeting";

const ORIGIN = { x: 0, y: 0 };
const ENGAGEMENT = 100;

const at = (id: number, x: number, y = 0): TargetCandidate => ({ id, pos: { x, y } });

describe("selectTarget", () => {
  test("returns null with nothing in the engagement radius", () => {
    expect(selectTarget([], ORIGIN, ENGAGEMENT, null)).toBeNull();
    expect(selectTarget([at(1, 150)], ORIGIN, ENGAGEMENT, null)).toBeNull();
  });

  test("picks the nearest hostile when untargeted", () => {
    expect(selectTarget([at(1, 80), at(2, 40), at(3, 60)], ORIGIN, ENGAGEMENT, null)).toBe(2);
  });

  test("keeps the current target against a marginally closer challenger", () => {
    // 86 vs 90 is only ~4% closer — inside the 15% hysteresis band.
    expect(selectTarget([at(1, 90), at(2, 86)], ORIGIN, ENGAGEMENT, 1)).toBe(1);
  });

  test("switches when a challenger is meaningfully closer", () => {
    expect(selectTarget([at(1, 90), at(2, 50)], ORIGIN, ENGAGEMENT, 1)).toBe(2);
  });

  test("switch threshold respects a custom hysteresis", () => {
    // 80 is 20% closer than 100: switches at 15% but not at 25%.
    expect(selectTarget([at(1, 100), at(2, 80)], ORIGIN, ENGAGEMENT, 1, 0.15)).toBe(2);
    expect(selectTarget([at(1, 100), at(2, 80)], ORIGIN, ENGAGEMENT, 1, 0.25)).toBe(1);
  });

  test("snaps to the nearest when the current target leaves the radius", () => {
    expect(selectTarget([at(1, 150), at(2, 95)], ORIGIN, ENGAGEMENT, 1)).toBe(2);
  });

  test("snaps to the nearest when the current target no longer exists", () => {
    expect(selectTarget([at(2, 95)], ORIGIN, ENGAGEMENT, 1)).toBe(2);
  });
});
