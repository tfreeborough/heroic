import { describe, expect, test } from "bun:test";
import { hitsInArc, type HurtBox, type HurtCircle } from "./hitbox";

const ORIGIN = { x: 0, y: 0 };
const REACH = 100;
const ARC = Math.PI / 2; // 90° cone

const circle = (id: number, x: number, y: number, radius = 10): HurtCircle => ({
  id,
  pos: { x, y },
  radius,
});

const box = (id: number, x: number, y: number, w = 40, h = 40): HurtBox => ({
  id,
  box: { x, y, w, h },
});

describe("hitsInArc", () => {
  test("hits a target dead ahead within reach", () => {
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 80, 0)])).toEqual([1]);
  });

  test("misses behind and beyond reach", () => {
    const targets = [circle(1, -80, 0), circle(2, 200, 0)];
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, targets)).toEqual([]);
  });

  test("range is measured to the target's edge", () => {
    // Centre at 109, radius 10 → edge at 99, inside reach 100.
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 109, 0)])).toEqual([1]);
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 111, 0)])).toEqual([]);
  });

  test("respects the cone half-angle", () => {
    // 45° off facing is exactly the 90°-arc edge; 50° is out.
    const onEdge = circle(1, Math.cos(Math.PI / 4) * 50, Math.sin(Math.PI / 4) * 50);
    const outside = circle(2, Math.cos(0.9) * 50, Math.sin(0.9) * 50);
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [onEdge, outside])).toEqual([1]);
  });

  test("handles the ±π facing wrap", () => {
    // Facing -x (π); a target at (-80, slightly +y) sits near angle -π.
    const target = circle(1, -80, 5);
    expect(hitsInArc(ORIGIN, Math.PI, REACH, ARC, [target])).toEqual([1]);
  });

  test("cleaves every target inside the cone", () => {
    const targets = [circle(1, 60, 10), circle(2, 70, -15), circle(3, 60, 90)];
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, targets)).toEqual([1, 2]);
  });

  test("hits a box dead ahead, range to its nearest face", () => {
    // Centre 80, half-width 20 → near face at x=60, well inside reach.
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [box(1, 80, 0)])).toEqual([1]);
    // Near face at x=99 hits; at x=101 it's out of reach.
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [box(1, 119, 0)])).toEqual([1]);
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [box(1, 121, 0)])).toEqual([]);
  });

  test("misses a box off to the side of the cone", () => {
    // Centred above the origin: nearest point (0,60) sits at 90° off a 0 facing.
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [box(1, 0, 80)])).toEqual([]);
  });

  test("a box the origin stands inside is an unambiguous hit, any facing", () => {
    expect(hitsInArc(ORIGIN, Math.PI, REACH, ARC, [box(1, 0, 0)])).toEqual([1]);
  });

  test("cleaves circles and boxes together", () => {
    expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 60, 10), box(2, 70, -10)])).toEqual([1, 2]);
  });

  describe("minReach (the floating band)", () => {
    const MIN = 50;

    test("a body inside the dead zone is untouchable", () => {
      // Centre 30, radius 10 → far edge at 40, short of the band at 50.
      expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 30, 0)], MIN)).toEqual([]);
    });

    test("any overlap with the band counts, both edges", () => {
      // Far edge exactly reaches the inner edge (41 + 10 > 50) → hit.
      expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 41, 0)], MIN)).toEqual([1]);
      // Straddling the outer edge still hits (the original edge rule).
      expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 109, 0)], MIN)).toEqual([1]);
    });

    test("minReach 0 is the classic full cone", () => {
      expect(hitsInArc(ORIGIN, 0, REACH, ARC, [circle(1, 30, 0)], 0)).toEqual([1]);
    });

    test("a box fully inside the dead zone is untouchable", () => {
      // Centre 20, 40×40 → farthest corner at hypot(40, 20) ≈ 44.7, short of 50.
      expect(hitsInArc(ORIGIN, 0, REACH, ARC, [box(1, 20, 0)], MIN)).toEqual([]);
      // Centre 40 → farthest corner ≈ 63.2, overlapping the band → hit.
      expect(hitsInArc(ORIGIN, 0, REACH, ARC, [box(1, 40, 0)], MIN)).toEqual([1]);
    });
  });
});
