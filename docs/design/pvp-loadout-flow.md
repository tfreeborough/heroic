# Blood in the Sand — Guided Loadout Flow ("The Arming")

Status: **BUILT 2026-07-15 (protocol v9)** — on-device polish pass owed ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-15 ·
Supersedes: [pvp-pick-ceremony](./pvp-pick-ceremony.md) (draft → reveal → counterpick)

> **As built (2026-07-15):** the arming countdown lives IN the sim
> (`tickRoundMachine`'s lobby case — the machine watches `armingComplete` and
> starts the match itself; `addPlayer`/`removePlayer` zero the timer, which is
> the whole join/leave-cancel rule). It rides `round.timer` while the phase is
> `lobby`; the `armingComplete` event cues the client banner. `forceStartMatch`
> random-fills stragglers and lets the same gate pass. **The lobby return
> DISARMS everyone** (weapon/hand clear at matchEnd → lobby), so an instant
> auto-rematch is impossible by construction and a rematch re-runs the wizard —
> run-it-back makes that one tap. RoomScreen = the wizard (local optimistic
> picks, idempotent sends; carousel via Animated.ScrollView interpolation;
> measured fly-to-socket) + lobby + countdown veil (the full-screen armed
> splash was CUT 2026-07-17 — repeated ceremony; haptic + confirm sound + the
> lobby's arsenal box mark the moment); a mid-lobby single-slot edit returns
> straight to the lobby. The
> cast flash rides the existing `cast` event (`FxItem "castFlash"`, forge
> icons via `useAbilityIconImages`). Practice runs the identical flow (bot
> arms ~1.2–3s in; the lobby interval owns the clock, GameScreen takes over at
> countdown) — headless-verified: lobby → 5s countdown → active, plus a full
> 2-bot wire match (arm → countdown → 5 rounds → matchEnd) on the live server.
> The old LoadoutSheet is deleted; `--noarm` bot = the straggler for testing
> force-start from a phone. Owed: on-device polish (fly/beat timings, flash
> size/placement), a real "you are armed" fanfare + wizard SFX via Asset Forge.

> **Why the pivot (Tom, 2026-07-14):** casual testers bounced off the draft
> ceremony — the lock-in / reveal / hidden-counterpick loop "just goes over
> their head". The yomi layer was designed for a competitive player type we
> don't yet know exists. The lobby is most players' first touch with the game,
> so it must be **casual-first and premium-feeling**: smooth animations, clean
> but interesting design, clever UX. The counterpick metagame is *deferred,
> not dead* — it's a candidate for a ranked/veteran mode once the base game
> has an audience (see "What survives" below).

## The flow

```
join room ──▶ STEP 1        STEP 2         STEP 3         STEP 4        ──▶ lobby (armed)
              WEAPON        ABILITY №1     ABILITY №2     ABILITY №3        tap any socket to
              full-screen   "your top      "your middle   "your bottom      revisit that step
              card picker    button"        button"        button"
                                       all seats armed ──▶ 5s countdown (all clients) ──▶ match
```

Players are walked through four decisions, one per screen, in a fixed order:
weapon, then abilities 1→2→3. Completing the wizard **guarantees** a full
loadout — no empty picks, no random fills in the happy path, no lobby-holding.

### The wizard

- **Triggers immediately on joining the room (Tom, 2026-07-15)** — you're
  *doing* something the instant you're in; the compact roster ticker keeps
  the party-filling-up visible while you arm.
- **One decision per screen.** Full-bleed step; swipeable snap-to card
  carousel. The focused card shows the codex content we already have
  (`loadout/catalogue.ts`): big icon, flavour quote, stat bars / number chips.
  Same copy rules as ever — everything derived from sim config, nothing that
  rots.
- **Category gates keep the carousel thumb-sized (Tom, 2026-07-15).** The
  weapon step is one carousel. Each ability step opens on a **category
  choice** (offensive / defensive / support — each gate shows a mini icon
  preview of what's inside), then a carousel *within* that category — so the
  carousel never outgrows a swipe as the roster grows. Everything lists
  **alphabetically** (weapons too); a revisited socket opens straight inside
  its pick's category.
- **Stat bars are roster-normalised (Tom, 2026-07-15):** the roster's best
  value fills the bar, the worst floors at ~20% (never empty), and the scale
  re-derives itself as weapons join the roster. Built into
  `catalogue.ts weaponBars` already — the wizard inherits it.
- **CHOOSE → the moment.** Tap CHOOSE on the focused card: stamp animation +
  heavy haptic (+ SFX owed via Asset Forge), the icon **flies into a
  persistent socket strip** (◆ ◇ ◇ ◇ — weapon + 3 abilities), then
  auto-advance after a ~350ms beat.
- **Ability steps teach the controls.** Ability order IS button order, so each
  ability step renders the in-game button column with the slot being filled
  glowing — "this will be your **top** button". The lobby teaches the control
  scheme before round one, for free.
- **No duplicates by construction:** already-socketed abilities simply don't
  appear in later steps.
- **Back navigation** via the socket strip: tap a filled socket → jump to that
  step with the current pick pre-focused. Picking **replaces**, never clears —
  a player can never become *un*-armed (this invariant is what lets the
  auto-start countdown ignore edits, below).
- **No timers, no lock-in.** Picks are live on the wire the whole time
  (teammates see them update; enemies never do).
- **The finish moment is the premium payoff.** After slot 3: a "YOU ARE
  ARMED" composition — the four icons assembled into a banner/crest with a
  staggered flip-up (recycle the RevealSplash animation DNA) + a real SFX.
  This replaces the reveal as the ceremony's emotional peak: it celebrates
  *your* choices instead of asking you to decode the enemy's.
- **Repeat players — "SAME ARMS" (renamed from "run it back", Tom
  2026-07-16):** the wizard opens on "TAKE UP THE SAME ARMS?" showing your
  last loadout — SAME ARMS ✓ / CHOOSE ANEW. One tap for veterans, full
  guidance for newcomers. Last loadout persists locally (no server change).
  **CHOOSE ANEW starts from scratch, never pre-socketed (Tom, 2026-07-16):**
  pre-filling would commit the old loadout, which ARMS you — and with the
  rest of the party ready, the countdown starts while you're still browsing
  (~5s to "change"). Staying unarmed holds the match open until you finish
  the wizard again; only SAME ARMS commits instantly.

### The lobby after arming

Roster as today (team-split, host crown, connection state), plus:

- Your own team's rows show live pick icon strips (unchanged).
- Enemy rows show only **⚔ armed / choosing…** — never picks (unchanged
  transport, see below).
- Your loadout renders as the socket strip; tapping a socket re-enters the
  wizard at that step.

### Start logic (Tom, 2026-07-14; full-room gate 2026-07-16)

- **Auto-start, server-initiated.** The moment the room is **full** and every
  seat is armed (all connected), the **server** starts a **10-second
  countdown** and broadcasts it — every client shows the same "ALL ARMED —
  MATCH STARTS IN 10…" banner over the lobby roster. At zero: straight into the existing match
  countdown → fight. Nobody needs to know they're the host for a match to
  start — and an AFK *host* can no longer block one either (which
  `startByHost` could never handle).
- The 5s banner doubles as the **last-look moment** — anticipation beat over
  everyone's armed rows, replacing what the reveal splash used to provide.
- **Picks stay editable during the countdown.** Enemy-hidden anyway, and the
  replace-not-clear invariant means edits can never invalidate readiness — so
  editing never pauses or cancels the countdown.
- **Countdown cancels** (reverts to waiting; restarts fresh at 10 when the
  condition holds again):
  - a new player joins mid-countdown (they need to arm), or
  - a player disconnects mid-countdown — we're still in the lobby, so the
    "matches never pause" rule doesn't apply yet; no dragging a disconnected
    friend into a match that hasn't started. (From the *match* countdown on,
    existing rules take over: the body idles in.)
- **Host force-start — the AFK backstop AND the partial-room launcher
  (2026-07-16).** The host's *only* start control: a secondary "START NOW"
  action that appears once someone has sat unarmed for a grace period (~30s)
  while the rest are ready, **or** when the room has empty seats but everyone
  present is armed. It random-fills any stragglers (sim RNG, deterministic —
  today's auto-select), sets the sim's `forced` override (which lets the
  full-room gate pass with empty seats — cleared by any join/leave, so it can
  never go stale), and then **feeds into the same 5s countdown, never
  instant** (Tom 2026-07-14): everyone gets the same start moment, and the
  auto-armed player gets a beat to see what they were dealt. Uneven teams are
  the host's call; empty seats simply don't spawn. It requires at least one
  player on each team.
  **Amended 2026-07-19 (protocol v15, [bits-bot-backfill](./bits-bot-backfill.md)):**
  empty seats no longer go unspawned — a force-start FILLS them with
  server-run bots (the button shows immediately when seats are empty; the
  ~30s grace now applies only to the full-room straggler case), and during
  the 5s countdown of a bot-filled start any seated player may cancel.

## Information rules

- **Enemy picks are never visible pre-match** — no reveal, ever. In-match,
  weapons are visible in snapshots from countdown on (you can see what they
  swing); abilities reveal **through play** via the cast flash below.
- **The cast flash (Tom, 2026-07-15):** when any player — enemy or ally —
  casts an ability, its icon **flashes in above them and animate-fades out**:
  "they just pressed this button." This is the in-game ability iconography;
  nothing persistent. It rides the existing `cast` event (which already
  carries the ability id and drives haptics/tremor cracks), so it's
  **client-derived, zero protocol change** — and snapshots never need to
  carry ability loadouts publicly. An enemy's kit is intel you earn by
  watching them fight, one cast at a time. Fine details (size, duration,
  exact placement vs name tag) resolve at the end of the build.
- The per-team filtered `roomState` transport from protocol v6 **is kept
  verbatim** — it's what makes "enemies see armed/choosing, never picks" a
  server rule rather than a client courtesy. Watchers keep the neutral view.
- Snapshot weapon-scrubbing while phase is `lobby` stays; snapshots must now
  carry **abilities** publicly in-match so enemy iconography can render.

## What this deletes (the simplification win)

- `pick` / `reveal` RoundPhases; `PICK_PHASE_SECONDS` / `REVEAL_ADJUST_SECONDS`;
  the timed draft config on `startMatch`.
- `lockIn` wire message; `locked` / `revealed` / `revealedAbilities` on
  `RoomStatePlayer`; lock ✓ UI.
- RevealSplash, TimerRing (radial pick timer), the draft phase headers.
- The bot's draft behaviour (bait-swap, lock clocks) — practice/server bots
  just arm instantly; practice remains the solo test bed for the wizard.
- `LoadoutSheet` as the primary path — its card/codex internals get recycled
  into the wizard steps.

New wire needs: armed flag (derivable from picks — may need no new field),
lobby-countdown state, force-start message. Net: **protocol shrinks**.

## What survives from the ceremony work

- Team-filtered `roomState` (built "deliberately ahead of need" — this is the
  need holding).
- Deterministic auto-fill (now only behind host force-start).
- The codex/card content and copy rules.
- The counterpick design itself: recorded in
  [pvp-pick-ceremony](./pvp-pick-ceremony.md), superseded for the default
  lobby, revisitable as a ranked/veteran mode.

## Open questions (not yet decided)

- **Constants:** 5s countdown (10s felt too long — Tom 2026-07-17) and ~30s
  force-start grace are starting values, tune in testing.
- **Cast-flash detail:** size/duration/placement of the icon pop — resolve at
  the end of the build, on device.

## Why this design (recorded so we don't re-litigate)

- Casual players need information rules they can reason about at first touch:
  "pick your stuff, you can't see theirs" is one sentence. The draft needed a
  paragraph and a theory of mind.
- A fixed pick order (weapon → 1 → 2 → 3) guarantees completeness *by
  construction* instead of by timers + random fills — the guarantee moves
  from enforcement to flow.
- Server-initiated auto-start removes the last "someone must act" dependency
  from the happy path; the host only exists for the AFK edge case.
- Premium-first because the lobby is the first-session funnel: the wizard IS
  the tutorial for buttons 1–3, and the "you are armed" moment is the hook.
