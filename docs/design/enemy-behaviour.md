# Enemy Behaviour & Pathing

Status: **agreed (lightweight v1)** · Applies to: both games (shared mechanic) · Last decided: 2026-06-09

## Intent

Many enemy types that *feel* different — from a dumb zombie to a circling wolf to
bespoke special creatures — without writing each one from scratch. The variety comes
from a shared toolbox of movement behaviours, combined differently per enemy type. Kept
deliberately **lightweight for now**; the structure leaves room to add more later.

> New to the terms here? See [Plain-English glossary](#plain-english-glossary) at the
> bottom. Nothing is harder than the jargon makes it sound.

## The core idea: two layers

Enemy AI is split into two layers, because the *thinking* and the *moving* are separate
problems:

1. **Decision layer ("what do I want to do right now?")** — picks an intent like
   *approach*, *circle*, *hold*, *retreat*. This is where enemy-to-enemy **variety** lives.
2. **Movement layer ("how do I physically move to do that?")** — a shared palette of
   **steering behaviours** that each produce a "which way I want to move" arrow (a force),
   applied to the enemy's Matter.js body. Almost every enemy reuses this same palette.

Variety is cheap because it lives almost entirely in layer 1 choosing *which* layer-2
behaviour to use, and *when*.

## Layer 2 — the shared steering palette

Each is a small pure function returning a desired-velocity vector. Multiple can be blended
(added together):

- **Approach** — steer toward the player (*seek*). **Arrive** = the same but slow to a stop
  instead of overshooting.
- **Orbit / Strafe** — steer *sideways* relative to the player (perpendicular to the
  enemy→player line) to circle at a kept distance.
- **Flee / Keep-distance** — steer away if too close.
- **Separation** — steer away from nearby allies so a crowd spreads and flows instead of
  stacking into one point. **On by default for everyone.**
- **Path-follow** — steer toward the next pathfinding waypoint (used only when a wall is in
  the way — see Pathing).

## Layer 1 — the "brain" (a lightweight FSM)

Each enemy type has a **brain**: a small **Finite State Machine (FSM)** — it's always in
exactly one of a few **states** (modes), with **rules** for switching between them. The
brain reads **perception** (see below) and picks which steering behaviour(s) layer 2 should
run this tick.

In the ECS, each enemy carries a `brain` component holding its type + per-instance state
(current state, target, timers). One AI system ticks every brain each fixed simulation step.

### The three examples, mapped

**Zombie** — one state, no transitions. Always *Approach*. Steering = Approach + Separation.
"Easiest angle" = straight at the player (and pathfind only if a wall blocks).

**Wolf** — two states, one perception input (*am I inside the player's front arc?*, read from
the player `facing` we defined in the movement doc):

```
              player faces the wolf
          ┌──────────────────────────►┐
   ┌──────────┐                    ┌──────────┐
   │ APPROACH │                    │  CIRCLE  │   APPROACH steering = Approach
   │          │                    │          │   CIRCLE  steering = Orbit (+ keep-distance)
   └──────────┘                    └──────────┘
          └◄──────────────────────────┘
              player faces away
```

A whole different-feeling enemy from a 2-state rule + reused steering. (Note: the wolf is
literally a function of the player-facing mechanic — the designs compose.)

**Special creature** — same palette, plus a bespoke decision policy (a hand-written script or,
later, a behaviour tree). e.g. an *ambusher*: hold still until the player is within X, then
burst-*Approach*. The movement layer doesn't care how fancy the brain is.

### Simple = data, complex = code

- **Simple enemies are data/config**: numbers + which states they use. Cloning a "zombie" and
  bumping its speed gives a "fast zombie" — no new code.
- **Special creatures get a code escape hatch**: a custom brain function. The `brain` interface
  is uniform (the AI system just calls `brain.tick()`), so a fancy brain slots in without
  touching the rest.

### Deferred: behaviour trees

A **behaviour tree** is a heavier, flowchart-like way to express *very* complex AI. We are
**not** building one now — lightweight FSMs cover wolves and zombies. Because the `brain`
interface is uniform, a behaviour-tree runtime can be added later for bosses **with no rework**.

## Perception (what a brain can sense)

- **Distance** to the player.
- **Player front-arc** — is this enemy inside the cone the player is facing? (drives the wolf;
  reads the player `facing` state).
- **Line of sight (LOS)** — is there a clear straight line to the player, or a wall between?
  (decides steer-direct vs. pathfind).
- **Nearby allies** — for Separation now; for pack/coordination behaviour later.

**Avoid state thrash with hysteresis** — make state switches slightly "sticky" (a threshold
margin or a minimum time-in-state) so a wolf doesn't flicker Approach↔Circle when the player's
facing wobbles right on the arc edge. (Same fix we used for target-switching in the movement doc.)

## Pathing (combining steering with A*)

Steering is *local* (moment-to-moment); pathfinding is *global* (routing around walls). They
combine:

- **Clear line to the player → just steer** (Approach/Orbit directly). No pathfinding.
- **Wall in the way → A\*** (the shortest-route-around-obstacles algorithm already in core) gives
  waypoints, and the enemy *Path-follows* them until it can see the player again.

### Performance reality (many enemies on a phone)

- **Steering is cheap** (vector math) — fine for hundreds of enemies every frame.
- **A\* is expensive** — never run it per-enemy per-frame. Only when LOS is blocked, and
  **re-path on a throttle** (every N steps / when the target moves significantly).
- **Swarms → flow field (later).** A *flow field* is one shared map of "which way to the player
  from every tile," computed once so a whole swarm reads it instead of each enemy pathfinding
  alone. Start with throttled A* + steering; add a flow field when zombie counts demand it.
  The architecture doesn't preclude it.

## Where this lives (for implementation later)

Nearly all of enemy AI can be **pure `@heroic/core`** — which keeps it deterministic
(seeded RNG → reproducible behaviour, replays, tests) and shared across both games:

- **`@heroic/core` (pure, testable):** the steering math; the FSM brains; perception
  (distance, front-arc angle, and LOS as a grid raycast); A* (already there); the flow field
  later.
- **`@heroic/engine` / app layer:** read each enemy's Matter body position; apply the brain's
  resulting desired-velocity to that body. That's essentially all the engine-side work.

## Open tunables (numbers to find in playtest)

- per-type: move speed, aggro/engagement radius, which states it uses
- wolf: front-arc width; orbit distance & direction (consistent vs. shortest way around)
- hysteresis margin / minimum time-in-state
- A* re-path throttle (steps between repaths); LOS check frequency
- threshold at which swarms switch from per-enemy A* to a flow field
- enemy speed vs. player speed (ties into the movement doc's kiting balance)

## Plain-English glossary

- **FSM (Finite State Machine)** — a thing that's always in exactly one of a few named states,
  with rules for switching. The wolf: states *Approach* and *Circle*, rule = the player's facing.
- **Steering behaviour** — a rule that outputs a "which way I want to move" arrow; add several
  together for final movement. (Seek, Arrive, Orbit, Flee, Separation are all steering behaviours.)
- **A\*** ("A-star") — pathfinding: shortest walkable route around walls on the grid.
- **Flow field** — one shared "downhill to the player" map for a whole crowd; cheap at scale.
- **Line of sight (LOS)** — is there a clear straight line to the player, or a wall in the way?
- **Hysteresis** — deliberate stickiness so something doesn't rapidly flip at a threshold (like a
  thermostat's buffer).
- **Behaviour tree** — a heavier, flowchart-like structure for complex AI; deferred for now.
- **ECS (Entity/Component/System)** — enemies are an id + data components; systems run logic over
  everything that has the right components.
