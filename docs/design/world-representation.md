# World Representation & Realmsmith

Status: **agreed (v1)** · Applies to: how a **realm** ([realms-and-overworld](./realms-and-overworld.md))
is stored in data, drawn, collided against, and **authored** in **Realmsmith**, our self-built map editor ·
Last decided: 2026-06-19

This is the *technical* counterpart to [realms-and-overworld](./realms-and-overworld.md): that doc says
what a zone **is** (a level-banded spatial unit with handcrafted geography); this one says how a zone is
**represented, rendered, and made**. Enter the Gauntlet is the first consumer (a linear realm sequence —
[enter-the-gauntlet](./enter-the-gauntlet.md)); the format is built so Journey to Greatness's giant
continuous overworld inherits it.

## The problem

Today the world is a single fixed square arena defined in code (`ARENA_SIZE`, `WALLS`, `PILLARS`,
`OCCLUDERS` in `constants.ts`), re-recorded into one `SkPicture` every frame. That is the right shape for a
tech demo and the wrong shape for a game of many large, handcrafted zones. We need:

1. A way to **paint** a map and **place objects** (walls, columns, spawners, waystones) without writing
   code per zone.
2. A world **expressed as data**, not constants, so zones are content.
3. **Performance headroom**: never hold or draw a whole large zone at once — only what is near the player.

The standard 2D answer to all three is a **tilemap with layers**, **culled** to the camera and **chunked**
for memory. Our engine already leans this way (grid-based fog/nav/separation, batched Skia draws), so this
is continuous with what exists, not a rewrite.

## Core model: tilemap + layers

A zone is a **tilemap** — the level expressed as 2D arrays of small cells. It is composed of stacked
**layers**, drawn/consumed independently:

- **Floor** (background, visual) — what's under the player's foot. A grid of tile IDs → draw rules. Purely
  cosmetic; never blocks.
- **Walls / decor** (visual, optional overhead) — tiled visual structure above the floor. Cosmetic.
- **Collision** (authored shapes, *invisible*) — what the player and enemies physically collide with.
  Authored separately from visuals (see below); not necessarily 1:1 with any wall tile.
- **Objects** (entities, not tiles) — placed points/regions with typed properties: spawners
  ([spawners](./spawners.md)), settlements & waystones ([realms-and-overworld](./realms-and-overworld.md)),
  the player spawn, zone exits/transitions, points of interest.

Separating **what you see** (floor/decor) from **what blocks you** (collision) from **what lives there**
(objects) is the core simplification. Each is edited, stored, and consumed on its own terms.

### Layers are independent grids — collision resolution ≠ visual tile size

There is no single "the grid". The engine already runs several grids at different resolutions for different
jobs (`NAV_CELL`, `FOG_CELL`, `ENEMY_GRID_CELL`). The **visual tile** (e.g. 32 px, the paint resolution) is
just one more. Critically, **collision detail is independent of floor-tile size**: you can paint a coarse
floor and still author thin columns, because collision is authored as its own thing (next section) — you do
*not* shrink the floor grid to get fine geometry.

## Coordinate systems

Keep these distinct; conflating them is the classic trap.

- **World space** — continuous px, the one true coordinate of the simulation (positions, velocities,
  collision, line-of-sight). **The sim only ever speaks world space.**
- **Tile coords** — `(col, row)` into a layer array, at that layer's cell size. A storage/authoring detail.
- **Chunk coords** — which fixed block of the world a thing falls in. A storage/streaming detail.

The sim never needs to know chunks or tiles exist. Chunks are a concern of the **loader/renderer** only.
This separation is what lets streaming be added later without touching gameplay code.

## Chunks have two distinct roles — and we adopt them at different times

A **chunk** is a fixed block of the world (e.g. 32×32 tiles ≈ 1024 px). It does two jobs that are easy to
conflate but are separable:

1. **Bake unit (render performance).** A chunk's *static* layers (floor + wall visuals + meshed collision
   outlines if drawn) are recorded **once on load** into a per-chunk `SkPicture`, then merely *replayed*
   (`drawPicture`) each frame. Re-recording is the cost; replaying a cached picture is nearly free. This is
   the generalisation of what `recordCombatScene` already does with `DARK_TILES_PATH` (bake the static
   checkerboard once) — extended so the whole static world is per-chunk baked. **Adopt now**, because even
   a moderately bigger zone benefits.

