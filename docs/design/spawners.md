# Spawners & Zone Population

Status: **agreed (v1, numbers placeholder)** · Applies to: **both games** (shared mechanic) ·
Last decided: 2026-06-12

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

- **Dormant** — inert. No spawning, no simulation cost, no XP-budget drain. Every nest the
  player discovers is at full value. A nest stays dormant until the player has **seen it at least
  once** (had clear line of sight to it) — so a nest behind a wall (or a breakable wood-wall) is
  silent until revealed, making *breaking through to expose a nest* the "oh damn, it's pumping out
  monsters" beat. Proximity (the activation radius) then gates the actual spawning.
- **Active** — spawns its creature type on a **cadence** (every N seconds), up to a
  **max-alive cap** (at most M of *its* creatures alive at once — the pressure stays constant
  instead of snowballing, and keeps entity counts phone-safe). The **first** entry to a fresh nest
  spawns **immediately**, then it settles into the cadence — so a long-cadence nest reacts the
  instant you reveal it rather than being killed before it does anything. Spawned creatures emerge
  **hugging the nest** (within ~one tile of its footprint) so they pour out of it rather than popping
  in around it, then use the normal [enemy-behaviour](./enemy-behaviour.md) brains. Leaving the
  activation radius drops the nest back to dormant but **pauses** its cadence countdown rather than
  resetting it, so you can't stall a slow nest by skirting its edge.
- **Destroyed** — has HP; the player kills it like anything else. **Dead stays dead for the
  visit** — clearing is real and satisfying. On the next run (Gauntlet) / next visit (Journey),
  nests have regrown: the world repopulates across runs, as
  [realms-and-overworld](./realms-and-overworld.md) promised, with zero pop-in.

## XP: the fixed budget (anti-farm by construction)

Each spawner holds a **fixed XP budget**:

- Every creature it spawns grants its normal XP, **deducted from the budget**.
- When the budget runs dry, its creatures grant **0 XP** — but it *keeps spawning*: the nest
  remains a threat even when it's no longer a piñata.
- **Destroying the spawner pays out the remaining budget.**

The total XP obtainable from a spawner is exactly its budget, however you play it. Rushing the
nest gets it all at once; farming gets the same total slower and at more risk — so there is no
exploit to police and no cliff to tune. Because drain only happens while **active** (i.e. while
the player is present and watching), a freshly-found nest is always worth full value.

- **Telegraph the drain visually** — the nest withers/dims as its budget empties, so a 0-XP
  creature never reads as a bug.
- **Level-gap stacks on top**: an under-level spawner's budget is built from trivial-XP
  creatures, so revisiting low zones to farm nests was already pointless
  ([progression](./progression.md)).

## Defender waves (the bee-swarm)

Attacking a nest can provoke a burst of **defenders** — a wave that spawns at once and attacks
the player, ignoring the max-alive cap (a burst, not a new steady state).

**Trigger:** each time the spawner's HP **crosses a 25% threshold** (75% / 50% / 25%), roll once
with `chance = 100 − remaining HP%` (crossing 75% → 25% chance; crossing 25% → 75%), to a
**maximum of 2 waves per nest**. Rolling per threshold-crossed rather than per hit keeps it
**weapon-agnostic** — a fast dagger build and a slow maul build get the same expected defenders
for the same damage dealt.

- Early hits on a healthy nest are usually safe; a nest on its last legs probably erupts. Never a
  guarantee — the gamble is the fun. Expected ~1.5 waves over a full grind-down, never more
  than 2.
- **Burst rewards burst:** one-shotting a nest crosses every threshold at once — resolve at most
  one roll (at the final HP) or none on overkill; deleting a nest before it can react is the
  payoff for an overwhelming-force build. *(Exact rule = tunable below.)*
- **Defenders' XP draws from the same budget** — otherwise provoking waves becomes the farm
  exploit re-entering through the side door.

## Where this lives (for implementation later)

- **`@heroic/core` (pure, deterministic, testable):** the spawner state machine
  (dormant/active/destroyed), cadence + max-alive accounting, the XP-budget ledger, the
  threshold-crossing defender rolls (seeded RNG → reproducible).
- **`@heroic/engine` / app:** creating/removing the Matter bodies and sprites for spawned
  creatures and the nest; the wither visual as budget drains.
- **Content/data:** per-realm spawner placement, creature type, budget size, cadence, cap,
  activation radius — authored alongside realm layout.
- **Persistence:** "destroyed this visit" is run-scoped state (resets each run), so nothing new
  for the save system.

## Open tunables (numbers to find in playtest)

- Budget size (expressed in spawn-counts of its creature — your "~20 full-value spawns" instinct
  is the starting calibration).
- Spawn cadence; max-alive cap; activation radius. (Resolved 2026-06-25: leaving the radius
  mid-fight **pauses** the cadence countdown rather than resetting it — a reset made a small-radius,
  long-cadence nest practically impossible to trigger. Reveal gating — a nest must be *seen* once
  before it can wake — was added the same day; see the lifecycle above.)
- Defender wave size/composition; threshold granularity + wave cap (v1 = 25% bands, max 2 waves
  — chosen over 10% bands, whose expected ~4.5 waves felt like too many); the exact
  one-shot/overkill rule.
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
- **Spawn cadence** — the interval between spawns while active.
- **Max-alive cap** — the most of a spawner's creatures that may be alive at once.
- **XP budget** — a spawner's fixed total XP; spawns deduct from it, destruction pays the rest.
- **Defender wave** — a burst of creatures provoked by damaging the nest, rolled per 25% HP
  threshold crossed at `100 − remaining%` chance, max 2 per nest.
- **Diegetic** — existing inside the game's fiction (creatures emerge from a visible nest)
  rather than imposed from outside it (creatures popping into existence).
- **Placed roamer** — an authored, pre-placed ambient enemy not tied to a runtime spawner.
  Implemented as a `creature` object (a `ZoneObject` whose `props.creature` names a roster
  `CreatureId`), placed in Realmsmith and spawned once at zone load. The spawner's static
  sibling: no nest, no cadence — it just stands where you put it until killed.
