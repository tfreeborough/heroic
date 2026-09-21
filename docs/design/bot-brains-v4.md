# Blood in the Sand — Bot Brains v4: the un-trickable pass

Status: **BUILT 2026-09-21 (all five stages, same day as the audit) —
gauntlet losses to tricksters 66/216 → 3/312 (1v1 rows) at Godlike; Tom's on-device
feel pass owed** ·
Applies to: **Blood in the Sand** ·
Builds on: [bot-brains](./bot-brains.md) (v2 toolkit/archetypes/tiers),
[bot-humanization](./bot-humanization.md) (v3 motor texture)

> Tom, 2026-09-21: "it's still quite easy to beat a godlike bot provided you
> know how to trick it — I want to avoid those situations." Plus: a lot of
> weapons and abilities have landed since the brain was last touched
> (2026-09-03), and the brain has never been taught most of them.

## Method: the exploit gauntlet

Guessing at exploits from code is cheap and unreliable, so this pass starts
with a harness: `packages/blood-in-the-sand-sim/src/botGauntlet.ts`
runs a **godlike** bot, headless, against scripted **trickster policies** —
tiny programs that do the one dumb-but-effective thing a human who has
figured the bot out would do. Tricksters read the world ~230ms stale (a
human's reaction time), get no speed bonus, and most never press a button.
If a 15-line script beats godlike, a person certainly can.

```
bun packages/blood-in-the-sand-sim/src/botGauntlet.ts 12
```

### Baseline (6 matches per row, first to 3 rounds, arena-00)

| Godlike bot | Trickster | Matches | Rounds | Note |
|---|---|---|---|---|
| blade + dash/ironhide | CHASER hammer (walks at it, no casts) | 6–0 | 18–0 | but **67% of hammer swings land** |
| hammer + dash/ironhide | CHASER hammer | 6–0 | 18–0 | **62% land** — on a 0.65s telegraph, at "100% dodge" |
| hammer + dash/ironhide | **CHASER fang** (no casts) | **1–5** | 9–17 | 73 dashes burned, out-cycled at contact |
| blade + dash/ironhide | **KITER trident** | **1–5** | 7–17 | never gets inside the dead zone |
| bow + dash/mirror | **KITER bombard** | **1–5** | 8–15 | stands in the landing ring |
| blade + dash/ironhide | **TRAP-CAMPER bow** (mine between us) | **2–4** | 13–14 | 52 detonations in 27 rounds — eats ~every mine |
| hammer + dash/ironhide | **TRAP-CAMPER staff** | **0–6** | 6–18 | same; can never reach the camper |
| blade + dash/ironhide | KITER bow / scorpion / bombard | 6–0 | — | fine (weave + speed carry it) |
| bow + dash/mirror | CHASER blade / hammer | 6–0 | — | fine |

(A `FEINTER` policy — start a windup, step back out so it cancels free, to
bait Mirror Guard/Ironhide/Straw Man — is in the harness but my script for
it is too clumsy to win; the mechanism is real (see R1), the win-rate is
unproven. Tom's hands are the better test.)

## Diagnosis: five root causes, not fifteen patches

**R1 — Answers commit at windup START, not at the STRIKE.** Every reactive
answer (the melee dodge-dash, Mirror Guard, Ironhide, Straw Man) fires the
tick a telegraph appears. Three separate failures fall out of that one
decision:

- *Mistimed i-frames.* Dash invulnerability is 0.2s. Hammer windup is 0.65s,
  bow 0.5s, trident 0.35s + a 0.15s travelling thrust. A dash at windup
  start is over long before the blow lands, and since the windup TRACKS its
  target, the 75px hop rarely breaks reach either (a brawler's hop is
  usually *toward* the attacker). Only the ranged case was ever fixed
  (`smartDodge` holds the dash to `atkLeft ≤ 0.15`).
- *Burned budget.* Dash is 4 charges a round on a 3s cooldown. The fang
  swings every 0.45s. The bot answers swing one and is naked for the rest —
  a godlike hammer bot burns 12 dashes a match against a fang and loses.
- *Feints are free.* A windup whose lock breaks (target leaves the
  engagement radius, or LOS) cancels with NO recovery. For a bow that is a
  20px step backwards. Every early-committed answer can be baited out at
  zero cost.

**R2 — Melee bots have no spacing game.** `band: null` means "walk to the
middle of the target". That is wrong whenever reaches differ: a hammer (125)
should fight a fang (60) from 100px where the fang cannot swing at all;
everything should live INSIDE the trident's dead zone (<115) and the
bombard's (<120); a blade should not stand in a hammer's arc between its own
swings. Positioning is aiming in this game, and half the archetypes don't do
any.

**R3 — Hazard knowledge is a hand-written list that content outran.**
`hostileZoneRadius` knows quake, sandstorm and ARMED sandtraps. It does not
know: **arming** traps (invisible to the brain for 2s — it walks onto them
and they arm underfoot; treating them as live took blade-vs-camper from 2–4
to 4–2 in a one-line experiment), **sinkhole**, **tar**, or **bombard
shells** (`shells` isn't even in `BotWorld`). It also skips everything
friendly — wrong for the spare-no-one family (sinkhole, tar, bombard blasts
hurt their own team).

**R4 — New weapons are misread.** The bots never draft gated/Signet kit, but
they must FIGHT it:

- *Bombard* has `shell`, not `projectile`, so `rangedWeapon()` says melee:
  threat range becomes reach+50 = 410px, the bot panic-dashes at every
  windup from across the arena, never weaves, and never walks off the mark.
- *Trident*: no notion of the dead zone as the answer (dash INTO it).
- *Scorpion*: three re-aimed bolts; the dodge spends itself on bolt one.
- *Lifeline*: the healer is never a priority target ("kill the body" is the
  whole counterplay, per the config comment). `weakest` focus actively
  prefers the patient.
- *Titan's Draught*: reach and body grow 1.6×; threat ranges don't.
- *Fang*: poison punishes staying in reach; the brawler stays in reach.

**R5 — No concept of a losing approach, and no memory between rounds.** The
trap-camper wins on geometry: they orbit the mine on a small circle, the
bot orbits on a big one, so +10% speed never catches them. A person would
stop, go wide, wait out the orb, or tank the mine under Ironhide on purpose.
The bot repeats the same failed approach every round of every match — which
is exactly what "knowing how to trick it" means.

## Proposal (staged — each stage lands with gauntlet rows that must flip)

**Stage 0 — the gauntlet becomes the regression suite.** Keep the harness in
the repo, add Tom's real tricks as policies (the most valuable input to this
whole pass), wire `bun run bots:gauntlet`, and add a slim CI-able subset to
`bot.test.ts` as hard gates ("godlike never loses a match to CHASER-*").
Every future weapon adds a trickster row — the brain can't silently fall
behind content again.

**Stage 1 — the strike predictor (fixes R1, most of R4).** Replace "is there
a windup near me" with one model: *for each incoming threat, WHEN does it
land and WHERE is lethal at that instant* — arcs (reach/minReach band, titan
scale), thrusts (the travelling front), shots and bursts (flight lines),
shells and mines (a circle with a clock). Then pick the CHEAPEST sufficient
answer at the LAST responsible moment: walk out if the clock allows → step
into a dead zone → timed dash (i-frames straddle the strike) → Ironhide /
Mirror / Straw Man → or accept the trade if the hit is cheap and the dash is
worth more later (the fang rule). Late commitment kills feint-baiting for
free: a cancelled windup never reaches the commit point. Tier dial: timing
error (godlike ±1 tick, skilled ±4) and whether the cheap options are
considered at all — low tiers keep the honest panic-dash.

**Stage 2 — matchup-aware spacing (fixes R2).** `resolveBand` takes the
TARGET's weapon too. Out-reach them → hold my reach edge, step in to swing,
out during their windup. Out-reached → live at contact / inside their dead
zone, gap-close by dashing THROUGH their band. Versus venom → stab-and-leave
cadence. Archetype presets stay as the personality; this is the floor under
them.

**Stage 3 — exhaustive knowledge tables (fixes R3, locks in R4).** One
`Record<DeployableKind, HazardSpec | null>` (radius, clock, spares-no-one,
severity) and one `Record<WeaponId, ThreatProfile>` derived from config.
Because they're exhaustive `Record`s, **adding a weapon or deployable is a
compile error until the brain has an entry** — the archetype-check ritual
enforced by the type system instead of by memory. `BotWorld` gains `shells`.

**Stage 4 — anti-camp + round memory (fixes R5).** Detect "my approach keeps
failing" (damage taken vs dealt over a window while closing) and switch
plan: go wide, hold outside their range and make THEM come (the impatience
rule inverted — a camper with a bot that won't walk in has to move), or
spend Ironhide to walk the mine deliberately. A small per-opponent
`RoundNotes` in BotMemory carries what hurt last round (mined twice →
wider margins, feinted → later commits).

**Stage 5 — team target scoring.** Replace nearest/weakest with a score:
hp, distance, healer-with-live-beam, who is hitting my ward, who is
out-of-position. Stops the conga-line chase of a weak runner past a
full-hp enemy who is free-hitting.

## Tier policy

Knowledge is universal; execution is tiered. Every tier should know a
sinkhole pulls and a shell lands (a Novice who ignores the landing ring reads
as broken, not new) — they just react late, mistime, and pick the panicky
answer. The un-trickable behaviours (late commit, trade maths, plan
switching, round memory) scale in from Adept and are complete at Godlike.
Ranked backfill bots (default tier, human stats) inherit the knowledge
fixes, which makes them modestly stronger — their seeded ratings may want a
nudge after Stage 3.

## Non-goals

No stat changes, no inputs a thumb couldn't make, no reading anything a
client can't see, bots still never draft gated kit, humanization texture
(v3) stays on at every tier — reflexes sharpen, the feet stay human.

## Tom's answers (2026-09-21)

1. **His tricks** — (a) *fang hit-and-run*: "go in and attack 3–4 times,
   disengage, re-apply right before it ends — absolutely devastating, there
   is essentially no counterplay"; (b) *blade dives hammer*: "the blade beats
   the hammer in a straight slogging match, so I dive in immediately and the
   bot takes the bait"; (c) *no teamwork*: "they don't protect each other and
   most of the time won't gang up on one player". (a) and (b) are gauntlet
   policies (`venomHitAndRun`, `diver`) and both reproduced at 0–8.
2. **Godlike** "should be genuinely VERY hard if not almost impossible to
   beat — it's there specifically as a challenge for only the absolute best
   players." So the un-trickable behaviours are complete at Godlike with no
   mercy dial.
3. Stage order fine; **2v2 matters** — stage 5 built, not deferred.

## As built

New file `botThreats.ts` (the knowledge), edits in `bot.ts` / `botCasts.ts` /
`botArchetypes.ts` / `botDifficulty.ts`; harness `botGauntlet.ts`
(`bun run gauntlet` in the sim package; `TIER=`, `DET=1`); tests
`botV4.test.ts` incl. six hard gauntlet gates.

- **Tables (stage 3).** `THREAT_KINDS: Record<WeaponId, arc|shot|shell|beam>`
  and `HAZARDS: Record<DeployableKind, HazardSpec|null>` — exhaustive, so new
  content is a compile error until the brain is told about it. Hazards now
  include ARMING mines, sinkhole, tar, and the spare-no-one rule (own-team
  sinkhole/tar bind me too). `BotWorld.shells` added (every host already
  passes a whole SnapshotMsg).
- **Strike predictor (stage 1).** Smart tiers (`smartDodge`, adept+) compute
  lag-corrected time-to-strike and the lethal centre-distance band
  (`strikeBand`, titan-scaled) and answer in order: already clear → nothing;
  walk out / into a dead zone if my speed EDGE covers it; else a dash timed
  so the i-frames straddle the strike (+ thrust/burst span). Reactive casts
  take `reactLead` — they wait for the last ~0.25s, so a feinted windup
  baits nothing. Fast cycles (<0.6s, the fang) are never i-framed by a
  contact fighter. The bombard is no longer "a 360px melee weapon"; shells
  are walked off at EVERY tier (roll ≥35%), i-framed if the feet can't
  make it. Dumb tiers keep the honest panic-dash.
- **Footwork (stage 2).** New tier dial `footwork` (0 below Skilled → 1 at
  Godlike). `meleeSpacing`: out-reach by ≥33px → hold my reach edge
  (hammer vs blade/fang), snap-retreating at ≥0.7; dead zone → hug
  (trident, bombard); else contact. Footwork scales the v3 band slop DOWN
  for spacing bands only. Versus a trident: **staging** — never loiter in
  the prong band; hold outside until the hop is up and the slow is off,
  enter with the predictor's timed hop, finish on foot inside 45px; with
  no hop left, wait for the Closing Sands to take the kiter's room (ring
  <420px) instead of walking into a chain of pokes. Venom-clock denial for
  fighters that own the reach edge.
- **Hazards are a constraint (stage 4).** After the blend, any component of
  the intent pointing INTO a detour-class zone within 45px of its lip is
  stripped — the camper geometry (mark directly behind the mine) used to put
  the detour's equilibrium 20px inside the trigger ring. Sharp tiers are
  only greedy for a mark under 25% hp, and never because of impatience.
  *Not built:* cross-round `RoundNotes` — the constraint + staging removed
  the need; revisit if Tom finds a repeatable per-round trick.
- **Team play (stage 5).** `focusFire` (now adept+) = a shared TEAM score
  (finishable, near the pack's centroid, on our wounded = the peel, live
  heal-link = kill the healer, sticky current mark). Both bots agree on the
  mark >90% of the time in mirrors; team-focus beat solo-focus 78–48 across
  126 mirrored 2v2 matches (noisy but positive). Warding Shout and Blood
  Font now fire for a hurt teammate at my elbow.

- **Retreat reads the room (Tom's trick #3, after first play: "I can slowly
  back it into a corner and then it has nowhere to go").** Every back-off
  was a straight line away from the threat, so the CHASER chose where the
  fight ended up. `retreatDirection` probes the room behind a fan of
  directions (walls, rocks, the arena edge and the Closing Sands' ring all
  end the room; a dead end is disqualified outright) and, once the straight
  line runs short of 440px, curls toward the open side and sticks with it —
  with room to spare it is exactly the old line. The gauntlet now reports a
  `cornered %` (bot boxed within 220px of two edges): bow vs a melee chaser
  15% → 4%, kiting a fang 12% → 1%.
- **The pursuit hop.** Any ADVANCING arc wielder at footwork ≥ 0.7 (not just
  band-less brawlers) spends a hop when one puts the next swing on a mark
  that is slipping out of reach, or when a mark under 30% hp is walking
  away. Trace: a dash/ironhide blade drafts as a DUELLIST (no gap-close
  dash), and trailed a disengaging fang at 110–160px for 2.5s with the hop
  unspent. Blade vs fang hit-and-run 3–5 → 11–1. (That row had read 10–2
  only because the script's "centre" was wrong for a 1600px arena and it
  kept pinning itself — fixing the SCRIPT exposed the hole.)

### Results (Godlike, 12 matches/row)

| Row | Before | After |
|---|---|---|
| hammer vs DIVER blade (Tom) | 0–8 | 12–0 |
| hammer (no dash) vs DIVER blade (Tom) | 0–8 | 12–0 |
| hammer vs VENOM hit-and-run fang (Tom) | 0–8 | 12–0 |
| blade vs VENOM hit-and-run fang (Tom) | 8–0 (3–5 vs the fixed script) | 11–1 |
| hammer vs CHASER fang | 1–7 | 12–0 |
| blade / hammer vs KITER trident | 1–7 / 1–7 | 12–0 / 12–0 |
| bow / staff vs KITER bombard | 0–8 / 6–2 | 12–0 / 12–0 |
| blade vs TRAP-CAMPER bow | 6–2 | 12–0 |
| hammer vs TRAP-CAMPER staff | 0–8 | 11–0 (+1 timed out) |
| hammer (no dash) vs KITER bow | 7–1 | 9–3 ² |

¹ (superseded — see the pursuit hop above.)
² Dashless melee vs a bow kiter is the known worst matchup (bot-brains.md);
within noise of before.

### Every tier, graded (Tom, same day: "ideally we should be upgrading all our difficulties and dumb down the lower ones so players can beat them — we already do this with reaction time")

The first cut gated the new brain behind switches (`smartDodge`, `footwork
≥ 0.7`), so the top five tiers leapt and the bottom three didn't move. Fixed
the way reaction time works — ONE brain, graded execution:

- **`timing`** (new dial, seconds): every tier runs the same strike
  predictor but commits up to ±`timing` early/late, rolled once per swing.
  Dash i-frames forgive ~±0.1s, so Godlike (0) lands every approved dodge,
  Skilled (0.17) mistimes a fair share, Novice (0.7) is the old panic dash
  in all but name. Reactive casts' late-commit lead widens by 2×`timing`
  (a big error = press on sight = feintable, which is right for a Novice).
- **`footwork`** now starts at 0.1 (Novice) not 0: every tier knows a hammer
  out-reaches a blade and that a trident has a dead zone — the low tiers
  just hold those bands with nearly the full v3 slop and no snap retreat.
- **Knowledge is flat across tiers**: arming mines, sinkhole/tar, the
  hazard constraint, shells (≥35% roll), bombard-isn't-melee, ally-aware
  shout/font. **Team focus** reaches down to Skilled; below it bots tunnel
  on the nearest body the way new players do. Only `nearest` hunters join
  the team score — the opportunist's `weakest` and the bodyguard's
  `protect` stay those brains' identities.

The gauntlet's tricksters are, in effect, a model of a competent human, so
win-rate against them calibrates the ladder (23 1v1 rows × 4 matches):

| Tier | Before v4 | After |
|---|---|---|
| Novice | 20% | 21% |
| Average | 24% | 23% |
| Experienced | 32% | 34% |
| Skilled | 41% | **51%** |
| Adept | 41% | 76% |
| Masterful | 51% | 86% |
| Inhuman | 53% | 96% |
| Godlike | 63% | 97% |

Before: a flat, compressed ladder (Adept no better than Skilled; Godlike
lost over a third). After: Skilled — "plays like a person" — sits at a coin
flip against human-like play, and each rung above is a real step. The bottom
three barely move BY DESIGN: they now share the knowledge but a competent
player still beats them comfortably; what changes down there is what their
mistakes look like (late, mistimed, sloppy — not oblivious).

## Owed

- **Tom's on-device pass at Godlike** — especially the hammer's new
  back-pedal (does the snap retreat read as skill or as a twitch?) and the
  trident staging (does holding outside read as smart or as stalling?).
- Ranked backfill bots run Skilled: they gain the knowledge fixes (shells,
  arming mines, light footwork) — a modest strength bump; watch their
  seeded ratings.
- Trickster rows for the next tricks Tom finds; a FEINTER good enough to
  prove the late-commit fix by win-rate.
