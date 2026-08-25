# Blood in the Sand — The Primer (first-play onboarding)

Status: **designed + BUILT 2026-08-24** (Tom: "for new players the game isn't
really explained before you jump into a match… the first time you press PLAY
we should take the player to a small onboarding that explains the basics and
core mechanics — super premium, as much image + animation + particle work as
possible, reuse the deeds particles"). **REVISED same day — LIVE SCENES:**
Tom's first look: "the gladiator images aren't showing matches at all, we'd
want to show videos of actual combat". Options weighed (screen-recorded
video loops via expo-video = native rebuild + bytes + clips rot with every
art change; vs scripted scenes on the real sim + real renderer = never
stale, OTA-shippable, the biggest build) — Tom chose **live scenes**.
Chapters I–IV now run the match sim itself (§ live scenes). Owed: an
on-device feel pass (loop timings, zooms, the stage's share of the screen). Companion docs:
`bits-mode-select.md` (what the Primer hands off to), `pvp-loadout-flow.md`
(the arming wizard the Primer previews), `bits-art-style.md`, `bits-audio.md`.

## Why

Nothing in the game explains itself before the first fight. The arming
wizard teaches *which button is which* and the codex teaches *what a Fang
does*, but the three ideas a new player has to hold before any of that makes
sense — **one life a round**, **you never aim**, **one weapon + two powers in
button order** — are learned by dying. The mode select (`bits-mode-select.md`)
deliberately sells the *shape* of the game; the Primer sells the *rules*, once,
in the same premium register as the ceremonies.

## The shape

**Five chapters, one tap each, ~40 seconds.** Not a playable tutorial: every
chapter is a *living illustration* (loop-animated stage over the arena
backdrop with the Chronicle's ember field) plus a title, one gladiator line
and two or three plain facts. The last chapter ends on two doors. Tapping
anywhere advances (mid-reveal tap snaps the chapter home — the deed-card
rule); `‹` steps back a chapter (home from chapter I); SKIP is always
available top-right.

```
┌──────────────────────────────┐
│ ‹                     SKIP › │
│                              │
│     ┌────────────────────┐   │
│     │   living stage     │   │  loop-animated illustration
│     │  (sprites, rings,  │   │  composed from existing forged
│     │   sparks, embers)  │   │  assets + Skia/Animated FX
│     └────────────────────┘   │
│                              │
│         CHAPTER I            │  eyebrow
│         THE SAND             │  Cinzel display face
│  "There is no second life    │  gladiator line (italic gold)
│         on the sand."        │
│   ─────────── ◆ ───────────  │  rule + gem (title-screen ornament)
│  One life a round. Last team │  facts (bone, plain)
│  standing takes it. Three    │
│  rounds take the match.      │
│                              │
│         ● ○ ○ ○ ○            │  chapter pips
│       TAP TO CONTINUE        │
└──────────────────────────────┘
```

Backdrop = the forged home art (`HOME_ART.home`) cover-cropped, dimmed to
~0.3 under a vertical scrim — the same sand the title stands on — with the
Chronicle's rising gold embers over it (the "deeds particles" Tom asked
for; see § reuse).

## Live scenes (the 2026-08-24 revision)

Chapters I–IV are no longer sprite dioramas: each stage mounts a
`PrimerArena` — the REAL `ArenaSim` stepped at the match tick by a script,
sampled through the same `SnapshotBuffer` interpolation a match uses, and
drawn by the real `recordArena` with its own blood / crack / tar fields,
status pulses, impact numbers, rings and cast flashes. Nothing is faked:
the swing arcs, the staff's orb, the dash i-frames, the cooldown wedge and
the charge pips are the sim's own, so the Primer can never drift from the
game it teaches (a re-tune or a new weapon re-teaches itself).

- `src/primer/scenario.ts` — `ScenarioRunner`: a 1v1 sim (you = seat 0 team
  1, "Crixus" = seat 1 team 2), loadouts set, `startMatch` then the countdown
  collapsed (`round.timer = 0`) so the next tick is FIGHT. A `Scenario` is
  data: loadouts, `place()` (positions on the arena's open centre lane —
  `LANE_X = 1090`, y 470–940, north–south: arena-00's props are spread
  evenly so no long east–west lane exists, and the first cut fought
  against the east wall with the crowd in shot (Tom); the rock pile, tree,
  hoodoo and cactus dress the frame without ever touching a path; optional
  starting HP and a host-side `moveFactor` — the bot tiers' dial), `input()` (stick + slot
  presses per seat per tick, given the live bodies), a directed `camera()`
  and a loop clock. The runner loops: a round end restarts the scene after
  a short hold (wins zeroed every time so the machine can never reach a
  match end); the sim's own round-end clock beating ours is handled (the
  respawn is re-placed the moment the fight resumes). Fixed seed, no wall
  clock — every mount loops identically.
