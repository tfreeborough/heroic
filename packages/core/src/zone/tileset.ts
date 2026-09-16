/**
 * Tilesets & props — how zones get real artwork (docs/design/tilesets.md).
 *
 * A tileset is a named **atlas**: one image cut into a uniform grid of square
 * cells. Tile id `N` (N ≥ 1) is atlas cell `N − 1`, row-major; `0` is empty.
 * The id in the zone JSON *is* the address in the image — `tileSourceRect` is
 * the single place that rule lives, shared by every renderer.
 *
 * `ZoneFile.tileset` is a **name**, resolved per consumer (the audio-manifest
 * pattern): each game app maps name → bundled image, Realmsmith maps name →
 * dev-server URL, and this registry maps name → the atlas *geometry* + its
 * prop roster. An unknown name renders as the placeholder look and defines no
 * props — which is exactly how every pre-tileset zone (`"placeholder"`) keeps
 * working untouched.
 *
 * Scale rule: **1 atlas cell = 1 world tile** (`zone.tileSize` px). Sprites,
 * footprints, and tiles all scale together per zone; the art's own resolution
 * (`cellSize`) never leaks past the source rect.
 *
 * Pure data + math — no images, no renderer. The registry holds only geometry
 * and gameplay-relevant facts (footprints, occlusion), so core stays pure and
 * the Bun server collides against props without ever decoding a PNG.
 */
import type { Aabb } from "../physics/crowd";
import type { ZoneObject } from "./format";

/** Geometry of one atlas image. The image itself lives app-side, keyed by name. */
export interface TilesetDef {
  /** Cell size in the atlas image, px (the art's native tile resolution, e.g. 16). */
  cellSize: number;
  /** Cells per atlas row — with `tileCount` this fixes every id's source rect. */
  columns: number;
  /** Total cells (caps valid ids). */
  tileCount: number;
  /**
   * Atlas rows that hold paintable floor/decor tiles; rows below are prop art
   * (reached through `props`, not by id). Editors show only these in the tile
   * palette. Absent → every row is paintable.
   */
  tileRows?: number;
  /** Standing props this set defines, by name (`ZoneObject.props.prop` values). */
  props: Record<string, PropDef>;
}

/**
 * A standing prop: a multi-cell sprite with feet. Blocks movement at its base
 * (the hidden `footprint`) while its upper region draws over a player standing
 * behind it — renderers y-sort props with entities by baseline (bottom) y.
 */
export interface PropDef {
  /** Source region in the atlas, in cells: [col, row, cols, rows]. */
  cells: [number, number, number, number];
  /**
   * Hidden collision footprint in *cells* (floats fine), anchored to the
   * sprite's bottom-centre — covers the base only (trunk, boulder bottom); the
   * sprite's upper region has no collision, which is what makes walk-behind
   * read correctly. Scaled by `zone.tileSize` like the sprite. Absent → purely
   * visual (walk-through grass).
   */
  footprint?: { w: number; h: number };
  /** Footprint also blocks sight/projectiles/targeting (a boulder does; a
   *  cactus doesn't). Only meaningful with a footprint. Default false. */
  occludes?: boolean;
}

/** Source rect (atlas px) for a tile id, or null for empty/out-of-range ids. */
export const tileSourceRect = (
  def: TilesetDef,
  id: number,
): { x: number; y: number; w: number; h: number } | null => {
  if (!Number.isInteger(id) || id < 1 || id > def.tileCount) return null;
  const cell = id - 1;
  return {
    x: (cell % def.columns) * def.cellSize,
    y: Math.floor(cell / def.columns) * def.cellSize,
    w: def.cellSize,
    h: def.cellSize,
  };
};

/** Source rect (atlas px) for a prop's whole sprite region. */
export const propSourceRect = (
  def: TilesetDef,
  prop: PropDef,
): { x: number; y: number; w: number; h: number } => ({
  x: prop.cells[0] * def.cellSize,
  y: prop.cells[1] * def.cellSize,
  w: prop.cells[2] * def.cellSize,
  h: prop.cells[3] * def.cellSize,
});

/**
 * A placed prop resolved for runtime: everything a renderer needs to draw and
 * sort it, plus what the loader already folded into collision. `x/y` is the
 * authored bottom-centre — feet, sort baseline, and footprint anchor at once.
 */
