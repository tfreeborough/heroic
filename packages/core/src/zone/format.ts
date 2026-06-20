/**
 * The zone format — how a level ("realm") is stored as data, authored in
 * Realmsmith and consumed by the game. See docs/design/world-representation.md.
 *
 * Two shapes live here:
 *   - `ZoneFile` — the **authored** form Realmsmith saves (committed to git) and
 *     the game loads. Plain JSON: visual layers as tile grids, collision *as
 *     drawn* (free rects + painted cells), breakables, and placed objects.
 *   - `Zone` (+ `ZoneChunk`, `Breakable`) — the **runtime** form `loadZone`
 *     derives: collision greedy-meshed into `Aabb[]`, layers sliced into chunks,
 *     breakables given mutable hp/alive state.
 *
 * Pure data + types — no renderer, no Skia. The per-chunk `SkPicture` bake is a
 * load-time step that lives app-side (it needs the device); core stops at the
 * tile arrays. Reuses the core `Aabb` (centre + size) so loaded collision feeds
 * `stepCrowd` / `buildNavGrid` / line-of-sight unchanged.
 */
import type { Aabb } from "../physics/crowd";
import type { Vec2 } from "../math/vec2";

/** Bump when the authored shape changes incompatibly; `loadZone` rejects mismatches. */
export const ZONE_FORMAT_VERSION = 1;

// ─────────────────────────────── Authored file ───────────────────────────────

/** The on-disk zone: what Realmsmith writes and the game loads. JSON-serialisable. */
export interface ZoneFile {
  /** Schema version — must equal `ZONE_FORMAT_VERSION`. */
  format: number;
  /** Stable id, e.g. "realm-01". */
  id: string;
  /** Human label. */
  name: string;
  /** Level band — see realms-and-overworld. */
  band: number;
  /** Zone dimensions in *tiles* (world px = cols·tileSize × rows·tileSize). */
  size: { cols: number; rows: number };
  /** Px per floor tile (the visual resolution). */
  tileSize: number;
  /** Tiles per chunk side; the loader slices the layers into chunks of this size. */
  chunkTiles: number;
  /** Atlas image path; tile ids index its source rects. */
  tileset: string;
  /** Visual tile grids, `[row][col]` tile ids (`0` = empty). */
  layers: ZoneLayers;
  /** Collision **as drawn** — greedy-meshing happens at load, so cells stay editable. */
  collision: ZoneCollision;
  /** Destructible blockers, placed by the designer. */
  breakables: BreakableDef[];
  /** Placed entities — spawners, waystones, the player spawn, exits, POIs. */
  objects: ZoneObject[];
  /**
   * Treat floorless cells (`floor` id `0`) as solid, fencing the zone into the
   * shape you painted — an L, a blob, an outdoor field — with no manual boundary
   * walls. Default `true`; set `false` only for a floorless-but-walkable zone.
   */
  fenceVoid?: boolean;
}

export interface ZoneLayers {
  /** `[row][col]` tile ids, `0` = empty. Dimensions must match `size`. */
  floor: number[][];
  /** Optional visual layer drawn above the floor. */
  decor?: number[][];
}

export interface ZoneCollision {
  /** Free rectangles (centre + size, world px) — walls, columns, thin geometry. */
  rects: Aabb[];
  /** Painted solid cells, `[row][col]` of `0`/`1`. Greedy-meshed into rects at load. */
  cells?: number[][];
  /** Px per collision cell — independent of `tileSize`. Defaults to `tileSize`. */
  cellSize?: number;
}

/** Extra effect run when a breakable is destroyed (it always vanishes regardless). */
export type BreakEffect =
  | { type: "explode"; radius: number; damage: number }
  | { type: "drop"; table: string };

/** A solid blocker with hp, authored into the zone. */
export interface BreakableDef {
  id: string;
  /** Drives art, hit-feel, and defaults, e.g. "wood-wall" | "barrel" | "crate". */
  kind: string;
  /** Solid footprint *and* hit target (centre + size, world px). */
  box: Aabb;
  maxHp: number;
  /** Blocks line-of-sight while alive (a wall does; a barrel does not). Default `false`. */
  occludes?: boolean;
  /** Effects on top of vanishing. Empty/absent → it just opens the path. */
  onBreak?: BreakEffect[];
}

export type ZoneObjectKind =
  | "spawner"
  | "waystone"
  | "settlement"
  | "playerSpawn"
  | "exit"
  | "poi";

/** A free-placed entity (world px). `props` carry the kind-specific config. */
export interface ZoneObject {
  id: string;
  kind: ZoneObjectKind;
  x: number;
  y: number;
  /** Present for region objects (e.g. an exit trigger area). */
  w?: number;
  h?: number;
  props: Record<string, string | number | boolean>;
}

// ─────────────────────────────── Runtime form ────────────────────────────────

/** A loaded zone, held in memory by the game. Derived from a `ZoneFile` by `loadZone`. */
export interface Zone {
  id: string;
  name: string;
  band: number;
  /** World dimensions in px. */
  size: Vec2;
  tileSize: number;
  chunkTiles: number;
  /** Chunk side in px (`chunkTiles · tileSize`). */
  chunkSize: number;
  chunkCols: number;
  chunkRows: number;
  tileset: string;
  /** Row-major: `chunks[cy * chunkCols + cx]`. */
  chunks: ZoneChunk[];
  /** Static collision, greedy-meshed — feeds Matter / `stepCrowd` / `buildNavGrid` / LoS. */
  collision: Aabb[];
  /** Dynamic, destructible collision — live state, dropped on break. */
  breakables: Breakable[];
  objects: ZoneObject[];
  /** The `playerSpawn` object's position, or the zone centre if none authored. */
  spawn: Vec2;
}

export interface ZoneChunk {
  cx: number;
  cy: number;
  /** Row-major tile ids for this chunk, length `chunkTiles²` (`0` = empty/out-of-bounds). */
  floor: Uint16Array;
  /** Present only if the zone has a decor layer. */
  decor: Uint16Array | null;
}

/** A breakable resolved for runtime: its authored def plus mutable battle state. */
export interface Breakable {
  id: string;
  kind: string;
  box: Aabb;
  hp: number;
  maxHp: number;
  occludes: boolean;
  onBreak: BreakEffect[];
  /** Cleared on destruction; the world drops its collision/occluder when this flips. */
  alive: boolean;
}
