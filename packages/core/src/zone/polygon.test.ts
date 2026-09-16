import { describe, expect, test } from "bun:test";
import { pointInPolygon, rasterizePolygon } from "./polygon";
import { loadZone } from "./load";
import { ZONE_FORMAT_VERSION, type ZoneFile } from "./format";

const inBox = (b: { x: number; y: number; w: number; h: number }, px: number, py: number): boolean =>
  Math.abs(px - b.x) <= b.w / 2 && Math.abs(py - b.y) <= b.h / 2;
const covered = (boxes: ReturnType<typeof rasterizePolygon>, px: number, py: number): boolean =>
  boxes.some((b) => inBox(b, px, py));

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  test("inside / outside / concave", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
    // An L: the notch (top-right) is outside.
    const ell = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 8, y: 2 }, ell)).toBe(false);
    expect(pointInPolygon({ x: 8, y: 8 }, ell)).toBe(true);
    expect(pointInPolygon({ x: 2, y: 2 }, ell)).toBe(true);
  });
});

describe("rasterizePolygon", () => {
  test("a cell-aligned rectangle meshes to exactly one box", () => {
    const boxes = rasterizePolygon(
      [
        { x: 32, y: 32 },
        { x: 96, y: 32 },
        { x: 96, y: 64 },
        { x: 32, y: 64 },
      ],
      32,
      10,
      10,
    );
    expect(boxes).toEqual([{ x: 64, y: 48, w: 64, h: 32 }]);
  });

  test("a triangle becomes a staircase that covers its inside and not its outside", () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 128, y: 0 },
      { x: 0, y: 128 },
    ];
    const boxes = rasterizePolygon(tri, 16, 8, 8);
    expect(boxes.length).toBeGreaterThan(1);
    expect(covered(boxes, 20, 20)).toBe(true); // deep inside
    expect(covered(boxes, 110, 110)).toBe(false); // far outside the hypotenuse
    // Every box centre is inside the polygon — strips never spill past the outline by more than a cell.
    for (const b of boxes) expect(pointInPolygon({ x: b.x, y: b.y }, tri)).toBe(true);
  });

  test("clips to the grid and ignores degenerate input", () => {
    const off = rasterizePolygon(
      [
        { x: -100, y: -100 },
        { x: -50, y: -100 },
        { x: -50, y: -50 },
      ],
      16,
      8,
      8,
    );
    expect(off).toEqual([]);
    const spill = rasterizePolygon(
      [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 400, y: 400 },
        { x: 100, y: 400 },
      ],
      16,
      8,
      8,
    );
    for (const b of spill) {
      expect(b.x + b.w / 2).toBeLessThanOrEqual(128);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(128);
    }
    expect(rasterizePolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }], 16, 8, 8)).toEqual([]);
  });
});

describe("loadZone polygons", () => {
  test("a hidden polygon lands in the hidden + collision channels, never walls", () => {
    const cols = 4;
    const rows = 4;
    const file: ZoneFile = {
      format: ZONE_FORMAT_VERSION,
      id: "t",
      name: "t",
      band: 1,
      size: { cols, rows },
      tileSize: 64,
      chunkTiles: 4,
      tileset: "placeholder",
      layers: { floor: Array.from({ length: rows }, () => new Array<number>(cols).fill(1)) },
      collision: {
        rects: [],
        polys: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 128, y: 0 },
              { x: 0, y: 128 },
            ],
          },
        ],
      },
      breakables: [],
      objects: [],
    } as unknown as ZoneFile;
    const zone = loadZone(file);
    expect(zone.walls).toEqual([]);
    expect(zone.hidden.length).toBeGreaterThan(0);
    // Half-tile resolution: the staircase steps are 32px on a 64px tile.
    expect(zone.hidden.every((b) => b.h % 32 === 0 && b.w % 32 === 0)).toBe(true);
    expect(zone.collision).toEqual(expect.arrayContaining(zone.hidden));
  });
});
