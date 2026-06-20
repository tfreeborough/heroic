import { describe, expect, test } from "bun:test";
import { loadZone } from "./load";
import { ZONE_FORMAT_VERSION, type ZoneFile } from "./format";

/** A valid 4×4-tile zone (tileSize 10, chunkTiles 2 → a 2×2 grid of chunks). */
const makeFile = (overrides: Partial<ZoneFile> = {}): ZoneFile => ({
  format: ZONE_FORMAT_VERSION,
  id: "test-zone",
  name: "Test Zone",
  band: 1,
  size: { cols: 4, rows: 4 },
  tileSize: 10,
  chunkTiles: 2,
  tileset: "tiles.png",
  layers: {
    floor: [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ],
  },
  collision: { rects: [] },
  breakables: [],
  objects: [],
  ...overrides,
});

describe("loadZone", () => {
  test("rejects an unknown format version", () => {
    expect(() => loadZone(makeFile({ format: 99 }))).toThrow();
  });

  test("rejects a floor layer whose row count disagrees with size", () => {
    expect(() => loadZone(makeFile({ layers: { floor: [[1, 2, 3, 4]] } }))).toThrow();
  });

  test("derives world size, chunk grid, and chunk-side px", () => {
    const zone = loadZone(makeFile());
    expect(zone.size).toEqual({ x: 40, y: 40 }); // 4 tiles × 10 px
    expect(zone.chunkCols).toBe(2);
    expect(zone.chunkRows).toBe(2);
    expect(zone.chunkSize).toBe(20); // chunkTiles 2 × tileSize 10
    expect(zone.chunks).toHaveLength(4);
  });

  test("slices the floor into row-major chunks of chunkTiles² tile ids", () => {
    const zone = loadZone(makeFile());
    // chunks[cy * chunkCols + cx]; top-left chunk = cols 0..1, rows 0..1.
    expect(Array.from(zone.chunks[0]!.floor)).toEqual([1, 2, 5, 6]);
    expect(Array.from(zone.chunks[1]!.floor)).toEqual([3, 4, 7, 8]); // top-right
    expect(Array.from(zone.chunks[2]!.floor)).toEqual([9, 10, 13, 14]); // bottom-left
    expect(Array.from(zone.chunks[3]!.floor)).toEqual([11, 12, 15, 16]); // bottom-right
    expect(zone.chunks[0]!.floor).toBeInstanceOf(Uint16Array);
    expect(zone.chunks[0]!.decor).toBeNull(); // no decor layer authored
  });

  test("combines free rects with greedy-meshed painted cells into one collision list", () => {
    const zone = loadZone(
      makeFile({
        collision: {
          rects: [{ x: 100, y: 100, w: 20, h: 20 }],
          cells: [
            [0, 0, 0, 0],
            [0, 1, 1, 0], // a 2-wide run → one meshed rect
            [0, 0, 0, 0],
            [0, 0, 0, 0],
          ],
          cellSize: 10,
        },
      }),
    );
    expect(zone.collision).toEqual([
      { x: 100, y: 100, w: 20, h: 20 }, // the authored free rect, untouched
      { x: 20, y: 15, w: 20, h: 10 }, // cells (1,1)+(1,2) greedy-meshed
    ]);
  });

  test("painted cells default to tileSize when no cellSize is given", () => {
    const zone = loadZone(
      makeFile({ collision: { rects: [], cells: [[1]] } }), // 1 cell, default cellSize = tileSize 10
    );
    expect(zone.collision).toEqual([{ x: 5, y: 5, w: 10, h: 10 }]);
  });

  test("fences the void: floorless cells become solid collision (zone shape)", () => {
    // An L-shape: floor everywhere except the bottom-right 2×2 corner.
    const zone = loadZone(
      makeFile({
        layers: {
          floor: [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
            [1, 1, 0, 0],
            [1, 1, 0, 0],
          ],
        },
        collision: { rects: [] },
      }),
    );
    // The void corner greedy-meshes into one rect (cols 2..3 × rows 2..3, tile 10).
    expect(zone.collision).toEqual([{ x: 30, y: 30, w: 20, h: 20 }]);
  });

  test("fenceVoid: false leaves floorless cells open", () => {
    const zone = loadZone(
      makeFile({
        layers: {
          floor: [
            [1, 1, 1, 1],
            [1, 1, 1, 1],
            [1, 1, 0, 0],
            [1, 1, 0, 0],
          ],
        },
        collision: { rects: [] },
        fenceVoid: false,
      }),
    );
    expect(zone.collision).toEqual([]);
  });

  test("resolves spawn from the playerSpawn object, else the zone centre", () => {
    const withSpawn = loadZone(
      makeFile({
        objects: [{ id: "s", kind: "playerSpawn", x: 33, y: 44, props: {} }],
      }),
    );
    expect(withSpawn.spawn).toEqual({ x: 33, y: 44 });
    expect(loadZone(makeFile()).spawn).toEqual({ x: 20, y: 20 }); // centre of 40×40
  });

  test("turns breakable defs into live runtime breakables with defaults filled", () => {
    const zone = loadZone(
      makeFile({
        breakables: [
          {
            id: "barrel-1",
            kind: "barrel",
            box: { x: 50, y: 50, w: 8, h: 8 },
            maxHp: 30,
            onBreak: [{ type: "explode", radius: 40, damage: 10 }],
          },
          {
            id: "wall-1",
            kind: "wood-wall",
            box: { x: 80, y: 20, w: 40, h: 8 },
            maxHp: 60,
            occludes: true, // a wall blocks sight; no onBreak → just vanishes
          },
        ],
      }),
    );
    expect(zone.breakables[0]).toEqual({
      id: "barrel-1",
      kind: "barrel",
      box: { x: 50, y: 50, w: 8, h: 8 },
      hp: 30,
      maxHp: 30,
      occludes: false, // defaulted
      onBreak: [{ type: "explode", radius: 40, damage: 10 }],
      alive: true,
    });
    expect(zone.breakables[1]!.occludes).toBe(true);
    expect(zone.breakables[1]!.onBreak).toEqual([]); // defaulted
    expect(zone.breakables[1]!.alive).toBe(true);
  });

  test("slices a decor layer when present", () => {
    const zone = loadZone(
      makeFile({
        layers: {
          floor: makeFile().layers.floor,
          decor: [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 99],
          ],
        },
      }),
    );
    expect(zone.chunks[0]!.decor).toBeInstanceOf(Uint16Array);
    expect(Array.from(zone.chunks[3]!.decor!)).toEqual([0, 0, 0, 99]); // bottom-right corner = 99
  });
});
