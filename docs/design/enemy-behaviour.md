# Enemy Behaviour & Pathing

Status: **v1 implemented**, **v2 architecture agreed** · Applies to: both games (shared mechanic) · Last decided: 2026-06-13

- **v1 (shipped):** steering palette + two hand-written brains (chaser, circler) in
  `@heroic/core/src/ai/`, driving the gauntlet tech demo.
- **v2 (this doc, adopting next):** the same behaviours, restructured into **archetypes**
  (reusable behaviour patterns, named by what they *do*) that **creatures** select and tune
  with data. No new feel — a refactor that makes the *next* ten enemies cheap.

## Intent

Many enemy types that *feel* different — from a dumb zombie to a circling wolf to bespoke
special creatures — without writing each one from scratch. The variety comes from a small set
of **behaviour archetypes** built on a shared **steering** toolbox, with concrete **creatures**
combining an archetype + tuning + looks. Kept deliberately lightweight; the structure leaves
room to add more later.

> New to the terms here? See [Plain-English glossary](#plain-english-glossary) at the
> bottom. Nothing is harder than the jargon makes it sound.

## The core idea: three layers

The *thinking*, the *moving*, and the *content* are separate problems, so they're separate
layers. Top to bottom — each layer only knows about the one below it:

```
   ┌─────────────────────────────────────────────────────────────┐
   │  CREATURES  (data)   "I'm a wolf: a circler, these numbers,   │
   │                       steel-blue, bites for 10."              │  ← lots of these
   ├─────────────────────────────────────────────────────────────┤
   │  ARCHETYPES (logic)  chaser · circler · kiter · ambusher ·    │
   │                      charger …  — the FSM brains, named by    │  ← a handful
   │                      behaviour, owning states + transitions   │
   ├─────────────────────────────────────────────────────────────┤
   │  STEERING   (math)   seek · arrive · orbit · keepDistance ·   │
   │                      flee · separation · wander …             │  ← tiny, generic
   └─────────────────────────────────────────────────────────────┘
```

The key relationship is the one you (Tom) called: **steering is generic and high-level;
archetypes own the behaviour logic; specific creatures reuse the same archetypes with
different data.** A wolf and a hyena are both `circler`s with different numbers. A zombie and
a ghoul are both `chaser`s. New *content* is data; only a genuinely new *behaviour shape* is
new code — and even then it's one self-contained archetype, nothing else changes.

## Layer 1 — the steering palette (generic math)

Each is a small pure function returning a desired-velocity vector. Archetypes blend several by
adding them. These know nothing about creatures or even about FSMs.

Shipped:

- **Seek** — steer straight at the player at full speed. **Arrive** = the same but ease to a
  stop inside a slow radius instead of overshooting.
- **Orbit** — steer *sideways* relative to the player (perpendicular to the enemy→player line)
  to circle at a kept distance, with a radial correction so drift on/off the ring self-heals.
- **KeepDistance / Flee** — steer away when closer than a minimum, harder the closer you are.
- **Separation** — steer away from nearby allies so a crowd spreads and flows instead of
  stacking into one point. **Applied to everyone by the runtime** (see below), not per archetype.

To add as their archetypes land:

- **Wander** — small seeded-random drift, for erratic swarmers and idle patrols. (Seeded
  through core's RNG so behaviour stays deterministic/replayable.)
- **Dash** — a *committed* straight-line lunge: sample the direction to the player once, then
  drive that way ignoring further steering, so the player can sidestep it. (For `charger`.)
- **Alignment + Cohesion** — the other two "boids" rules, for real pack coordination. (Later;
  for `pack-hunter`.)
- **Path-follow** — steer toward the next pathfinding waypoint (used only when a wall blocks
  the way — see [Pathing](#pathing-combining-steering-with-a)).

## Layer 2 — archetypes (the behaviour brains)

An **archetype** is a lightweight **FSM** (Finite State Machine — always in exactly one of a
few named states, with rules to switch). It reads **perception** and decides which steering to
blend this tick. Crucially, archetypes are named by **behaviour, not by animal**: `circler`,
not `wolf`. The wolf is a *creature* that happens to use the `circler` archetype.

### The uniform archetype interface (no central switch)

Every archetype implements the same shape, so adding one is writing a new module and **nothing
else changes** — no editing a big `switch`. This is the "code escape hatch" for special
creatures: a bespoke boss brain is just another object implementing this interface.

```ts
interface Archetype<Config, State> {
  id: string;
  /** Fresh per-instance state (current FSM state, timers, fixed quirks like orbit direction). */
  initState(config: Config, instance: InstanceSeed): State;
  /**
   * One fixed step. Returns the *intent* velocity (px/s) — pre-separation,
   * pre-clamp; the runtime handles those. Mutates `state` (FSM transitions, timers).
   * Deterministic: same (state, config, perception) in → same intent out.
   */
  tick(state: State, config: Config, perception: EnemyPerception, dt: number): Vec2;
}
```

`v1` is a discriminated union + a `switch` in `tickBrain` — fine for two brains, but every new
brain edits that function. `v2` replaces it with this interface so archetypes are pluggable.

### The brain runtime — universal concerns live here, not in archetypes

A thin runtime wraps every archetype's `tick` with the things *every* creature does, so the
archetypes stay focused on just their behaviour:

1. Call `archetype.tick(...)` → the intent velocity.
2. Blend in **separation** from nearby allies (on for everyone).
3. **Clamp** the result to the creature's max speed.

This pulls two things *out* of the archetypes that v1 repeats by hand in every brain.

> **Decision — aggro is archetype-owned, not runtime-forced.** v1's runtime also force-idles
> any enemy beyond its aggro radius. We're *not* keeping that universal, because "what do I do
> when the player is far?" genuinely varies: a chaser idles, a **patroller wanders**, an
> **ambusher lies dormant then bursts**. So "stand down when the player's beyond aggro" becomes
> a one-line shared *helper* most archetypes call as their first move — opt-in, not imposed.
> Separation + clamp stay truly universal because they really are.

### Anti-thrash: hysteresis

State switches must be slightly "sticky" — a threshold margin and/or a minimum time-in-state —
so a brain doesn't flicker between states right at a boundary (the circler doesn't flap
Approach↔Circle when the player's facing wobbles on the arc edge). Same fix we used for
target-switching in the movement doc.

### The archetype catalogue

Shipped:

- **chaser** *(was "zombie")* — one state, no transitions: `seek` the player, forever. The
  relentless walker. Tunables: speed, aggroRadius.
- **circler** *(was "wolf")* — two states gated on the player's front-arc: **APPROACH** while
  the player faces away, **CIRCLE** (orbit + keep-distance, at a slower *prowl* speed) while
  watched. A whole different-feeling enemy from a 2-state rule. Literally a function of the
  player-facing mechanic from the movement doc — the designs compose.

  ```
                player faces the creature
            ┌──────────────────────────►┐
     ┌──────────┐                    ┌──────────┐
     │ APPROACH │                    │  CIRCLE  │   APPROACH = seek
     │          │                    │          │   CIRCLE   = orbit + keepDistance (prowl speed)
     └──────────┘                    └──────────┘
            └◄──────────────────────────┘
                player faces away
  ```

Shipped, reusing existing steering (no new primitives — cheap):

- **ambusher** *(the doc's original "special creature")* — **dormant** (still, no telegraph)
  until the player is within a trigger radius, then a full-speed `seek` **burst**; re-arms if
  the player escapes past a (larger) release radius. Two states, completely different feel,
  almost no code. *Live in the demo.*
- **kiter** — the circler inverted, and the natural foil to *melee*: holds at a preferred
  range, **flees** when you close, **seeks** back to range when you drift out, holds in the
  band where it fires. *Live in the demo as the Archer (physical) and Caster (magic) — see
  ranged attacks below.*
- **charger** *(uses `dash`)* — approach, then a committed telegraphed dash that blows *past* a
  player who sidesteps; can't course-correct mid-dash. *Live in the demo.*

Planned, needing one new primitive each:

- **swarmer** *(needs `wander`)* — fast, weak, erratic: `seek` + `wander`; separation turns a
  group into a believable cloud rather than a line.

Bigger, deferred (need perception/steering we haven't built):

- **pack-hunter** *(needs alignment + cohesion, or a coordinator + flank-angle assignment)* —
  wolves that actually flank from different sides instead of mobbing your front.
- **patroller / sentry** *(needs LOS + interior level geometry)* — wanders or walks a path
  until it gets line of sight to the player, then engages.

### Simple = data, complex = code

- **A creature variant is pure data**: clone the wolf creature, bump `speed`, recolour → a
  "dire wolf". No new code (true in v1 already for tuning; v2 extends it to *picking* an
  archetype).
- **A genuinely new behaviour is one new archetype module** implementing the interface above.
  The runtime and every creature are untouched.

### Deferred: behaviour trees

A **behaviour tree** is a heavier, flowchart-like way to express *very* complex AI. We are
**not** building one now — lightweight FSM archetypes cover everything above. Because the
archetype interface is uniform, a behaviour-tree-backed archetype can be added later for bosses
**with no rework**: it's just another object with `initState` + `tick`.

## Built 2026-06-14: charger · summoner

Both shipped (see the status note and creature table below for the live tuning). The specs that
guided them are kept here for reference. (A **berserker** — enrages at low HP, bite cuts
through i-frames — was specced and **shelved 2026-06-13**: the i-frame-piercing turned one enemy
into a combat-system question, deferred until that's worth opening. The `selfHpFrac` perception it
needed is shelved with it; it'll also unlock cowards / last-stands when revived.)

### Architecture additions these need

- **[NEW] `dash` movement** — a *committed* lunge: the brain samples a direction once and drives
  straight along it, ignoring steering, until a timer runs out. Lives as archetype state (a stored
  locked vector), not a shared steering function — there's nothing to blend mid-dash.
- **[NEW] telegraph surfacing** — a brain's *internal* FSM state (charging up) has to reach the
  renderer without leaking the whole opaque `state`. Add an optional `telegraph(state, config)`
  accessor to the `Archetype` interface returning a tiny render hint (`{ kind, progress, dir? }`);
  the app reads it each frame, like it reads the ranged attack cycle today.

### charger — the read-and-dodge bruiser *(new archetype)*

FSM: **APPROACH → WINDUP → DASH → RECOVER → APPROACH**.
- **APPROACH** — `seek` until within `chargeRange`.
- **WINDUP** — lock the dash direction at the player's position *now* (sampled once, at windup
  start), then hold still for `windupTime` showing the committed telegraph line.
- **DASH** — drive the locked direction at `dashSpeed` for `dashDuration`, ignoring steering, so it
  blows *past* a player who sidesteps. No course-correction — that whiff is the counterplay.
- **RECOVER** — vulnerable pause (`recoverTime`), then re-approach.

Telegraph via the new accessor (an arrow along the locked dir, progress 0→1). The dash direction is
locked when WINDUP begins, so the telegraph shows the committed line for the whole wind-up — you
step off it. Reuses `seek` + the new `dash`. No new perception.

### summoner — calls in minions *(a creature ACTION, composable onto any movement)*

`summon` is the mirror of `attack`: a data action you bolt onto a creature, and **what it spawns is
just a creature id**. So "summoner" isn't one fixed enemy — a back-line `kiter` with
`summon: { minionType: "wolf" }` is a *wizard that calls wolves*; a `chaser` with the same action is
a necromancer that shambles forward raising the dead. Mix the movement and the spawn freely.

- **`summon` on `CreatureDef`** *(app-side, like `attack`)*: `{ minionType, count, windup, recovery,
  maxAlive, spawnRadius }`. `minionType` is **any creature in the roster**. The app ticks a **summon
  cycle** (reuse `stepAttackCycle`); the windup telegraphs; on **strike** it spawns `count` ×
  `minionType` near the summoner through the existing `spawnEnemy` path.
- **Minion cap** — `maxAlive` (counted per summoner) stops it flooding the arena; ties into the
  throttling concerns in `spawners.md`. (Don't point a summoner's `minionType` at itself — the cap
  bounds it, but it's a silly loop.)
- No new brain, no new steering, no new perception — only the summon-action plumbing + the cap.

### Decisions

- **berserker shelved** *(2026-06-13)* — the i-frame-piercing enrage became a combat-system question
  (how invuln is shared across sources); parked until that's worth opening. `selfHpFrac` perception
  parked with it.
- **summoner spawn target = any creature id** *(decided)* — fully data-driven; `minionType`
  references any roster creature (so a kiter "wizard" can summon `wolf`). **Defaults:** `maxAlive`
  ≈ 6, `count` 2 per cast, the demo wizard summons wolves.
- **telegraph surfacing** *(decided)* — add the optional `telegraph(state, config)` accessor to the
  `Archetype` interface; the charger uses it for its committed-line tell.

## Layer 3 — creatures (data, and where they live)

A creature is the bundle that selects an archetype and gives it identity. It's really *two*
concerns, and they live in different places because of `@heroic/core`'s purity rule:

- **AI + combat definition** — archetype id + that archetype's config + combat stats + contact
  damage. All **pure data**, lives in `@heroic/core`, shared across both games, unit-testable.
- **Presentation** — colour (later sprites/anims), hit haptics, sounds. **App-side only** —
  core is forbidden from importing anything that knows about rendering, so visuals layer on top
  in the app's creature definitions.

```
   core (pure):   { archetype: "circler", config: {...}, stats: {...}, contact: {...} }
   app (visual):  + { color, haptic, sprite, ... }   ← the playable "wolf"
```

> **Decision — split the creature.** The temptation is one `Creature` object with everything
> on it, but `color` in `@heroic/core` would break the purity rule that keeps core testable and
> renderer-swappable. So the AI/combat half is core data; the app composes presentation over it.
> Concrete creature *rosters* (the actual bestiary, stat blocks per realm) can become their own
> content doc later; this doc is the *mechanism*.

### The demo creatures, mapped

| Creature | Archetype  | Notable config |
|----------|------------|----------------|
| Zombie   | `chaser`   | slow, tanky, big aggro |
| Wolf     | `circler`  | fast, fragile, orbit ring just outside melee, prowl speed 0.55× |
| Ambusher | `ambusher` | dormant then 320 px/s burst; trigger 300 / release 500; bites hardest |
| Archer   | `kiter`    | holds ~220px, fires physical bolts (reach 260, 0.5s telegraph) |
| Caster   | `kiter`    | holds ~210px, fires piercing magic bolts (reach 240, 0.65s telegraph) |
| Charger  | `charger`  | shuffles, then a 0.55s-telegraphed 640 px/s dash ~576px (sails well past you) |
| Wizard   | `kiter`    | hangs back ~360px, `summon`s wolves (cast 0.8s, ≤6 alive) |

## Perception (what an archetype can sense)

- **Distance** to the player.
- **Player front-arc** — is this enemy inside the cone the player is facing? (drives the
  circler; reads the player `facing` state from the movement doc).
- **Line of sight (LOS)** — clear straight line of *sight* to the player, or an occluding wall
  between? Gates ranged fire, the kiter's hold-vs-close, the ambusher's spring, and the future
  patroller. (It does **not** decide steer-vs-pathfind — that's the *movement* nav grid, since a
  barrel/pit blocks movement without blocking sight; see Pathing below.) *Built:*
  `EnemyPerception.hasLineOfSight`, computed by the app with `segmentClear` against the arena's
  occluders; see [line-of-sight](./line-of-sight.md).
- **Nearby allies** — for separation now; for pack/coordination behaviour later.

## Pathing (combining steering with A*) — *implemented*

Steering is *local* (moment-to-moment); pathfinding is *global* (routing around obstacles). They
combine, decided **once in the runtime** (`tickBrain`) rather than per archetype, so every
ground enemy benefits without bespoke code. The steer-vs-route test is the **movement** nav grid,
not sight (`pathClear` walks the grid line) — so a mover routes around anything the grid was built
from (walls, voids/pits, breakables, spawner nests), even a non-occluding barrel it can see the
player straight through. (Using *sight* here was the old behaviour, and the bug: enemies ground
against a barrel/crate/nest because it didn't block the sightline.)

- **Clear movement path to the player → just steer** (the archetype's own seek/orbit/kite runs untouched).
- **An obstacle in the way → A\*** (`findPath` over a `NavGrid` built from the level's collision,
  inflated by the enemy radius) gives waypoints; `pursue` follows them to the player's *live*
  position, re-pathing on a throttle. Routes to where you actually are, so enemies don't give up
  out of sight. (Flyers use their own grid — walls + breakables, no voids — so they beeline over pits.)

Two intents are *not* re-routed, by design:
- **Idle/dormant** (intent ≈ 0) — a dormant ambusher stays hidden; it doesn't path toward a
  player it hasn't triggered on.
- **Committed bursts** (intent above normal `speed`, e.g. a charger's dash) — stay a straight,
  dodgeable line; `pursue` would otherwise curve them around walls.

### Movement domains — flying (over voids)

"Flying" is **not an archetype** — it's a *movement domain* layered under any behaviour (a flying
chaser, a flying circler…). The behaviour decides where to go; the domain decides what geometry
stops it. Two domains, set by a `flying` flag on the creature def:

- **Grounded** routes and crowd-collides against **walls + voids** (`SOLIDS`) — fenced out of chasms.
- **Flying** routes and crowd-collides against **walls only** (`PILLARS`) — it beelines over a void
  a grounder must go around, and hovers above a pit. Still stopped by walls, breakables, and the
  arena bounds; sight/projectiles/targeting are unchanged (voids never blocked those), so a flyer
  over a pit is still fully shootable.

Mechanically it's just *which wall list* a mover sees: the app builds a second `flyingNavGrid`
(from `PILLARS`, no voids) and runs the crowd in **two passes** (grounded vs flying, each against its
own walls). The layers are separate, so flyers crowd-separate only among themselves (they're
"above") — but both still resolve against the player and the bounds. No core/archetype change; the
`bat` is the worked example (a flying chaser). This is also the natural hook for future domains
(amphibious over water, etc.).

### Performance reality (many enemies on a phone)

- **Steering is cheap** (vector math) — fine for hundreds of enemies every frame.
- **A\* is expensive** — never run per-enemy per-frame. Only when LOS is blocked, and re-pathed
  on a throttle (`REPATH_INTERVAL`, ~0.35 s) with the route cached on the brain (`Brain.nav`).
  Grid resolution is `NAV_CELL`.
- **Swarms → flow field (later).** A *flow field* is one shared map of "which way to the player
  from every tile," computed once so a whole swarm reads it instead of each enemy pathfinding
  alone. Throttled A* + steering is what's shipped; add a flow field when swarmer counts demand it.

### Known edges / next
- **Path smoothing:** routes follow grid-cell centres (no string-pulling yet), so turns are
  slightly faceted; the acceleration-limited locomotion hides most of it. Lower `NAV_CELL` or add
  funnel smoothing if it reads robotically.
- **Corner hugging / oscillation:** an enemy can flip between "route" and "steer" right at a sight
  edge. Acceptable so far; add hysteresis if it jitters.
- **Static grid:** the nav grid is built once from `PILLARS`. Moving/destructible obstacles would
  need a rebuild.

## Where this lives (implementation map)

Nearly all of enemy AI is **pure `@heroic/core`** — deterministic (seeded RNG → reproducible,
replayable, testable) and shared across both games:

- **`@heroic/core/src/ai/` (pure, testable):**
  - `steering.ts` — the steering math (incl. `flee`) *(shipped)*.
  - `archetypes/` — one module per archetype: `chaser`, `circler`, `ambusher`, `kiter`, each
    implementing the uniform interface *(shipped)*.
  - `runtime.ts` — the `Archetype` interface + the brain wrapper that ticks an archetype and
    applies separation + clamp *(shipped)*.
  - `perception.ts` — `EnemyPerception`, the shared `CommonConfig`, and helpers (distance via
    `beyondAggro`, front-arc angle; later LOS as a grid raycast) *(shipped)*. A* already exists;
    flow field later.
- **`@heroic/engine` / app layer:** read each enemy's Matter body position; feed the runtime's
  desired-velocity through the shared acceleration-limited locomotion onto the body.
  - **Creature definitions live here for now** (`apps/enter-the-gauntlet/src/game/constants.ts`,
    `CREATURES`): each is one bundle of archetype + config + combat stats + presentation
    (colour, contact damage). The AI/combat half *could* be promoted to a pure `core/creatures.ts`
    when the second game needs to share a bestiary — held off at n=3 creatures, since splitting
    each across core (stats) + app (colour) fragments content for no current gain. The
    architecture boundary that matters — pure archetype *logic* — is already fully in core.

> **Status note:** five archetypes are live across seven creatures — `chaser` (Zombie),
> `circler` (Wolf), `ambusher` (Ambusher), `kiter` (Archer + Caster + Wizard), and `charger`
> (Charger). Ranged attacks (2026-06-13) run the *same* attack cycle + `AttackConfig` the player
> does (combat.md, one shared attack library). Charger + summoner landed 2026-06-14: the charger
> uses the new `dash` + a `telegraph()` accessor for its committed-line tell; the Wizard is a kiter
> carrying a data-driven `summon` action (any `minionType`; it calls wolves, ≤6 alive). Enemies are
> spawned on demand from a test HUD (no auto-population, no respawn) so a single archetype can be
> stress-tested in isolation.

## Open tunables (numbers to find in playtest)

- per-creature: move speed, aggro/engagement radius, which archetype, combat + contact stats
- circler: front-arc width; orbit distance & direction (consistent vs. shortest way around);
  **circle-speed scale** (full-speed strafing is nearly unhittable — circling is slower than
  closing)
- kiter: preferred range band width; flee vs. hold thresholds
- ambusher: trigger radius; burst speed; re-arm time
- charger: windup distance; dash speed & duration; recovery time
- hysteresis margin / minimum time-in-state (per archetype)
- A* re-path throttle (steps between repaths); LOS check frequency
- threshold at which swarms switch from per-enemy A* to a flow field
- enemy speed vs. player speed (ties into the movement doc's kiting balance)

## Plain-English glossary

- **Steering behaviour** — a rule that outputs a "which way I want to move" arrow; add several
  together for final movement. (Seek, Arrive, Orbit, KeepDistance, Separation, Wander…)
- **Archetype** — a reusable *behaviour pattern* (the FSM + which steering it uses), named by
  what it does (`circler`), not by which animal uses it. Many creatures share one archetype.
- **Creature** — a concrete enemy: an archetype + tuning data + combat stats + looks. The
  thing that spawns in the world. Lots of creatures, few archetypes.
- **Brain runtime** — the thin wrapper that ticks an archetype and applies the universal bits
  (separation, speed clamp) so each archetype doesn't repeat them.
- **FSM (Finite State Machine)** — always in exactly one of a few named states, with rules for
  switching. The circler: states *Approach* and *Circle*, rule = the player's facing.
- **Hysteresis** — deliberate stickiness so something doesn't rapidly flip at a threshold (like
  a thermostat's buffer).
- **A\*** ("A-star") — pathfinding: shortest walkable route around walls on the grid.
- **Flow field** — one shared "downhill to the player" map for a whole crowd; cheap at scale.
- **Line of sight (LOS)** — is there a clear straight line to the player, or a wall in the way?
- **Boids** — the classic flocking rules: *separation* (don't crowd), *alignment* (match
  heading), *cohesion* (steer toward the group's centre). We use separation now; the other two
  arrive with pack-hunters.
- **Behaviour tree** — a heavier, flowchart-like structure for complex AI; deferred, and will
  slot in as just another archetype when bosses need it.
- **ECS (Entity/Component/System)** — enemies are an id + data components; systems run logic
  over everything with the right components.
