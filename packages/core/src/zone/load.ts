/**
 * `loadZone` — turn an authored `ZoneFile` into the runtime `Zone` the game holds.
 *
 * The reductions here are the cheap, deterministic half of "loading" (see
 * docs/design/world-representation.md, "Authored vs. game-ready"):
 *   1. static collision  — free rects + greedy-meshed painted cells → one `Aabb[]`
 *   2. visual layers     — sliced into row-major chunks of `chunkTiles²` tile ids
 *   3. breakables        — given mutable hp/alive state
 *   4. spawn             — resolved from the `playerSpawn` object (or zone centre)
 *
 * The expensive, device-bound step — baking each chunk's tiles into an `SkPicture`
 * — is NOT here; it lives app-side and runs on the chunks this produces. Pure and
 * deterministic, so it's unit-tested like the rest of core.
 */
import type { Vec2 } from "../math/vec2";
import type { Aabb } from "../physics/crowd";
import { greedyMesh } from "./mesh";
import {
  COLLISION_CELL,
  ZONE_FORMAT_VERSION,
  type Breakable,
  type BreakableDef,
  type CollisionRect,
  type Zone,
  type ZoneChunk,
  type ZoneFile,
} from "./format";

/** Drop the `material` tag — runtime collision is plain geometry. */
const toAabb = (r: CollisionRect): Aabb => ({ x: r.x, y: r.y, w: r.w, h: r.h });

/** Greedy-mesh just the cells equal to `value` (one collision material) into rects. */
const meshMaterial = (
  cells: readonly (readonly number[])[],
  cellSize: number,
  value: number,
): Aabb[] =>
  greedyMesh(
    cells.map((row) => (row ?? []).map((v) => (v === value ? 1 : 0))),
    cellSize,
  );

/** Slice one full-zone tile grid (`[row][col]`) into a chunk's row-major `Uint16Array`. */
const sliceLayer = (
  grid: readonly (readonly number[])[] | undefined,
  cx: number,
  cy: number,
  chunkTiles: number,
): Uint16Array => {
  const out = new Uint16Array(chunkTiles * chunkTiles);
  if (!grid) return out;
  for (let ly = 0; ly < chunkTiles; ly++) {
    const row = grid[cy * chunkTiles + ly];
    if (!row) continue;
    for (let lx = 0; lx < chunkTiles; lx++) {
      out[ly * chunkTiles + lx] = row[cx * chunkTiles + lx] ?? 0;
    }
  }
  return out;
};

/** Authored breakable → runtime breakable (full hp, alive, defaults filled in). */
const toBreakable = (def: BreakableDef): Breakable => ({
  id: def.id,
  kind: def.kind,
  box: def.box,
  hp: def.maxHp,
  maxHp: def.maxHp,
  occludes: def.occludes ?? false,
  onBreak: def.onBreak ?? [],
  // A locked door carries its lock into the runtime; plain breakables stay unlocked.
  ...(def.lock ? { lock: def.lock } : {}),
  alive: true,
});

export const loadZone = (file: ZoneFile): Zone => {
  if (file.format !== ZONE_FORMAT_VERSION) {
    throw new Error(`Unsupported zone format ${file.format} (expected ${ZONE_FORMAT_VERSION})`);
  }
  const { tileSize, chunkTiles } = file;
  const { cols, rows } = file.size;
  if (cols <= 0 || rows <= 0) throw new Error("zone size must be positive");
  if (tileSize <= 0) throw new Error("zone tileSize must be > 0");
  if (chunkTiles <= 0) throw new Error("zone chunkTiles must be > 0");
  if (file.layers.floor.length !== rows) {
    throw new Error(`floor layer has ${file.layers.floor.length} rows, expected ${rows}`);
  }

  // 1. Static collision, split by material. Physics/nav want one flat list of
  // movement-blockers (`collision`), but the renderer + line-of-sight want walls
  // and voids apart: a wall is drawn and blocks sight; a void is a chasm —
  // impassable, but invisible and see/shoot-across. So mesh each material on its
  // own, then union them. (Free rects with no `material` are walls → legacy files,
  // whose rects are bare `Aabb`s, stay walls.)
  const cellSize = file.collision.cellSize ?? tileSize;
  const rects = file.collision.rects ?? [];
  const walls: Aabb[] = rects.filter((r) => (r.material ?? "wall") === "wall").map(toAabb);
  const voids: Aabb[] = rects.filter((r) => r.material === "void").map(toAabb);
  const cells = file.collision.cells;
  if (cells && cells.length > 0) {
    walls.push(...meshMaterial(cells, cellSize, COLLISION_CELL.wall));
    voids.push(...meshMaterial(cells, cellSize, COLLISION_CELL.void));
  }

  // 1b. Fence the void: floorless cells (floor id 0) are outside the painted shape,
  // so make them VOID — impassable, but invisible (the void backdrop already shows
  // there) and see/shoot-across. This is what lets a designer author an L-shape, an
  // outdoor field, or a bridge over a chasm just by painting the floor in that shape
  // — no manual boundary walls (greedy-meshed, so a notch is one rect, not hundreds
  // of cells). Off only for the rare floorless-but-walkable case. See
  // docs/design/world-representation.md.
  if (file.fenceVoid !== false) {
    const floorless: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const floorRow = file.layers.floor[r];
      const row = new Array<number>(cols);
      for (let cc = 0; cc < cols; cc++) row[cc] = floorRow && floorRow[cc] ? 0 : 1;
      floorless.push(row);
    }
    voids.push(...greedyMesh(floorless, tileSize));
  }

  // Movement collision = every solid, regardless of material (walls first, to match
  // authored order). Occluders are built from `walls` alone, app-side.
  const collision: Aabb[] = [...walls, ...voids];

  // 2. Slice visual layers into chunks (row-major: chunks[cy * chunkCols + cx]).
  const chunkCols = Math.ceil(cols / chunkTiles);
  const chunkRows = Math.ceil(rows / chunkTiles);
  const hasDecor = file.layers.decor !== undefined;
  const chunks: ZoneChunk[] = [];
  for (let cy = 0; cy < chunkRows; cy++) {
    for (let cx = 0; cx < chunkCols; cx++) {
      chunks.push({
        cx,
        cy,
        floor: sliceLayer(file.layers.floor, cx, cy, chunkTiles),
        decor: hasDecor ? sliceLayer(file.layers.decor, cx, cy, chunkTiles) : null,
      });
    }
  }

  // 3. Breakables → runtime state.
  const breakables = (file.breakables ?? []).map(toBreakable);

  // 4. Spawn: the authored playerSpawn, else the zone centre.
  const sizePx: Vec2 = { x: cols * tileSize, y: rows * tileSize };
  const spawnObj = (file.objects ?? []).find((o) => o.kind === "playerSpawn");
  const spawn: Vec2 = spawnObj
    ? { x: spawnObj.x, y: spawnObj.y }
    : { x: sizePx.x / 2, y: sizePx.y / 2 };

  return {
    id: file.id,
    name: file.name,
    // Older files carry only `band` — treat them as a single-level zone there.
    levels: { min: file.band, max: Math.max(file.band, file.bandMax ?? file.band) },
    size: sizePx,
    tileSize,
    chunkTiles,
    chunkSize: chunkTiles * tileSize,
    chunkCols,
    chunkRows,
    tileset: file.tileset,
    chunks,
    collision,
    walls,
    voids,
    breakables,
    objects: file.objects ?? [],
    spawn,
    audio: file.audio,
  };
};
