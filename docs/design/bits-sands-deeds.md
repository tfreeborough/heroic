# The Blood Tide — deeds chapter + Call the Tide

*Designed 2026-09-04 (Tom + Claude). Status: BUILT 2026-09-09, protocol v33 —
forge art/SFX + on-device pass + coordinated deploy owed (see § Build notes).*

Companion to [bits-sand-circle.md](bits-sand-circle.md) (the mechanic) and
[achievements.md](achievements.md) (the deed engine). One new chapter on the
Season I ranked board, one new spell that can ONLY be earned, never bought.

## The shape

Tom's brief: the spell is a whole-round tempo changer that costs a slot, so
it must "require a lot of work". The 2v2 board precedent applies — moments,
not counts — with ONE mastery chain for volume and a **capstone** deed that
requires every skill feat plus the chain's top. Jokes and luck never gate the
reward.

## Deeds

Chapter **The Blood Tide** (new `ACHIEVEMENT_CHAPTERS` entry, sits after
The Pit). Naming rule (bits-sand-circle.md § naming, 2026-09-09): every
player-facing string says **the Blood Tide**, never sands/circle/drown;
`sands*` stays the internal name. Ranked-only like every deed. Titles are Tom's to rename.

### Root

| Deed | Criteria | Cost |
|---|---|---|
| **The Horn Sounds** | Play a ranked round in which the Blood Tide rises. Chapter entry node; no reward. | free (`sands_rounds` ≥ 1) |

### The chain — kills after the horn

Counter `sands_kills`: killing blows you land in a round AFTER the Blood
Tide rose (normal kill credit; sands ticks themselves credit no one). Chosen over
"seconds in blood" because rewarding time in blood teaches the wrong habit.

| Tier | Threshold | Reward |
|---|---|---|
| **High Tide** | 10 | — |
| **Spring Tide** | 60 | — |
| **Red Deluge** | 250 | — (capstone requisite) |

Sands rounds are a minority of rounds, so 250 is a long climb by design.
Tune in place per the 2026-08-25 threshold precedent.

### Skill feats (all capstone requisites)

| Deed | Criteria | Cost |
|---|---|---|
| **Baptism** | Win a round in which YOU struck the killing blow on the last enemy while standing in the Blood Tide. | T2: `hit.inBlood` |
| **Waist Deep** | Win a round in which you took ≥ 20 blood ticks (10 s in the Blood Tide). | free |
| **Let the Tide Decide** | Win a round in which the last enemy was taken by the Blood Tide and you took zero blood ticks that round. | free |
| **Quicksand** | Win a match in which every round was decided in under **10 s** of fight time. Tom, 2026-09-09: 10 s is the bar — he has seen exactly one match end that fast ("everything getting fired at once") and it felt like a one-off, which is the right rarity for a feat. | free (`fightStartTick`) |
| **The Last Grain** | Win a round with a killing blow landed after the circle has fully closed (progress = 1). | T2: `hit.sandsP` |
| **Undertow** | Put an enemy over the shoreline into the Blood Tide — any displacement: Harpoon reel, Sinkhole drag, Warding Shout / Sandtrap / shell knockback, even a hammer or bow shove — and they die there within 4 s, to the blood or to you. | T2: `sandsShove` event |

### Jokes and luck (NEVER capstone requisites, pay no Glory/items)

| Deed | Criteria | Cost |
|---|---|---|
| **Dry Feet** | Be standing inside the final circle's footprint at the instant the Blood Tide rises. Pure luck. The chapter's one joke title. (Was "Eye of the Storm" — the Sandstorm cast chain already wears that title.) | T2: `sandsStart.inside` |
| **Taken by the Tide** | Die to the Blood Tide three times in one match. | free |
| **Watching the Sand Fall** | Win a match of ≥ 3 rounds in which EVERY round saw the Blood Tide rise. Deliberately advertises the stalling loadout — hence pays nothing. | free |

### Capstone

| Deed | Requires | Reward |
|---|---|---|
| **Tidecaller** | Baptism · Waist Deep · Let the Tide Decide · Quicksand · The Last Grain · Undertow · Red Deluge | title + `ability:call-the-tide` |

