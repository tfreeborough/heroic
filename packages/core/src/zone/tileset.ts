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
};
