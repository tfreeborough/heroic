# Blood in the Sand — Dev Menu & the Target-Dummy Range

Status: **BUILT 2026-07-16** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-16

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

## Adding future tools

`HomeScreen`'s dev panel is just a column — add a `Pressable` per tool and a
handler prop wired in `App.tsx`. Candidates mentioned so far: none yet beyond
the range; keep each tool offline/in-process where possible so nothing dev
ever touches the server.
