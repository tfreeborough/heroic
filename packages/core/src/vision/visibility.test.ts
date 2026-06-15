import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../math/vec2";
import { computeVisibility, rectEdges, segmentClear, type VisionSegment } from "./visibility";

/** A 1000×1000 room: rays cast at open angles terminate on these walls. */
const room: VisionSegment[] = [
  { ax: 0, ay: 0, bx: 1000, by: 0 },
  { ax: 1000, ay: 0, bx: 1000, by: 1000 },
  { ax: 1000, ay: 1000, bx: 0, by: 1000 },
  { ax: 0, ay: 1000, bx: 0, by: 0 },
];

/** Standard ray-cast point-in-polygon, so tests assert on "is this lit". */
const inside = (p: Vec2, poly: Vec2[]): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

describe("segmentClear", () => {
  const pillar = rectEdges(500, 500, 100, 100); // centred block

  test("an unobstructed line is clear", () => {
    expect(segmentClear({ x: 100, y: 100 }, { x: 100, y: 900 }, pillar)).toBe(true);
  });

  test("a line through a wall is blocked", () => {
    // Left of the pillar to right of it, straight through its middle.
    expect(segmentClear({ x: 300, y: 500 }, { x: 700, y: 500 }, pillar)).toBe(false);
  });

  test("a line that ends before the wall is clear", () => {
    expect(segmentClear({ x: 100, y: 500 }, { x: 300, y: 500 }, pillar)).toBe(true);
  });
});

describe("computeVisibility", () => {
  test("an empty room is fully visible from its centre", () => {
    const poly = computeVisibility({ x: 500, y: 500 }, room);
    expect(poly.length).toBeGreaterThanOrEqual(4);
    // Points anywhere in the room are lit; the polygon hugs the four walls.
    expect(inside({ x: 100, y: 100 }, poly)).toBe(true);
    expect(inside({ x: 900, y: 900 }, poly)).toBe(true);
  });

  test("a pillar casts a blind spot behind it", () => {
    const occluders = [...room, ...rectEdges(500, 500, 80, 80)];
    // Observer on the left; the pillar sits between it and the right wall.
    const poly = computeVisibility({ x: 150, y: 500 }, occluders);
    // Directly behind the pillar (further right, same row) is hidden...
    expect(inside({ x: 800, y: 500 }, poly)).toBe(false);
    // ...but a clear sightline above the pillar is still lit.
    expect(inside({ x: 800, y: 150 }, poly)).toBe(true);
  });
});
