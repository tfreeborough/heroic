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
import type { DoorLock } from "../keys/keys";
import type { LevelRange } from "../progression/levelGap";
// Type-only, so the format↔tileset import cycle is erased at compile time.
import type { PlacedProp } from "./tileset";

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
  /**
   * Level range floor (creature-levels.md): spawns roll between `band` and
   * `bandMax`, clamped by each creature's own bounds — the zone is the content
   * gate, the species is the identity.
   */
  band: number;
  /** Level range ceiling; older files omit it (treated as a single-level zone at `band`). */
  bandMax?: number;
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
  /** Music this zone plays, by situation. Absent → the zone is silent. See docs/design/audio.md. */
  audio?: ZoneAudio;
  /**
   * Treat floorless cells (`floor` id `0`) as **void** collision, fencing the zone
   * into the shape you painted — an L, a blob, a bridge over a chasm — with no
   * manual boundary walls. Floorless cells already show the void backdrop; this
   * makes them impassable too (but still see/shoot-across, since void doesn't
   * occlude). Default `true`; set `false` only for a floorless-but-walkable zone.
   */
  fenceVoid?: boolean;
}

export interface ZoneLayers {
  /** `[row][col]` tile ids, `0` = empty. Dimensions must match `size`. */
  floor: number[][];
  /** Optional visual layer drawn above the floor. */
  decor?: number[][];
}

/**
 * Which looping music bed plays. The app's music decider picks one each step
 * (idle until an enemy engages, then combat with a hangover — see
 * `audio/musicState`); the runtime crossfades to whichever the zone supplies.
 * Open to extension (boss, ambient…) — a situation a zone has no bed for just
 * keeps the current bed playing.
 */
export type MusicSituation = "idle" | "combat";

/** A zone's music: a bed per situation plus how long to crossfade between them. */
export interface ZoneAudio {
  /** Situation → clip name in the app's audio manifest. Any subset; absent ones are silent. */
  beds: Partial<Record<MusicSituation, string>>;
  /** Seconds to crossfade when the active bed changes. Default 2. */
  crossfade?: number;
}

/**
 * What a solid *is* — its collision material. The geometry (an `Aabb`) is the same
 * either way; the material decides how it behaves and reads:
 *   - `"wall"` — solid floor-to-ceiling: blocks movement, **and** blocks sight,
 *     projectiles, and targeting. Drawn as a pillar/wall.
 *   - `"void"` — a chasm: blocks *movement* only. Sight, projectiles, and ranged
 *     targeting pass straight across it (you can shoot to the far side of a bridge).
 *     Drawn as a dark, drifting-mist pit — the swirling cloud, not a wall.
 *   - `"hidden"` — an invisible barrier: blocks *movement* only and is **never
 *     drawn in-game** — the terrain art (a painted cliff-face tile, a map edge)
 *     is the visual. The editor shows it as a translucent blue box. Unlike
 *     wall/void it coexists with floor in the same cell: the ground under it
 *     stays painted and visible. Same idea as a prop's footprint, but paintable.
 * Open to extension (e.g. `"water"`) — add the material, then decide which sets
 * (movement / occluders / a slow field) it joins in `loadZone`.
 */
export type CollisionMaterial = "wall" | "void" | "hidden";

/** A free collision rectangle (centre + size, world px) plus what it's made of. */
export interface CollisionRect extends Aabb {
  /** Material; absent → `"wall"` (so legacy files of bare `Aabb`s are walls). */
  material?: CollisionMaterial;
}

export interface ZoneCollision {
  /** Free rectangles — walls, columns, thin geometry, or void gaps (per `material`). */
  rects: CollisionRect[];
  /**
   * Painted solid cells, `[row][col]` of material codes: `0` empty, `1` wall,
   * `2` void, `3` hidden. Greedy-meshed per material into rects at load.
   * (Legacy `0/1` grids stay correct — `1` has always meant a wall.)
   */
  cells?: number[][];
  /** Px per collision cell — independent of `tileSize`. Defaults to `tileSize`. */
  cellSize?: number;
}

