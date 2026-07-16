# Blood in the Sand — PVP Arena Concept & Network Architecture

Status: **agreed (v2) — approved + M1 built 2026-07-07/08** ·
Applies to: **Blood in the Sand** (shares all combat systems with Gauntlet + Journey) ·
Last decided: 2026-07-08

> Title decided by Tom 2026-07-07: **Blood in the Sand** (replaces the "Heroic: Arena"
> placeholder). Code: `packages/blood-in-the-sand-sim` (pure sim + wire protocol),
> `apps/blood-in-the-sand-server` (Bun WS server), `apps/blood-in-the-sand` (Expo client,
> dev builds like the gauntlet).
> This doc records the concept and the netcode architecture decision so implementation never
> re-litigates them; **v2 updates it to what M1 actually built.**

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

- **Teams:** the host picks **1v1 / 2v2 / 3v3 / 4v4** at room creation (built
  2026-07-16, protocol v11) → 2×N open seats; joiners are **randomly placed
  onto teams**, balanced (join the smaller team, coin-flip on ties, from the
  sim rng — deterministic). The arming countdown waits for a full room; the
  host's force-start launches early with empty seats. 5v5 remains the design
  ceiling if playtests want it.
- **Round:** both teams spawn at their arena's team spawn points → fight → last team standing
  wins the round. **One life** — the fallen spectate their team until the round ends.
- **Match:** first to **3 round wins** *(placeholder — tune)*.
- **Stall guard:** round timer *(placeholder: 3 min)*; on expiry, **sudden death** — a shrinking
  arena boundary that damages anyone outside it *(mechanism open — could also be: most total
  damage dealt wins; decide when it actually stalls in playtests)*.

## Loadout: one weapon, pick 3 powers

**Weapons: BUILT 2026-07-10 (protocol v3).** Four weapons, picked per-player in the lobby
(tap to repick until the host starts; duplicates allowed — variety by choice, not rule;
decided with Tom 2026-07-10). The match cannot start until every seat has picked
(`canStartMatch`). Every weapon auto-fires at the auto-target — ranged included — so still
no aim input on the wire (confirmed 2026-07-10). The table lives in the sim package's
`config.ts` (`WEAPONS`); the client imports it directly (the ARENA_00 rule), so per-weapon
telegraphs never desync:

| id | shape | feel | signature |
| --- | --- | --- | --- |
| blade | 40° arc, reach 90, fastest cycle | commit in close | 35% chance on hit: bleed, 3 × 3 dmg over 3s (fixed damage, no rng draws — core `status.ts` DoT container, the seed of the modifiers-and-effects hook system) |
| bow | projectile 520 px/s, range 360 | long poke, biggest hit | arrows stop on walls; dash i-frames pass *through* a shot |
| staff | projectile 300 px/s, range 320, homing 2.2 rad/s | zoning dread | steers toward its fire-time target; barely faster than a sprint — dash/walls beat it, running doesn't |
| hammer | 90° arc, reach 125 (longest melee), slowest cycle | melee zoning | knockback 1400 (vs blade 100) — launches people out of its own reach |

**Melee range swap 2026-07-10 (Tom):** the hammer now OUT-REACHES the blade (125 vs 90; they
launched at 70 vs 110). Rationale: the hammer was paying three costs (reach, speed, damage) for
one benefit whose real value only arrives at 5v5 (knockback → peel/displacement), and its own
launch kept resetting the approach it had just won — while the blade held the longest reach AND
the fastest cycle AND bleed. Now: blade = get genuinely close, cycle fast, stack bleeds; hammer
= a long, slow, readable sweep that wins *space*, not duels (attack nudged 9 → 11 so it isn't a
pillow). Knockback polarised same day (Tom): blade 400 → 100 (it wants targets to STAY in
reach for bleed stacking), hammer 1100 → 1400.

Balance numbers are first guesses awaiting on-device tuning; the "read the telegraph, dash the
strike" windup philosophy carries over (0.25–0.6s windups). Ranged windups draw an aim-line
telegraph instead of the arc wedge. **Pacing pass 2026-07-10 (Tom, after first play):** attack
cycles slowed across the board (blade 0.8s, bow/hammer 1.2s, staff 1.5s) — the 0.9s-cycle staff
was near-unapproachable; ranged must leave gaps a melee player can close through. Added the
same day: **enemy range rings** — a faint dashed circle at each enemy's strike range, fading in
as you approach, so engage/disengage decisions read at a glance (client-derived from snapshot
weapon + positions; nothing networked).

