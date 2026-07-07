# PVP Arena — Concept & Network Architecture

Status: **proposal (v1) — drafted 2026-07-07, awaiting sign-off** ·
Applies to: **new third title** (shares all combat systems with Gauntlet + Journey) ·
Last decided: —

> Working title: **Heroic: Arena** *(placeholder — amusingly, the name Gauntlet vacated;
> Tom to decide)*. This doc records the concept and the netcode architecture decision so the
> prerequisite engineering (which benefits Gauntlet regardless) can start without re-litigating.

## The pitch

Team-vs-team elimination in authored arenas. Up to **5v5**; each player has **one life per
round** — die and you're benched (spectating) until the next round. Eliminate the enemy team to
win the round; first team to the round target wins the match.

Where Gauntlet is *you vs the dungeon*, Arena is *your build vs theirs*: the same combat, the
same skills, but every fight is against humans. The bet: the PvE systems we're already building
(combat math, abilities, movement/targeting, Realmsmith zones) are ~80% of a PVP game — the new
20% is netcode and match structure.

## What it reuses (and why it's cheap)

| System | Source | Reuse |
| --- | --- | --- |
| Combat resolution | [combat](./combat.md) — `resolveAttack` in `@heroic/core` | as-is: already faction-agnostic (any combatant vs any combatant) |
| Skills/abilities | [characters-and-talents](./characters-and-talents.md) — shared ability lifecycle (`stepAbility` in core) + per-skill effects | as-is: skills authored once work in all three games; dash is the worked example |
| Movement + auto-targeting | [player-movement-and-targeting](./player-movement-and-targeting.md) | as-is: auto-targeting means no aim input to network (a big netcode simplifier) |
| Arenas | [realmsmith](./realmsmith.md) zone JSON | as-is: server and clients load the same authored file; arena authoring = a Realmsmith map with spawn points per team |
| Seeded RNG, fixed-step sim | `@heroic/core` (`createRng`, `advanceFixed`) | as-is: built deterministic from day one |

**Explicitly out (v1):** persistent progression, gear, XP/levels, gold, lives/IAP. A match is
self-contained — everyone enters equal and the round loadout is the whole build. (Cosmetics /
account-level unlocks are a later monetisation question, not v1.)

## Match structure (v1 rules)

- **Teams:** up to 5v5; any size down to 1v1 works (1v1 is the first playtest target).
- **Round:** both teams spawn at their arena's team spawn points → fight → last team standing
  wins the round. **One life** — the fallen spectate their team until the round ends.
- **Match:** first to **3 round wins** *(placeholder — tune)*.
- **Stall guard:** round timer *(placeholder: 3 min)*; on expiry, **sudden death** — a shrinking
  arena boundary that damages anyone outside it *(mechanism open — could also be: most total
  damage dealt wins; decide when it actually stalls in playtests)*.

## Loadout: one weapon, pick 3 skills

At round start (or match start — open question) each player picks:

- **1 weapon** from the shared weapon categories ([equipment](./equipment.md) shapes: melee /
  ranged / magic) — sets your basic-attack pattern and damage school.
