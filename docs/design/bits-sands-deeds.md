# The Closing Sands — deeds chapter + Call the Tide

*Designed 2026-09-04 (Tom + Claude). Status: DESIGNED, not built.*

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

Chapter **The Closing Sands** (new `ACHIEVEMENT_CHAPTERS` entry, sits after
The Pit). Ranked-only like every deed. Titles are Tom's to rename.

### Root

| Deed | Criteria | Cost |
|---|---|---|
| **The Horn Sounds** | Play a ranked round in which the sands roll. Chapter entry node; no reward. | free (`sands_rounds` ≥ 1) |

### The chain — kills after the horn

Counter `sands_kills`: killing blows you land in a round AFTER the sands
rolled (normal kill credit; sands ticks themselves credit no one). Chosen over
"seconds in blood" because rewarding time in blood teaches the wrong habit.

| Tier | Threshold | Reward |
|---|---|---|
| **High Tide** | 10 | — |
| **Spring Tide** | 60 | title |
| **Red Deluge** | 250 | title (capstone requisite) |

Sands rounds are a minority of rounds, so 250 is a long climb by design.
Tune in place per the 2026-08-25 threshold precedent.

### Skill feats (all capstone requisites)

| Deed | Criteria | Cost |
|---|---|---|
| **Baptism** | Win a round in which YOU struck the killing blow on the last enemy while standing in the blood. | T2: `hit.inBlood` |
| **Waist Deep** | Win a round in which you took ≥ 20 blood ticks (10 s in the tide). | free |
| **Let the Sands Decide** | Win a round in which the last enemy died to the sands and you took zero blood ticks that round. | free |
| **Quicksand** | Win a match in which every round was decided in under 20 s of fight time. | free (`fightStartTick`) |
| **The Last Grain** | Win a round with a killing blow landed after the circle has fully closed (progress = 1). | T2: `hit.sandsP` |
| **Undertow** | Displace an enemy (Harpoon, Sinkhole, Warding Shout) from safe sand into the blood, and they die within 4 s. | T2: `sandsShove` event |

### Jokes and luck (title only, NEVER capstone requisites, pay no Glory/items)

| Deed | Criteria | Cost |
|---|---|---|
| **Eye of the Storm** | Be standing inside the final circle's footprint at the instant the sands roll. Pure luck. | T2: `sandsStart.inside` |
| **Pearl Diver** | Drown three times in one match. | free |
| **Watching the Sand Fall** | Win a match of ≥ 3 rounds in which EVERY round reached the sands. Deliberately advertises the stalling loadout — hence pays nothing. | free |

### Capstone

| Deed | Requires | Reward |
|---|---|---|
| **Tidecaller** | Baptism · Waist Deep · Let the Sands Decide · Quicksand · The Last Grain · Undertow · Red Deluge | title + `ability:call-the-tide` |

Why this beats one big threshold: the six feats pull in opposite directions
(Quicksand wants fast rounds, The Last Grain wants the full distance;
Undertow uses displacement against the ring, Let the Sands Decide denies the
fight entirely). A Tidecaller has demonstrably played the circle every way
it can be played — exactly who should own the clock.

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
   whose last hit was the sands → `drownings`. Also fixes the silent drop
   where sands damage taken is indistinguishable from bleed.
2. Ingest `sandsStart` → round flag `sandsLive` (+ counter `sands_rounds`);
   kills while live → `sands_kills`.
3. Round duration = `roundEnd` tick − `fightStartTick` → `longestRoundSec`.
4. Round-scoped win flags computed at `roundEnd` into per-player counts:
   `waistDeepWins`, `sandsDecidedWins`, plus `drownings` for Pearl Diver.

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
would change Let the Sands Decide (the drowning would become your kill).
If that ships, keep the deed's test on the ORIGINAL attacker id (−1 on the
event) — add the credited id as a separate field rather than overwriting.

## Call the Tide — the spell

| | |
|---|---|
| Slot | ability, 1 charge per round, no cooldown |
| Cast | if no circle is live: the sands roll NOW at a fresh random centre (same `rollSands` path, same fairness draws). Nothing else. |
| Guards | not castable while a circle is live; not castable before **10 s** of fight time (Tom to confirm) so a round never opens with the horn |
| Tell | fires the normal `cast` event → enemies learn you hold it the moment you use it (cast-flash intel rule) |
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

## Open questions

- Minimum cast time for Call the Tide (10 s proposed).
- Quicksand's 20 s bar needs real data on round lengths (server log
  `roundEnd` durations for a week) — the first-win-audit rule: a deed that
  pops on every fast first win is a bug.
- Do Waist Deep / Baptism get Glory once the economy pass sets amounts?