export interface PlacedProp {
  id: string;
  /** `PropDef` key within the zone's tileset. */
  prop: string;
  /** Bottom-centre, world px. Sort key for the y-sorted entity pass. */
  x: number;
  y: number;
  /** Sprite source rect in the atlas, px. */
  src: { x: number; y: number; w: number; h: number };
  /** Sprite draw size, world px (cells × tileSize). Draw at (x − w/2, y − h). */
  w: number;
  h: number;
  /** The hidden collision footprint (centre + size, world px); absent → walk-through.
   *  Already folded into `zone.collision` by the loader — carried here so editors
   *  can draw it and renderers never have to re-derive it. */
  foot?: Aabb;
  /** Whether `foot` also blocks sight (mirrors `PropDef.occludes`). */
  occludes: boolean;
}

/** Resolve a `"prop"` zone object against its tileset, or null if unknown —
 *  unknown tileset/prop degrades to "not there", the placeholder philosophy. */
export const resolveProp = (
  obj: ZoneObject,
  tileset: TilesetDef | undefined,
  tileSize: number,
): PlacedProp | null => {
  const key = typeof obj.props.prop === "string" ? obj.props.prop : "";
  const def = tileset?.props[key];
  if (!def) return null;
  const foot = def.footprint
    ? {
        x: obj.x,
        y: obj.y - (def.footprint.h * tileSize) / 2,
        w: def.footprint.w * tileSize,
        h: def.footprint.h * tileSize,
      }
    : undefined;
  return {
    id: obj.id,
    prop: key,
    x: obj.x,
    y: obj.y,
    src: propSourceRect(tileset!, def),
    w: def.cells[2] * tileSize,
    h: def.cells[3] * tileSize,
    ...(foot ? { foot } : {}),
    occludes: (def.occludes ?? false) && foot !== undefined,
  };
};

// ────────────────────────────── The registry ──────────────────────────────

const CACTUS_FOOT = { w: 1.25, h: 1 };
const TREE_FOOT = { w: 1.25, h: 1 };

/**
 * Every tileset the games know, by the name zones store. Desert is the first
 * (16px pack repacked by `scripts/repack-tileset.py`: ground sheet rows 0–27,
 * wall sheet rows 28–33, props sheet rows 34–52 — see the script's report for
 * the cell map). Wall tiles are *paintable* (inside `tileRows`): they're
 * Pokémon-style visual height for floor/decor, not blocking geometry — real
 * walls stay the collision tools.
 */
