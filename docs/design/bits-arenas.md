# Blood in the Sand — arenas: many maps, random rotation, editor workflow

**Status:** designed + built 2026-09-13. Rotation grown to three maps + picker cards 2026-09-18
(protocol v35).
**Owner decisions (Tom):** several arenas, one chosen at random per room rather than the same
map every time; practice gets a picker; the editor lists and creates arena files itself.

## The problem

Every match is `arena-00`. It is imported statically in eight places — server room, practice,
primer, promo rig, and the renderer, which derives world size, crowd, walls and the floor bake at
module scope — so there is no notion of *which* arena anywhere. With the ancient-ruins tileset and
terrain brushes ready (tilesets.md), the next arena is a content job, and content jobs need a
pipeline: new file → edit → show up in the game.

## Shape

### Registry (sim package)

`packages/blood-in-the-sand-sim/src/zones/` holds every arena JSON. `zones/index.ts` is
**generated** (by the editor's New-arena action, or by hand: one import + one entry per file) and
exports `ARENAS: Record<id, ZoneFile>`. `zone.ts` keeps `ARENA_00` as the default and adds
`ARENA_ROTATION: readonly string[]` — the ids the server may serve online. Rotation is
hand-edited on purpose: a half-built arena can sit in the registry (practice, editor) without
being dealt to strangers.

The same-file-both-ends rule stands: the zone itself never goes on the wire; server and client
import the same package. `welcome.zoneId` (always there) is now *load-bearing* — it tells the
client which registry entry to render.

### Who picks

- **Ranked:** the server picks uniformly from `ARENA_ROTATION` when the room is created — always,
  nobody chooses. Every seat sees the same map, so fairness is unaffected. Since 2026-09-18 the
  rotation is all three maps: First Blood (`arena-00`), Obelisk (`desert-1`), Ancient Rites
  (`grasslands`).
- **Skirmish / brawl:** the host picks on the create sheet (v35: `createRoom.arena?`), Random by
  default. The server honours a pick only if it is a rotation id (`hostArena`) — anything else is
  a roll — so a half-built registry arena can never be dealt to strangers. The room list shows the
  arena name.
- **Practice:** the same picker over the whole registry, rotation or not, so a new arena can be
  walked before it ships. Random is the default.
- **Primer / showcase / server bot script:** stay on `arena-00` (scripted for its layout).

### Client rendering

`render.ts` loses its module-level `ZONE`. An `ArenaScene` (`game/scene.ts`) bundles everything
the renderer derived from the zone — world size, tileset def, sorted props, wall rects, crowd,
floor-bake cache — built once per arena id and memoised. `ArenaRenderInput` gains `scene`;
`recordArena` installs it as the frame's current scene and the helpers read from that (one
assignment per frame, no allocation — same idiom as the other per-frame module state there).
`useArenaAtlas(zoneId)` resolves the atlas from the arena's tileset; the manifest lists every
atlas any arena uses.

### Picker cards

Skirmish and practice share one `ArenaPicker` (`components/ArenaPicker.tsx`): a sideways row of
cards, Random first, each arena a fully rendered image of the map over its name. The images are
not painted — `bun run arena:cards` (in `apps/realmsmith`, `scripts/arena-cards.ts`) renders each
registry arena through the same zone loader and tileset registry the game uses (floor, decor,
ground props, contact shadows, standing props by baseline) to `assets/arenas/<id>.png` (512 px),
and regenerates `game/arenaCards.generated.ts`, the id → `require` map Metro needs. **Re-run it
after an arena's art changes or a new arena lands.** An arena with no card yet still gets a plain
named card, so a fresh map is never unpickable. Random wears a strip of every map on offer.

### Compatibility rule

A client that lacks an arena id cannot render it. The protocol version already gates client and
server to the same package build, so: **adding an arena to `ARENA_ROTATION` is a protocol bump**
(a note next to the constant). Adding one to the registry alone (practice-only) is not.

## Editor workflow (Realmsmith)

The editor's file model was one native file picker + one remembered handle. That is fine for a
single realm and wrong for "a few arenas": every switch is a picker dialog and a permission
prompt, and there is no way to make a new one.

**Project zones via the dev server** — the pattern `/tilesets` and the Forge already set:

- `GET /zones` — every `zones/*.json` the repo knows (`packages/*/src/zones`,
  `apps/*/assets/zones`): path, id, name, owning package.
- `GET /zones/<path>` / `PUT /zones/<path>` — read / save.
- `POST /zones/new { from, id, name }` — clone an existing arena under a new id (a fresh 25×25
  would be the obvious next option) and regenerate the sim's `zones/index.ts` so it is in the
  registry immediately. Rotation stays a hand edit.

In the UI: the landing page lists project zones (one click opens, no permission dance) with a
**New arena** button; the toolbar gets a zone switcher; **Open file…** stays as the fallback for
JSON outside the repo (a `handle`-sourced zone saves through the File System Access API exactly
as before). `docs/design/realmsmith.md`'s "no server" is now "no server for anything the browser
can do alone" — reading and writing the repo's own content is the dev server's job.

## Not now

- Arena-specific art (each arena is dressed by its tileset; a per-arena crowd/backdrop is later).
- Weighted rotation, "veto"/vote. Random uniform is the whole ask for ranked (host pick for
  skirmish landed 2026-09-18).
- Rendering the cards automatically on Realmsmith save — a manual script for now.
- Deleting/renaming arenas from the editor — a filesystem job, rare.
