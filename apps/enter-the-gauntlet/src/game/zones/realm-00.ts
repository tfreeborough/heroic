/**
 * realm-00 — the original tech-demo arena, now authored as a zone file.
 *
 * This is the first real consumer of the Realmsmith zone format (see
 * docs/design/world-representation.md): a hand-authored `ZoneFile` that
 * `loadZone` turns into the world the game runs. It reproduces the exact arena
 * the old hand-coded `constants.ts` built, so the game is unchanged while the
 * world becomes data — the Phase-1 proof that the format round-trips.
 *
 * Hand-authored as TypeScript for now (computed pillar rects, generated floor);
 * Realmsmith will emit this as JSON under `assets/zones/` later. `loadZone` takes
 * a plain object either way.
 */
import { ZONE_FORMAT_VERSION, type ZoneFile } from "@heroic/engine";

const COLS = 50;
const ROWS = 12;
const TILE = 64;
// World centre, per axis. Separate cx/cy so a non-square zone (try ROWS=12,
// COLS=50) still anchors the spawn and pillars to the actual middle of the map,
// not a square's centre.
const cx = (COLS * TILE) / 2;
const cy = (ROWS * TILE) / 2;
const u = TILE;

// Interior obstacles: the original line-of-sight demo layout, now data. (Realmsmith
// will emit explicit literals; computed here so the port is exactly 1:1.)
const pillars = [
  { x: cx - 3.5 * u, y: cy - 3.5 * u, w: 1.5 * u, h: 1.5 * u },
  { x: cx + 3.5 * u, y: cy - 3 * u, w: 2 * u, h: u },
  { x: cx + 5 * u, y: cy + 1.5 * u, w: u, h: 3 * u },
  { x: cx - 0.5 * u, y: cy + 4 * u, w: 3 * u, h: 1.5 * u },
  { x: cx - 5 * u, y: cy + 1 * u, w: u, h: 2.5 * u },
];

// Floor: every cell the same floor tile (id 1) for now. The renderer still draws
// the procedural checkerboard; tile-id/atlas rendering is Phase 2.
const floor = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(1));

export const REALM_00: ZoneFile = {
  format: ZONE_FORMAT_VERSION,
  id: "realm-00",
  name: "Proving Grounds",
  band: 1,
  size: { cols: COLS, rows: ROWS },
  tileSize: TILE,
  chunkTiles: 16, // 16 × 64 ≈ 1024 px chunks; unused until Phase 2 baking
  tileset: "placeholder",
  layers: { floor },
  collision: { rects: pillars },
  breakables: [],
  objects: [{ id: "spawn", kind: "playerSpawn", x: cx, y: cy, props: {} }],
};
