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
  /** Placed ON the ground (`props.ground: true`): baked with the floor, under
   *  every body, never y-sorted — a rug, rubble, a fallen log. Default false =
   *  a standing prop players walk behind. (Tom, 2026-09-18.) */
  ground: boolean;
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
    ground: obj.props.ground === true,
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
    //
    // NO FOOTPRINTS, by decision (2026-09-17): the pack's props are meant to
    // cluster (rocks against ruin walls, trees in copses) and a registry-wide
    // footprint kept them apart in the editor. Every ancient prop is
    // walk-through; the arena author paints hidden collision (¼-tile cells or
    // a polygon fence) under whatever should block. Sight occlusion goes with
    // it — BITS doesn't lean on it. Desert keeps its footprints: it's live.
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
      // Trees.
      "tree-gold-a": { cells: [0, 82, 4, 6] },
      "tree-gold-b": { cells: [4, 82, 4, 6] },
      "tree-gold-c": { cells: [8, 82, 4, 6] },
      "tree-olive-a": { cells: [0, 88, 4, 6] },
      "tree-olive-b": { cells: [4, 88, 4, 6] },
      "birch-gold": { cells: [0, 94, 4, 5] },
      "birch-red-a": { cells: [22, 94, 4, 5] },
      "birch-red-b": { cells: [29, 94, 4, 5] },
      "tree-dead-a": { cells: [33, 94, 3, 5] },
      "tree-dead-b": { cells: [40, 94, 4, 5] },
      "tree-dead-pale-a": { cells: [33, 99, 3, 5] },
      "tree-dead-pale-b": { cells: [40, 99, 4, 5] },
      // Bushes — walk-through dressing.
      "bush-a": { cells: [26, 78, 2, 2] },
      "bush-b": { cells: [28, 78, 2, 2] },
      "bush-c": { cells: [30, 78, 2, 2] },
      "bush-d": { cells: [32, 78, 2, 2] },
      // Rocks.
      "rock-a": { cells: [27, 99, 2, 2] },
      "rock-b": { cells: [29, 99, 4, 2] },
      "rock-c": { cells: [27, 101, 2, 2] },
      "rock-d": { cells: [29, 101, 4, 2] },
      "rock-e": { cells: [27, 103, 2, 2] },
      "rock-f": { cells: [29, 103, 4, 2] },
      "spire-a": { cells: [27, 106, 2, 2] },
      "spire-b": { cells: [29, 106, 2, 2] },
      "spire-c": { cells: [31, 106, 2, 2] },
      "spire-d": { cells: [33, 106, 2, 2] },
      "spire-e": { cells: [27, 108, 2, 2] },
      "spire-f": { cells: [29, 108, 2, 2] },
      // Ruins — statues, broken walls, pedestals, altars.
      "statue-warrior-a": { cells: [0, 115, 3, 4] },
      "statue-warrior-b": { cells: [3, 115, 3, 4] },
      "statue-warrior-c": { cells: [0, 119, 3, 4] },
      "ruin-wall-a": { cells: [0, 109, 2, 3] },
      "ruin-wall-b": { cells: [2, 109, 2, 3] },
      "ruin-wall-c": { cells: [4, 109, 2, 3] },
      "ruin-wall-d": { cells: [6, 109, 2, 3] },
      "ruin-wall-e": { cells: [0, 112, 2, 3] },
      "ruin-wall-f": { cells: [2, 112, 2, 3] },
      "ruin-wall-g": { cells: [4, 112, 2, 3] },
      "ruin-wall-h": { cells: [6, 112, 2, 3] },
      "altar-a": { cells: [0, 104, 2, 3] },
      "altar-b": { cells: [6, 104, 2, 3] },
      "altar-c": { cells: [14, 104, 2, 3] },
      "sarcophagus-a": { cells: [0, 107, 2, 2] },
      "sarcophagus-b": { cells: [2, 107, 2, 2] },
      "sarcophagus-c": { cells: [4, 107, 2, 2] },
      "pedestal-a": { cells: [16, 109, 2, 2] },
      "pedestal-b": { cells: [18, 109, 2, 2] },
      "pedestal-c": { cells: [20, 109, 2, 2] },
      "pedestal-d": { cells: [22, 109, 2, 2] },
      "pedestal-e": { cells: [24, 109, 2, 2] },
      // Low walls, stumps, urns.
      "low-wall-a": { cells: [10, 114, 3, 2] },
      "low-wall-b": { cells: [13, 114, 3, 2] },
      "low-wall-c": { cells: [16, 114, 3, 2] },
      "low-wall-d": { cells: [10, 117, 3, 2] },
      "low-wall-e": { cells: [13, 117, 3, 2] },
      "low-wall-f": { cells: [16, 117, 3, 2] },
      "low-wall-long": { cells: [21, 117, 4, 2] },
      "stump-a": { cells: [20, 113, 2, 2] },
      "urn": { cells: [23, 113, 2, 2] },
      "stump-b": { cells: [25, 113, 2, 2] },
    },
  },
  /**
   * "Epic RPG World — Desert" pack, 32px (same creator as ancient; named
   * `dunes` because `desert` is the live 16px pack under arena-00). Repacked by
   * `scripts/repack-tileset.py dunes`: terrain sheet rows 0–41 (sand, dirt,
   * grass, rocky/stone ground transitions, 1-tall cliff, platform, carpet),
   * the 2- and 3-tall cliff sheets side by side on rows 42–59 (cols 0–15 and
   * 16–31), props sheet rows 60–111, props2 (temple dressing) rows 112–136.
   * Terrain brushes: apps/realmsmith/src/terrains/dunes.ts.
   *
   * Props follow the ancient decision: NO footprints, walk-through, collision
   * painted by hand. Names are the pack's own sprite file names (kebab-cased)
   * so `props/props-sprites/<name>.png` in the raw pack is the reference; the
   * rects were located by exact pixel match, not by eye. 1×1 dressing (grass,
   * pebbles, bones, small vases) is left to the tile palette — no `tileRows`.
   */
  dunes: {
    cellSize: 32,
    columns: 42,
    tileCount: 42 * 137,
    props: {
      "cactus-0": { cells: [1, 60, 1, 2] },
      "cactus-1": { cells: [2, 60, 1, 2] },
      "cactus-2": { cells: [3, 60, 1, 2] },
      "cactus-3": { cells: [4, 60, 1, 2] },
      "cactus-4": { cells: [5, 60, 1, 2] },
      "cactus-13": { cells: [6, 61, 2, 2] },
      "cactus-10": { cells: [1, 63, 2, 2] },
      "cactus-11": { cells: [3, 63, 2, 2] },
      "cactus-12": { cells: [5, 63, 2, 2] },
      "bush-0": { cells: [9, 66, 2, 2] },
      "bush-1": { cells: [11, 66, 2, 2] },
      "dead-tree-fallen-1": { cells: [27, 67, 4, 3] },
      "bush-2": { cells: [10, 68, 2, 1] },
      "bush-3": { cells: [10, 69, 2, 1] },
      "dead-tree-fallen-2": { cells: [20, 69, 7, 4] },
      "plants1-1": { cells: [3, 71, 2, 1] },
      "plants1-0": { cells: [5, 71, 2, 1] },
      "plants2-1": { cells: [3, 72, 2, 1] },
      "plants2-0": { cells: [5, 72, 2, 1] },
      "plants3-1": { cells: [3, 73, 2, 1] },
      "plants3-0": { cells: [5, 73, 2, 1] },
      "palm-tree-1": { cells: [15, 73, 3, 5] },
      "palm-tree-2": { cells: [18, 73, 3, 6] },
      "runic-stone": { cells: [27, 73, 3, 5] },
      "plants4-1": { cells: [3, 74, 2, 1] },
      "plants4-0": { cells: [5, 74, 2, 1] },
      "palm-trunk": { cells: [21, 74, 2, 5] },
      "plants5-0": { cells: [5, 75, 2, 1] },
      "big-rocks-1": { cells: [0, 76, 2, 2] },
      "big-rocks-2": { cells: [2, 76, 2, 2] },
      "big-rocks-3": { cells: [4, 76, 2, 2] },
      "big-rocks-4": { cells: [6, 76, 3, 3] },
      "big-rocks-5": { cells: [9, 77, 2, 2] },
      "cracked-pit": { cells: [23, 78, 8, 6] },
      "big-rocks-6": { cells: [6, 79, 3, 3] },
      "cave-entrance-2": { cells: [9, 79, 6, 3] },
      "big-rocks-nosand-1": { cells: [15, 81, 2, 2] },
      "big-rocks-nosand-2": { cells: [17, 81, 2, 2] },
      "big-rocks-nosand-3": { cells: [19, 81, 2, 2] },
      "big-rocks-7": { cells: [6, 82, 2, 2] },
      "big-rocks-8": { cells: [8, 82, 3, 2] },
      "big-rocks-11": { cells: [11, 82, 4, 3] },
      "big-rocks-nosand-4": { cells: [15, 83, 3, 3] },
      "big-rocks-nosand-5": { cells: [18, 83, 2, 2] },
      "big-rocks-nosand-6": { cells: [20, 83, 3, 3] },
      "big-rocks-9": { cells: [6, 84, 2, 1] },
      "big-rocks-10": { cells: [8, 84, 2, 1] },
      "big-rocks-nosand-7": { cells: [23, 84, 3, 2] },
      "crates-8": { cells: [2, 85, 2, 2] },
      "crates-10": { cells: [4, 85, 3, 2] },
      "crates-11": { cells: [7, 85, 2, 3] },
      "crates-7": { cells: [0, 86, 2, 2] },
      "plants-0": { cells: [11, 86, 3, 2] },
      "plants-7": { cells: [14, 86, 3, 2] },
      "big-rocks-nosand-10": { cells: [17, 86, 2, 2] },
      "big-rocks-nosand-8": { cells: [19, 86, 2, 1] },
      "crates-13": { cells: [3, 87, 3, 3] },
      "big-rocks-nosand-9": { cells: [19, 87, 2, 1] },
      "crates-12": { cells: [0, 88, 3, 2] },
      "crates-14": { cells: [6, 88, 3, 2] },
      "crates-9": { cells: [9, 88, 2, 2] },
      "plants-1": { cells: [11, 88, 3, 2] },
      "plants-6": { cells: [14, 88, 3, 2] },
      "vase-big-3": { cells: [17, 89, 1, 2] },
      "vase-big-2": { cells: [18, 89, 1, 2] },
      "vase-big-1": { cells: [19, 89, 1, 2] },
      "vase-big-0": { cells: [20, 89, 1, 2] },
      "provision-bags-3": { cells: [3, 90, 2, 2] },
      "provision-bags-4": { cells: [5, 90, 2, 2] },
      "sand-path-1": { cells: [7, 90, 1, 2] },
      "sand-path-2": { cells: [8, 90, 2, 3] },
      "plants-2": { cells: [11, 90, 3, 2] },
      "plants-5": { cells: [14, 90, 3, 2] },
      "vase-big-7": { cells: [17, 91, 1, 2] },
      "vase-big-6": { cells: [18, 91, 1, 2] },
      "vase-big-5": { cells: [19, 91, 1, 2] },
      "vase-big-4": { cells: [20, 91, 1, 2] },
      "provision-bags-5": { cells: [0, 92, 2, 2] },
      "provision-bags-6": { cells: [2, 92, 2, 2] },
      "provision-bags-7": { cells: [4, 92, 2, 2] },
      "sand-path-3": { cells: [6, 92, 2, 2] },
      "plants-3": { cells: [11, 92, 3, 2] },
      "plants-vase-7": { cells: [22, 92, 2, 2] },
      "plants-vase-6": { cells: [24, 92, 2, 2] },
      "plants-vase-5": { cells: [26, 92, 2, 2] },
      "plants-vase-4": { cells: [28, 92, 2, 2] },
      "sand-path-4": { cells: [8, 93, 3, 2] },
      "chest-open": { cells: [2, 94, 2, 2] },
      "sand-path-5": { cells: [6, 94, 2, 2] },
      "chest": { cells: [0, 95, 2, 1] },
      "temple-gate": { cells: [11, 95, 8, 7] },
      "plants-vase-3": { cells: [22, 95, 2, 2] },
      "plants-vase-2": { cells: [24, 95, 2, 2] },
      "plants-vase-1": { cells: [26, 95, 2, 2] },
      "plants-vase-0": { cells: [28, 95, 2, 2] },
      "cave-entrance-1": { cells: [0, 96, 6, 4] },
      "temple-door": { cells: [7, 96, 4, 5] },
      "statue2": { cells: [26, 97, 4, 5] },
      "statue1": { cells: [20, 98, 2, 4] },
      "well": { cells: [0, 100, 4, 3] },
      "statue-base": { cells: [22, 100, 2, 2] },
      "portal": { cells: [5, 102, 7, 8] },
      "pyramid": { cells: [12, 102, 7, 6] },
      "statue-2-plinth": { cells: [26, 102, 4, 4] },
      "statue-3-seated": { cells: [22, 103, 2, 2] },
      "statue3": { cells: [24, 103, 2, 3] },
      "well-small-1": { cells: [0, 104, 2, 2] },
      "well-small-2": { cells: [2, 104, 2, 2] },
      "well-trough": { cells: [0, 106, 4, 2] },
      "pyramid-base": { cells: [12, 108, 7, 3] },
      "statue2-golden": { cells: [3, 112, 4, 4] },
      "statue3-golden": { cells: [7, 112, 2, 3] },
      "obelisk4": { cells: [19, 112, 2, 5] },
      "statue1-golden": { cells: [1, 113, 2, 3] },
      "statue4": { cells: [9, 113, 2, 3] },
      "statue4-golden": { cells: [11, 113, 2, 3] },
      "obelisk1": { cells: [13, 113, 2, 4] },
      "obelisk2": { cells: [15, 113, 2, 4] },
      "obelisk3": { cells: [17, 113, 2, 4] },
      "sarcophagus1-6": { cells: [6, 117, 2, 3] },
      "obelisk-4-noglow": { cells: [21, 117, 2, 5] },
      "small-pillar1": { cells: [15, 119, 1, 2] },
      "small-pillar2": { cells: [16, 119, 1, 2] },
      "sarcophagus1-4-mummy": { cells: [2, 121, 1, 3] },
      "sarcophagus1-1": { cells: [3, 121, 1, 3] },
      "sarcophagus1-2": { cells: [4, 121, 1, 3] },
      "sarcophagus1-0": { cells: [6, 121, 1, 3] },
      "small-altar-2": { cells: [8, 121, 4, 4] },
      "small-altar-1": { cells: [12, 121, 4, 4] },
      "sarcophagus-mummy": { cells: [1, 122, 1, 2] },
      "sarcophagus0-0": { cells: [0, 124, 1, 3] },
      "sarcophagus0-5": { cells: [2, 124, 1, 3] },
      "sarcophagus0-2": { cells: [3, 124, 1, 3] },
      "sarcophagus0-3": { cells: [4, 124, 1, 3] },
      "sarcophagus0-1": { cells: [6, 124, 1, 3] },
      "small-altar-0": { cells: [8, 125, 4, 4] },
      "pillar-square-4": { cells: [13, 125, 2, 4] },
      "pillar-square-3": { cells: [15, 125, 2, 4] },
      "pillar-square-2": { cells: [17, 125, 2, 4] },
      "pillar-square-1": { cells: [19, 125, 2, 4] },
      "pillar-square-0": { cells: [21, 125, 2, 4] },
      "support-for-statues-7": { cells: [0, 127, 4, 2] },
      "support-for-statues-0": { cells: [4, 127, 2, 2] },
      "support-for-statues-6": { cells: [0, 129, 4, 2] },
      "support-for-statues-2": { cells: [4, 129, 2, 2] },
      "support-for-statues-1": { cells: [6, 129, 2, 2] },
      "pillar-round-1": { cells: [9, 129, 2, 3] },
      "pillar-round-4": { cells: [11, 129, 2, 3] },
      "pillar-round-3": { cells: [13, 129, 2, 3] },
      "pillar-round-2": { cells: [15, 129, 2, 3] },
      "pillar-round-0": { cells: [19, 129, 2, 3] },
      "support-for-statues-5": { cells: [0, 131, 4, 2] },
      "support-for-statues-3": { cells: [4, 131, 4, 4] },
      "pillar-broken-round-1": { cells: [9, 132, 2, 2] },
      "pillar-broken-round-0": { cells: [11, 132, 2, 2] },
      "pillar-square-round-1": { cells: [13, 132, 2, 3] },
      "pillar-square-round-0": { cells: [15, 132, 2, 3] },
      "support-for-statues-4": { cells: [0, 133, 4, 4] },
      "pyramid-door-frame": { cells: [18, 133, 6, 4] },
      "dead-tree-1": { cells: [15, 60, 5, 5] },
      "dead-tree-2": { cells: [21, 60, 4, 5] },
      "dead-tree-3": { cells: [25, 60, 5, 5] },
      "palm-tree-3": { cells: [23, 73, 3, 5] },
    },
  },
  /**
   * "Epic RPG World — Highlands" pack, 32px. Repacked by
   * `scripts/repack-tileset.py highlands`: terrain sheet rows 0–51 (snow,
   * leaf-litter grounds, frozen lake, 1-tall platforms, bridges, fences),
   * eight raised-platform/fortress sheets packed three per band on rows 52–105
   * (each 16 cols wide: cols 0–15 / 16–31 / 32–47), props sheet rows 106–155.
   * Terrain brushes: apps/realmsmith/src/terrains/highlands.ts. Same prop
   * policy and naming as dunes (raw pack `tilesets and props/props-sprites/`);
   * the pack's "animated" pines/clouds are the static first frame.
   */
  highlands: {
    cellSize: 32,
    columns: 57,
    tileCount: 57 * 156,
    props: {
      "pine-tree-trunk1": { cells: [7, 106, 1, 2] },
      "pine-tree-trunk3": { cells: [9, 106, 1, 2] },
      "pine-tree-big-snow2": { cells: [3, 107, 3, 6] },
      "pine-tree-big-snow": { cells: [12, 107, 3, 6] },
      "pine-tree-medium-snow2": { cells: [6, 108, 3, 5] },
      "pine-tree-medium-snow": { cells: [15, 108, 3, 5] },
      "cabin-1": { cells: [21, 108, 7, 6] },
      "cabin-2": { cells: [28, 108, 6, 6] },
      "cabin-3": { cells: [34, 108, 6, 6] },
      "pine-tree-small-snow2": { cells: [9, 110, 3, 3] },
      "pine-tree-small-snow": { cells: [18, 110, 3, 3] },
      "pine-tree-big": { cells: [12, 114, 3, 6] },
      "campfire-1": { cells: [27, 114, 4, 3] },
      "campfire-2": { cells: [31, 114, 4, 3] },
      "pine-tree-medium": { cells: [15, 115, 3, 5] },
      "campfire-3": { cells: [32, 115, 2, 2] },
      "pine-tree-small": { cells: [18, 117, 3, 3] },
      "stone-ring": { cells: [28, 117, 9, 7] },
      "magic-tree": { cells: [21, 118, 5, 6] },
      "pine-tree2-big-snow2": { cells: [3, 120, 3, 6] },
      "pine-tree2-big-snow": { cells: [12, 120, 3, 6] },
      "pine-tree2-medium-snow2": { cells: [6, 121, 3, 5] },
      "pine-tree2-medium-snow": { cells: [15, 121, 3, 5] },
      "poi2-2": { cells: [28, 121, 4, 3] },
      "poi2-3": { cells: [33, 121, 4, 3] },
      "pine-tree2-small-snow2": { cells: [9, 123, 3, 3] },
      "pine-tree2-small-snow": { cells: [18, 123, 3, 3] },
      "poi1-1": { cells: [21, 125, 3, 3] },
      "poi1-2": { cells: [24, 125, 3, 3] },
      "pine-tree2-big": { cells: [12, 127, 3, 6] },
      "rune-pool": { cells: [27, 127, 5, 5] },
      "pine-tree2-medium": { cells: [15, 128, 3, 5] },
      "poi3-rocks-1": { cells: [32, 128, 2, 2] },
      "poi3-rocks-2": { cells: [34, 128, 2, 2] },
      "poi3-rocks-3": { cells: [36, 128, 2, 2] },
      "tall-grass-3": { cells: [0, 129, 2, 1] },
      "tall-grass-1": { cells: [2, 129, 2, 1] },
      "poi1-5": { cells: [21, 129, 5, 4] },
      "poi3-rocks-4": { cells: [38, 129, 2, 1] },
      "tall-grass-2": { cells: [0, 130, 2, 1] },
      "tall-grass-0": { cells: [2, 130, 2, 1] },
      "pine-tree2-small": { cells: [18, 130, 3, 3] },
      "poi3-rocks-5": { cells: [32, 130, 2, 2] },
      "poi3-rocks-6": { cells: [34, 130, 2, 2] },
      "poi3-rocks-7": { cells: [36, 130, 2, 2] },
      "poi3-rocks-8": { cells: [38, 130, 2, 2] },
      "poi3-rocks-9": { cells: [28, 132, 4, 2] },
      "wooden-logs-19": { cells: [2, 133, 3, 1] },
      "bare-pine-snow-1": { cells: [12, 133, 3, 5] },
      "bare-pine-1": { cells: [17, 133, 3, 5] },
      "poi1-3": { cells: [21, 133, 3, 3] },
      "poi1-4": { cells: [24, 133, 3, 3] },
      "wooden-logs-18": { cells: [2, 134, 3, 1] },
      "bare-trunk-snow-1": { cells: [6, 134, 1, 5] },
      "bare-trunk-snow-2": { cells: [7, 134, 1, 5] },
      "stone-circle-scene": { cells: [26, 134, 11, 9] },
      "wooden-logs-17": { cells: [2, 135, 3, 1] },
      "bare-sapling-snow-1": { cells: [11, 135, 1, 3] },
      "bare-sapling-1": { cells: [16, 135, 1, 3] },
      "wooden-logs-16": { cells: [2, 136, 3, 1] },
      "bare-trunk-snow-3": { cells: [8, 136, 1, 3] },
      "bare-trunk-snow-4": { cells: [9, 136, 1, 3] },
      "wooden-logs-3": { cells: [1, 137, 1, 2] },
      "wooden-logs-2": { cells: [2, 137, 1, 2] },
      "wooden-logs-1": { cells: [3, 137, 1, 2] },
      "wooden-logs-0": { cells: [4, 137, 1, 2] },
      "bare-pine-snow-2": { cells: [12, 138, 3, 5] },
      "bare-pine-2": { cells: [17, 138, 3, 5] },
      "wooden-logs-11": { cells: [0, 139, 3, 1] },
      "wooden-logs-13": { cells: [3, 139, 3, 1] },
      "wooden-logs-10": { cells: [0, 140, 3, 1] },
      "wooden-logs-12": { cells: [3, 140, 3, 1] },
      "bare-sapling-snow-2": { cells: [11, 140, 1, 3] },
      "bare-sapling-2": { cells: [16, 140, 1, 3] },
      "wooden-logs-9": { cells: [0, 141, 3, 1] },
      "bare-trunk-1": { cells: [6, 141, 1, 5] },
      "bare-trunk-2": { cells: [7, 141, 1, 5] },
      "wooden-logs-8": { cells: [0, 142, 3, 1] },
      "wooden-logs-7": { cells: [0, 143, 3, 2] },
      "bare-trunk-3": { cells: [8, 143, 1, 3] },
      "bare-trunk-4": { cells: [9, 143, 1, 3] },
      "snow-drift-5": { cells: [11, 143, 5, 2] },
      "snow-drift-1": { cells: [16, 143, 5, 2] },
      "wooden-logs-6": { cells: [0, 145, 3, 2] },
      "snow-drift-4": { cells: [11, 145, 5, 2] },
      "snow-drift-2": { cells: [16, 145, 5, 2] },
      "wooden-logs-5": { cells: [0, 147, 3, 2] },
      "snow-drift-3": { cells: [12, 147, 6, 2] },
      "wooden-logs-4": { cells: [0, 149, 3, 2] },
    },
  },
};
