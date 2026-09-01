# Blood in the Sand — showcase scripts (choreographed promo footage)

Status: **designed + BUILT 2026-08-29** (`src/net/showcaseScripts.ts`; on-device review of the takes owed) · Feeds `apps/bits-promos` (the
capture rig, docs/marketing.md).

## The problem (Tom, 2026-08-29, after running `capture:roster`)

The capture rig drives seat 0 with the shared bot brain + an "eager cast"
of the featured ability, against a low-tier bot. Watching the 23 takes:

- the brains look too stupid to sell the realism, and sometimes don't use
  the weapon properly (a brain optimises to *win*, not to *demonstrate*);
- abilities fire at the wrong moments (the eager cast is "ready + enemy
  within 340px", which is almost never the moment the ability is *for*);
- most clips are lacklustre — two bodies jittering at each other.

A spotlight needs the item shown **once, clearly, with nothing else in
frame**. That is choreography, not AI.

## The idea: scripts, not brains

Replace the autopilot with a **showcase script per item** — both seats
scripted, deterministic, staged on the Primer's clean lane. The Primer
already proved the mechanism (`src/primer/scenario.ts`: placement + per-tick
inputs on the real sim; every swing and cooldown is the match's own). The
rig keeps everything else: the deep link, `PracticeClient`, the real
`GameScreen` (HUD, follow camera, blood), the capture script and its
`fightStartsAt` sidecar, `render:roster`. Only *who decides the inputs*
changes.

```
bloodinthesand://showcase?feature=sinkhole      (weapon/abilities now implied by the script)
        │
PracticeClient(showcase) ── round active ──► SHOWCASE_SCRIPTS[id]
        │                                     place(seat) → stage both bodies
        │                                     input(seat, t, me, foe) → {sx, sy, casts}
        └── seat 0 AND seat 1 both scripted; botThink never runs in a showcase
```

Contract (mirrors the Primer's `Scenario`, minus camera/loop):

```ts
interface ShowcaseScript {
  you: Loadout;                       // the star's kit — the featured item + quiet fillers
  foe: Loadout;                       // whatever makes the item READ (a bow for Mirror Guard…)
  place(seat): { x, y, facing?, hp?, moveFactor? };
  input(seat, t, me: PlayerSnapshot, foe: PlayerSnapshot): { sx, sy, casts? } | null;
}
```

Rules every script obeys:

- **Movement is clear and simple.** Straight lines and holds along the
  lane (`LANE_X`, north–south — the Primer's clean pocket, crowd out of
  shot). No strafing jitter, no weaving. The star is the only thing doing
  anything interesting; the foe walks, stands, or swings.
- **The foe never casts** unless the script needs it (nothing).
- **Attacks are automatic in reach**, so scripts never "press attack" —
  distance IS the attack decision. Holding a gap = firing; closing = swinging.
- **Deterministic**: fixed seed, no wall clock; a take is re-shootable
  identically after a balance patch.
- **One beat, then loop**: each script is ≤ ~12s, fights end (foe hp is
  set low when the kill should land on cue), the round restarts, the script
  re-places. `capture` records ~20s = two clean beats; `render:roster` cuts
  8s from `fightStartsAt`.

## Weapons — two generic scripts + three specials

| Class | Script |
| --- | --- |
| **Melee** (blade, hammer, fang, trident) | *Hold the band.* Start ~220px apart. Star walks in until `d ≈ reach × 0.85`, then **holds that distance**: the foe (moveFactor 0.5) keeps trying to close, the star steps back at the foe's speed so the gap sits at the edge of reach — swings land at full stretch every time, the telegraph reads. Trident holds *inside its annular band* instead (min-reach is its story). Foe hp set so the third clean hit kills. |
| **Ranged** (bow, staff, scorpion) | *Dodge, then dash.* Start at `reach × 0.75`. The star stands and fires (auto). The **foe dashes sideways** out of the first two inbound shots (alternating sides, one hop per shot): the bow's arrows **whiff** past it, then the third lands; the staff's orb **bends after the hop and catches it anyway** — the homing is the story. When the foe closes inside half reach the star **dashes once back up the lane** (the ranged player's dash), then gives ground slowly; the foe dies a step short. (Retired 2026-08-29: the constant backpedal against a straight-walking foe — every shot landed, nothing to see.) |
| **Bombard** | Kite, but the star stops and stands: shells land where the foe *was*, the foe walks through two blasts to the third. Indirect fire needs a still shooter to read. |
| **Fang** | Melee hold, but hit-and-step: close, one hit, back out of reach, wait for the poison tick to show, close again. Poison stacking is the story. |
| **Lifeline** | Needs an ally. **Open question** (below). |

## Abilities — one script each

Star = seat 0. Foe = blade + `[dash, ironhide]` and **never casts**, unless stated.

| # | Ability | The one beat |
| --- | --- | --- |
| 1 | **Sandtrap** | Start 260 apart. Star casts at t≈0.5 (trap lands between them), backs off two steps. Foe walks straight in and over it. Boom, then the star closes. |
| 2 | **Tremor** | Star closes to ~150, casts (quake at the foe), **holds still** outside the zone. Foe staggers in the shake; the star walks in when it ends. |
| 3 | **Harpoon** | Start 300 apart, both standing. Star casts at t≈0.8: chain, haul, the foe dragged the full length into reach, swing lands. The cleanest read in the roster — nothing moves but the victim. |
| 4 | **Dash** | Foe = **hammer** (the slowest, most readable telegraph). Foe walks in and swings; star holds until `foe.atk === windup && d < reach`, then dashes *through* the swing and hits from behind. i-frames on the telegraph, the game's central skill, in one motion. |
| 5 | **Mirror Guard** | Foe = **bow**, standing at 300, firing (auto). Star stands, casts at t≈0.6, the next arrow comes back and hits the archer. Foe hp so the returned arrow kills. |
| 6 | **Ironhide** | Foe = hammer, walks in. Star casts as the windup starts, **takes the hit standing** (no knockback stagger), keeps walking, kills. |
| 7 | **Straw Man** | Star closes to 200, casts (decoy at feet), then walks *sideways* out of the lane. Foe's lock snaps to the dummy and swings at straw; star comes back in on its back. |
| 8 | **Warding Shout** | Foe walks into melee lock. Star casts the cone at it: peeled, shoved, target lost. Star backs off three steps — the "nothing can target you" beat — then closes. |
| 9 | **War Drums** | Foe chases the star up the lane at equal speed (gap holds). Star casts: the gap visibly *opens* as the aura kicks in, then the star turns and fights. Speed reads only against a chaser. |
| 10 | **Blood Font** | Star placed at **40% hp**, foe far (400) walking in at moveFactor 0.4. Star casts at t≈0.3 and stands in the circle: three heal ticks visible before the foe arrives, then wins the fight it would have lost. |
| 11 | **Sandstorm** | Foe = bow at 300, firing. Star casts (cloud at feet): arrows stop — no lock. Star steps out the near side and closes. |
| 12 | **Sinkhole** | Foe walking a slow lateral line at 220 (so the pull *changes* its path). Star casts along facing: foe dragged to the hole; star walks in and swings. (1v2 would show "group" — see open questions.) |
| 13 | **Tar Pit** | Foe chases. Star casts and runs a gentle **curve** away, laying tar; foe hits the trail and slows to a crawl; star turns and strikes. The roster's only movement-expressed ability needs movement — but one curve, not a zigzag. |
| 14 | **Titan's Draught** | Start 200 apart, foe standing. Star casts (drink, grow), walks in, one crushing hit kills (foe hp low). Drink. Grow. Crush. |

Each script names its own foe kit and placements, so the deep link
shrinks to `?feature=<id>` (weapon spotlights: `?weapon=<id>`). The old
`tier`/`enemy*` params died with the brain — there's no brain to tier.

## Implementation (small)

- `apps/blood-in-the-sand/src/net/showcaseScripts.ts` — the table above
  as code (two generic weapon scripts parameterised by reach + the
  specials + 14 ability scripts). Helpers `toward`, `holdAt`, `IDLE` lifted
  from the Primer's `scenes.ts` (share, don't copy).
- `PracticeClient`: in showcase mode, on `phase → active` apply
  `place()` to both bodies (the Primer's `restart()` code — `mover.pos`,
  `combatant.hp`, `moveFactor`); every tick feed `input()` for seat 0
  and seat 1 instead of `autopilot()`/`botThink`. `SHOWCASE_ARM_SECONDS`
  and the sidecar's `fightStartsAt` are untouched.
- `showcase.ts`: parse `feature` / `weapon`, resolve the script, derive
  the loadouts from it. `capture.ts` in bits-promos: drop the tier/enemy
  flags (or keep them as no-ops for a release).
- Nothing in the sim changes. Shipped builds still ignore the link
  (`EXPO_PUBLIC_SHOWCASE=1` only).

Rough size: the scripts are the work — ~14 small functions; the plumbing
is an afternoon.

## What the first shoots taught (simulator screenshots, 2026-08-29)

- **Size foe hp in hits.** A blade lands ~14 after defence (16 − 2); the
  first cut's 25–40 hp foes died on the first swing and the clip was mostly
  the ROUND WON card. Foes now carry ~55 (four hits), 70 for the hammer
  duel, 15 for the Mirror Guard archer (one returned arrow must kill).
- **Both fighters hold at reach.** A foe that pushes forever ends up
  standing inside the star (bodies stack; the sim lets them overlap).
  `approach(w, foe, stopAt)` walks the foe in to just inside its own reach
  and stops — with the star's `holdBand` that's the "engage at the range of
  the weapon" look with daylight between the bodies.
- **The dash must be lateral.** Rolling AT the hammer just landed on top of
  it. The roll goes perpendicular to the foe line, out of the cone; the
  hammer visibly swings at air, then the star closes to blade reach and
  punishes; the foe re-commits and the beat repeats every ~2.5s.
- **Sinkhole pulls the thrower too.** Radius 260 > throw 200, so the star
  is always inside its own hole. The star is a bow: throw, back north out
  of the pull during the pot's 0.6s flight, shoot into the clump from ~320.
  (Two shoots ended with the star hauled into three blades before this.)
- **The lane is short (~470px).** War Drums' chase jogs at half speed so
  the gap has room to open; Straw Man's sidestep is 0.7s west (1.4s east
  walked into the crowd band); after any knockback beat (Warding Shout)
  the star holds at reach rather than chasing to the wall.
- **Let the first hit land.** Mirror Guard takes one arrow and returns the
  second, so the beat sits mid-clip instead of ending the round at 1.5s.
- **All 23 scripts were screenshot-checked on the simulator** (2026-08-29,
  `xcrun simctl io screenshot` at fixed offsets after the deep link — no
  ffmpeg needed). Capture + review of the rendered spotlights is Tom's.

## Decisions (Tom, 2026-08-29)

1. **Lifeline = 2v2**: one fighter a side trades blows in the middle, one
   healer a side stands behind and pours. Seat 0 (the camera) is our healer.
2. **Sinkhole = 1v3, everyone static**: three foes spaced in a triangle
   200px down the lane; the star throws into the group, then walks in.
   The sim is created 3-a-side and force-started with four seats.
3. **Real HUD** — the rig keeps recording the real `GameScreen`.
4. **Sinkhole**: "place me further away so I don't get sucked in, and give
   me a bow" — the back-out-and-shoot script above.

## As built

- `src/net/showcaseScripts.ts` — `ShowcaseScript { seats, teamSize, place,
  input }`; `weaponScript(id)` / `abilityScript(id)`. Per-round memory
  lives in closures and resets in `place(0)`.
- `PracticeClient(…, script)`: fixed seed (7), seats the script's cast with
  forced teams, arms everyone on the lobby's first tick, force-starts a
  partial room, `stage()`s placements on every countdown, feeds every
  seat's `input()` per tick (`showcaseT` = seconds since active). No
  `botThink` runs in a showcase.
- `showcase.ts`: the link is just `?feature=<ability>` or `?weapon=<id>`;
  `capture.ts` lost its tier/enemy flags.

## Dry runs (2026-08-29)

`apps/bits-promos/scripts/dry-run.ts` steps a script headlessly (same seed,
same staging as PracticeClient) and prints every hp change, cast and death
stamped in seconds since FIGHT. Damage rolls are fixed per take, so foe hp is
sized arithmetically against the printed rolls (staff 26/17/14 → 56 dies on
the third orb; bow 31/14 → 45; scorpion's rapid 10/7/6… → 35). Remember the
dash's 3s cooldown: one dodge per ~3s, so a beat that wants two hops needs
the kill after t≈4s.

