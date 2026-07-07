# Spawners & Zone Population

Status: **built (v1, numbers placeholder)** · Applies to: **both games** (shared mechanic) ·
Last decided: 2026-07-04

This is the "enemy spawning" doc deferred from [realms-and-overworld](./realms-and-overworld.md)
(the enemy *roster* — which creatures exist per realm — is still its own future doc).

## Intent: repopulation you can watch

WoW-style timed respawns work because broken sightlines hide the pop-in. In a top-down game you
see everything, so creatures materializing from nowhere would read as a bug. The fix (borrowed
from Gauntlet, 1985 — the game's namesake): **spawners** — destructible monster nests placed in
the world. Repopulation becomes **diegetic** — it happens through something visible in the
fiction (creatures walk *out of a nest*) rather than appearing from thin air. Full visibility
flips from a liability to the threat itself: you can *see* the nest pumping out monsters.

A spawner is not just a monster faucet — it's an **objective**. It creates a spatial decision
(rush the nest through the trickle, or keep killing the trickle and never stem it) and interacts
with the level-gap for free: a nest placed deep in higher-band territory is a risk/reward target.

## How a zone is populated (two sources)

1. **Placed roamers** — authored, pre-placed free-roaming enemies. The ambient population you
   meet between nests; gives full placement control (patrols, lone elites, ambushes).
   Fictionally they "came from" the nests, but are not spawned at runtime.
2. **Spawners** — the pressure points. Dormant until approached (below), then produce creatures
   until destroyed.

## The spawner lifecycle

```
DORMANT ──seen once  AND  player within activation radius──► ACTIVE ──HP to 0──► DESTROYED
   ▲                                            │                    │
   └────────player leaves radius (countdown ────┘         stays destroyed this visit;
            PAUSES, not resets)                            regrown next run / next visit
```

- **Dormant** — inert. No spawning, no simulation cost, no capacity spent. Every nest the
  player discovers is at full value. A nest stays dormant until the player has **seen it at least
  once** (had clear line of sight to it) — so a nest behind a wall (or a breakable wood-wall) is
  silent until revealed, making *breaking through to expose a nest* the "oh damn, it's pumping out
  monsters" beat. Proximity (the activation radius) then gates the actual spawning.
- **Active** — spawns its creature type on a **cadence** (every N seconds), up to a
  **max-alive cap** (at most M of *its* creatures alive at once — the pressure stays constant
  instead of snowballing, and keeps entity counts phone-safe). The cadence is **jittered up to 30%
  faster** each interval (uniform in `[0.7·N, N]` — never *slower*) so a nest never metronomes: a
  7s nest pops at ~6s, then 5.5s, then 7s. The **first** entry to a fresh nest spawns
  **immediately** (no jitter — jitter shapes the *steady* cadence), so a long-cadence nest reacts
  the instant you reveal it rather than being killed before it does anything. A nest with capacity
  left wears a **spinning spiral** so you can spot which nests are still live and need attention at a
  glance (it vanishes when the nest bursts). Spawned creatures emerge
  **hugging the nest** (within ~one tile of its footprint) so they pour out of it rather than popping
  in around it, then use the normal [enemy-behaviour](./enemy-behaviour.md) brains. Leaving the
  activation radius drops the nest back to dormant but **pauses** its cadence countdown rather than
  resetting it, so you can't stall a slow nest by skirting its edge.
- **Destroyed** — has HP; the player kills it like anything else. **Dead stays dead for the
  visit** — clearing is real and satisfying. On the next run (Gauntlet) / next visit (Journey),
  nests have regrown: the world repopulates across runs, as
  [realms-and-overworld](./realms-and-overworld.md) promised, with zero pop-in.

## Capacity: a finite reservoir (anti-farm by construction)

Each spawner has a **capacity** — the total number of creatures it will ever emit (`capacity`,
default ~20). *(Superseded the earlier "XP-budget ledger", 2026-07-05: consume-on-kill with 0-XP
creatures and a gradual wither read as confusing — "why is this nest fading, and why did that kill
give nothing?" A finite spawn count is the same anti-farm guarantee with none of the ambiguity.)*

- Every spawn — cadence *or* a defender burst — **spends one** from capacity. When it hits 0 the
  nest is **spent**: it **bursts into particles and is removed** on the spot (no inert husk left
  lying around), while its already-spawned brood fights on independently.
- **Every creature it emits is worth its normal (level-gap-adjusted) XP**, exactly like any other
  enemy — no devalued kills, nothing that reads as a bug.
- **Destroying the nest pays out its un-spawned remainder** at once — each un-spawned unit as one
  full-value kill of its creature, priced through the level gap (so a low-band nest pays little).
  Already-spawned creatures keep their own XP; the payout counts only what never came out, so
  there's no double-dip.

The total XP a spawner yields is exactly its capacity, however you play it: farm the whole trickle,
or destroy the nest to claim the rest at once — same total, so there's no exploit to police and no
cliff to tune. Leaving a nest alive to farm means an ongoing stream of threats; destroying it ends
that but forfeits nothing (you're paid the remainder). A freshly-found nest is always at full value.

- **Telegraph it visually** — a nest with capacity left wears the spinning active-spiral; the moment
  it's spent (or the player destroys it) it **bursts into a poof of arcane particles and vanishes**.
  So a nest is only ever on screen while it's still a threat — "done with" reads as "gone", not as a
  husk you have to interpret. *(Superseded the "dim to inert" telegraph, 2026-07-05 — an inert nest
  that no longer does anything is just clutter.)*
- **Level-gap stacks on top**: an under-level spawner's creatures are trivial-XP, so revisiting low
  zones to farm nests was already pointless ([progression](./progression.md)).

## Defender waves (the bee-swarm)

Attacking a nest can provoke a burst of **defenders** — a wave that spawns at once and attacks
the player, ignoring the max-alive cap (a burst, not a new steady state). A firing wave bursts
**`maxAlive` creatures** — the nest's own cap in one go, so a big nest erupts harder than a small
one.

**Trigger:** a hit that **crosses a 25% threshold** (75% / 50% / 25%) rolls once, to a **maximum of
2 waves per nest**. The single roll is taken **at the hit's final HP**: `chance = 1 − hpFracAfter`.
A chip hit crosses one band and lands just under it (≈ the per-threshold chance — crossing 75% → ~25%,
crossing 25% → ~75%); a big hit that crosses several bands still takes only **one** roll, so bursting
provokes *fewer* expected waves than chipping. Rolling per damage-dealt (not per hit) keeps it
**weapon-agnostic** — a fast dagger and a slow maul get the same expected defenders for the same
damage.

- Early hits on a healthy nest are usually safe; a nest on its last legs probably erupts. Never a
  guarantee — the gamble is the fun. Expected ~1.5 waves over a full grind-down, never more
  than 2.
- **Burst rewards burst:** a hit that **destroys** the nest (`hpFracAfter ≤ 0`) rolls **none** —
  deleting a nest before it can react is the payoff for an overwhelming-force build.
- **Defenders draw from the same capacity** — a burst front-loads the nest's population rather than
  adding to it (its count is clamped to and spent from `remaining`), so provoking waves can't become
  the farm exploit re-entering through the side door; it just trades a scary rush for the same total.

## Where this lives (implemented)

- **`@heroic/core` (pure, deterministic, testable) — `spawner/spawner.ts`:** the state machine
  (`stepSpawner`, with the seeded cadence jitter and the capacity spend), the config/state types +
  `parseSpawnerConfig`, and `rollDefenderWave`. Deterministic through one injected `Rng` (jitter +
  wave rolls), unit-tested in `spawner.test.ts`.
- **Game (`apps/enter-the-gauntlet`, `GameScreen.tsx`):** the nest as a `LiveBreakable`; a
  `SpawnerRuntime` per nest and a `spawnerById` map; the per-step FSM + a shared `spawnFromNest`
  (used by both the cadence tick and the defender burst); the destroy-time remainder payout in
  `breakOne`, and the wave roll in `damageBreakable`. Every spawned creature is a normal enemy worth
  normal XP — no per-creature tagging needed.
- **Render (`renderCombat.ts` + `constants.ts`):** the spinning `drawSpawnerSpiral` over nests with
  capacity left (a gentle pulse), and the `drawSpawnerBurst` particle poof fired when a nest is
  spent or destroyed (driven by a small `spawnerBursts` effect list, ticked like explosions).
- **Editor (`apps/realmsmith`):** the `capacity` field in the spawner inspector (flows from
  `SPAWNER_DEFAULTS`); creature type, HP, cadence, cap, radius, and level window already there.
- **Persistence:** the whole state (capacity remaining, waves, phase) is transient world state —
  reset each visit like "destroyed this visit," so nothing new for the save system.

## Open tunables (numbers to find in playtest)

All resolved to starting values (2026-07-05); the shapes are fixed, the numbers are placeholder
(`SPAWNER_DEFAULTS` / `SPAWNER_TUNING` in core):

- Capacity — `capacity` default **20** (total creatures a nest emits before it's spent).
- **Cadence jitter** — `cadenceJitter` **0.3** (each interval up to 30% faster, never slower).
- Spawn cadence; max-alive cap; activation radius. (Resolved 2026-06-25: leaving the radius
  mid-fight **pauses** the cadence countdown rather than resetting it — a reset made a small-radius,
  long-cadence nest practically impossible to trigger. Reveal gating — a nest must be *seen* once
  before it can wake — was added the same day; see the lifecycle above.)
- Defender **wave size = `maxAlive`** (the nest's cap in one burst); threshold granularity + wave
  cap (25% bands, `defenderMaxWaves` **2** — chosen over 10% bands, whose expected ~4.5 waves felt
  like too many); the burst/overkill rule (single roll at final HP; no roll on a killing blow).
- Whether destroying a spawner also drops gold/loot.
- Spawner HP per level band; how many spawners per zone (pacing).

## Open / deferred (own docs)

- The **enemy roster** per realm (which creature types, elites, bosses) — its own doc.
- **Boss/elite nests** — unique spawners guarding named creatures, lair mechanics.
- Whether any quest/objective system counts "destroy all nests" as a zone-clear condition.
- Journey-specific: does a long-lived single visit ever regrow nests on a timer? (v1: no.)

## Glossary

- **Spawner / nest** — a destructible structure that produces creatures while active.
- **Dormant / active** — a spawner is inert until the player enters its **activation radius**.
- **Spawn cadence** — the interval between spawns while active (jittered up to 30% faster each time).
- **Max-alive cap** — the most of a spawner's creatures that may be alive at once.
- **Capacity** — the total number of creatures a nest ever emits; each spawn (cadence or defender
  burst) spends one, and at 0 the nest is **spent**. Every creature is worth normal XP; destroying
  the nest pays out its un-spawned remainder, so total XP == capacity either way.
- **Spent** — a nest whose capacity is exhausted: it bursts into particles and is removed on the
  spot (leaving its already-spawned brood behind), so a cleared nest never lingers as a husk.
- **Defender wave** — a burst of up to `maxAlive` creatures provoked by damaging the nest (drawn
  from its capacity), rolled once per 25% HP band crossed (chance `1 − hpFracAfter`), max 2 per nest,
  none on the killing blow.
- **Diegetic** — existing inside the game's fiction (creatures emerge from a visible nest)
  rather than imposed from outside it (creatures popping into existence).
- **Placed roamer** — an authored, pre-placed ambient enemy not tied to a runtime spawner.
  Implemented as a `creature` object (a `ZoneObject` whose `props.creature` names a roster
  `CreatureId`), placed in Realmsmith and spawned once at zone load. The spawner's static
  sibling: no nest, no cadence — it just stands where you put it until killed.