export const TILESETS: Record<string, TilesetDef> = {
  desert: {
    cellSize: 16,
    columns: 23,
    tileCount: 23 * 53,
    tileRows: 34, // ground + wall sheets; rows 34–52 are the props sheet
    props: {
      // Cacti — cover for your body, not your target-lock (no occlusion).
      "cactus-large": { cells: [12, 34, 3, 5], footprint: CACTUS_FOOT },
      "cactus-a": { cells: [6, 35, 2, 4], footprint: CACTUS_FOOT },
      "cactus-b": { cells: [8, 35, 2, 4], footprint: CACTUS_FOOT },
      "cactus-small-a": { cells: [0, 36, 2, 3], footprint: CACTUS_FOOT },
      "cactus-small-b": { cells: [2, 36, 2, 3], footprint: CACTUS_FOOT },
      "cactus-small-c": { cells: [4, 36, 2, 3], footprint: CACTUS_FOOT },
      "cactus-small-d": { cells: [10, 36, 2, 3], footprint: CACTUS_FOOT },
      // Trees.
      "tree-a": { cells: [0, 39, 4, 5], footprint: TREE_FOOT },
      "tree-b": { cells: [4, 39, 4, 5], footprint: TREE_FOOT },
      "tree-c": { cells: [8, 39, 4, 5], footprint: TREE_FOOT },
      "tree-small": { cells: [12, 40, 3, 4], footprint: TREE_FOOT },
      // Rocks — solid stone: these DO break sight/targeting, like the pillar.
      "rock-pillar": { cells: [0, 45, 2, 3], footprint: { w: 1.5, h: 1 }, occludes: true },
      "rock-hoodoo": { cells: [3, 45, 2, 3], footprint: { w: 1.25, h: 1 }, occludes: true },
      "rock-spire": { cells: [6, 44, 2, 4], footprint: { w: 1.5, h: 1 }, occludes: true },
      "rock-boulder": { cells: [8, 45, 3, 3], footprint: { w: 2.5, h: 2.25 }, occludes: true },
      "rock-pile": { cells: [12, 45, 3, 3], footprint: { w: 2.5, h: 2.25 }, occludes: true },
      // Ground dressing — walk-through, no footprint. (These live as props, not
      // decor tiles, because the pack draws them across cell boundaries.)
      "tuft-a": { cells: [0, 49, 2, 2] },
      "tuft-b": { cells: [2, 49, 2, 2] },
      "tuft-c": { cells: [4, 49, 2, 2] },
      "tuft-d": { cells: [6, 49, 2, 2] },
      "pebble-a": { cells: [8, 49, 2, 2] },
      "pebble-b": { cells: [10, 49, 2, 2] },
      "rocks-small-a": { cells: [12, 49, 3, 2] },
      "tuft-e": { cells: [0, 51, 2, 2] },
      "tuft-f": { cells: [2, 51, 2, 2] },
      "tuft-g": { cells: [4, 51, 2, 2] },
      "tuft-h": { cells: [6, 51, 2, 2] },
      "pebble-c": { cells: [8, 51, 2, 2] },
      "pebble-d": { cells: [10, 51, 2, 2] },
      "rocks-small-b": { cells: [12, 51, 3, 2] },
    },
  },
  /**
   * "Ancient Ruins" pack, 32px. Repacked: terrain sheet rows 0–46 (grass tones,
   * transitions, stone ground), wall-9 sheet rows 47–72 (the arched parapet;
   * painted by its terrain brush, faces included), props sheet rows 73–123.
   * Terrain brushes live editor-side (apps/realmsmith/src/terrains/ancient.ts).
   */
  ancient: {
    cellSize: 32,
    columns: 50,
    tileCount: 50 * 124,
    // No tileRows: the props sheet's small dressing (tufts, flowers, pebbles,
    // rows 73–82) is 1×1 art that paints best as decor TILES, so the whole
    // atlas stays in the palette; standing art still goes through `props`.
    props: {
      // Foliage clumps that cross cell boundaries — walk-through props.
      "grass-clump-a": { cells: [17, 76, 3, 1] },
      "grass-clump-b": { cells: [17, 77, 3, 2] },
      "grass-clump-c": { cells: [17, 79, 3, 1] },
      "grass-tuft-a": { cells: [20, 76, 2, 1] },
      "grass-tuft-b": { cells: [20, 77, 2, 1] },
      "grass-tuft-c": { cells: [20, 78, 2, 1] },
      "grass-tuft-d": { cells: [20, 79, 2, 1] },
      "grass-tuft-e": { cells: [20, 80, 2, 1] },
      "grass-tuft-f": { cells: [20, 81, 2, 1] },
      "fern-blue-a": { cells: [34, 77, 2, 2] },
      "fern-blue-b": { cells: [36, 77, 2, 2] },
      "fern-blue-c": { cells: [38, 77, 2, 2] },
      "fern-green-a": { cells: [34, 79, 2, 2] },
      "fern-green-b": { cells: [36, 79, 2, 2] },
      "fern-green-c": { cells: [38, 79, 2, 2] },
      "fern-green-d": { cells: [40, 79, 2, 2] },
      "fern-teal-a": { cells: [34, 81, 2, 2] },
      "fern-teal-b": { cells: [36, 81, 2, 2] },
      "fern-teal-c": { cells: [38, 81, 2, 2] },
      "sapling-a": { cells: [24, 82, 2, 3] },
      "sapling-b": { cells: [27, 82, 2, 3] },
      "sapling-c": { cells: [30, 82, 2, 3] },
      "bush-e": { cells: [26, 80, 2, 2] },
      "bush-f": { cells: [28, 80, 2, 2] },
      "bush-g": { cells: [30, 80, 2, 2] },
      "bush-h": { cells: [32, 80, 2, 2] },
      // Trees — cover for your body, not your target-lock.
      "tree-gold-a": { cells: [0, 82, 4, 6], footprint: TREE_FOOT },
      "tree-gold-b": { cells: [4, 82, 4, 6], footprint: TREE_FOOT },
      "tree-gold-c": { cells: [8, 82, 4, 6], footprint: TREE_FOOT },
      "tree-olive-a": { cells: [0, 88, 4, 6], footprint: TREE_FOOT },
      "tree-olive-b": { cells: [4, 88, 4, 6], footprint: TREE_FOOT },
      "birch-gold": { cells: [0, 94, 4, 5], footprint: TREE_FOOT },
      "birch-red-a": { cells: [22, 94, 4, 5], footprint: TREE_FOOT },
      "birch-red-b": { cells: [29, 94, 4, 5], footprint: TREE_FOOT },
      "tree-dead-a": { cells: [33, 94, 3, 5], footprint: TREE_FOOT },
      "tree-dead-b": { cells: [40, 94, 4, 5], footprint: TREE_FOOT },
      "tree-dead-pale-a": { cells: [33, 99, 3, 5], footprint: TREE_FOOT },
      "tree-dead-pale-b": { cells: [40, 99, 4, 5], footprint: TREE_FOOT },
      // Bushes — walk-through dressing.
      "bush-a": { cells: [26, 78, 2, 2] },
      "bush-b": { cells: [28, 78, 2, 2] },
      "bush-c": { cells: [30, 78, 2, 2] },
      "bush-d": { cells: [32, 78, 2, 2] },
      // Rocks — solid stone, break sight.
      "rock-a": { cells: [27, 99, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "rock-b": { cells: [29, 99, 4, 2], footprint: { w: 3, h: 1 }, occludes: true },
      "rock-c": { cells: [27, 101, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "rock-d": { cells: [29, 101, 4, 2], footprint: { w: 3, h: 1 }, occludes: true },
      "rock-e": { cells: [27, 103, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "rock-f": { cells: [29, 103, 4, 2], footprint: { w: 3, h: 1 }, occludes: true },
      "spire-a": { cells: [27, 106, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "spire-b": { cells: [29, 106, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "spire-c": { cells: [31, 106, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "spire-d": { cells: [33, 106, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "spire-e": { cells: [27, 108, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "spire-f": { cells: [29, 108, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      // Ruins — statues, broken walls, pedestals, altars: all solid stone.
      "statue-warrior-a": { cells: [0, 115, 3, 4], footprint: { w: 1.5, h: 1 }, occludes: true },
      "statue-warrior-b": { cells: [3, 115, 3, 4], footprint: { w: 1.5, h: 1 }, occludes: true },
      "statue-warrior-c": { cells: [0, 119, 3, 4], footprint: { w: 1.5, h: 1 }, occludes: true },
      "ruin-wall-a": { cells: [0, 109, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-b": { cells: [2, 109, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-c": { cells: [4, 109, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-d": { cells: [6, 109, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-e": { cells: [0, 112, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-f": { cells: [2, 112, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-g": { cells: [4, 112, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "ruin-wall-h": { cells: [6, 112, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "altar-a": { cells: [0, 104, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "altar-b": { cells: [6, 104, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "altar-c": { cells: [14, 104, 2, 3], footprint: { w: 2, h: 1 }, occludes: true },
      "sarcophagus-a": { cells: [0, 107, 2, 2], footprint: { w: 2, h: 1 }, occludes: true },
      "sarcophagus-b": { cells: [2, 107, 2, 2], footprint: { w: 2, h: 1 }, occludes: true },
      "sarcophagus-c": { cells: [4, 107, 2, 2], footprint: { w: 2, h: 1 }, occludes: true },
      "pedestal-a": { cells: [16, 109, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "pedestal-b": { cells: [18, 109, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "pedestal-c": { cells: [20, 109, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "pedestal-d": { cells: [22, 109, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      "pedestal-e": { cells: [24, 109, 2, 2], footprint: { w: 1.5, h: 1 }, occludes: true },
      // Low walls — waist-high: block feet, not sight.
      "low-wall-a": { cells: [10, 114, 3, 2], footprint: { w: 3, h: 1 } },
      "low-wall-b": { cells: [13, 114, 3, 2], footprint: { w: 3, h: 1 } },
      "low-wall-c": { cells: [16, 114, 3, 2], footprint: { w: 3, h: 1 } },
      "low-wall-d": { cells: [10, 117, 3, 2], footprint: { w: 3, h: 1 } },
      "low-wall-e": { cells: [13, 117, 3, 2], footprint: { w: 3, h: 1 } },
      "low-wall-f": { cells: [16, 117, 3, 2], footprint: { w: 3, h: 1 } },
      "low-wall-long": { cells: [21, 117, 4, 2], footprint: { w: 4, h: 1 } },
      "stump-a": { cells: [20, 113, 2, 2], footprint: { w: 1, h: 0.75 } },
      "urn": { cells: [23, 113, 2, 2], footprint: { w: 1, h: 0.75 } },
      "stump-b": { cells: [25, 113, 2, 2], footprint: { w: 1, h: 0.75 } },
    },
  },
};
