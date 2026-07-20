# Blood in the Sand — Bot Brains

Status: **agreed direction 2026-07-19 — rollout steps 1–4 BUILT (1–2
2026-07-19: nav layer + generalised casts + cast rules for all 11 abilities;
3 2026-07-20: the eight archetypes in botArchetypes.ts, derived per-tick
from the bot's own loadout inside botThink; 4 2026-07-20: the eight
difficulty tiers in botDifficulty.ts — snapshot-staleness reaction +
per-swing dodge roll + cast discipline + wobble, verified godlike-beats-
novice 9–1 in mirror matches; 5 2026-07-20: practice-lobby BOT SKILL picker
(4×2 tier grid, persisted "bits.botDifficulty", per-tier hint captions) +
dev-menu BOT BRAIN / BOT TIER session overrides — online rooms keep the
default tier, a room-level picker is future work; 6 2026-07-20: Tom's ladder
playthrough → bottom tiers stupider (longer staleness, dither freezes),
top tiers weave + timed dodges + 5/10% speed — the bow-kite exploit is
dead); further tuning happens from play** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-20

> Until matchmaking has a player base, bots ARE the game (Tom, 2026-07-19) —
> practice mode has to carry a genuinely satisfying single-player fight. This
> doc replaces the two v1 strategies (`seek` / `circle`) with a composable
> brain: a shared toolkit of micro-behaviours + per-ability cast rules,
> **archetypes** as parameter presets derived from the bot's loadout, and
> **difficulty** as an orthogonal execution-quality preset (the eight Unreal
> Tournament tier names). Difficulty changes NO stats — see the decision below.

## The design lens

A bot is just a client that thinks instead of touches: `botThink` (sim
package, shared verbatim by the app's in-process practice sim and the server's
headless bot script) reads a snapshot and emits one input per tick. Attacks
are automatic — the sim swings whenever the auto-target is in range — so a
brain controls exactly two things: **where to move** and **when to cast**.
Everything below is an elaboration of those two levers; nothing touches the
sim's combat rules, so bots can never do anything a human client couldn't.

Two consequences worth keeping in view:

- **Positioning IS aiming here.** Since weapons auto-fire, a "good shot" means
  standing in the right range band with the target acquirable — so the
  movement toolkit is where bot skill lives.
- **Casts are the intel currency.** Enemy kits are hidden until cast (the cast
  flash, [pvp-loadout-flow](./pvp-loadout-flow.md)) — a bot that spends casts
  well *and* reacts to what it has seen cast feels like a thinking opponent.

## Architecture: two layers + two presets

**Layer 1 — micro-behaviours** (steering: each proposes a movement direction
with a weight; the brain blends the active set and normalises):

| Behaviour | What it does |
|---|---|
| Engage | Close toward target (v1 `seek`, keeps the wall-unstick shuffle) |
| Kite | Hold a preferred range band: retreat inside it, advance outside it |
| Strafe | Orbit the target to stay hard to hit / hard to home on |
| Dodge | React to an enemy windup telegraph: dash or sidestep out of the arc/line |
| Anchor | Stay within a leash radius of the nearest living teammate |
| Peel | Move toward a teammate under attack; body-block or shout the diver off |
| Disengage | Retreat when low HP, when charges are spent, or while cooldowns recover |
| Avoid ground | Steer out of hostile zones (tremor, armed sandtraps, chip areas) |

Behaviours don't steer raw: each proposes a **goal point** (or a retreat
direction), and a shared **navigation layer** turns goals into wall-aware
movement — see the next section. This is load-bearing, not polish.

**Layer 2 — cast rules**: one "should I cast now?" predicate per ability
(table below). Rules read only snapshot data the bot legitimately has.

**Preset A — archetype** (weights/thresholds for layer 1, derived from
loadout). **Preset B — difficulty** (execution quality: reaction, dodge odds,
cast discipline). The two compose with no special cases: archetype decides
*what the bot is trying to do*, difficulty decides *how well it does it*.

## Navigation: bots are never trappable (Tom, 2026-07-19)