- **3 skills** from a catalogue of **12+** actives. These are the same ability implementations
  the PvE games use (dash, and the class kits as they're built) — the PVP catalogue is a curated
  *subset + rebalance pass*, not new systems. PvP numbers live in a separate tuning table from
  PvE numbers (same skill, different constants) so balancing one never breaks the other.

No classes in v1 — the weapon + 3 skills *is* the build. This keeps the draft legible and dodges
the class-balance problem while the catalogue is small. *(Revisit if builds converge on one meta
combo — banning/pick-order or class restrictions are the levers.)*

**Catalogue authoring is the content cost:** 12 skills that are fair vs humans is a real
balancing job (PvE tolerates wild imbalance; PvP doesn't). v1 playtests can start with ~6.

## Network architecture (the decision)

Two classic approaches, recorded so we don't revisit:

- **Lockstep** — every client sends only inputs; every device runs the identical sim. Minimal
  bandwidth but requires **bit-perfect determinism** (all devices compute identical floats,
  identical tick counts) and one laggard stalls everyone.
- **Server-authoritative** — one server runs the real sim; clients send inputs and receive
  periodic **snapshots** (serialized world state), rendering by smoothly blending between the
  last two (**interpolation**). More bandwidth; no determinism requirement; cheat-proof by
  construction.

**Decision: server-authoritative.** Rationale recorded:

1. Our sim rate is deliberately **adaptive per device** (60→30→20Hz under load — the crowd-perf
   work). Lockstep needs every client on an identical fixed tick; server-auth lets the server
   pin its own rate while clients keep their adaptive render loop.
2. Cross-device float determinism (Hermes on two phone models) is miserable to verify and
   miserable to debug when it drifts. Server-auth never needs it.
3. Cheating: client-run sims can't be trusted for PVP anyway.

**Shape:** a new `packages/server` — a **Bun** process (built-in WebSocket server, zero new
deps) that imports `@heroic/core`, loads the arena zone JSON, runs the sim at a **fixed 30Hz
tick**, and broadcasts snapshots at **15–20Hz**. Clients send `{ stick, dash, skill1..3 }` per
tick (a few bytes — auto-targeting means no aim vector) and render interpolated snapshots.
Rooms via a join code; the lobby is just "who's connected + team assignment + loadout picks".

**LAN-first, deliberately.** On home Wi-Fi latency is 1–5ms, so v1 needs **no client
prediction, no lag compensation** — the genuinely hard netcode. Naive send-input /
render-snapshot feels fine on LAN. Internet play (prediction + reconciliation, hosted server,
matchmaking) is a later phase and a separate decision. *(Trade-off recorded: until then the
game is same-network only — acceptable for the validation goal.)*

## Prerequisite engineering (benefits Gauntlet regardless)

In dependency order — 1 dominates:

1. **Extract the pure sim step.** Today the per-tick step is a ~1000-line closure in
   `GameScreen.tsx` mutating ~20 refs, stepping Matter.js, and playing audio inline. It must
   become `step(state, inputs, dt) → state` over one plain-data world state, with
   audio/haptics/rendering *reacting to* the output (events list on the state) rather than
   living inside it. Pays off for single-player too: testability, replays, headless perf runs.
2. **Players become entities.** The player is a hard-coded singleton (one Matter body, one
   combatant, one dash runtime) with two hard-coded damage directions (`applyHit` /
   `damagePlayer`). Promote players into the entity-list model enemies already use, add a
   `team` tag, unify damage into one team-aware path. Likely drop Matter.js for players —
   enemies already integrate in pure core, and our actual physics (circle movers + walls) is
   simple. *(PvE regression risk: this touches the Gauntlet hot path — the perf profiler
   overlay is the guard.)*
3. **Serializable state.** Mostly plain data already; consolidate the scattered refs into one
   snapshot-able object (falls out of 1+2).

## Milestones

| # | Milestone | Proves |
| --- | --- | --- |
| M0 | Pure `step()` extraction; Gauntlet plays identically | the refactor didn't break the shipping game |
| M1 | **LAN 1v1** — two phones, Bun server on the Mac, one arena, fixed loadout | the netcode end-to-end (the wife test) |
| M2 | Rounds + bench/spectate + loadout picker + 2v2 | the actual game loop is fun |
| M3 | 5v5, skill catalogue to 12, stall rules tuned | the full pitch |
| M4 | Internet play (prediction, hosted server) | *separate decision — not scheduled* |

**Scope honesty:** M1 is a few weeks of evening work on top of M0. A *shipped* internet 5v5 is
a different beast (matchmaking, server hosting costs, disconnect handling, PvP balance as a
live service). Arena is a **cheap prototype on shared systems**, not a parallel ship target —
Gauntlet still ships first; nothing here may slip it.

## Open questions

- Working title (placeholder: Heroic: Arena).
- Loadout timing: pick per-round (draft/counter-pick tension) or per-match (commit to a build)?
- Draw handling: shrinking boundary vs damage-tiebreak — decide from real stalled playtests.
- Mid-round disconnect: pause? bot-walk to death? forfeit that player's life? (LAN v1: whoever
  dropped rejoins next round.)
- Respawn-bench spectating: free camera or lock to a living teammate?
- Does Arena share Gauntlet's app shell or start as its own `apps/` entry? (Own entry likely —
  no navigation/progression baggage — but decide at M1.)
