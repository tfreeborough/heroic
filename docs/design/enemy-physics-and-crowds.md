# Enemy Physics & Crowd Scaling

Status: **agreed** (feel decisions locked 2026-06-16) · Applies to: both games (shared mechanic) · Last decided: 2026-06-16

This is the layer *below* [enemy-behaviour](./enemy-behaviour.md): that doc decides how an
enemy **thinks** (archetypes) and which way it **wants** to move (steering). This doc decides
how an enemy actually **moves and collides** in the world — and, crucially, how that stays
cheap when there are *lots* of them.

> **Why now.** The gauntlet demo drops to ~5–6 fps at ~150 enemies. We profiled it (per-second
> JS-thread timings) and found three separate walls, all of which this doc removes. The target
> is **150+ enemies at 60 fps on a phone**.

## The measured problem

Per-second averages from the live demo (sim step split into AI / physics; render is the Skia
picture recording; `steps/frame` > 1 means the loop is falling behind and catching up):

| Scene | sim step | – AI | – physics | render | fps | steps/frame |
|-------|----------|------|-----------|--------|-----|-------------|
| 0 enemies (after fog fix) | 0.2 ms | 0 | 0.1 | ~9 ms | ~45 | 1.4 |
| ~150 enemies | ~25 ms | ~7 | ~16 | ~22 ms | ~5 | **5.0** |

Reading it:

- **Physics ~16 ms** — the single biggest cost, and it does **not** drop when we disable
  enemy↔enemy collisions. That ruled out the collision *solver* and pointed at matter.js's
  **broadphase** (the pass that decides *which* bodies might be touching). See below.
- **AI ~7 ms** — the `separation` steering checks *every enemy against every other* (O(n²)).
- **Render ~22 ms** — at 150 enemies (vs ~9 ms empty), so ~13 ms is per-enemy draw cost. The
  flat ~9 ms baseline is fog-of-war, already cut from ~25 ms (cached tile + fog paths).
- **steps/frame pinned at 5.0** — a *catch-up spiral*: one sim step (25 ms) already blows the
  16.7 ms frame budget, so the loop runs the maximum 5 steps every frame trying to keep up,
  multiplying the sim cost 5× and running the game in slow motion. Fix the per-step cost and
  this self-resolves.

### Why matter.js can't scale here (root cause)

matter.js's collision detector (`Matter.Detector.collisions`) is **sort-and-sweep**: it sorts
all bodies by their left edge, then for each body walks rightward until the next body's left
edge passes the current body's right edge, at which point it stops.

```
spread out:   [A]   [B]   [C]      → each body's sweep stops almost immediately   ≈ O(n)
piled up:     [ABCDEF…]            → every body's box overlaps every other's      = O(n²)
              all left-edges < all right-edges, so the sweep never stops early
```

When a crowd **piles onto the player** — exactly the case we care about — every enemy's
bounding box overlaps every other's on the x-axis, the early-out never fires, and the detector
degrades to **O(n²) ≈ 11,000 pair checks per step** at 150 enemies. The collision-group filter
that would skip enemy↔enemy contacts is checked *inside* that loop, *after* the expensive
enumeration — so it saves the narrowphase + solver, but not the broadphase walk (nor the
per-step `sort` of 150 bodies). That's why removing collisions didn't help.

There is no fix inside matter.js: it dropped its grid broadphase in newer versions and exposes
no spatial-hash option. **The only way past O(n²) is to not have 150 dynamic bodies in the
matter world.**

> This supersedes the "steering is cheap — fine for hundreds every frame" note in
> enemy-behaviour.md: *per-enemy* steering is cheap, but the all-pairs `separation` and the
> all-pairs physics broadphase are both O(n²) and are the actual ceiling.

## The plan: a spatial grid + enemy movement in core

Two changes, and one structure shared between them:

1. **A uniform spatial grid** (a.k.a. spatial hash) in `@heroic/core` — the standard broadphase
   for crowds. It answers "which entities are near this point?" in ~O(1), turning every
   all-pairs O(n²) scan into ~O(n).
2. **Move enemy movement + collision out of matter.js into core**, using that grid. matter.js
   keeps only the **player + static walls** (~10 bodies → broadphase is free). Enemies become
   plain `{ pos, vel }` entities integrated in core.

This kills the two biggest costs at once (physics broadphase **and** AI separation both become
grid queries), it's deterministic and unit-testable (fits core's purity rule), and it gives us
full control over the swarm's feel — including *better* spacing than matter.js gave us.

### The spatial grid

A grid of square cells over the arena. Each step: clear it, drop every enemy into the cell its
centre falls in (O(n)). To find an enemy's neighbours within radius `R`, look only at the 3×3
block of cells around it.