/** Painted-cell material codes (the non-empty values in `ZoneCollision.cells`). */
export const COLLISION_CELL = { none: 0, wall: 1, void: 2, hidden: 3 } as const;

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
  /**
   * Makes this breakable a **locked door**: it ignores weapon damage and opens
   * only when the player touches it while holding a matching-color key (which is
   * consumed). Opening reuses the normal break path — collision drops and the
   * navgrid rebuilds. Pair with `occludes: true` for a sight-blocking door.
   * See docs/design/doors-and-keys.md.
   */
  lock?: DoorLock;
}

export type ZoneObjectKind =
  | "spawner"
  /** A single authored enemy: one creature placed at this spot, present from load.
   *  `props.creature` names the roster `CreatureId`. The spawner's static sibling —
   *  no nest, no cadence, it just stands where you put it. */
  | "creature"
  /** A collectible color key. `props.color` names a `KeyColor`; picked up on
   *  contact and consumed to open the matching locked door (a breakable with a
   *  `lock`). See docs/design/doors-and-keys.md. */
  | "key"
  /** An invisible region (uses `w`/`h`) that fires an action when the player
   *  walks into it — v1 shows text. Hidden in-game, drawn in Realmsmith. Config
   *  rides `props` (`parseTriggerConfig`). See docs/design/triggers.md. */
  | "trigger"
  | "waystone"
  | "settlement"
  | "playerSpawn"
  | "exit"
  | "poi"
  /** A standing prop (cactus, rock…): a multi-cell sprite from the zone's
   *  tileset, placed by its bottom-centre. `props.prop` names a `PropDef` in
   *  the tileset's registry entry, which supplies the sprite region, the
   *  hidden collision footprint, and occlusion. Y-sorted with entities at
   *  render so players walk behind its top. See docs/design/tilesets.md. */
  | "prop";

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
  /** The zone's spawn-level range, normalised from the file's band/bandMax. */
  levels: LevelRange;
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
  /**
   * Everything that blocks **movement**, greedy-meshed — the union of `walls` and
   * `voids`. This is what Matter / `stepCrowd` / `buildNavGrid` consume (they don't
   * care what a solid is *made of*, only that it stops a body), so they're fed
   * exactly as before. For line-of-sight / projectiles / targeting, use `walls`
   * (void is see-through).
   */
  collision: Aabb[];
  /**
   * The `"wall"` subset of `collision`: solid, drawn as pillars, **and** occluding
   * (blocks sight, projectiles, targeting). Build occluders from these.
   */
  walls: Aabb[];
  /**
   * The `"void"` subset of `collision`: blocks movement but does *not* occlude — you
   * can see/shoot across it — and is drawn as a dark, drifting-mist pit (a chasm),
   * not a wall. Includes the auto-fenced floorless cells (unless `fenceVoid` is
   * `false`).
   */
  voids: Aabb[];
  /**
   * The `"hidden"` subset of `collision`: invisible barriers — block movement,
   * never drawn in-game, never occlude. Renderers ignore this list entirely
   * (it's already in `collision` for physics/nav); the editor draws it as
   * translucent blue boxes so authored barriers stay visible while designing.
   */
  hidden: Aabb[];
  /** Dynamic, destructible collision — live state, dropped on break. */
  breakables: Breakable[];
  /**
   * Placed standing props, resolved against the tileset registry (unknown
   * tileset/prop names simply don't resolve — the placeholder philosophy).
   * Their footprints are already folded into `collision`; renderers draw these
   * y-sorted with entities. See zone/tileset.ts.
   */
  props: PlacedProp[];
  /**
   * Occluding prop footprints (`PropDef.occludes`): they block sight /
   * projectiles / targeting like `walls`, but are **never drawn** — the sprite
   * is the visual. Build occluders from `walls` ∪ `propOccluders`.
   */
  propOccluders: Aabb[];
  objects: ZoneObject[];
  /** The `playerSpawn` object's position, or the zone centre if none authored. */
  spawn: Vec2;
  /** Music beds for this zone, copied verbatim from the file. Absent → silent. */
  audio?: ZoneAudio;
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
  /** Set on a locked door (mirrors `BreakableDef.lock`); absent on a plain breakable. */
  lock?: DoorLock;
  /** Cleared on destruction; the world drops its collision/occluder when this flips. */
  alive: boolean;
}
