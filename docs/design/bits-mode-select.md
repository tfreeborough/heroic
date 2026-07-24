# Blood in the Sand — Mode Select ("Choose your fight")

Status: **designed + BUILT 2026-07-23.** Decisions locked same day: RANKED
label (not COMPETITIVE); Ranked v1 ships gated with its own "Season I —
opening soon" flavour (queue server is a later project); title screen
collapses to PLAY + SETTINGS (PRACTICE button absorbed into mode select).
Owed: the four card-art PNGs (Tom, spec below — placeholder gradients paint
the cards until `MODE_ART` in ModeSelectScreen.tsx gets its `require`s), the
`mode_reveal` Forge clip, and an on-device feel pass. Sits between the title screen and
everything else. Companion docs: `pvp-loadout-flow.md` (what happens after a
mode is chosen), `bits-audio.md` (UI sound conventions), `monetisation.md`
(glory framing).

## Why

Today PLAY drops you straight into the online room browser and PRACTICE is a
separate title button. As modes multiply (ranked queue, story) that doesn't
scale, and it buries the most important choice a player makes — *what kind of
fight am I here for?* — inside navigation. The mode select makes that choice a
moment: four full-art cards, stacked, each selling its mode like a poster.

## The screen

Route: new `Route` value `"modes"` in `App.tsx`. Title PLAY →
`setRoute("modes")`. The separate PRACTICE title button goes away — Practice
lives inside mode select (title becomes PLAY / SETTINGS, which also makes the
title composition cleaner). Android back + the ← affordance return to home.

Four cards, stacked vertically, filling the safe area under a slim header
(back chevron + "CHOOSE YOUR FIGHT" + glory pill carried over from home):

```
┌──────────────────────────────┐
│ ←  CHOOSE YOUR FIGHT   ◈ 240 │
├──────────────────────────────┤
│ ▓▓ RANKED ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  art: packed arena, banners
│    Queue against the ladder. │
│    ◈ Glory on victory        │
├──────────────────────────────┤
│ ▓▓ CASUAL ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  art: campfire / training yard
│    Your rooms, your rules.   │
│    ◈ Glory when earned       │
├──────────────────────────────┤
│ ▓▓ PRACTICE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  art: straw men at dawn
│    Every weapon unlocked.    │
│    No stakes, no glory       │
├──────────────────────────────┤
│ ░░ STORY ░░░  COMING SOON ░░ │  greyed, non-navigable
└──────────────────────────────┘
```

All four are always *rendered* — a mode you can't enter right now is shown
disabled with a reason, never hidden. Players should learn the full shape of
the game from this screen.

## Card anatomy

Each card is a rounded-rect (matching existing 10–14px radii) with:

1. **Full-bleed art** — Tom-generated PNG per mode (see art spec below).
2. **Scrim** — left-to-right gradient (`rgba(10,6,4,0.82)` → transparent at
   ~65%) so the text column always reads over any art. A 1px bone-tinted
   hairline border (existing `#8a6d44`-family gold) at full opacity for
   available cards.
3. **Text column** (left-aligned, over the scrim):
   - Mode name — `DISPLAY_FONT` (Copperplate/serif), letter-spaced, bone
     `#f5ede0`.
   - One-line pitch (copy above).
   - **Status row** — small caps, contextual: glory tag when available,
     reason line when disabled (see states).
4. **Press feedback** — scale to 0.98 + scrim darkens slightly; `uiConfirm`
   via the existing `withTap` wrapper; light haptic (`impactLight`) — first
   use of haptics outside the match, deliberate: choosing a mode is a
   commitment beat.

### Art spec (for generation)

- One landscape PNG per mode, **card aspect ~5:2** (e.g. 1600×640) so four
  cards + header fit a tall phone without scrolling; art is `cover`-cropped so
  overscan ~10% on each edge.
- **Right two-thirds carries the subject** — the left third sits under the
  scrim and text, so keep it low-detail (sky, wall, sand).
- Style-bible consistent with the icon set (dark-fantasy woodcut palette:
  sand, blood-red `#a32c22`, gold `#e8c87a`); paired `.forge.json` manifest
  like every other art PNG, filed under `assets/modes/`.
- Story card ships with placeholder art (or a darkened duplicate) — it's
  greyed anyway.