Why this beats one big threshold: the six feats pull in opposite directions
(Quicksand wants fast rounds, The Last Grain wants the full distance;
Undertow uses displacement against the ring, Let the Tide Decide denies the
fight entirely). A Tidecaller has demonstrably played the circle every way
it can be played — exactly who should own the clock.

## Titles — two, not six

Tom, 2026-09-09: don't oversaturate titles (the boards already pay 37). This
chapter pays exactly TWO: **Tidecaller** (the flex — the only title that
proves the whole chapter) and **Dry Feet** (the joke; luck deeds are
where joke titles live). Every other deed's unlock is its own reward; the
chain tiers and skill feats pay nothing until the economy pass sets Glory.
Rule of thumb for future chapters: one earned title + at most one joke.

## Engine change — the capstone trigger

`AchievementTrigger` gains a third kind:

```ts
| { kind: "capstone"; requires: readonly string[] }
```

`evaluate` fires it when every required id is in `unlocked ∪ fresh` (so the
capstone lands in the SAME match as its last requisite — one ceremony, two
cards). Implement as a second pass after feats/milestones. ~10 lines + a
test: the capstone must never fire with a requisite missing, and must fire
same-match. Map: parent = Red Deluge (silhouette until the chain tops out).

## Sim / accumulator signals (listed up front, writ-deeds style)

Free = accumulator only (`summary.ts`), no sim change:
1. Recognise `SANDS_ATTACKER_ID` hits → per-round `bloodTicks`, and deaths
   whose last hit was the sands → `tideDeaths`. Also fixes the silent drop
   where sands damage taken is indistinguishable from bleed.
2. Ingest `sandsStart` → round flag `sandsLive` (+ counter `sands_rounds`);
   kills while live → `sands_kills`.
3. Round duration = `roundEnd` tick − `fightStartTick` → `longestRoundSec`.
4. Round-scoped win flags computed at `roundEnd` into per-player counts:
   `waistDeepWins`, `tideDecidedWins`, plus `tideDeaths` for Taken by the Tide.

T2 (small sim additions, no protocol bump — events are additive):
5. `hit` gains `inBlood?: { attacker: boolean; victim: boolean }` and
   `sandsP?: number` on real hits while a circle is live (two `outsideSands`
   calls + `sandsProgress`). Powers Baptism, The Last Grain.
6. `sandsStart` gains `inside: number[]` — players already within the FINAL
   radius at the roll. Powers Eye of the Storm.
7. New event `{ type: "sandsShove"; byId; victimId }` fired when a
   displacement effect (harpoon pull, sinkhole drag, warding shout push)
   moves a victim from inside to outside the live ring. Accumulator holds a
   4 s window per victim; a sands OR attacker death inside it credits
   Undertow to `byId`. The one real piece of sim work here.

Dependency: the doc's future "credit the last real attacker within ~5 s"
would change Let the Tide Decide (the tide death would become your kill).
If that ships, keep the deed's test on the ORIGINAL attacker id (−1 on the
event) — add the credited id as a separate field rather than overwriting.

## Call the Tide — the spell

| | |
|---|---|
| Slot | ability, 1 charge per round, no cooldown |
| Cast | if no circle is live: the Blood Tide rises NOW at a fresh random centre (same `rollSands` path, same fairness draws). Nothing else. |
| Guards | not castable while a circle is live; not castable before **7 s** of fight time (decided 2026-09-09 at 10 s, trimmed to 7 s the same day) so a round never opens with the horn — long enough for an exchange or two, short enough that the slot still buys ~35 s of tempo. SHOWN, not hidden (Tom, same day): the slot opens each round in a real 7 s cooldown seeded at fightStart (`lockTideCallers`; config cooldown = the lock so the ring reads full→empty), and any roll — the fuse's or a call — spends every held charge so the button reads SPENT once a tide is in |
| Tell | fires the normal `cast` event → enemies learn you hold it the moment you use it (cast-flash intel rule). No cast bank: the HORN is the cast sound (Tom, 2026-09-09), and the banner reads **"<name> called forth / THE BLOOD TIDE / <worn title>"** in the kill-call grammar — `sandsStart.callerId` carries who. |
| Gate | `DEED_ABILITIES = { "call-the-tide" }`; entitlement `ability:call-the-tide`; hidden everywhere until owned; bots never draft it |
| Symmetry | affects all bodies equally — in 2v2 a coordination tool for the ready team, a liability for the other |