The known exploit in v1: arenas have collision (rocks, trees, walls), and
players routinely **bait bots into concave pockets** they can't escape —
purely local "steer toward target" has no answer to a U-shaped obstacle,
because every local step toward the target points back into the wall. The
seek strategy's unstick shuffle is a band-aid; the fix is real pathfinding,
and we already own every piece in core (the gauntlet's system,
[flow-field-pathfinding](./flow-field-pathfinding.md)):

- **NavGrid per arena, built once at brain init** from `zone.collision` (the
  Aabb list) via core `buildNavGrid` — static, deterministic, shared by every
  bot on a host. The map is public knowledge; humans see the rocks too.
- **Goal resolution**: if core `pathClear(me → goal)` holds, steer straight
  (one cheap raycast). Otherwise read the direction from a **flow field**
  flooded from the goal — wall-aware routing in O(1) per bot per tick. Bots
  chasing the same target share one field (the gauntlet's crowd trick), and
  fields re-sweep throttled (~200ms / target moved a cell), not per tick.
- **Retreat is nav-aware too** — the other half of the bait is luring a
  kiting/disengaging bot to back INTO a pocket. Kite/Disengage don't step
  blindly away from the threat: they probe a fan of candidate directions
  with `pathClear` and score each by threat distance + open room (flow-field
  cost toward open ground breaks ties), so a cornered bot slides along the
  wall and out instead of grinding into it. **The arena boundary counts as a
  wall here** (found in play, Tom 2026-07-20): the edge exists only as grid
  bounds (physics clamps it; there's no collision box), and core `pathClear`
  skips endpoint cells by design — so intent probes additionally require a
  STANDABLE endpoint cell, or a kiter pressed to the edge grinds outward
  forever instead of sliding along it.
- The v1 unstick shuffle survives only as a **last-resort fallback** behind
  the nav layer, and a bot triggering it logs in dev builds — after this
  work, "bot wedged on geometry" is a bug report, not a behaviour.
- **Navigation competence is NOT a difficulty dial.** A terminally stuck bot
  reads as broken at every tier, so all eight tiers path competently. Low
  tiers are still baitable the honest way — stale reactions mean they enter
  zones late and round corners lazily — but they always find the way out.

## Cast rules (first pass)

| Ability | Cast when… |
|---|---|
| Dash | Dodge says an unavoidable hit is incoming (i-frames), or Engage needs a gap closed, or Disengage needs an exit — priority in that order |
| Sandtrap | Disengaging or kiting through a chokepoint / own retreat path; melee archetypes drop it at the fight's centre |
| Tremor | ≥1 enemy inside radius AND (they're slowed/committed, or defending a Blood Font pour) |
| Harpoon | Target is kiting at the edge of my weapon's range (melee), or a diver needs dragging off a teammate (peel variant) |
| Mirror Guard | Enemy projectile windup is up within range and pointed at me |
| Ironhide | Committing through a telegraph on purpose (melee all-in), or caught with dash down |
| Straw Man | Reactive (2026-07-20 taunt rework): a blow winding up at me from inside the taunt radius — drop the decoy, the swing falls on straw |
| Warding Shout | ≥1 enemy in cone range of me or an anchored teammate while we're hurt — the peel button |
| War Drums | ≥1 teammate in radius while engaging or retreating as a group |
| Blood Font | My HP (or an anchored teammate's) below ~40% AND no enemy zone on the ground here — one pour per round, treat as precious |
| Sandstorm | Breaking ranged sightline on me/teammate (defensive), or covering a melee approach (offensive) |

## The eight archetypes

Archetype is **derived from the loadout** (Tom's framing 2026-07-19: melee +
support = aggressive but sticks with teammates — dials, not new brains).
Derivation: weapon sets the base (melee → engage-biased, ranged →
kite-biased), ability categories tilt it (support → Anchor/Peel weight up,
defensive → Dodge/Disengage up, offensive deployables → zone play). The
presets, roughly from most to least aggressive:

| Archetype | Typical loadout | Signature |
|---|---|---|
| Brawler | Blade + offensive | All-in engage, Ironhide through telegraphs, sticks for bleed |
| Juggernaut | Hammer + defensive | Patient bully: walks you down, casts to trap you in the sweep |
| Duellist | Melee + dash-heavy defensive | Dodge-focused counter-play: strafes, punishes recovery windows |
| Trapper | Any + sandtrap/tremor | Fights on prepared ground, funnels you through zones |
| Skirmisher | Bow/staff + dash | Kites the band edge, re-opens gaps, full-auto discipline |
| Sniper | Bow + defensive | Max-range extremist: avoids damage at all costs, Straw Man screens |
| Bodyguard | Any + support | Anchors to teammates, peels divers, Drums/Font at the right moment |
| Opportunist | Any + harpoon/offensive | Target-discipline brain: focuses low-HP, drags kiters, third-parties |

Practice lobby keeps random assignment by default (bots draft varied loadouts
→ varied archetypes for free); the dev menu gets an override picker for
testing a specific matchup.

## Difficulty: the eight UT tiers, even stats

**DECIDED (Tom deferred, Claude called it, 2026-07-19): difficulty scales the
brain only — stats are identical at every tier.** A top-tier bot with ~40ms
reactions, near-perfect telegraph dodging, and optimal casting is already
superhuman (original UT's top tiers barely touched stats either); the tuning
risk at Godlike is making it *lose sometimes*, not making it win. Even stats
also keep every fight readable — no damage sponges, no broken windup timings —
and losses feel outplayed, not outstatted. Fallback lever if playtesting
disagrees: a per-player stat multiplier threaded through the sim is a small,
deterministic addition; nothing here burns it.

| Tier | Reaction | Dodges | Casts | Wobble | Dither | Weave | Timed dodge | Speed |
|---|---|---|---|---|---|---|---|---|
| Novice | ~670ms | never | 20%, glacial | heavy | freezes often | — | — | even |
| Average | ~500ms | 10% | 35%, slow | strong | freezes | — | — | even |
| Experienced | ~370ms | 30% | 55% | some | rare freeze | light | — | even |
| Skilled | ~270ms | 55% | 75% | light | — | some | — | even |
| Adept | ~200ms | 70% | 85% | trace | — | real | ✓ | even |
| Masterful | ~130ms | 85% | 95% | trace | — | strong | ✓ | even |
| Inhuman | ~100ms | 95% | 100% | — | — | strong | ✓ | +5% |
| Godlike | ~33ms | 100% | 100% | — | — | strongest | ✓ | +10% |

(~250ms is the median human visual reaction time — Skilled is "plays like a
person"; everything above is progressively superhuman. Retuned after Tom's
step-6 ladder playthrough, 2026-07-20: the bottom stupider — longer
staleness, zero/low dodge, glacial ragged casting, plus **dither**, the
overwhelmed-new-player freeze; the top sharper — **weave** (serpentine
approach against shooters; kills the "kite with a bow, they walk a straight
line into arrows" exploit), **timed dodges** (vs a projectile windup, hold
the dash until the shot is about to loose, then hop PERPENDICULAR — dodge by
displacement; the mistimed windup-start dash is deliberately kept as the
low-tier behaviour), and — **REVISING the even-stats rule (Tom)** — the top
two tiers run 5%/10% move-speed hot via a host-set `ArenaPlayer.moveFactor`
(never wire-settable; damage/HP stay even at every tier). Verified: godlike
blade chaser now beats a novice bow kiter 6–1 in rounds — the pre-weave
version of that matchup lost 0–3.)

**Reaction time is implemented as staleness, not delay-handling:** each bot
keeps a short ring buffer of snapshots and thinks on the one ~N ms old. Every
downstream skill (dodge lateness, kite overshoot, whiffed peels) falls out of
stale data for free — no hand-written "make a mistake" code. Dodge odds and
cast discipline are the two explicit dials on top; movement noise is a small
deterministic jitter so low tiers don't track with robotic precision.

As-built notes (2026-07-20):

- **Stale world, current self.** The host's SnapshotHistory serves
  `players`/`deployables` at the tier's staleness, but the bot's OWN snapshot
  stays current — proprioception is instant, and a stale self-position
  re-opens the wall-grinding the nav layer eliminated.
- **The dodge roll is per SWING, not per tick** (else any odds converge on
  certainty over a windup's ticks): a new telegraph episode rolls once and
  the result stands for that whole swing — including the reactive casts
  (mirror/ironhide ride the same roll: a tier that misses the dodge misses
  the answer entirely). Rolls come from a per-bot seeded mulberry32 in
  BotMemory; the sim's rng stream is untouched.
- **Impatience (found in bot-vs-bot testing): rounds have NO clock**, and two
  competent equal-speed brains can kite/orbit each other — or carousel a
  pillar with line of sight broken — indefinitely. If neither side's hp
  changes for ~8s the bot presses in (band collapses to a charge, dash
  becomes a gap-closer) for ~5s; a FLEEING bot never presses (its opponent's
  impatience ends that stand-off). Bots supply the urgency a human's boredom
  would. **Open design question for a ranked future: a real round clock /
  sudden-death rule** — human-vs-human stalling has the same missing
  backstop.
- **Loadout asymmetry dwarfs tiers in extremes**: a dash-less blade vs a
  dash-owning bow loses at ANY tier (as it would for humans). Tier
  verification therefore uses mirror matches; cross-loadout balance is the
  step-6 tuning pass's business.
- **Last stand (Tom, 2026-07-20, from play):** fleeing exists to regroup
  with teammates — a lone survivor has nobody to regroup with, so a fleeing
  last body can only prolong a round, never win it (and chasing it is
  anti-fun). The team's LAST living bot never enters run-away mode; the
  archetype's band/dodge game stays on, only the disengage retreat is
  suppressed. In 1v1s every bot is always its team's last, so 1v1 bots
  simply never flee.

Difficulty is picked in the practice lobby (BUILT 2026-07-20: the BOT SKILL
4×2 chip grid on PracticeScreen, persisted per device, one expectation-
setting caption per tier — "plays like a person" / "it is not fair. it is
not meant to be") and defaults to Skilled. Every bot in the bout — ally and
enemy — fights at the picked tier. The dev menu carries two session-only
overrides for matchup testing: BOT BRAIN pins every practice bot's archetype
(else derived from loadout) and BOT TIER trumps the lobby pick. Online
rooms' backfill bots stay at the default tier; a room-level picker is future
work.

## Implementation notes

- `BotDecision.dash: boolean` generalises to `casts: boolean[]` (slot-indexed,
  mirroring `PlayerInput.casts`) — both current consumers already send a
  casts array, so this is a signature change, not a protocol one.
- `botThink` gains the full `players` list (teammate awareness) plus the two
  preset objects; `nearestEnemy` becomes one option in a target-selection
  helper (`focusTarget`) that Opportunist/Bodyguard override.
- `BotMemory` grows the snapshot ring buffer, a seeded per-bot RNG for noise /
  mistake rolls (sim-rng pattern — bot inputs are just inputs, so sim
  determinism is untouched either way, but seeding keeps practice replayable),
  and per-behaviour cooldown scratch.
- Zone awareness (Avoid ground) needs deployables/zones in the data the brain
  reads — already in the snapshot for rendering; the brain just starts
  consuming it.
- Nav reuses core wholesale: `buildNavGrid(zone.collision)` once per arena,
  `pathClear` for the straight-line fast path and retreat probes,
  `createFlowField`/flood for routing. New sim-side code is only the glue
  (`nav.ts`: shared grid + per-target field cache + goal→direction resolve).
  Cost check: arena grids are small, floods are radius-bounded and throttled,
  and the practice tick already runs 7 `botThink`s comfortably — the field
  read path is allocation-free O(1).
- **No new audio**: bots trigger the existing cast/combat SFX through normal
  sim events; nothing to add to the forge checklist.

## Rollout order

1. Nav layer + toolkit + generalised casts (behaviours behind the existing
   two strategies first — `seek`/`circle` become degenerate presets that
   PATH, nothing regresses and the bait-into-rocks exploit dies on day one).
2. Cast rules for all 11 abilities.
3. Archetype derivation + the eight presets.
4. Difficulty dials (staleness buffer first — it's the backbone).
5. Practice-lobby difficulty picker + dev-menu archetype/difficulty overrides.
6. Tuning passes: Godlike must be brutal-but-beatable 1v1; Novice must lose
   convincingly without visibly throwing.
