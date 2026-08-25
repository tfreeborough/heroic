# Blood in the Sand — Dev Menu & the Target-Dummy Range

Status: **BUILT 2026-07-16** (perf overlay added 2026-07-17; pruned 2026-08-25) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-25

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

## Tool 1 — Perf overlay (frame profiler)

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

## Tool 2 — Announcer pack switcher

`ANNOUNCER ○ DEFAULT / ◉ ELIZA NIGHTSHADE` — cycles the kill-announcement
voice through every pack in `audio/announcer.ts` and immediately plays the
new voice's FIRST BLOOD line (the wizard's ear-training move). Unlike every
other row this one is **persisted** (`bits.announcerPack`, settings.ts,
applied on launch by App.tsx): it's a real device setting — the future store
purchase — that simply has no player-facing UI yet, so the dev menu is where
packs get auditioned. The product shape is LIVE (protocol v18): the KILLER's
pack voices kill calls on every client in the room — so cycling this row is
also how you demo the flex (see monetisation.md § announcer packs).

## Tool 3 — Deed ceremony rehearsal *(2026-08-03)*

`DEED CEREMONY ▶` — plays the ENTIRE post-match ceremony (achievements.md
§ unlock ceremony) on fabricated data, right over the title screen: the
Glory count, the rating count, the RANK UP pop (Pit Fighter — a forged
badge), NEW SEASON BEST, then three deed cards including the N-of-M
counter. Fake data in, the real `RankedCeremony` component throughout, so
feel-tuning here IS tuning the live thing. The `rehearsal` flag keeps the
celebrated set untouched — a rehearsed deed still gets its real moment when
genuinely earned. Fully offline: no server, no DB, session-only like the
rest of the menu.

## Tool 4 — first-win nudge rehearsal *(2026-08-24)*

`FIRST-WIN NUDGE ▶` — raises the `firstWin` AccountSheet (bits-accounts.md §
the first-win nudge) right over the title screen, on demand, as many times as
you like. It bypasses the sheet's real gates (linked / accounts-live) so a
linked tester still sees the copy, and it also CLEARS the persisted
`bits.firstWinNudge` flag — so after tapping it, the next real online win
re-triggers the honest path too. Only rendered when the Clerk key shipped
(the sheet can't mount without the provider). Signing in from the rehearsed
sheet is real — it links for real.

## Tool 5 — Primer replay *(2026-08-24)*

`PRIMER ▶` — replays the five-chapter Primer (bits-onboarding.md) and
re-arms its once-per-install `bits.primerSeen` flag, so the real first-PLAY
trigger can be re-tested.

## Tool 6 — reset purchases *(2026-08-15)*

`RESET PURCHASES` — forgets every Signet purchase (server entitlements with a
`purchase:*` source + the local entitlement cache) so a store unlock can be
re-tested end to end. Deed grants survive. Hits `POST /dev/reset-purchases`,
which only exists when the API runs with `STORE_DEV_TOOLS=1` — inert against
production.

## Retired rows *(2026-08-25)*

Pruned once they'd served their purpose, with their plumbing removed:

- **TARGET DUMMIES** — the range has a player-facing door now (PRACTICE →
  TARGET DUMMIES, plus the Primer's "try the range" exit); the dev shortcut
  was redundant. The range itself (`PracticeClient` in `"dummies"` mode,
  `ArenaState.training`, `addDummy`) is unchanged.
- **SFX / HAPTICS kill-switches** — the 2026-07 iPhone stutter hunt is over;
  `devFlags.disableSfx` / `disableHaptics` and their guards in `audio/index.ts`,
  `game/haptics.ts`, `ModeSelectScreen` are gone.
- **BOT BRAIN / BOT TIER** — practice bots take archetype from loadout and
  tier from the practice lobby again, no session override
  (`devFlags.botArchetype` / `botDifficulty` removed from `PracticeClient`).
- **DEEDS preview** — the fake-unlock board state (`devFlags.deedsPreview`,
  `previewState` in DeedsScreen) is gone; the board always shows real
  `/achievements/me` data.
- **ITEMS grant-all** — the `getEntitlements()` overlay
  (`devFlags.grantAllItems`) is gone; the wizard only ever shows what's earned
  or bought.
- **WALLET / GRANT 500 GLORY / GRANT 1 SIGNET** — the dev ledger faucet.
  `POST /dev/grant` was removed from the API along with `devGrant` in
  `net/api.ts`. `STORE_DEV_TOOLS=1` still gates `/dev/reset-purchases` and
  the mock IAP arm on `/store/iap` (the remaining way to add Signets in dev).

## Adding future tools

`HomeScreen`'s dev panel is just a column — add a `Pressable` per tool and a
handler prop wired in `App.tsx` (or, for loop/screen switches, a flag on
`devFlags` in `src/dev.ts`). Keep each tool offline/in-process where possible
so nothing dev ever touches the server.