**Powers: designed, not built (sketch 2026-07-10 — iterate with Tom before building).**
Each player picks **up to 3 powers** in the lobby, same flow as weapons. Dash stops being
hardwired and becomes the first catalogue entry:

- **Sim shape:** `DashState` generalises to `powers: PowerState[]` (each = core `AbilityState`
  + per-power runtime fields); `PlayerInput.dash: boolean` becomes three per-slot booleans (or a
  bitmask); the server's `dashLatch` set becomes per-slot latches. A `POWERS` table in
  `config.ts` mirrors `WEAPONS`.
- **Wire:** fold `setWeapon` into `{ t: "setLoadout"; weapon; powers[] }` when powers land (one
  more protocol bump); `RoomStatePlayer.powers`; per-power cooldowns in `PlayerSnapshot`
  (generalising `dashCd`).
- **Client:** the buttons container (built 2026-07-10 as a column opposite the thumbstick)
  holds up to 3 `PowerButton`s — `DashButton` generalised with per-power icons over the same
  cooldown-pie overlay.
- **Starter catalogue (6 for playtests):** dash (as today), blink (teleport, no barge, longer
  cd), shield (brief damage immunity, rooted), hook (projectile that pulls the victim in —
  reuses the weapon projectile system), war cry (radial knockback burst), regenerate
  (channelled heal, broken by damage). Picks should enable counter-play (hook pulls the archer
  in; shield eats the hammer launch) and, later, team roles.

No classes in v1 — the weapon + 3 powers *is* the build. This keeps the draft legible and dodges
the class-balance problem while the catalogue is small. *(Revisit if builds converge on one meta
combo — banning/pick-order or class restrictions are the levers.)*