Cost of shipping it: new `AbilityId` + config row + effect in `abilities/`,
protocol bump + coordinated deploy (trident precedent — a new id crashes old
bundles), forge icon + cast SFX (the horn itself with a caster flourish;
brief in styleBible + row in soundSet), War Table codex copy, and its own
cast chain in the Offensive/Support Arts (coverage test). No bot archetype
work: gated items are never drafted.

Balance safety valves if it proves too strong: raise the minimum cast time;
make the cast a 1 s interruptible channel; or have the summoned circle close
faster but start at the caster's position (telegraphed, punishable).

## Decided 2026-09-09

- Call the Tide minimum cast time: **7 s** of fight time (10 s at first, trimmed the same day).
- Quicksand bar: **10 s** per round, from Tom's own play rather than a data
  pull. Still worth a one-line server log of `roundEnd` fight durations when
  building — a free sanity check against the first-win-audit rule (a deed
  that pops on every fast first win is a bug), not a blocker.

## Build notes (2026-09-09)

- **Engine**: `{ kind: "capstone", requires }` trigger, second pass over
  `unlocked ∪ fresh`, loops so capstones may require capstones
  (`packages/achievements/src/evaluate.ts`).
- **Sim signals**: `hit.tide {attackerOut, victimOut, p}` stamped in
  `stepSafeCircle` on every real hit while a circle is live;
  `sandsStart.inside`; `sandsShove {byId, victimId}` from a per-player
  `shovedBy/shoveLeft` stamp (`markShoved`, written by `applyImpulse` — so
  every knockback — plus the harpoon reel and the sinkhole drag; window
  `SANDS_SHOVE_WINDOW` = 1 s) + a `sandsOutside` edge detector. Reset on
  round reset.
- **Accumulator** (`summary.ts`): tideRounds, roundsPlayed, tideTicks,
  tideDeaths, tideKills, baptisms, waistDeepWins, tideDecidedWins,
  lastGrainWins, undertows, eyeOfStorm, longestRoundSec. Counters
  `sands_rounds`, `sands_kills`. `WAIST_DEEP_TICKS` = 20,
  `UNDERTOW_WINDOW_SEC` = 4.
- **Defs**: chapter "The Blood Tide", south cluster y ≥ 2300; ids
  the-horn-sounds, tide-kills-{10,60,250}, baptism, waist-deep,
  let-the-tide-decide, quicksand, the-last-grain, undertow, dry-feet,
  taken-by-the-tide, watching-the-sand-fall, tidecaller. Tests pin: jokes
  never requisites, two titles, first tideless win pops nothing.
- **Call the Tide**: `call-the-tide` (offensive, 1 charge, cooldown = the
  lock); `CALL_THE_TIDE.minFightSeconds` = 7; `tideCallable` gate at press
  time (harpoon rule: gated press = nothing, charge kept); `summonSands`
  sets `round.elapsed` to the delay and rolls via the shared `rollSands`,
  so radius/progress start from zero. `DEED_ABILITIES` = {call-the-tide};
  excluded from FREE_ABILITY_IDS; cast chain casts-call-the-tide-{15,75,300}
  at offensive row 5 (later rows renumbered, chapter slices 18/33).
  Protocol **v33**.
- **Client**: codex entry, showcase script, icon placeholder (sandstorm
  swirl copied to call-the-tide.png), NO cast bank (the horn is the cast;
  `clips: []` by decision), caller banner, 12 deed icons registered null
  (bare medallion).

**Owed**: forge 12 deed emblems + the horn icon (briefs in styleBible
DEED_SUBJECTS / ICON_SUBJECTS) + `sands_close_1` itself (still unforged);
coordinated server+client deploy (v33, the trident precedent); on-device
pass (does the horn read when YOU called it? the codex copy; the War Table
hiding the spell until earned); a server log line of `roundEnd` fight
durations as the Quicksand sanity check.

## Open questions

- Do Waist Deep / Baptism get Glory once the economy pass sets amounts?