```
   cell size = the largest query radius (separationRadius ≈ 56 → use 64 = one tile)

   ┌────┬────┬────┐   To service a query of radius R from ●, only the 9 shaded
   │    │    │    │   cells can hold a result (anything farther is ≥ 1 cell = R
   ├────┼────┼────┤   away). Check those, distance-test the few candidates, done.
   │    │ ●  │    │   No enemy outside the 3×3 can be within R, so none are missed.
   ├────┼────┼────┤
   │    │    │    │
   └────┴────┴────┘
```

- **Cell size** = the max neighbour-query radius across creatures (`separationRadius`, ≈56),
  rounded to **64** (= `TILE_SIZE`). With cell ≥ R, a 3×3 block is guaranteed to contain every
  neighbour within R. (Bigger cells → fewer cells but more candidates per query; 64 is the
  sweet spot here.)
- **Rebuilt every step** from scratch — enemies move every frame, so incremental updates aren't
  worth the complexity. Clearing + inserting n entities is O(n) and trivial.
- **Stays O(n) even in a pile** — *only if* enemies can't infinitely overlap. With hard-ish
  spacing (below), a 3×3 block (192×192 px) physically holds ≤ ~28 enemies, so each query
  returns a bounded handful no matter how big the horde. This is the linchpin: **the grid and
  hard separation reinforce each other** — without a density cap, a single cell could hold all
  150 enemies and the query degrades back to O(n²).

The grid serves more than separation — enemy↔enemy collision uses it, and contact-damage and
auto-target queries *can* later (they're O(n) per-frame scans today; cheap at 150, free on the
grid if they ever bite).

### Enemy movement in core

The per-enemy step currently lives in `GameScreen.onStep` and writes velocities onto matter
bodies. It moves into a core system over `{ pos, vel }` entities, running the same pipeline:

1. `archetype.tick` → intent velocity *(unchanged)*
2. **separation via the grid** (was: scan all enemies) — query the 3×3, push away from the few
   neighbours found
3. `clampSpeed` to max speed *(unchanged)*
4. `approachVelocity` — the acceleration-limited locomotion, same as the player *(unchanged)*
5. **integrate**: `pos += vel · dt`
6. **resolve collisions**: enemy↔wall, enemy↔enemy (grid), enemy↔player, clamp to arena bounds

Knockback (currently `addVelocityPerSecond` on the body) becomes a direct add to `vel`, decaying
through `decel` exactly as designed. Render interpolation (prev/curr positions) is unchanged —
it already reads positions, which now come from the entity instead of the body.

This is pure and deterministic → unit-testable in core, which matter-driven movement never was.

### Enemy ↔ wall collision

