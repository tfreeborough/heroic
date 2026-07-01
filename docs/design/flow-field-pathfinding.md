# Flow-field pathfinding

## The problem

Today every pursuing enemy runs its own A* (`pursue` → `findPath`) to route around
walls toward the player. A* is a *per-enemy, per-goal* search: cost grows with both
the number of enemies **and** the map size. We cap it (`MAX_REPATHS_PER_STEP`, a
re-path throttle) to stop it spiking, but that's damage control — it doesn't make
the work cheaper, it just spreads it out, and staler routes are the price.

For a horde all chasing the **same** target (the player), this is wasteful: a
hundred enemies run a hundred searches for what is essentially the same answer —
"which way is the player, around the walls, from here?"

## The idea

Compute that answer **once, for the whole map, from the player**, and let every
enemy read it in O(1).

A *flow field* is two grids laid over the nav cells:

- **Integration field** — the wall-aware **distance** from each cell to the player
  (flooded outward from the player over walkable cells; walls are impassable, so a
  cell behind a wall gets the *around-the-wall* distance, not the straight-line one).
- **Flow field** — a unit **direction** per cell, pointing toward the player down the
  steepest descent of the integration field (i.e. toward the neighbouring cell that's
  closest to the player).

One breadth-first flood builds both. An enemy then just looks up its cell:
`flowAt(pos)` gives "the way to the player from here, around walls" — no search.

**Cost:** one flood of O(cells-in-range) per *re-sweep*, plus O(1) per enemy.
Pathfinding stops scaling with enemy count. 100 enemies = 1 flood + 100 lookups,
versus 100 A* searches today.

## It is a *fact*, not a *policy*

The crucial framing (see the movement archetypes in `enemy-behaviour.md`): the field
is shared knowledge — "here is the player's wall-aware direction and distance, from
anywhere" — that each brain **reads however it likes**. It does **not** force
everyone to walk to the player.

| Archetype | How it reads the field |
| --- | --- |
| **Chaser** | Follow the direction (downhill toward the player). |
| **Circler** | Direction as the *approach* component, plus a perpendicular orbit — now correctly around walls. |
| **Kiter / avoider** | Flee **up** the field: step toward a reachable neighbour cell with a *greater* distance. A proper wall-aware retreat (better than today's straight away-vector, which can back into a wall). |
| **Ambusher (dormant), charger/ambusher dash** | Ignore it — idle, or a committed straight-line burst. (The runtime already skips routing for both.) |

So "toward the player" is one read; "away", "orbit", and "ignore" are equally valid.

**Limit:** a field sourced at the player only answers player-relative questions. A
brain with a non-player goal (patrol a waypoint, retreat to a specific room) keeps
its own A*. But essentially every enemy here is player-relative, so one field covers
them; the rare exception falls back to `pursue`.

## Design decisions

1. **Built over the existing nav grid.** The field reads `NavGrid.matrix`
   (walkability, already inflated by enemy radius). No new geometry. **Two fields** —
   one per nav grid: ground (`navGrid`) and flying (`flyingNavGrid`) — since flyers
   cross voids grounders can't.

2. **Bounded to an active radius around the player**, not the whole map. The nav grid
   is 200×200 = 40k cells (`NAV_CELL` 32 over a 6400px arena); a full flood every
   re-sweep would be its own fixed cost (the exact trap we just fixed in the spatial
   grid). The flood stops at a radius covering the fight (a few screens). Enemies
   outside the field fall back to straight-line steering — which off-screen enemies
   already do (`OFFSCREEN_SIM_MARGIN`), and the leash reels them in until they enter
   the field.

3. **Re-swept on a throttle**, not every step. The field goes stale as the player
   moves, but slowly. Re-sweep every N steps (or when the player crosses a cell) and
   reuse it in between — the same "a few frames of staler routing is invisible" trade
   `pursue` already makes. Reuses its arrays across sweeps (reset only the cells the
   last flood touched, à la the spatial-grid `occupied` fix — no O(all-cells) clear).

4. **Pure and deterministic**, like the rest of `@heroic/core`: `computeFlowField`
   mutates a preallocated field from `(nav, playerPos, radius)`; same inputs → same
   field. Unit-testable, no renderer, no allocation on the read path.

5. **4-connected integration, 8-neighbour direction read.** Orthogonal flood (cost 1
   → Manhattan distance, no priority queue needed); the per-cell direction points at
   the lowest-cost of the 8 neighbours, so flow still moves diagonally and smoothly.
   Locomotion (`approachVelocity`) + the crowd smooth any residual blockiness. (A true
   Eikonal/Dijkstra field is a later refinement if the flow ever looks faceted.)

## Rollout — two phases

**Phase 1 — drop-in replacement (perf, no behaviour change).** Swap the per-enemy
A* for a field lookup at the *one* place routing happens today: the runtime override
in `tickBrain` (when a wall blocks the straight line to the player and the archetype
wants normal-speed engagement, replace intent with the route toward the player). It
reads `flowAt(selfCell)` instead of running `pursue`. Same behaviour — "route toward
the player around walls" — just O(1) and count-independent. `pursue`/A* stays as the
fallback for enemies outside the field and for any future non-player goal.

**Phase 2 — smarter per-archetype reads (behaviour, later).** Expose the field
(direction **and** distance) through `EnemyPerception` so archetypes read it
natively: the kiter flees up the distance gradient instead of being yanked toward the
player by the blunt override; the circler orbits around walls. This is where the
avoider gets *better*, not just cheaper. Deferred until Phase 1 is proven.

## Open tuning knobs

- **Field radius** — big enough to cover the fight, small enough to keep the flood
  cheap. Start ~ the combat-music / leash range; measure.
- **Re-sweep interval** — steps between floods. Higher = cheaper, staler. Start ~6–10.
- **Direction quality** — 4-connected + 8-neighbour read vs a true Eikonal solve, if
  movement looks faceted at cell boundaries.
