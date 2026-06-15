# Line of Sight & Fog of War

Status: **demo built, design decisions open** · Applies to: both games (shared mechanic) · Last decided: 2026-06-14

A working slice exists: solid pillars in the gauntlet arena block what the player can see
behind them, and the world is rendered in three fog-of-war states — visible now, explored (a
dim memory of the layout), and never-seen (near-black). This doc records how it works and the
decisions still open before it becomes a real mechanic rather than a tech demo.

> New to the terms here? See the [Plain-English glossary](#plain-english-glossary) at the
> bottom.

## Intent

Solid objects should hide what's behind them. That single rule buys a lot: corners to peek,
pillars to break an archer's shot, rooms that hide an ambush until you step in. Tension comes
from *not knowing* — the player advances into the unknown, and the designer gets to place a
surprise just out of sight.

## How it works (the technique)

The world is continuous 2D, the camera bakes a world→screen transform into one Skia picture
per frame, and walls are axis-aligned rectangles. That's the ideal setup for the standard
**visibility polygon** method (a.k.a. 2D shadow-casting):

1. Treat every wall as a set of line **segments** (a rectangle is four).
2. From the player, cast a ray at every wall **corner** — plus one a hair to either side, so a
   ray can slip *past* a corner and land on whatever is behind it.
3. Keep each ray's nearest wall hit. Sort those hits by angle, join them into a polygon. That
   polygon is exactly the area the player can see (the **lit** region).
4. Fill the whole screen with dark, *minus* that polygon (an even-odd "punch a hole" fill). The
   hole is what you see; everything else is a blind spot.

A bounding box (the arena rectangle) is included among the segments so rays that point at open
space still terminate at the arena edge.

This is pure geometry and lives in `@heroic/core/src/vision/visibility.ts`, unit-tested, with
no renderer knowledge — so the **same** code can later answer gameplay questions, not just
draw. Two functions:

- `computeVisibility(origin, segments)` → the lit polygon (for drawing).
- `segmentClear(origin, target, segments)` → can A see B in a straight line? (for AI / shots.)

The renderer (`renderCombat.ts`) calls `computeVisibility` each frame from the interpolated
player position and paints the dark overlay just before the player marker, so blind spots hide
enemies and floor while the player is always visible.

Cost is trivial at this scale: ~5 pillars = ~24 segments → ~150 rays/frame → a few thousand
ray-segment tests, well within a 60 Hz budget on mobile. If obstacle counts grow a lot, the
escape hatches are: only recompute when the player has moved, or spatially index the segments.

## What's in the demo today

- A handful of `PILLARS` in the arena centre (`constants.ts`) — solid bodies you **collide**
  with (Matter.js blockers) *and* sight-blockers.
- **Three fog states**, layered over the world as dark overlays with soft edges. Two **radii**
  drive them, and both respect line of sight (walls block):
  - *Visible now* — clear, out to `VISION.sightRadius` and **fading with distance** from
    `sightFalloff`·radius outward (a radial gradient), so vision closes in around you even down
    an open corridor. Live enemies, projectiles and telegraphs render only here (clipped to the
    sight polygon), so memory never shows you current enemy positions.
  - *Explored* — dimmed to `VISION.exploredAlpha`. Anything you've had line of sight to within
    `VISION.discoverRadius` (> sightRadius, so a ring just past clear vision gets discovered).
    Static geometry stays faintly readable; the live world does not.
  - *Never-seen* — near-black at `VISION.unexploredAlpha`. Includes spots behind a wall you've
    never seen around, even close ones — discovery respects sight, so you can't reveal a room by
    walking past its wall.
- The explored region is a coarse memory **grid** (`FOG_CELL` px/cell) that `markVisible`
  rasterises the sight polygon into, clamped to `discoverRadius`
  (`@heroic/core/src/vision/fog.ts`, unit-tested). Created once; a new arena would call `resetFog`.
- Drifting **mist** (an SkSL runtime shader, `VISION.mistColor`/`mistScale`/`mistSpeed`) fills
  *only the never-discovered* layer — mist = genuinely unknown. Discovered-but-occluded memory and
  the sight-range falloff are flat/calm, so "remembered" reads differently from "unseen".
- 360° vision (no facing cone yet — you see all around you, just not through walls).

Tuning lives in one place: `COLORS.pillar`, the `VISION` block, and `FOG_CELL` in `constants.ts`.

## Known rough edges

- **Enemies in fog still fight you.** Rendering hides them, but the sim doesn't: a hidden enemy
  can still be auto-targeted, shoot you, and bite you — and the player will visibly aim into
  empty fog at it. That's the rendering/gameplay split below (decision 1), not a bug.
- **Fog softness vs. perf.** The memory frontier is drawn from the grid's square cells, then
  dissolved by a heavy blur (`VISION.fogSoftness`, ~cell-sized) so it reads as mist, not blocks;
  the current-sight edge keeps its own tight blur (`VISION.edgeFeather`). The blurred full-view
  fills plus the per-pixel mist shader are the main per-frame cost — if it stutters on device,
  lower `fogSoftness`/coarsen `FOG_CELL`, or cut the mist `fbm` octaves. The never-seen layer
  isn't clipped out of sight (current sight is a subset of explored, so it's already a hole in
  that layer); keep `discoverRadius − sightRadius` comfortably larger than `fogSoftness` so the
  blur can't bleed dark back over what you can see.
