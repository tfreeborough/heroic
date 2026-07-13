import { describe, expect, test } from "bun:test";
import { loadZone } from "./load";
import { ZONE_FORMAT_VERSION, type ZoneFile, type ZoneObject } from "./format";
import { TILESETS, propSourceRect, tileSourceRect, type TilesetDef } from "./tileset";

const SET: TilesetDef = {
  cellSize: 16,
  columns: 4,
  tileCount: 12, // 4×3 atlas
  props: {},
};

describe("tileSourceRect", () => {
  test("id N addresses cell N−1, row-major", () => {
    expect(tileSourceRect(SET, 1)).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    expect(tileSourceRect(SET, 4)).toEqual({ x: 48, y: 0, w: 16, h: 16 });
    expect(tileSourceRect(SET, 5)).toEqual({ x: 0, y: 16, w: 16, h: 16 }); // wraps to row 1
    expect(tileSourceRect(SET, 12)).toEqual({ x: 48, y: 32, w: 16, h: 16 });
  });

  test("empty and out-of-range ids resolve to null", () => {
    expect(tileSourceRect(SET, 0)).toBeNull();
    expect(tileSourceRect(SET, 13)).toBeNull();
    expect(tileSourceRect(SET, -1)).toBeNull();
    expect(tileSourceRect(SET, 1.5)).toBeNull();
  });
});

describe("desert registry", () => {
  const desert = TILESETS["desert"]!;

  test("every prop's sprite region lies inside the atlas", () => {
    const rows = desert.tileCount / desert.columns;
    for (const [name, def] of Object.entries(desert.props)) {
      const [col, row, cols, rws] = def.cells;
      expect(col + cols, name).toBeLessThanOrEqual(desert.columns);
      expect(row + rws, name).toBeLessThanOrEqual(rows);
    }
  });

  test("footprints fit within their sprite's width", () => {
    for (const [name, def] of Object.entries(desert.props)) {
      if (def.footprint) expect(def.footprint.w, name).toBeLessThanOrEqual(def.cells[2]);
    }
  });

  test("propSourceRect converts cells to atlas px", () => {
    const cactus = desert.props["cactus-large"]!;
    expect(propSourceRect(desert, cactus)).toEqual({ x: 192, y: 544, w: 48, h: 80 });
  });
});

// ── loadZone integration: props resolve, footprints join collision ──────────

const propObj = (id: string, prop: string, x: number, y: number): ZoneObject => ({
  id,
  kind: "prop",
  x,
  y,
  props: { prop },
});

const makeFile = (overrides: Partial<ZoneFile> = {}): ZoneFile => ({
  format: ZONE_FORMAT_VERSION,
  id: "prop-zone",
  name: "Prop Zone",
  band: 1,
  size: { cols: 8, rows: 8 },
  tileSize: 64,
  chunkTiles: 4,
  tileset: "desert",
  layers: { floor: Array.from({ length: 8 }, () => new Array(8).fill(1)) },
  collision: { rects: [] },
  breakables: [],
  objects: [],
  ...overrides,
});

describe("loadZone props", () => {
  test("a placed prop resolves with sprite rect, world size, and baseline anchor", () => {
    const zone = loadZone(makeFile({ objects: [propObj("c1", "cactus-large", 256, 256)] }));
    expect(zone.props).toHaveLength(1);
    const p = zone.props[0]!;
    // 3×5 cells at tileSize 64 → 192×320 world px, anchored bottom-centre.
    expect({ w: p.w, h: p.h, x: p.x, y: p.y }).toEqual({ w: 192, h: 320, x: 256, y: 256 });
    expect(p.src).toEqual({ x: 192, y: 544, w: 48, h: 80 });
  });

  test("footprint joins movement collision but never walls; cactus does not occlude", () => {
    const zone = loadZone(makeFile({ objects: [propObj("c1", "cactus-large", 256, 256)] }));
    // Derive from the registry (footprints are gameplay-tuned): w×h cells at
    // 64px, centred above the feet.
    const fp = TILESETS["desert"]!.props["cactus-large"]!.footprint!;
    const foot = { x: 256, y: 256 - (fp.h * 64) / 2, w: fp.w * 64, h: fp.h * 64 };
    expect(zone.collision).toContainEqual(foot);
    expect(zone.walls).not.toContainEqual(foot);
    expect(zone.propOccluders).toHaveLength(0);
  });

  test("an occluding rock's footprint lands in propOccluders too", () => {
    const zone = loadZone(makeFile({ objects: [propObj("r1", "rock-boulder", 128, 128)] }));
    expect(zone.propOccluders).toHaveLength(1);
    expect(zone.collision).toContainEqual(zone.propOccluders[0]!);
  });

  test("a walk-through tuft draws but adds no collision", () => {
    const base = makeFile();
    const withTuft = loadZone(makeFile({ objects: [propObj("t1", "tuft-a", 100, 100)] }));
    expect(withTuft.props).toHaveLength(1);
    expect(withTuft.collision).toEqual(loadZone(base).collision);
  });

  test("hidden collision blocks movement but is neither drawn geometry nor an occluder", () => {
    const zone = loadZone(
      makeFile({
        collision: {
          rects: [{ x: 100, y: 100, w: 64, h: 64, material: "hidden" }],
          cells: [
            [0, 3, 3],
            [0, 0, 0],
          ],
          cellSize: 64,
        },
      }),
    );
    // The free rect and the meshed pair of painted cells both land in `hidden`…
    expect(zone.hidden).toEqual([
      { x: 100, y: 100, w: 64, h: 64 },
      { x: 128, y: 32, w: 128, h: 64 },
    ]);
    // …and in movement collision, but never in the drawn/occluding walls or the
    // mist-pit voids.
    for (const h of zone.hidden) {
      expect(zone.collision).toContainEqual(h);
      expect(zone.walls).not.toContainEqual(h);
      expect(zone.voids).not.toContainEqual(h);
    }
  });

  test("unknown tileset or prop name degrades to nothing (placeholder philosophy)", () => {
    const unknownSet = loadZone(
      makeFile({ tileset: "placeholder", objects: [propObj("c1", "cactus-large", 256, 256)] }),
    );
    expect(unknownSet.props).toHaveLength(0);
    const unknownProp = loadZone(makeFile({ objects: [propObj("x", "no-such-prop", 256, 256)] }));
    expect(unknownProp.props).toHaveLength(0);
    expect(unknownProp.collision).toEqual(loadZone(makeFile()).collision);
  });
});
