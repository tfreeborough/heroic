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

// Floor *shape*: paint floor (id 1) where `isFloor`, else void (id 0). loadZone
// auto-fences the void and Phase-2 rendering draws it as the backdrop — so this
// predicate literally IS the zone's shape. Edit it to try other shapes; just keep
// the centre (the spawn + pillars) floored. Here: a wide band with the top-right
// and bottom-left corners bitten out, so it's obviously not a rectangle.
const isFloor = (col: number, row: number): boolean => {
  const topRight = row < ROWS * 0.5 && col > COLS * 0.66;
  const bottomLeft = row >= ROWS * 0.5 && col < COLS * 0.3;
  return !topRight && !bottomLeft;
};
const floor: number[][] = [];
for (let row = 0; row < ROWS; row++) {
  const cells: number[] = [];
  for (let col = 0; col < COLS; col++) cells.push(isFloor(col, row) ? 1 : 0);
  floor.push(cells);
}

// Breakables (docs/design/world-representation.md): destructible blockers placed
// by the designer. A wood wall just right of spawn that you knock down to open the
// right side — it `occludes`, so it blocks sightlines until broken — and a ROW of
// barrels to the upper-left that chain-detonate. They sit in the clear band above
// spawn (no pillars at that row), receding left, spaced BARREL_GAP apart: with a
// 120px blast that reaches each barrel's immediate neighbour but not the one beyond
// it, so shooting the nearest sets off a visible 1→2→3 cascade rippling away from
// you (each link waits its own fuse). Equip a ranged weapon — melee can't target an
// explosive barrel (it would catch you in the blast). Move them closer together to
// detonate as one, further apart (past ~144px) to break the chain.
const BARREL_GAP = 1.75 * u; // ≈112px: inside the 120 blast (chains the next), but
//                              a two-away barrel (~200px edge) stays out of range.
const barrelY = cy - 1.5 * u; // clear row above spawn
const barrel = (n: number, x: number) => ({
  id: `barrel-${n}`,
  kind: "barrel",
  box: { x, y: barrelY, w: 0.75 * u, h: 0.75 * u },
  maxHp: 12,
  onBreak: [{ type: "explode" as const, radius: 120, damage: 25 }],
});
const breakables: ZoneFile["breakables"] = [
  {
    id: "wood-wall-0",
    kind: "wood-wall",
    box: { x: cx + 2 * u, y: cy, w: 0.5 * u, h: 4 * u },
    maxHp: 45,
    occludes: true,
  },
  barrel(0, cx - 2.5 * u), // nearest spawn — shoot this one
  barrel(1, cx - 2.5 * u - BARREL_GAP),
  barrel(2, cx - 2.5 * u - 2 * BARREL_GAP),
];

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
  breakables,
  objects: [{ id: "spawn", kind: "playerSpawn", x: cx, y: cy, props: {} }],
};