- **Sight falloff has no mist.** The clear→dim distance fade is a flat gradient, while the
  occluded-dim and never-seen layers drift. If the boundary between them reads oddly, the fix is
  folding the range falloff into the mist shader (distance-driven alpha) — noted, not done.
- **Still flat-coloured mist.** The blur makes it soft, but it's a static dark wash. The
  headline upgrade for *cool* is an animated drifting fog — a Skia runtime shader (SkSL fractal
  noise, a time uniform, masked to the fogged region). Bigger commit and best iterated on with
  the app running; see below.

## Decisions still open

These are the forks worth deciding deliberately rather than by default:

1. **Sight affects ranged combat (done).** Projectiles (player *and* enemy) now die on the wall
   or pillar they cross — `segmentClear(from, to, OCCLUDERS)` in the sim's projectile loops — and
   a hit on the far side of that wall doesn't count. Ranged enemies are gated on line of sight:
   they won't start (or hold) a windup through a wall, so ducking behind a pillar mid-cast
   cancels the shot. `OCCLUDERS` (arena box + pillar edges) now lives in `constants.ts`, shared
   by the renderer and the sim.
   The **movement** AI now routes too: when an engaging enemy loses line of sight it follows an
   A* path around the wall to the player's live position instead of sliding against it (see
   [enemy-behaviour](./enemy-behaviour.md) → Pathing). The **player** is gated symmetrically:
   auto-targeting only considers hostiles in line of sight, so you never lock onto, face, or
   auto-fire at something behind a wall, and a target that ducks behind cover is dropped. The
   **ambusher** now springs only when a clear line opens within its trigger radius (you walk into
   its eyeline), then commits and pursues — giving up only on distance.
   *Still open (minor):* a melee *cleave* arc isn't wall-checked, so a swing at a visible target
   could in theory clip an unseen enemy sharing the cone through a thin corner.
2. **Fog look & feel — now tunable.** Fog of war is built (flat dark layers + soft edges). Open
   polish: a gradient/vignette vision falloff instead of a hard polygon edge; a colour shift for
   explored vs. unseen so "remembered" reads differently from "unknown"; and whether explored
   memory should slowly *re-fog* if you don't revisit. All presentation, no new architecture.
3. **Last-seen "ghosts"?** When an enemy leaves sight, do we leave a faded marker at its last
   known position? More tactical, but it's a deliberate feature (and leans on the movement-AI
   perception work in decision 1), so deferred.
4. **Vision cone?** A forward-facing cone (you see where you look) is more tactical but fights
   the existing auto-facing/targeting. Probably *not* for this game, but noted.

## Plain-English glossary

- **Line of sight (LOS):** whether a straight line between two points is unobstructed. "Can I
  see that?" / "Can it see me?"
- **Visibility polygon:** the exact shape of everything an observer can see from where they
  stand, given the walls — a star-shaped region with the observer at its centre.
- **Ray casting:** shooting an imaginary line out from a point and finding the first thing it
  hits. We do it toward wall corners to trace the edges of the visible region.
- **Segment:** a straight wall edge (two endpoints). A rectangle is four segments.
- **Even-odd fill:** a rule for "fill the area between two shapes" — here, the screen with the
  visible polygon cut out of it, so only blind spots get darkened.
- **Fog of war:** the convention (from strategy games) where unexplored/out-of-sight areas are
  hidden or dimmed, often with explored areas dimly remembered.
- **Occluder:** anything that blocks sight — for us, the pillars and arena walls.
