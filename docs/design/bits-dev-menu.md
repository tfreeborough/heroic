# Blood in the Sand — Dev Menu & the Target-Dummy Range

Status: **BUILT 2026-07-16** (perf overlay added 2026-07-17) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-17

A hidden toolbox for on-device testing — things a developer needs mid-playtest
that must never be visible (or reachable) in a normal session.

## The secret entrance

Tap the **title** on the home screen **5 times in a row** (≤1.5s between taps —
slower starts the count over). The dev menu toggles on: a small panel pinned to
the **bottom-left corner** of the title screen. Another 5 taps (or its ✕)
hides it.

- **Session-only, on purpose.** The unlock never persists — a fresh launch is
  always clean, so a handed-over phone or a wife-test can't stumble into it.
- Silent until the fifth tap (a secret shouldn't click), then the ordinary
  `uiConfirm` sound. No new audio events (bits-audio checklist: nothing owed).

## Tool 1 — Target dummies (the firing range)

An offline mode for testing weapons, abilities, damage numbers, statuses and
feel against things that hold still: **you vs a line of 3 target dummies**.

- Rides the whole practice stack: `PracticeClient` in `"dummies"` mode steps
  the sim in-process — the same arming wizard (RoomScreen), the same
  GameScreen. The only dev shortcut: the 10s arming countdown is clamped to
  2s (client-side, offline only).
- **Dummies are first-class in the sim** (`ArenaPlayer.dummy`, seated by
  `addDummy`) because attacking is automatic — an input-less bot would still
  auto-swing. A dummy never takes aim and never swings (skipped in step.ts's
  targeting + attack passes) but is hit, bled, slowed, shoved and harpooned
  like anyone else. It arms itself on placement (loadout is cosmetic) so the
  arming gate treats it as ready; the room is sized exactly (4 seats) so the
  full-room gate passes without a force-start.
- **Training flag** (`ArenaState.training`, set via `createSim(…, training)`):
  rounds never end (`checkRoundOver` stands down) and a dead dummy stands back
  up on its spawn slot after `DUMMY_RESPAWN_SECONDS` (2s) at full hp, statuses
  dropped — "another one spawns in its place", the range never empties.
  Real rooms never set the flag; nothing changes on the wire (dummies are
  ordinary players in snapshots).
- Leaving the range (LEAVE / quit) lands back on the **title screen** — the
  range has no front-door screen of its own.

## Tool 2 — Perf overlay (frame profiler)

A toggle (`PERF OVERLAY ◉/○`) that turns on a small green readout in matches
— top-left of GameScreen, next match you enter (any match: online or
practice):

```
JS 58fps  sim 4.2ms (1.1×)  rec 3.1ms
```

- **JS fps** — rAF frames per second on the JS thread (raster/GPU cost lives
  on the UI thread; use RN's Perf Monitor for that half).
- **sim** — ms/frame spent inside `sendInput`. Online that's a WebSocket send
  (~0ms); in practice it's the whole in-process tick: 7 bot brains + `stepSim`
  + snapshot. This split is exactly how you tell "practice sim is the cost"
  from "drawing 8 fighters is the cost" on a weak device.
- **(×)** — sim steps per rendered frame, the fixed-timestep catch-up
  multiplier. At 30Hz sim / 60fps render, healthy is ~0.5×; sustained higher
  means the loop is running make-up ticks (the stutter spiral — capped at 2
  in GameScreen's loop config since 2026-07-17).
- **rec** — ms/frame re-recording the Skia scene picture (decals, pulses,
  `recordArena`, ability-button faces).

Carried by `devFlags` (`src/dev.ts`), a plain session-only module object —
readable from the game loop without React, reset on every launch like the
menu itself. When off, every timing branch is skipped: zero cost.

## Tool 3 — SFX kill-switch (perf A/B)

`SFX ◉ ON / ○ KILLED` — flips `devFlags.disableSfx`, which makes `playSound`
return before doing ANY work: no scheduler, no native `seekTo`/`play` calls.
Not a mute (mute still drives the players at volume 0) — this is a perf
experiment: if a device stutters in busy fights with SFX on and is smooth
with SFX killed, the per-play native audio path is the cost and audio is
where to optimise; if it's choppy either way, look at render/raster instead.
Added 2026-07-17 chasing an iPhone-only chop that survived voice warming.

## Tool 4 — Haptics kill-switch (perf A/B)

`HAPTICS ◉ ON / ○ KILLED` — flips `devFlags.disableHaptics`, which makes
`playStrikeHaptic` return before any native work. The same experiment as the
SFX switch for the other per-moment native cost: iOS allocates a fresh
`UIImpactFeedbackGenerator` per pulse (Android's vibrator call is cheap), and
strikes/casts fire one on the exact frame the moment lands. Killed-and-smooth
means haptics need batching/pre-armed generators; choppy either way clears
them. Added 2026-07-18 on the same iPhone stutter hunt.

## Adding future tools

`HomeScreen`'s dev panel is just a column — add a `Pressable` per tool and a
handler prop wired in `App.tsx` (or, for loop/screen switches, a flag on
`devFlags` in `src/dev.ts`). Keep each tool offline/in-process where possible
so nothing dev ever touches the server.