## Card states

| State | Trigger | Treatment |
|---|---|---|
| **Available** | connectivity ok (or mode is offline) | full colour, gold hairline, glory tag |
| **Checking** | app just opened / retry in flight | full colour but muted hairline; status row shows a subtle "Connecting…" shimmer; taps queue nothing (no-op with `uiTap`, not `uiConfirm`) |
| **Unavailable** | server/API unreachable | art desaturated + darkened (single `saturation(0)`+opacity overlay — no second asset), no glory tag, status row in muted red: "Can't reach the arena — check your connection", plus a small RETRY affordance on the card |
| **Coming soon** | Story, hardcoded | same desaturated treatment + a diagonal "COMING SOON" ribbon in gold on parchment; tap gives a soft thud (`uiTap`) and a 4px shake — acknowledged, not dead |

Unavailable and coming-soon cards keep full text so players know what they're
missing — that's the sell.

## Connectivity model

Ranked and Casual require **both** the game WebSocket server and the glory
API. Practice never checks anything (fully on-device).

New hook `useConnectivity()` in `src/net/`:

- **Game server** — read `ArenaClient.status` (already connect-on-launch with
  a heartbeat, `connection.ts`). `open` = ok; `connecting` = checking;
  `closed` = down; `rejected` = protocol mismatch → the status row says
  "Update required" and tapping routes to the existing UPDATE REQUIRED flow
  instead of the lobby.
- **API** — new lightweight probe of the existing `GET /` health endpoint
  (Render already pings it) through the existing 8s-abort `apiFetch` pattern.
  Cached ~30s; re-probed on entering the mode screen and on RETRY. Today API
  failures are silent (`api.ts` returns null); the probe makes reachability
  explicit *only here* — wallet reads elsewhere stay silently-degrading.
- Combined state per online mode: `checking | ok | down | updateRequired`.
  One RETRY re-kicks both (reconnect the socket + re-probe).

## Per-mode behaviour on tap

- **RANKED** — v1 ships gated: full-colour card but tapping gives the
  denied shake + `uiTap`, status row reads "Season 1 — opening soon" (gold,
  distinct from the red connectivity message). The matchmaking queue is a
  later server project; when it lands the card flips to navigable.
- **CASUAL** — `setRoute("play")`: the existing NameScreen gate →
  RoomListScreen → RoomScreen wizard, untouched. Glory-earning conditions
  ("sometimes, provided conditions are met" — e.g. no bots / full-human room)
  are an economy question for `monetisation.md`, not this screen; the card
  just says "◈ Glory when earned".
- **PRACTICE** — `setRoute("practice")`: existing PracticeScreen, extended
  with an **opponent picker: BOTS | TARGET DUMMIES** above the current match
  size + bot-skill rows (skill grid hides for dummies). This promotes the
  dev-menu-only dummies range (`PracticeClient` `"dummies"` mode) to a
  player-facing feature; the dev-menu shortcut stays. Card copy carries the
  promises: every weapon + ability unlocked (true today — no locking exists;
  when locking arrives, Practice ignores it), no glory, no achievements.
- **STORY** — no-op beyond the shake/thud.

## Motion & premium feel

- **Entrance** — reuse the home screen's `rise()` stagger: header first, then
  cards top-to-bottom, ~70ms apart, each rising ~12px with fade. Art breathes
  (2–3% slow scale loop, existing breathing-sway pattern) on *available*
  cards only — disabled cards sit still, which reads as "cold".
- **Exit into a mode** — chosen card scales up ~2% and holds while the rest
  fade; then route flips. Cheap (Animated, native driver) but makes the pick
  feel like a door opening.
- **Sound** — reuse `uiConfirm` (choose) / `uiTap` (denied/back). One new
  owed clip: `modeReveal`, a low drum-hit-with-air as the stack finishes its
  entrance. → **added to the forge done-tick checklist** per `bits-audio.md`
  (new event → manual wiring: play once from the mode screen's entrance
  effect).

## Open questions

1. Casual glory conditions — economy design, tracked in `monetisation.md`.
2. Does dummies mode need team-size exposure, or keep the fixed
   `RANGE_TEAM_SIZE = 2` line-up? (Lean: keep fixed — it's a range, not a match.)