- `src/primer/scenes.ts` — the four scripts (below).
- `src/primer/PrimerArena.tsx` — GameScreen's frame loop distilled
  (`useGameLoop` at TICK_DT, events → blood/fx exactly as a match maps
  them, `recordArena` per frame, retired-picture disposal). Silent on
  purpose — a looping kill sting would grate. `onFrame(view, runner)` hands
  the sampled view to the chapter overlay each frame.
- `render.ts` gained ONE optional field: `camera?: { cx, cy, zoom }` — a
  directed camera that bypasses follow/fit. Matches never set it.

| # | Scene | Script | Camera |
|---|---|---|---|
| I THE SAND | blade (you, blue, from the north) vs hammer (red, from the south, starts at 45 hp) | both close to blade reach, then stand — the weapons do the rest; the red fighter falls, the round pip lights, 2.4s hold, restart | fixed on the lane, zoom 0.55 |
| II MOVE | you alone (foe parked in the far south-east) | `moveStickAt(t)`: idle → east → north-west → south-east → idle over 5s, sized to stay inside the pocket; the SAME function drives the pad overlay's knob + ghost thumb, so stick and fighter agree exactly | follows you, 0.62 |
| III STRIKE | staff (you, near the lane's top) vs hammer walking up from its foot at half speed, 55 hp | the renderer's own reach ring shows; once the foe is inside it you KITE — back off north at 40% speed (Tom: "player 1 moving slightly away to show the range distance") so the gap holds around the ring's edge while the orbs land; never past the lane's top; it still closes in the end and falls | tracks the pair's midpoint, 0.52 |
| IV ARM YOURSELF | blade + Dash + Ironhide | a short walk east with a Dash at 1.0s, Ironhide at 3.0s, a short walk west with a Dash at 5.0s, 7.5s loop (walks trimmed to the pocket's width); the overlay shows the picks as sockets AND the real button column, faces re-recorded from the live slots (cooldown wedge, charge pips) exactly as GameScreen does | follows you, 0.62 |

Chapter V stays a composition (crest, orbiting deeds, Glory tick, ladder) —
it teaches meta, not combat.

Perf: one arena loop at a time (only the active chapter mounts), the same
cost profile as a match minus the HUD and sound.

Layout (Tom, 2026-08-25: on a small phone the content ran off the bottom
and there is nothing to scroll — the screen is tap-anywhere): the stage is
sized from what the phone has LEFT after the copy block's budget and the
footer (pips + prompt, or pips + the two doors), clamped 170–380, never a
fixed share of the height; a phone too tight for the full budget drops the
copy into compact type first. Fixed camera shots FIT their zoom to the
stage height (`fitZoom`) so a short, wide card never crops the fighters.

## The five chapters

| # | Title | Stage (loops) | Gladiator line | Facts |
|---|---|---|---|---|
| I | THE SAND | LIVE: a real blade-vs-hammer 1v1 closes on the sand (your disc blue, theirs red); the red fighter falls, bleeds, and the first round pip lights gold | *There is no second life on the sand.* | One life a round. Last team standing takes it. First to three rounds takes the match. Blue is your side; red is theirs. |
| II | MOVE | LIVE: the real fighter walks a scripted wander; the pad + a ghost thumb overlay show the exact stick driving it | *The sand goes where your thumb goes.* | Touch anywhere on the left. The pad rises under your thumb — push, and you move. It follows you, so your thumb can wander. |
| III | STRIKE | LIVE: you stand still with the renderer's own reach ring; a hammer walks in at half speed, crosses it, and your staff's orb hunts it down until it falls | *Your blade knows the way. Your feet decide the fight.* | You never aim. The nearest enemy in reach becomes your mark and your weapon strikes on its own. Your job is where you stand. |
| IV | ARM YOURSELF | LIVE: the picks as sockets, and the real button column whose faces are recorded from the live sim — the fighter dashes and turns to iron on script, the wedge sweeps and a pip burns for real | *Choose your steel. Choose it well.* | Before every fight: one weapon, two powers. Pick order is button order. Powers have charges per round — spent stays spent until the next round. |
| V | GLORY | the Initiate crest rises on a stoked forge-ember field; three deed emblems orbit it; a Glory count ticks up; the six-tier ladder runs beneath with a gold marker climbing | *The crowd remembers.* | Win and earn Glory. Carve deeds into your Chronicle. Climb the ladder in Ranked. Then doors: **ENTER THE RANGE** · **TO THE FIGHT** |

Copy rules carry over from the codex (`catalogue.ts`, Tom 2026-07-12): no
superlatives, no roster comparisons, nothing that rots as the roster grows —
the Primer names no weapon but the three it illustrates and quotes no number
that could tune away (charges/round wins are read from the sim config, never
typed).

### The doors

- **ENTER THE RANGE** (primary) → the target-dummy firing range straight
  away (`startTargetDummies`, the dev-menu shortcut promoted to a player
  door). Every weapon and power, nothing fights back — the natural next
  step after being *told* the rules is *feeling* them. Leaving the range
  lands on the practice front door like any range visit.
- **TO THE FIGHT** (ghost) → the mode select, exactly where PLAY used to go.

Either door (or SKIP) marks the Primer seen. A crash mid-Primer replays it —
only a decision retires it.

## Trigger + persistence

- `bits.primerSeen` in `src/settings.ts` (`loadPrimerSeen` / `savePrimerSeen`
  — the lefty pattern). App.tsx loads it at boot into `primerSeen: boolean |
  null`; PLAY routes to `"primer"` when it is `false`. `null` (boot read not
  landed — a sub-50ms tap) falls through to the mode select: a veteran must
  never see it twice, a newcomer tapping inside the entrance animation is
  hypothetical.
- Ordering: Primer **before** the name claim (`NameScreen` gates the play
  route, one screen later) — the rules first, the signature second.
- Replays: Settings gains a **How to play · REPLAY** row (an unrepeatable
  onboarding is a bad pattern); the dev menu gains **PRIMER ▶**, which also
  re-arms the flag so the real PLAY trigger can be re-tested.
- Android back inside the Primer = the `‹` (previous chapter / home).

## Reuse — what the Primer is built from

Everything on screen is an existing asset or an existing FX primitive; no
new art is required to ship it.

| Piece | Source | Note |
|---|---|---|
| Rising gold embers ("the deeds particles") | `DeedsScreen` `Ember` → **extracted** to `src/components/Embers.tsx` | Chronicle now imports it; Primer runs the same field over its backdrop |
| Spark bursts | `SignetForge` `Sparks` → **extracted** to `src/components/Sparks.tsx` (+ `tint`) | forge imports it back; the live scenes no longer need it (blood is the sim's own) — kept as a shared primitive |
| Stoked ember field (chapter V) | `ForgeEmbers` (Skia SkSL) | `boost` pinned at 1 — the forge at full heat |
| The fights themselves | `ArenaSim` + `recordArena` (via `PrimerArena`) | the real sim and renderer — see § live scenes |
| Pad chrome | the `FloatingStick` look, re-drawn | driven by the same stick function as the sim input |
| Power buttons | `recordAbilityButton` | real chrome, faces recorded from the live slots as GameScreen does |
| Rank crests, deed emblems, Signet | `RANK_BADGES`, `DEED_ICONS`, `SignetIcon` | |
| Backdrop | `HOME_ART.home` | |
| Reveal timeline | the `revealSlice` pattern (`DeedCards`/`ArmoryScreen`) | 700ms `out(cubic)`, tap snaps home, 140ms swap; title 0–0.35, rule 0.3–0.55, facts 0.45–0.8, pips 0.7–1 |
| Entrance drum | `modeReveal` per chapter (the mode-select roll's clip) | plus `uiTap` advance, `uiBack` skip/back, `uiConfirm` + light haptic on the doors, `deedUnlock` when the crest lands in V |

No new sound events (`bits-audio.md` checklist unchanged) — `modeReveal`
already *is* "a premium surface lands". Stage loops are silent on purpose:
a looping kill-sting would grate within seconds.

## Art (optional, later)

The stages are compositions, so the Primer ships without a forge run. If the
chapters want painted hero illustrations later, the path is a scene type
`primer-bits` (copy `home-bits`: `PRIMER_KEYS` = the five chapter ids, 5:2
landscape like the mode cards, saved to `assets/primer`, pasted into a
`PRIMER_ART` map) — the stage would render over the illustration the way the
mode cards' copy sits over theirs. Not owed for launch.

## Perf notes

- Only the active chapter's stage is mounted; every loop is native-driver
  RN `Animated` or a Skia clock, so the JS thread idles between taps.
- Chapter IV re-records a button face only when its quantised state
  changes (GameScreen's 1% rule).
- Chapters I–IV each run one arena loop (sim + record) — a match's cost
  without HUD or sound; only the active chapter mounts.

## Open

- On-device feel pass (loop timings, sprite scale, ember density on a
  OnePlus).
- Whether the Primer should also gate SKIRMISH/RANKED entry for players who
  skipped — no for now (skip is a decision).
- A sixth chapter for Signets/the Armory was considered and cut: the store
  has its own front door and the Primer is about the fight.