The piece matter.js gave us for free and we now own. Walls + pillars are **9 static
axis-aligned rectangles**. For each enemy, test against them and, on overlap, push out by the
shortest axis (standard circle-vs-AABB). O(n × 9) — negligible. (If obstacle counts ever grow,
the same grid can index static rects; 9 doesn't warrant it.)

### Decisions to lock before building

> **Decision — enemy spacing: hard-ish push-apart, not soft steering alone.** *(Locked
> 2026-06-16.)* Separation *steering* nudges a desired velocity; it lets enemies overlap when
> crowded (the "muddy pile" Tom flagged when we trialled disabling collisions). Instead, after
> integrating, do a cheap **positional** push so overlapping enemies are moved apart a fraction
> each step (grid-local, O(n)). This (a) looks clean — a readable ring around the player, not a
> blob — and (b) is what keeps grid density bounded so queries stay O(n). The softness is a
> single tunable (how much of the overlap to resolve per step).

> **Decision — enemy ↔ player: enemies are pushed out of the player; the player is not shoved
> by enemies.** *(Locked 2026-06-16.)* The player stays a matter.js body for crisp wall
> collision and tuned feel; enemies (now core entities) resolve against the player's circle by
> moving *themselves* out, so they crowd around you rather than overlapping your sprite, while
> your movement stays authoritative. Contact damage already triggers on distance, independent of
> this.

> **Decision — keep the player + walls in matter.js.** No need to rip it out: it's ~10 bodies
> (broadphase free), the player-movement doc is written around it, and its feel is tuned. The
> memory note that matter.js is "swappable later" still holds; this just stops feeding it the
> part it scales badly on (the crowd).

> **Decision — sim stays 60 Hz, with 30 Hz as a fallback lever.** Render interpolation is
> already in place, so halving the sim rate (→ half the sim cost) is a safe knob if a device
> can't hit 60 with the full crowd. Not the default; a guarantee valve.

## Render scaling (the third wall)

The grid fixes the sim; it does **not** fix the ~13 ms of per-enemy *rendering* at 150. For a
hard 60 fps that has to come down too:

- **Cache `Skia.Color`** — parsing colour strings per enemy per frame is pure waste; enemy
  colours are a tiny fixed set. Pre-parse constants, memoise the rest. (We *skipped* this
  earlier when fog dominated render; now that per-enemy cost is exposed, it's worth it.)
- **Fewer draws per enemy** — e.g. skip the HP bar (2 rects) for full-health enemies; most of a
  fresh horde is undamaged. Combine body + flash where possible.
- **Cull off-screen enemies** — only record enemies inside the camera viewport. A 150-enemy
  horde spread across the arena is often partly off-screen; during a pile they're all visible,
  so this helps the spread case, not the worst case.
- **Trim per-frame scene allocation** — the render currently rebuilds several arrays
  (`enemies.map`, two `flatMap`s) each frame; draw from the entity list directly or reuse
  buffers.

### Performance reality (the 150-at-60 budget)

16.7 ms per frame, aiming for `steps/frame = 1`:

| | now (150) | target (150) | how |
|---|---|---|---|
| physics | 16 ms | ~0 | enemies leave matter.js |
| AI separation | 7 ms | ~1 ms | grid query, O(n) |
| integrate + collision | (in physics) | ~1–2 ms | core, grid-local |
| render (enemies) | ~13 ms | ~3–5 ms | colour cache + cull + fewer draws |
| render (fog baseline) | ~9 ms | ~9 ms | already optimised |
| **frame total** | **~147 ms** (×5 spiral) | **~16–18 ms** | spiral gone |

Honest read: this lands **~55–60 fps at 150**, and the remaining squeeze is the ~9 ms fog
baseline. If a hard 60 matters, the next lever is a second fog pass (cache the dim/lit-edge
paths like we cached the dark layer) and/or the 30 Hz sim fallback. The cliff — the 5× spiral —
is gone either way, so it degrades gracefully instead of falling off.

## Phasing (each phase independently shippable + measurable)

1. **Spatial grid in core** (pure, unit-tested) + rewire `separation` onto it. Enemies stay in
   matter.js for now. → confirms the **AI** drop in isolation, lowest risk.
2. **Enemy movement + collision in core**; remove enemy matter bodies (wall + enemy + player
   resolution). → confirms the **physics** drop; breaks the spiral.
3. **Render scaling** (colour cache, cull, fewer draws). → confirms the **render** drop.
4. **Tune feel** (push-apart softness, enemy↔player) + optional fog pass / 30 Hz if 60 is still
   short.

Re-measure with the existing perf log after each phase; stop when it's smooth at the target.

## Where this lives (implementation map)

- **`@heroic/core/src/` (pure, testable):**
  - `spatial/grid.ts` *(new)* — the uniform grid: `build`, `queryNeighbors(pos, radius)`. Unit-tested.
  - `ai/runtime.ts` — `separation` reads grid neighbours instead of a full list.
  - `movement/` *(new system)* — enemy integration: intent → separation → clamp → accel-limit →
    integrate → collide. Reuses `locomotion`, `steering`, and the grid.
  - `physics/` *(new, pure)* — circle-vs-AABB resolution + the grid-based push-apart.
- **`@heroic/engine` / app layer:**
  - matter.js retained for the **player + static walls** only.
  - `GameScreen` calls the core movement system instead of looping bodies; reads entity
    positions for render interpolation (as today).
  - `renderCombat` — colour cache, viewport cull, fewer per-enemy draws.

## Open tunables (numbers to find in playtest)

- grid cell size (start 64); candidates-per-query sanity check under a full pile
- push-apart softness (fraction of overlap resolved per step) — spacing crispness vs. jitter
- enemy↔player resolution: push enemies out vs. full overlap (feel)
- separation strength vs. push-apart (steering keeps the *flow*, push-apart prevents *stacking*)
- the enemy count / device tier at which the 30 Hz sim fallback engages
- render: viewport cull margin; full-HP-bar skip on/off

## Plain-English glossary

- **Broadphase** — the cheap first pass of collision that decides which pairs of things are
  *near enough to bother* checking precisely. The slow part of matter.js here.
- **Sort-and-sweep** — matter.js's broadphase: sort by position, sweep across. Fast when things
  are spread out, O(n²) when they pile up (every box overlaps every other).
- **Spatial grid / spatial hash** — divide the world into cells, bucket entities by cell, and
  only ever compare things in neighbouring cells. Turns "check everyone" into "check the few
  nearby." The crowd workhorse.
- **O(n²) / O(n)** — how cost grows with count `n`. O(n²) at 150 ≈ 22,500 operations; O(n) ≈
  150. The whole point of the grid.
- **Integrate** — advance position from velocity for one time step (`pos += vel · dt`).
- **Circle-vs-AABB** — collision between a circle (an enemy) and an axis-aligned rectangle (a
  wall); resolved by pushing the circle out along the shallowest axis.
- **Catch-up spiral** — when a frame takes longer than one sim step, the loop runs extra steps
  to keep up; if each step is already too slow, it maxes out the step cap every frame and the
  game crawls in slow motion. Fixed by making each step fit the budget.
- **Fixed timestep** — the sim advances in constant slices (1/60 s) regardless of render rate,
  so physics/gameplay stay deterministic; the renderer interpolates between the last two slices.
- **Knockback impulse** — a one-off addition to velocity (a hit shoving an enemy), which then
  decays through the normal deceleration.
</content>
</invoke>
