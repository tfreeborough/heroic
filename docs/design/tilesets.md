# Tilesets

Status: **built (v1)** — core + Realmsmith + Blood in the Sand on 2026-07-13; the gauntlet's
renderer swap is the remaining consumer · Applies to: how zones get **real artwork** —
floor/decor tiles and **standing props** (walk-behind sprites with hidden collision
footprints) — in the games (Enter the Gauntlet, Blood in the Sand) and in **Realmsmith**
authoring · Companion to [world-representation](./world-representation.md) · Drafted: 2026-07-13

## The problem

The zone format has carried a tileset slot since day one — `ZoneFile.tileset` ("atlas image path;
tile ids index its source rects") and per-cell tile ids in `layers.floor` / `layers.decor` — but
nothing consumes it. Every renderer draws placeholders:

- **Enter the Gauntlet** bakes a light/dark checkerboard per chunk (`bakeFloorChunks`), with a
  comment marking the seam: "when real art lands, swap the draw rule here".
- **Blood in the Sand** ignores floor data entirely — one flat sand rect with a rim.
- **Realmsmith** mirrors the gauntlet checker, and its floor brush only ever paints id `1`
  (the data layer, `setFloor`, already accepts any id — the *palette UI* is what's missing).

We now have purchased tile art to put in. This doc decides how a tileset is defined, where the
images live, how each consumer resolves and draws them, and what Realmsmith needs so tiles can be
painted — without touching the wire protocol, the server, or the sim.

## What a tileset is (v1)

A tileset is a named **atlas**: one image containing all the tile artwork, cut into a uniform grid
of square cells. Tile ids map to cells by position:

- **id `0`** = empty (no tile — the void backdrop shows through; unchanged meaning).
- **id `N` (N ≥ 1)** = atlas cell `N − 1`, counting **row-major** (left→right, top→bottom).

So the id in the zone JSON *is* the address in the image — no per-tile lookup table to author or
drift. A tileset needs exactly three facts beyond its image:

```ts
/** In @heroic/core — pure data, no renderer. */
export interface TilesetDef {
  /** Cell size in the atlas image, px (the art's native tile resolution, e.g. 16). */
  cellSize: number;
  /** Cells per atlas row — with the image height this fixes every id's source rect. */
  columns: number;
  /** Optional cap so painting can't emit ids past the art. Default: columns × rows. */
  tileCount?: number;
}
```

plus a pure helper `tileSourceRect(def, id)` → `{x, y, w, h}` used by every renderer, so the
id→rect rule exists in exactly one place.

**Atlas cell size ≠ zone tile size.** `cellSize` is a property of the *art* (purchased packs are
commonly 16/32/48px); `ZoneFile.tileSize` is a property of the *world* (64px today). Renderers
scale the source rect to the world tile — crisp with nearest-neighbour sampling for pixel art.
Zones don't change when art resolution does. (The desert pack is 16px, so the arena's 64px tiles
mean a 4× integer scale — clean for pixel art, but eyeball it in Realmsmith early; if it reads too
chunky at gameplay zoom, dropping the arena to `tileSize: 32` is a data-only change.)

## The first real content: the desert pack

The purchased desert set (in `apps/realmsmith/tilesets/desert/`, pre-import) is **16×16** art,
split into three role sheets — and the split maps cleanly onto our layer model:

- **`ground_tile.png`** (23×28 cells) → the **floor layer**. Sand bases with edge/transition
  pieces, in two colour variants (light/dark) stacked vertically. The cross/blob layouts are
  autotile *templates* — with v1's explicit-id brush you pick edge pieces by hand.
- **`props.png`** (15×19 cells) → **props** (see the props section below) and small **decor**.
  Multi-cell sprites: cacti ~1–2 cells wide × 2–3 tall, trees ~3×4, rocks 1×1 up to 4×3, plus
  single-cell grass tufts and pebbles.
- **`wall_tile.png`** (10×6 cells) → **paintable floor/decor tiles**, not blocking geometry:
  cliff/ledge art that gives Pokémon-style visual height and dimension. Paint them where you
  want the *look* of a rise; where the terrain should actually block, pair with the **hidden
  collision material** — the third `CollisionMaterial` (`"hidden"`, cell code 3): blocks
  movement, never draws in-game (the tile art is the visual), never occludes, and — unlike
  wall/void — coexists with painted floor. The editor shows it as a translucent blue box.
  It's a prop footprint, but paintable: invisible fences, map-edge barriers, tile-art cliffs.
  (Real drawn walls stay procedural; tile-skinned walls remain a later pass.)

Import repacks all three sheets into one gapless `assets/tilesets/desert.png`
(`cellSize: 16`), stacked ground (rows 0–27) → wall (28–33) → props (34–52); the paintable
sheets come first so `tileRows: 34` exposes exactly them in the editor's tile palette.

## Props: partial collision and walk-behind

A cactus isn't a floor tile. Its **base blocks movement** (you can't walk through the trunk), but
its **top should draw over a player standing behind it** — walk north of a cactus and you're
partly hidden by it. That second half is **y-sorting** (the painter's algorithm): each frame,
sprites — players, enemies, props — draw in order of their **baseline** (their "feet" y in world
px); whoever's feet are lower on screen is nearer the camera and draws on top.

That has a structural consequence: a walk-behind prop **cannot live in the decor tile layer**.
Decor is baked into per-chunk pictures drawn *below* every entity, so a decor cactus could never
overlap a player. So the model splits prop-like art in two:

- **Flat decor** (single-cell ground detail, cracks) — stays in the `decor` tile grid. No
  collision, no sorting, baked with the floor. Cheap and plentiful. (The desert pack's tufts
  and pebbles ended up as footprint-less *props* instead — its art draws them across cell
  boundaries, so they can't be single decor ids; the decor layer remains for cell-aligned art.)
- **Standing props** (cacti, trees, rocks) — **placed objects**, not tiles. A new
  `ZoneObjectKind: "prop"` whose `props.prop` names a `PropDef` in the tileset's registry entry:

```ts
/** A standing prop: a multi-cell sprite with feet. Defined once per tileset in core. */
export interface PropDef {
  /** Source region in the atlas, in cells: [col, row, cols, rows]. */
  cells: [number, number, number, number];
  /**
   * Hidden collision footprint in *cells* (floats fine), anchored to the
   * sprite's bottom-centre — scaled by `zone.tileSize` exactly like the sprite,
   * so props stay consistent across zones of different tile scales. Covers the
   * base only (trunk, boulder bottom) — the sprite's upper region has no
   * collision, which is exactly what makes walk-behind read correctly.
   * Absent → purely visual (a grass tuft you can walk through).
   */
  footprint?: { w: number; h: number };
  /** Footprint also blocks sight/projectiles/targeting (a boulder pile does;
   *  a cactus doesn't). Only meaningful with a footprint. Default false. */
  occludes?: boolean;
}
```

The placement (`ZoneObject.x/y`) is the prop's **bottom-centre** — feet position, sort baseline,
and footprint anchor are all the same point, so a placed prop is one click and everything else
derives from the def.

**The footprint is hidden collision.** At load, footprints join the movement-collision set
(`zone.collision`) exactly like authored rects — `stepCrowd`, navgrids, and the sim treat them
identically — but they are **never drawn** as geometry: the sprite *is* the visual, so footprints
stay out of the procedural wall/void drawing (they'd double-render otherwise). `occludes: true`
additionally joins the sight-blocking set. Realmsmith *does* draw footprints (a translucent
overlay on the placed prop) — hidden in game, visible to the author.

**Rendering** — props leave the baked-chunk path and join the entity pass: cull to viewport,
merge with players/enemies, sort by baseline y, draw. Prop sprites are static quads
(`drawImageRect` from the atlas), so the per-frame cost is a sort of a small visible set —
the same order of work as the existing per-entity draws.

For Blood in the Sand specifically: footprints are part of the zone file, so the server-side sim
collides against them with zero new netcode — props never move, nothing new goes on the wire.
An `occludes` boulder becomes gameplay (it breaks auto-targeting like the pillar does); a cactus
(`occludes: false`) is cover for your body but not your target-lock.

### Deliberately out of scope in v1

- **Autotiling** — editors like Tiled can auto-pick edge/corner variants so painted regions get
  seamless borders (Wang/blob tiles). Big authoring win, big feature. v1 paints explicit ids; the
  format doesn't change when autotiling arrives later (it's an editor-side brush, the saved ids
  are the same kind of ids).
- **Animated tiles** (water, torches) — needs a frame schedule per id; add as a `TilesetDef`
  extension later.
- **Margins/spacing in the atlas** — many purchased sheets pad each cell. Rather than carry
  margin/spacing fields through every renderer forever, we **repack once at import time** to a
  clean gapless grid (see "Importing purchased art"). The runtime format stays trivial.
- **Multiple tilesets per zone** — one atlas per zone. A zone that wants two looks gets a merged
  atlas.
- **Tiled wall skins** — walls keep their procedural pillar look for now (see the desert-pack
  section); wall-tile art waits until floors and props have proven the pipeline.

## Where things live: the audio-manifest pattern

Precedent: zone JSON names a music bed (`audio.beds.idle: "idle"`), and each app resolves the
name through its own `AUDIO_MANIFEST` of `require()`d files. Names in content, files per consumer.
Tilesets copy this exactly — `ZoneFile.tileset` stays a **name**, not a path:

- **`@heroic/core`** gets `TilesetDef`, `tileSourceRect`, and a registry of defs by name
  (`TILESETS: Record<string, TilesetDef>`). Defs are tiny pure data — the *geometry* of each
  atlas is shared and versioned once, next to the format it serves.
- **Each game app** keeps the images in `assets/tilesets/<name>.png` and a manifest mapping
  name → `require("../../assets/tilesets/<name>.png")`, exactly like `AUDIO_MANIFEST`. Metro
  bundles them; the app only ships the atlases its zones use.
- **Realmsmith** resolves the same names to URLs. Its dev server already has one sanctioned
  exception to "no server" (the Asset Forge middleware, which reads/writes the games' asset
  folders); a sibling `/tilesets/<name>.png` route serves the images straight from the game
  apps' asset folders. No copies, no picker ceremony per image — open a zone, the atlas it names
  just loads.
- **The Bun server / sim** never touch any of this. `loadZone` copies `tileset` through as it
  always has; collision, spawns, and the wire protocol are untouched. Tilesets are 100% visual.

**Unknown name → placeholder.** A manifest/registry miss logs one warning and falls back to the
current checkerboard (Realmsmith and gauntlet) or flat sand (arena). Every existing zone says
`"tileset": "placeholder"` today, so all current content keeps rendering identically without
edits — `placeholder` is simply a name no manifest defines, forever.

## Rendering

### Games (Skia)

The seam was designed in advance: only the draw rule inside the per-chunk bake changes. On zone
load, resolve `zone.tileset` → atlas `SkImage`; in `bakeFloorChunks`, replace the two-colour
checker fill with one `drawImageRect(atlas, tileSourceRect(def, id), worldRect)` per non-zero
cell — floor layer, then decor over it. Everything downstream (chunk `SkPicture`s replayed per
frame, off-screen chunks culled) already exists and is the reason per-tile draw cost doesn't
matter: it's paid once at load, not per frame.

Blood in the Sand adopts the same bake (lifted into the engine package or copied — it's ~40
lines): `render.ts` draws the baked chunk pictures where it currently draws the flat sand rect.
The arena is 4 chunks; culling is moot at that size but comes along free. Image decode is async
on Skia (`useImage`) — until it resolves, draw the current placeholder, so there's no startup
flash of nothing.

### Realmsmith (canvas 2D)

`drawZone` replaces its checker fill with `ctx.drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh)`
per visible cell, using the same `tileSourceRect`. (`imageSmoothingEnabled = false` for pixel
art.) No baking needed — it already redraws the viewport per frame and zones are editor-sized.

**Palette UI** — the one genuinely new surface. A panel renders the atlas as a clickable grid
(one cell per id, current selection highlighted); the floor brush paints the selected id instead
of the hardwired `1`. Decor gets the same brush targeting the decor layer. Right-click/erase
paints `0`, as now. `setFloor` needs no changes.

**Prop placement** — the palette gains a props tab listing the tileset's `PropDef`s (drawn as
their sprites); clicking the viewport places a `"prop"` object at the cursor, snapped or free
like other objects. The viewport draws the sprite plus the translucent footprint overlay (amber =
movement-only, red = also blocks sight), and the usual object move/delete affordances apply.
Placement validity tests the candidate *footprint* against authored solids and other props'
footprints — not the generic point-in-collision gate, which would see the prop's own footprint.

**Tileset switching** — the dev server also exposes an index (`GET /tilesets`) of every atlas it
can find across the game apps; the Zone panel (click empty space) offers them in a dropdown.
Swapping a zone to any future tileset is one pick — no JSON hand-editing.

## Importing purchased art

Purchased packs rarely arrive as one clean gapless grid — expect multiple sheets, sometimes
padding, and more tiles than a zone needs. The desert pack is already gapless but split across
three role sheets, so its import is purely a merge. The step (manual at first, an Asset Forge job
later if it becomes routine):

1. Pick/compose the cells we actually want into **one PNG, uniform gapless grid**, power-of-two-ish
   dimensions, named `assets/tilesets/<name>.png`. (Licence note: check the pack's terms allow
   redistribution inside a built app — virtually all game-asset licences do, but keep source packs
   out of git if theirs says so; only the repacked atlas is committed.)
2. Add the `TilesetDef` (cellSize, columns) and the set's `PropDef`s to the core registry, and a
   manifest line in each app that uses it.
3. Set `"tileset": "<name>"` in the zone JSON, paint floor/decor, place props.

## Build order

1. **Import the desert pack**: repack the three sheets into `desert.png`, choose the prop roster.
2. **Core**: `TilesetDef`, `PropDef`, `tileSourceRect`, registry; `"prop"` object kind;
   footprints folded into `loadZone`'s collision/occluder sets. Pure functions — unit-testable
   in isolation (id↔rect round-trips, footprint→Aabb placement, occluder membership).
3. **Realmsmith**: dev-server tileset route, atlas loading in the viewport, palette UI + prop
   placement. Editing with real art comes first so dressing the arena is possible before the
   games render it.
4. **Blood in the Sand**: chunk bake + atlas draw in `render.ts`, props in the y-sorted entity
   pass (smallest game surface, 4 chunks, and the active project). Repaint `arena-00` with the
   desert set. The sim's collision comes from `loadZone`, so footprints work server-side with
   no sim changes.
5. **Enter the Gauntlet**: same swaps inside `bakeFloorChunks` and its entity draw — mechanical
   after (4).
6. Later, separately: autotile brush, tiled wall skins, animated tiles, multi-cell decor stamps,
   Asset Forge tileset importer.
