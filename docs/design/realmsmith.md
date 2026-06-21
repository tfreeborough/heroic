# Realmsmith — the zone editor

Realmsmith is our **self-built, web-based map editor** for authoring zones (realms). It exists because
hand-authoring zones as TypeScript — computed pillar rects, an `isFloor` predicate for the floor shape,
hand-typed barrel coordinates (see `realm-00.ts`) — does not scale, and authoring a second zone by hand is
what currently blocks Phase 3 (multiple zones + transitions). The editor turns content creation from a
chore into a tight loop, which is the strategic unlock for the whole game.

> **The loop is the point.** Edit in the browser → save → the running game hot-reloads the zone in seconds.
> Everything below serves that loop. See [world-representation.md](./world-representation.md) for the zone
> format this editor reads and writes; that format is the contract between editor and game.

## Why self-built (vs. Tiled)

Tiled is ~80% fit but speaks its own format; we'd maintain an import/export bridge and still diverge from our
runtime model. A self-built editor is a 100% fit: it edits **our** `ZoneFile` natively, reuses our pure-TS
zone logic (`loadZone` / `greedyMesh` / chunking) verbatim, and renders tiles the *same way the game does*
(see "Tilesets" below), so the editor preview matches the game by construction.

## Stack (decided 2026-06-21)

**Vite + React (DOM) + an HTML5 Canvas2D viewport, reusing `@heroic/core`.** Save via the browser
**File System Access API** (no server).

Rationale:

- An editor is mostly *chrome* — toolbars, tile palettes, layer panels, property inspectors, file dialogs,
  keyboard shortcuts. That UI is dramatically more productive in plain React/DOM than in React-Native-on-web
  (which has no native form controls and flexbox-only layout).
- The reuse that actually prevents editor/game divergence is the **zone format + `loadZone`/`greedyMesh`/
  chunk logic**, all of which live in `@heroic/core` — pure TypeScript, no Skia/RN/DOM, so they import into a
  Vite app unchanged. The game's Skia *draw calls* are coupled to live combat state (fog, lighting, enemies,
  the explosion VFX) and are **not** the valuable reuse — an editor wants none of that atmosphere.
- The viewport (floor tiles, collision rects, breakable boxes, object markers) is simple 2D blitting that
  Canvas2D does faithfully, including tilesets (see below).

**Rejected:** Expo-web + react-native-skia (pixel-identical preview, but clunky editor UI and CanvasKit/WASM
setup friction for zero gameplay need). If we ever need pixel-identical preview *including shaders*, we can
drop CanvasKit — the same Skia WASM the game uses — into the Vite viewport later without restructuring the
editor. We won't need it for authoring.

## Tilesets — keeping editor and game identical

A tileset is an image atlas; each tile id maps to a source rectangle in it. The game draws tiles with Skia
`drawAtlas`; the editor draws them with Canvas2D `drawImage(atlas, sx,sy,sw,sh, dx,dy,dw,dh)` — blitting a
sub-rect of an atlas, the textbook 2D tile-render. They stay identical by sharing the one thing that matters:
the **tile-id → source-rect mapping**, a pure helper in `@heroic/core` (e.g. `tileSourceRect(tileset, id)`)
that both the game's baker and the editor's canvas call. The tileset image + its metadata (tile size,
columns) are shared data; given the same inputs both renderers produce the same rects, so the floor looks the
same in both. (Today tiles are placeholder coloured rects; the helper lands when real atlases do — Tom plans
to add tilesets soon, which is exactly why we pin the mapping in core now.)

## The data contract

The editor reads and writes the **authored `ZoneFile`** (defined in `@heroic/core` `zone/format.ts`) as
**JSON**, under the game's `apps/enter-the-gauntlet/assets/zones/*.json`. The game loads those JSON files
through `loadZone(json)` — which already takes a plain object, so no core change is needed. `realm-00` (today
computed TypeScript) gets exported once to `realm-00.json`; `constants.ts` imports the JSON instead of the TS
module (its `REALM_00.size.cols/rows` reads work unchanged on a plain object). Hand-authored TS zones can
still exist for special cases, but editor-managed zones are JSON — that's the format the editor can round-trip.

## Save loop (File System Access API)

1. On first use the editor calls `showDirectoryPicker()` and the user grants the game's `assets/zones/`
   folder. The directory handle is persisted in IndexedDB, so subsequent sessions are a one-click re-grant.
2. The editor reads existing zone JSON from that folder to open/edit, and writes JSON back on save.
3. Because it writes directly into `assets/zones/`, Metro's watcher sees the change and Expo **Fast Refresh**
   reloads the running game with the new zone — edit→live in seconds.

Constraints/risks: the File System Access API is **Chromium-only** (Chrome/Edge/Arc/Brave) — Realmsmith is a
desktop-Chrome tool. **To verify in M2:** that Metro Fast Refresh reliably fires on an imported-JSON change
(if not, fall back to a tiny touch/bump of an importing module, or a local watcher).

## Rendering & interaction (the viewport)

- A single `<canvas>`; a world→screen transform (pan offset + zoom) the editor owns. Camera math mirrors the
  game's (scale around an anchor), but the editor's camera is free (the user pans/zooms; no follow).
- Layers drawn back-to-front: floor tiles → collision (greedy-meshed preview + the painted cells) →
  breakables (with the same translucent/cracked tell for occluders) → objects (spawn/exit/spawner markers) →
  editor overlays (grid, hover cell, selection, the zone bounds).
- Tools select what a click does: **pan**, **paint/erase floor**, **paint/erase collision cells**, **place/
  move/delete** a breakable or object. Only one tool active at a time.

## Monorepo placement

`apps/realmsmith` — a new workspace (Bun workspaces already glob `apps/*`). It depends on `@heroic/core` via
the workspace. It does **not** depend on `@heroic/engine` (no Skia/RN). Its own `package.json` runs Vite.

## What lives where

- **`@heroic/core` (pure, shared):** the `ZoneFile`/`Zone` types, `loadZone`, `greedyMesh`, chunking, and the
  new `tileSourceRect` helper (when tilesets land) — plus any small pure zone-edit helpers worth sharing
  (e.g. set-a-cell, resize). The editor and game both depend on this; it is the contract.
- **`apps/realmsmith` (the editor):** all React/DOM UI, the Canvas2D viewport, the File System Access save
  loop, and editor-only state (current tool, selection, undo stack). None of this touches the game.

## Milestones

1. **M1 — read-only viewport.** Scaffold `apps/realmsmith`; export `realm-00` to `assets/zones/realm-00.json`
   and load it via `@heroic/core`; render floor + collision + breakables + objects with pan/zoom. Proves the
   data contract and the viewport. (Also migrate the game to load `realm-00.json`.)
2. **M2 — the save loop.** Paint/erase the floor layer; open/save via the File System Access API; confirm the
   running game Fast-Refreshes. This delivers the core value (edit→live).
3. **M3 — authoring.** Collision painting + placing/moving breakables and objects — drop the barrels and walls
   we built by hand, visually.
4. **M4 — polish.** Grid/snap, undo/redo, multiple zones + a zone switcher, validation (warn on out-of-bounds
   objects, no player spawn, etc.), and the real tileset path (`tileSourceRect` + atlas image).

## Deferred / open

- Multi-zone *links* (wiring `exit` objects to a realm sequence) — belongs with Phase 3, edited here later.
- Real tile art / autotiling — after the first atlas lands.
- Collaboration, versioning beyond git — out of scope; zones are git-committed JSON.