**Catalogue authoring is the content cost:** 12 powers that are fair vs humans is a real
balancing job (PvE tolerates wild imbalance; PvP doesn't). v1 playtests start with ~6.

## Blood on the sand (added 2026-07-10, Tom's design)

The title mechanic: **wounded players bleed onto the arena floor**. Below **50% hp** a player
drips a blood trail behind them, and the drip rate/size worsens as hp falls — so a fresh, dense
trail means a badly hurt player went this way, and a busy match paints the sand with where the
fighting happened. Hits also splash blood at the impact point (scaled by damage), and a kill
leaves a larger, longer-lived pool. Decals fade out over ~45s (pools ~100s); blood **persists
across rounds** within a match and clears with the fresh match.

**Architecture decision — blood is client-derived, never networked.** Drips are a pure function
of snapshot data every client already receives (positions + hp each tick); splashes/pools come
from the existing `hit` events. Per the events contract, the wire only carries what clients
can't re-derive — so the sim, protocol, and server are untouched. Per-client random jitter means
pixel placement differs between phones, but the trails describe identical information. Accepted
trade-off: a mid-match spectator/rejoiner starts with a clean floor (blood spilt before they
arrived is gone for them) — fine while blood is informational flavour, revisit if it ever
becomes a hard gameplay mechanic. Implementation: `BloodField` in
`apps/blood-in-the-sand/src/game/blood.ts` (capped decal pool, oldest-first eviction), drawn on
the floor layer with camera culling in `render.ts`.

**Deferred (needs art):** a skeleton decal where each player fell, sinking further into the
sand as rounds pass — the death pool is its placeholder marker for now.

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

**Shape (as built, M1):** `packages/blood-in-the-sand-sim` (@heroic/blood-in-the-sand-sim) holds the pure sim — one plain
JSON-able `ArenaState`, `stepSim(sim, inputs, dt)` composing core primitives (`stepAttackCycle`,
`stepAbility`, `stepCrowd`, `resolveAttack`, `hitsInArc`, `selectTarget`, `segmentClear`) — plus
the wire protocol, snapshot projection, and the client's interpolation buffer, all unit-tested
(determinism asserted: same seed + inputs ⇒ identical states). `apps/blood-in-the-sand-server`
is a Bun WebSocket process running the sim at a **fixed 30Hz tick** and broadcasting snapshots
**every tick** (~21KB/s per client — a `SNAPSHOT_DIVISOR` constant drops it to 15Hz if ever
needed); the round/match machine lives *inside* the sim, so the server is pure transport.
Clients send `{ seq, stick, dash }` per tick (auto-targeting means no aim vector) and render
66ms behind the newest snapshot, lerping the bracketing pair. The arena zone JSON lives inside
`packages/blood-in-the-sand-sim` and is statically imported by BOTH server and client — the map can never
desync. M1 is one room, first-two-players; join codes come with M2. Headless bot clients
(`scripts/bot.ts`) let the server play full matches with no phones — that plus the sim tests is
the regression net.

**Rooms + host-driven lobbies (added 2026-07-10, Tom's design).** Players create rooms
(optional passcode) or browse/join open ones; each room is a lobby showing player names where
the **host** (creator; crown migrates if they leave) starts the match. After first-to-3
everyone returns to the lobby — **no auto-rematch**. Room registry is **in-memory only** (a
room is exactly as ephemeral as the match inside it; a DB would persist pointers to vanished
matches): `Map<code, Room>`, 4-letter unambiguous codes (doubles as join-by-code), 20-room cap,
2-minute empty-room GC. **Disconnect rule (Tom):** the match never pauses — a dropped player's
body idles in place and stays killable; rejoining the room reclaims the seat and its live
character; seats still empty when the match ends are freed at the lobby. Protocol v2
(create/join/list/watch/leave/start); `watchRoom` spectates seatlessly (debug tooling now, the
seed of bench-spectating later). Pure decision logic (codes, join rules, GC policy) lives in
the sim package under test; the server stays transport.

**Combat rule discovered in bot playtests (2026-07-08):** a windup whose facing locks at start
whiffs forever against a point-blank strafer (they orbit out of the cone every time — bot-vs-bot
fights literally never resolved). The arena rule is now **the windup tracks its target until the
strike**; counterplay is dash i-frames or breaking reach, not sidestepping — matching the
telegraph-then-dash design intent. PvE keeps its start-locked rule; this is exactly the kind of
per-game tuning the separate PvP tables exist for.

**LAN-first, deliberately.** On home Wi-Fi latency is 1–5ms, so v1 needs **no client
prediction, no lag compensation** — the genuinely hard netcode. Naive send-input /
render-snapshot feels fine on LAN. Internet play (prediction + reconciliation, hosted server,
matchmaking) is a later phase and a separate decision. *(Trade-off recorded: until then the
game is same-network only — acceptable for the validation goal.)*

> **Amended 2026-07-08 (Tom):** the server auto-deploys to **Render** (dashboard-configured
> web service on the native Bun/Node runtime — build `bun install`, start
> `bun apps/blood-in-the-sand-server/src/main.ts`; settings recorded in the app README) so the
> phones use one fixed address with no server-on-the-Mac step —
> i.e. internet *transport* arrives early, still **without prediction**. UK→Frankfurt adds
> ~25–40ms on top of the 66ms interpolation delay; judged acceptable for a top-down
> auto-targeting game, and the LAN path remains as an override in the join screen if it feels
> floaty. M4 (prediction/reconciliation, matchmaking) stays a separate unscheduled decision.
> Known accepted holes until M2: one public room on a guessable URL (join codes fix this) and
> free-tier spin-down (~1 min cold start; `starter` plan if annoying).

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

| # | Milestone | Proves | Status |
| --- | --- | --- | --- |
| M0 | ~~Pure `step()` extraction from Gauntlet~~ → **superseded**: the arena sim was written fresh in `packages/blood-in-the-sand-sim`, composing core primitives; Gauntlet untouched (Tom's constraint 2026-07-08) | zero regression risk to the shipping game | done |
| M1 | **LAN 1v1** — two phones, Bun server on the Mac, one arena, fixed loadout (sword + dash) | the netcode end-to-end (the wife test) | **built 2026-07-08** — full bot matches + Expo Go client verified vs live server; two-phone playtest pending |
| M2 | Rounds + bench/spectate + loadout picker + 2v2 | the actual game loop is fun | **partial 2026-07-10**: rooms, passcodes, host-run lobbies, names, watchRoom, weapon picker (4 weapons, protocol v3); **team sizes 1v1–4v4 built 2026-07-16** (protocol v11, host-picked, random-balanced assignment, incl. practice vs bot teams); remaining: in-match bench view |
| M3 | 5v5, skill catalogue to 12, stall rules tuned | the full pitch | — |
| M4 | Internet play (prediction, hosted server) | *separate decision — not scheduled* | — |

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