2. **Streaming unit (memory eviction).** Keep only the chunks near the player resident; load/unload the
   rest with **hysteresis** (a margin so you don't thrash at a boundary). **Defer this** until a zone is too
   large to hold resident. Enter the Gauntlet's realms are a linear sequence and likely fit in memory
   (load the whole zone on entry); Journey's continuous overworld is what forces true eviction.

### Three concentric scopes — keep them separately tuned

| Scope | Question | Status |
| --- | --- | --- |
| **Render** | which tiles/walls to *draw* | culling — extend the current viewport draw to per-chunk |
| **Sim** | which enemies/spawners *tick* | **already exists** (`simRadiusSq`, the `OFFSCREEN_SIM_MARGIN` LOD cutoff) |
| **Stream** | which chunks stay *resident* | deferred (see above); larger than render, with hysteresis |

## Rendering

- Draw only the **4–9 chunks overlapping the camera** (+ a small margin), replaying each chunk's baked
  static `SkPicture`.
- The **dynamic layer** (enemies, projectiles, telegraphs, damage numbers, fog) keeps being recorded
  per-frame exactly as `recordCombatScene` does now — it is already bounded by sim culling, and batched
  (`drawPoints` per colour, incremental fog path). Nothing about that changes.
- **Tiles are sprite/atlas from the start, placeholder art first.** A tile ID indexes a source rect in a
  tileset image (an **atlas**), drawn batched via `Skia.drawAtlas` (one call for many textured quads — the
  same batching philosophy as the enemy `drawPoints`). Realmsmith paints with these tiles, and because the editor
  reuses the game's own renderer, what you paint is exactly what you get — true WYSIWYG. To avoid needing finished art up front, **start with a small
  placeholder tileset** (flat-colour / programmer-art 32px tiles); real art drops in later by swapping the
  PNG, no code change. Per-chunk baking is unchanged — a chunk records `drawAtlas` calls into its
  `SkPicture` instead of fills.

## Collision & occlusion

Authored **two ways**, used for what each is good at, both compiled to the **same runtime form**:

- **Free rectangles** (drawn on the collision layer) → long straight walls, thin columns, regular rooms.
  Few shapes, exact, cheap. Thin costs nothing.
- **Painted cells** (a collision tile layer) → organic / curved / diagonal regions, where a grid staircase
  reads fine and painting is the natural tool.

At **build/load time**, both are reduced to a list of **axis-aligned rectangles** (`Aabb`): painted cells are
**greedy-meshed** (runs of adjacent solid cells merged into a handful of big rects — a 40-cell wall becomes
one rect). So everything downstream receives the format it already eats today, with no new math:

- **Player** — Matter.js static blockers (`createBlockerBody`).
- **Enemies** — `stepCrowd` → `resolveCircleAabb` against the rect list (`walls`).
- **Navigation** — `buildNavGrid` rasterises the rects (`inInflatedRect`).
- **Line-of-sight** — `rectEdges` → `VisionSegment[]`, fed to `computeVisibility` / `segmentClear`.

### On angled / curved collision (deferred)

Realmsmith could let you draw rotated rects or polygons, but we deliberately **do not** use angled collision in v1:

- **Collision is invisible.** The visible curve lives in the floor/wall *art* (painted tiles — no angle
  limit). The collision under it can be a cruder staircase and the player never feels it.
- Angled/curved collision is a known bug-magnet (ambiguous push-out direction, tunnelling, corner snags)
  for a payoff nobody perceives. Winding corridors → **paint the curvy collision cells**, draw rects for the
  straight runs.
- If a zone later genuinely needs a smooth oriented wall, note the head start: **line-of-sight is already
  segment-based** (`computeVisibility` works on arbitrary edges) and **Matter handles oriented boxes
  natively** — so the only real work would be `resolveCircleAabb` → circle-vs-oriented-box for the enemy
  crowd, plus a point-in-polygon cell test in `buildNavGrid`.

## Zone shape (irregular & outdoor zones)

A zone's array is always a rectangle — `cols × rows` is its **bounding box** — but the bounding box and the
zone's *shape* are different things. The shape is **which cells are actually part of the zone**; the rest are
**void** (outside the world). An L-shape is a rectangular grid with its notch left void; an outdoor field is
a blobby floor with void (treeline / cliff / water) all around it.

**Floor presence defines the shape.** Floor tile id `0` means empty, so you paint floor only where the zone
exists — paint an L-shaped floor and you've authored an L-shaped zone. No floor there = not part of the zone.

**The loader fences the void automatically.** `loadZone` treats every floorless cell as solid: it
greedy-meshes the void region into `Aabb`s and adds them to collision (`fenceVoid`, default on). So the
player and enemies are fenced into the exact painted shape with **zero manual boundary walls** — an L's notch
becomes ~one merged rect, an organic coastline a handful. It's just the rectangular-perimeter idea
generalised from the *bounds* to the *shape*, and it feeds Matter / crowd / nav / line-of-sight like any
other collision.

Two distinct cases, both already expressible:

- **Outside the zone** (the notch, beyond the field) → *no floor* → auto-fenced void. Nothing to author
  beyond painting the floor.
- **Inside the zone but impassable** (a wall, or water you can see across but not cross) → *floor (or water)
  tile + collision*. The normal collision layer — set `fenceVoid: false` only for the rare
  floorless-but-walkable case.

Caveats: the shape only *looks* right after **Phase 2 tile rendering** (today the renderer fills the whole
bounding box, so an L still *draws* as a rectangle — the fence is real, the look isn't yet). And whether the
zone *edge* blocks sight (a treeline does, an open-vista cliff doesn't) is a later per-edge flag; void edges
occlude by default, like walls.

## Authoring pipeline: Realmsmith

**Realmsmith is a self-built web app** — a focused map editor (desktop, mouse + keyboard), *not* a
third-party tool. We build rather than adopt Tiled deliberately: a tool we own fits **100%** of our needs
(our exact object kinds, our art, our shortcuts) instead of the ~80% a generic editor covers, and we have a
head start — it imports `@heroic/core`'s zone types and reuses the game's Skia renderer, so its canvas *is*
the game's view (true WYSIWYG) and it reads/writes the runtime zone format **natively**. There is no
import/translation step: **"save" writes the zone file directly.**

**The runtime zone format is the contract** — Realmsmith writes it, the game loads it. Owning both ends is
what makes the next part possible.

### The tight loop (the reason to own the tool)

The payoff is turnaround. The target cycle:

    edit in Realmsmith
      └─ save ──▶ zone .json   (the authored source of truth; committed to git)
            └─ watcher: validate + copy ──▶ apps/<game>/assets/zones/
                  └─ Expo Fast Refresh ──▶ game reloads → greedy-mesh → chunk → bake → live

A later enhancement could push the zone straight to a running game over a socket and hot-swap it without the
file round-trip — but the file-based loop above is the robust v1.

### Authored vs. game-ready

A zone has two *logical* forms (one file or two — TBD):

- **Authored** (the editable source of truth, committed): tile layers + collision **as drawn** (free rects
  + painted cells) + objects + meta. This is the precious file — what you re-open to revise.
- **Game-ready**: the same data with collision **greedy-meshed to `Aabb[]`** and sliced into chunks.

The reductions (greedy-mesh, chunk-slice) are cheap and deterministic, so they can run at **game load** —
letting the *saved* file stay in authored, diff-able form and still load directly. Per-chunk `SkPicture`
baking is always a load-time step (it needs Skia + the device).

- Objects carry **typed properties** mapped to existing systems: a `spawner` → [spawners](./spawners.md)
  config; `waystone` / `settlement` → [realms-and-overworld](./realms-and-overworld.md); `exit` → the
  zone-connectivity graph. Realmsmith gives each object kind a purpose-built property form — the 100%-fit win
  over a generic property table.

## Breakables

Some solid objects have **hp** and can be destroyed — a wooden wall you knock down to open a path, a barrel
you shoot to explode. These are **not enemies**, but they reuse an enemy's *combat* half. The engine already
splits an enemy into a **`Combatant`** (hp + `resolveAttack`) + a **`Mover`** + a **`Brain`**; a breakable is
simply:

> **`Combatant` + a static `Aabb` blocker — no `Mover`, no `Brain`.**

It takes hits through the exact path enemies do (`resolveAttack`, hit-flash, on-death hook), but spatially it
behaves like a wall: while alive it joins **collision, the nav grid, and the occluders**. The difference from
a wall is that it's **removable** — which is the whole point (break the wall → the path *and* the sightline
open).

- **Authored content.** A breakable is placed by the designer, so it lives **in the zone file** as a
  first-class `breakables[]` (not spawned at runtime like enemies, which come from [spawners](./spawners.md)).
- **Static vs dynamic collision.** Authored `collision` never changes → greedy-meshed + baked. Breakables are
  **dynamic** collision → tracked individually so they can be dropped on break.
- **On break:** every breakable vanishes (opening the path); `onBreak` lists *extra* effects — `explode`
  (an AoE that hits enemies, the player, **and other breakables**, so barrels chain-detonate) and later
  `drop` (loot). The AoE reuses the combat system.

This introduces two real (bounded) engine changes, both agreed:

1. **Hittable targets generalise from circle → also `Aabb`.** Today everything hittable is a circle
   (`hurtCircles`); a breakable wall is rectangular, so projectile- and arc-vs-target resolution gain an AABB
   case. (Barrels can use a small box too — one shape model.)
2. **The world becomes mutable.** Nav, occluders, and collision are built once today; breaking a breakable
   must *incrementally* drop its box from collision, reopen its nav cells, drop its occluder (sight/fog
   reopens), and redraw. Breakables render in the **dynamic** layer (they flash/change), not the baked chunk.

## Zone format

The agreed format, implemented in `@heroic/core` (`src/zone/`). Two shapes: the **authored file** Realmsmith
writes and the game loads, and the **runtime form** `loadZone` derives from it.

```ts
// ── Authored file: Realmsmith writes it (committed to git), the game loads it. JSON. ──
interface ZoneFile {
  format: number;                          // ZONE_FORMAT_VERSION — migration safety
  id: string; name: string; band: number;  // band → realms-and-overworld
  size: { cols: number; rows: number };    // zone dimensions, in tiles
  tileSize: number;                        // px per floor tile
  chunkTiles: number;                      // tiles per chunk side (loader slices to this)
  tileset: string;                         // atlas path; tile ids index its source rects
  layers: { floor: number[][]; decor?: number[][] };   // [row][col] tile ids; 0 = empty/void
  collision: {                             // AS DRAWN; greedy-meshed at load
    rects: Aabb[];                         // free rectangles (centre + size, world px)
    cells?: number[][];                    // painted solid cells, 0/1
    cellSize?: number;                     // px per collision cell (independent of tileSize)
  };
  breakables: BreakableDef[];
  objects: ZoneObject[];                   // spawner / waystone / settlement / playerSpawn / exit / poi
  fenceVoid?: boolean;                     // default true: floorless cells become solid (the zone's shape)
}

interface BreakableDef {
  id: string;
  kind: string;            // "wood-wall" | "barrel" | … → art, hit-feel, defaults
  box: Aabb;               // solid footprint + hit target, world px
  maxHp: number;
  occludes?: boolean;      // blocks line-of-sight while alive (wall = true, barrel = false)
  onBreak?: BreakEffect[]; // EXTRA effects; every breakable vanishes (path opens) regardless
}
type BreakEffect =
  | { type: "explode"; radius: number; damage: number }
  | { type: "drop"; table: string };       // loot — later

interface ZoneObject {
  id: string;
  kind: "spawner" | "waystone" | "settlement" | "playerSpawn" | "exit" | "poi";
  x: number; y: number; w?: number; h?: number;   // world px
  props: Record<string, string | number | boolean>;
}

// ── Runtime form: loadZone(file) derives this; the game holds it in memory. ──
// Collision greedy-meshed to Aabb[]; layers sliced into chunks (each baked to an
// SkPicture app-side at load); breakables carry mutable hp/alive state.
```

(`Aabb` is the core `{ x, y, w, h }` centre+size already used by `stepCrowd` / `buildNavGrid` /
line-of-sight — so loaded collision drops straight into the existing systems.)

## Phasing (incremental, ship ETG first)

1. **Data model + loader.** Define the runtime zone format in `@heroic/core` (+ greedy-mesh / chunk
   helpers). Hand-author the *current* arena as a zone file and load it in the game — same game,
   data-driven. Proves the format before any editor exists.
2. **Per-chunk bake + culling.** Move static floor/walls into per-chunk `SkPicture`s; draw only visible
   chunks. The dynamic layer is unchanged.
3. **Realmsmith editor + the tight loop.** Build the web editor against the format; wire save → watch →
   copy → Expo hot-reload so a saved map is live in seconds. Now zones are authored, not hand-written.
4. **Multiple zones + transitions.** Load a zone on entry, wire `exit` objects to the realm sequence,
   reset/rebuild the per-zone grids (fog/nav/spatial) on load.
5. **Streaming / eviction (deferred → Journey).** Resident-chunk window with hysteresis; windowed grids.
   Only when a zone won't fit resident.

## What changes in the current code

The blockers are the **single-square-arena assumptions** baked everywhere:

- `constants.ts` `WALLS` / `PILLARS` / `OCCLUDERS` → loaded from zone data, per zone.
- `createFogGrid(ARENA_SIZE, …)`, `buildNavGrid(ARENA_SIZE, …)`, `createSpatialGrid(ARENA_SIZE, …)` → sized
  to the **zone** and rebuilt on zone load (windowed only later, for Journey).
- `clampCircleToBounds(…, ARENA_SIZE)` and the arena-edge bounds → per-zone bounds (and eventually walls,
  not a hard square clamp).
- `recordCombatScene` static block (floor + `WALLS` + `PILLARS`) → per-chunk baked pictures.

## Where this lives (for implementation later)

- **Content:** zone files authored in **Realmsmith**, committed to git. Handcrafted per [realms-and-overworld](./realms-and-overworld.md).
- **Realmsmith (editor):** a standalone web app importing `@heroic/core` types and reusing the zone
  renderer; plus the save → watch → copy loop (the watcher in `scripts/`).
- **`@heroic/core`:** the zone/chunk data model, greedy-meshing, chunk math, (later) the streaming window —
  pure, deterministic, unit-tested like the rest of core.
- **`@heroic/engine` / app:** the chunk/zone renderer (per-chunk `SkPicture` bake + cull) — factored so
  **the editor and the game render identically** — and the adapters that hand zone collision to Matter /
  `stepCrowd` / `buildNavGrid` / line-of-sight.

## Open / deferred (own docs or tuning)

- **True streaming/eviction** and **windowed grids** (Journey-scale).
- **Hierarchical pathfinding** for cross-zone / very large worlds (current A* is per-zone).
- **Finished tile art** — the atlas pipeline (`drawAtlas`) is adopted now; only the artwork is placeholder.
  Also **animated tiles**.
- **Angled / polygon collision** (see above) — only if art demands it.
- **Overhead / decal layers**, lighting per zone.
- **Realmsmith enhancements (post-v1):** live socket push + hot-swap (skip the file round-trip),
  auto-tiling / terrain brushes, in-tool editing of zone adjacency / stitching.
- **Zone connectivity graph & transitions** — overlaps [realms-and-overworld](./realms-and-overworld.md);
  the `exit` object kind is the hook.
- **Save integration** — discovered map / fog persistence per zone (realms doc: world-state persistence).

## Glossary

- **Realmsmith** — our self-built web map editor (desktop, mouse + keyboard) plus its save → watch →
  hot-reload loop; reads and writes the runtime zone format natively.
- **Tilemap** — a level expressed as 2D arrays of small cells (tile IDs).
- **Tile** — one cell of a visual layer; an ID indexing a source rect in a tileset atlas.
- **Layer** — one stacked plane of a zone (floor / decor / collision / objects), edited and consumed
  independently.
- **Chunk** — a fixed block of the world; our **bake unit** (per-chunk `SkPicture`) now, **streaming unit**
  later.
- **Culling** — drawing only what's in the camera view. **Streaming** — keeping only nearby chunks resident.
- **Bake** — record static geometry into a reusable `SkPicture` once, then replay it per frame.
- **Greedy meshing** — merging runs of adjacent solid cells into a few large rectangles (at build/load).
- **AABB** — axis-aligned bounding box (our `Aabb`: centre + w/h). **OBB** — *oriented* (rotated) box;
  deferred.
- **Atlas** — one image holding many tile sprites, drawn batched via `Skia.drawAtlas`.
- **Hysteresis** — a load/unload margin so chunks don't thrash on/off at a boundary.
- **Object layer** — a zone layer of free-placed entities (not grid cells) — spawners, waystones, exits —
  each with typed properties.
- **Scopes** — **render** (drawn) ⊂ **stream** (resident), with **sim** (ticking) tuned on its own.
