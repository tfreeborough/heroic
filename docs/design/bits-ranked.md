# Blood in the Sand — Ranked, Ratings & the Queue

Status: **designed 2026-07-28 · revised 2026-07-29 · M1+M2+M3 BUILT 2026-07-29 ·
display v2 + 14-rung divisions BUILT 2026-07-30 · 2v2 solo queue DESIGNED +
BUILT 2026-08-24 (protocol v29) · queue roaming + match accept DESIGNED + BUILT
2026-08-25 (protocol v30)** (rating core + schema + server queue/ranked
rooms/recorder + client; on-device pass + M4 ladder polish pending) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-24

> Season I: solo-queue 1v1 ranked with Elo ratings, tier badges, and Glory payouts
> scaled by opponent difficulty — reached through a dedicated ranked screen built to
> grow into multiple brackets. Companion to [glory-economy.md](./glory-economy.md)
> (identity + ledger this builds on), [monetisation.md](./monetisation.md) (what Glory
> buys), and [bits-mode-select.md](./bits-mode-select.md) (the locked RANKED card this
> finally opens). The pick ceremony ([pvp-pick-ceremony.md](./pvp-pick-ceremony.md))
> stays parked as a *future* ranked flavour — Season I uses the standard arming wizard.

## Decisions locked

1. **Brackets, each with its own rating** *(revised 2026-07-29)*. A bracket is a ranked
   format — `1v1` now; `2v2`, `3v3` later. **A player's rating is
   per-bracket**: 1700 in 1v1 and 1400 in 2v2 coexist, so a bad 2v2 teammate can never
   dent your 1v1 number. Season I ships the `1v1` bracket only. *(Revised 2026-08-24:
   premade teams are NOT their own bracket — a premade pair queues into the same `2v2`
   pool as solo players, one ladder; see § 2v2 solo queue.)*
2. **Glory: participation + difficulty-scaled win payout** *(revised 2026-07-29)*.
   Losers always earn a little; winners earn `floor + range × (1 − E)` — an even fight
   pays ~50% over floor, an upset pays double-floor, a stomp pays the bare floor.
   Deliberately framed as a floor-plus-bonus, never a visible penalty: stomping weaker
   players is the worst rate in the economy without any "−%" ever appearing on screen.
3. **Rank display: tiers + visible number.** Named tier badges over rating bands, exact
   rating shown alongside.
4. **Queue lives in the game server.** In-memory queues beside the in-memory rooms; a
   match creates a room in-process and seats the players. No new service. The game
   server takes on `@heroic/blood-in-the-sand-persistence` + Turso creds — the same step
   glory-economy.md already planned for match payouts.
5. **A dedicated ranked screen** *(added 2026-07-29)*. Tapping RANKED opens a ranked
   home — bracket cards in the mode-select art style, live queue population, your rank —
   not a bare "queueing…" spinner. Built from day one for the WoW-battlegrounds future:
   queue for several brackets at once, first match found wins.

## Ratings: Elo

*(Primer: every player carries a number per bracket. The gap between two numbers
converts to an expected win chance; after each match the winner takes points from the
loser — more for an upset, fewer for a stomp. "K-factor" = the max points that can move
in one match.)*

- **Starting rating: 1500** *(revised 2026-07-29 from 1000)*. Elo is zero-sum around
  the start value — the population average stays pinned there — so the start value is
  purely a presentation choice. 1500 is the chess convention: the ladder reads
  ~1100–2200 instead of ~600–1700, and the top tier gets a number that sounds like one.
  Floor: 800 (a backstop far below the real range, not a mechanic).
- **Expected range, honestly stated:** for a pool our size over a season, ~99% of
  players land within roughly ±400 of 1500; only high-volume grinders push +500–700.
  WoW-style 2400+ numbers come from huge populations plus deliberate rating inflation —
  if our ladder ever feels compressed, a mild seasonal inflation mechanic is the lever
  (**deferred, not designed**).
- **Expected score** for you vs opponent: `E = 1 / (1 + 10^((opp − you) / 400))`.
  Equal ratings → 0.5; opponent +200 → ~0.24; opponent −200 → ~0.76.
- **Update:** `new = old + K × (S − E)` where `S` = 1 win / 0 loss.
- **K-factor schedule:** `K = 24` for a player's first **10** matches *in that bracket*
  this season ("placement" — new accounts and smurfs settle fast), `K = 15` after.
  Both sides use their *own* K. *(Retuned 2026-08-02 from 40/20 — Tom's day-one run
  climbed two divisions in ~10 games and it felt cheap. At 15, an even settled win
  pays ~7–8, a division is ~7 net wins, and the skill bands deliberately tighten;
  the placement K stays warm-not-hot so new players still calibrate fast.)*
- **Placements hide the numbers** *(decided 2026-07-30)*: until the 10 placement
  matches are done, the client shows NO rank and NO rating anywhere — the ranked
  home shows placement progress ("N/10 · X matches until your rank is forged") and
  the post-match ceremony shows "PLACEMENT MATCH N OF 10 · +Glory" instead of the
  Elo movement. Sells the reveal, and stops players reading meaning into a 1500 that
  hasn't converged. Server-driven: `/ranked/me` carries `placementsLeft`,
  `rankedResult` rows carry `placement {number, of} | null` — the client never
  re-implements the threshold.
- All math is **pure functions** — a new
  `packages/blood-in-the-sand-persistence/src/elo.ts` (no DB imports), unit-tested with
  known fixtures. The server calls it; nothing else re-implements it.
- **Team brackets:** team brackets rate each player *within that bracket* — a team's
  strength is the mean of its members' bracket ratings, and every member updates
  against the enemy mean with their own K. ~~**Premade teams** are a different thing
  again: the named team itself is the rated subject with its own row — a
  WoW-arena-team-style ladder.~~ *(Reversed 2026-08-24: premades share the solo pool
  and players stay the rated subject — a separate premade ladder would split an
  already-small population. § 2v2 solo queue.)*

### Tiers

Bands over the rating number, arena-flavoured — 6 tiers *(revised 2026-07-30 from
eight: with divisions carrying the fine-grained climb, fewer names each carry more
weight — see § Divisions)*. Badge + name are presentation only — no gameplay effect,
no promotion matches (the number is the truth). Tiers are per-bracket, same bands
everywhere.

| Tier | Rating |
| --- | --- |
| **Initiate** | < 1300 |
| **Pit Fighter** | 1300–1449 |
| **Gladiator** | 1450–1599 |
| **Champion** | 1600–1749 |
| **Warlord** | 1750–1899 |
| **Immortal** | 1900+ |

A fresh player starts mid-table in Gladiator II (1500 sits mid-tier; hidden until
placements are done anyway) — placements sort them fast. Tier art landed 2026-08-01,
and the `rank_up` moment is BUILT (see Audio & art owed): the new crest pops in
under "RANK UP" in step with the fanfare — since 2026-08-02 inside the post-match
ceremony (§ The ceremony), not on the in-game plate; demotions get one muted
warm-grey line ("RANK DOWN · <rank>"), no crest, no fanfare.

#### Divisions — the 14-rung ladder *(decided + built 2026-07-30, re-cut same day)*

Tom wanted many more ranks so rank-ups happen often enough to chase. Rather than a
pile of named tiers (new names + badge arts, and "Warlord" means less as one of
twenty), the **middle four tiers split into divisions III → II → I** — the LoL
convention, Roman numerals fitting the arena. The open-ended tiers stay single
rungs: Initiate is the "climb out of here" bin, Immortal the summit.
`1 + 4×3 + 1 = 14` rungs.

First cut kept the 8 tiers (20 rungs), but 100-wide tiers made 33-point divisions —
a promotion every ~2–3 wins, which Tom flagged as feeling cheap (and the fresh
post-placement K=40 tail moved a division per win). Re-cut same day: **every middle
tier is 150 wide, so every division is exactly 50 points — ≈ 5 net wins settled at
the original K=20, ≈ 7 after the 2026-08-02 retune to K=15** —
Blooded and Veteran retired, Immortal now 1900+ (attainable for grinders per the
expected-range note above, still rare).

Division floors are **derived** from the tier bands (each middle tier splits evenly
in three, `RUNGS` in elo.ts — TIERS stays the single source of truth):
Pit Fighter III 1300 · II 1350 · I 1400 · Gladiator III 1450 · II 1500 · I 1550 ·
Champion III 1600 · II 1650 · I 1700 · Warlord III 1750 · II 1800 · I 1850.

- **Grace stays TIER-level only**: the badge is the emotional boundary, so it sticks
  (50 under the tier floor, as display v2 decided); divisions inside a tier move
  freely both ways — frequent movement is their whole job. While grace holds a tier
  the rating has slipped under, the shown rung is that tier's entry division (III).
- The progress bar + "N TO <RUNG>" now target the **next rung**, not the next tier.
- **The bottomless rung and the missing bar** *(Tom, 2026-07-30)*: Initiate's true
  floor is 0, which would draw a nearly-full bar that barely moves — so it gets a
  **synthetic display floor of 1150** (one tier-width under Pit Fighter,
  `displayFloorOf`), making the bar span 1150→1300 and move like everywhere else.
  Below the displayed rank's floor — deep Initiate, or dipped under a grace-held
  badge — the client **hides the progress row entirely** rather than show a hollow
  bar: no progress claims we can't honestly draw; rating, season best, and the form
  dots still carry the panel. Per the distribution sim (skill σ=150), <0.5% of
  players ever sink under 1150.
- Badge art stays **one piece per tier (6)** — the division numeral/pips render over the tier badge
  (numeral composition is the one presentation the client owns: `rankName()`).
- Wire/API: `division: 1|2|3|null` beside every `tier`; `/ranked/me` sends
  `rankFloor` + `nextRank {tier, division, floor}|null` (replacing display v2's
  short-lived `tierFloor`/`nextTier`).

### The ceremony — the settlement gets its own stage *(decided + built 2026-08-02)*

Tom, after a day on ranked: the Glory + rating changes "pushed into a small text
space below" the VICTORY title undersold the moment. The split now:

- **In-game** the match-end plate is **title + score only** (RoundBanner: no
  settlement line, no rank callout — both deleted). The arena's job ends at
  VICTORY/DEFEAT.
- **Back on the ranked home**, a full-screen **ceremony overlay**
  (`RankedCeremony.tsx`) plays ONCE per settlement (module-level matchId latch —
  survives the screen unmounting for the match), then dismisses to the ranked
  home, where the existing compact settle card remains as the quiet record.
- **Beats**: VICTORY/DEFEAT title + the Glory count-up (ease-out cubic, timed to
  the `glory_earned` swell) → auto-crossfade (`ceremony_shift`, new catalogue id,
  clip owed) → the rating beat: the number counts before → after, delta chip,
  rank crest + name; if the displayed rank moved, the crest pop / muted line
  holds back until the count lands (`rank_up` / `rank_down` fire HERE now, not in
  GameScreen). `NEW SEASON BEST` caps the count when set. Placements swap the
  rating beat for "N / 10 · X matches until your rank is forged" — the
  numbers-stay-hidden rule follows the settlement wherever it's shown.
- **Tap rules — premium, never trapping**: tap mid-count snaps the count home;
  tap on a finished beat advances; the last beat waits for the dismissing tap
  ("TAP TO CONTINUE").

### Display v2 — progress you can feel *(decided + built 2026-07-30)*

The problem: Elo is zero-sum, so a mid-table regular sees the same number all month
and reads "no progress". The display pairs the honest rating with numbers that only
ever go up, without touching the math (Tom, 2026-07-30):

- **Progress-to-next-rank** *(re-languaged 2026-08-01 — Tom: "80 TO CHAMPION III"
  conveyed nothing)*: the bar runs INTO a small dimmed endcap showing what CHANGES
  at the next rung — the next division's Roman numeral within a tier, the next
  tier's crest when the rung crosses a tier boundary (six badges cover fourteen
  rungs, so a same-tier crest endcap just mirrored the player's own badge) — and
  the label speaks in the player's unit:
  **"NEXT RANK · ~2 WINS TO CHAMPION III"** (`RATING_PER_WIN ≈ 8`, a client-side
  presentation heuristic off K=15). Immortal (no ceiling) shows a full gold bar +
  "TOP OF THE LADDER". Ladder math (`rankFloor`, `nextRank`) is computed server-side
  in `/ranked/me`; the client renders, never re-implements the bands. The rating
  number carries a small "RATING" cap, and the form dots a "LAST N GAMES" cap —
  every element on the panel names itself.
- **Season peak** ("SEASON BEST 1682"): monotonic per bracket — `peak_rating` on
  `ranked_ratings`, maintained in the settle batch (initial peak = the 1500 start).
  Shown muted on the panel's meta row. *(Revised 2026-08-01: the gold "AT SEASON
  BEST" state was CUT — Tom's call, loss aversion: telling a player they're at
  their peak invites quitting while ahead.)* The settle result carries `peak` +
  `newBest`, and the settlement banner celebrates "NEW SEASON BEST" — reframes a
  plateau as "below your best", not "what you are".
- **Sticky tier badges (grace)**: an *earned* tier — one the season peak actually
  reached — keeps its badge until the rating falls **50 below its floor**
  (`TIER_GRACE`, `displayTierFor(rating, peak)`), so a player bouncing 1495↔1505
  never watches their Gladiator title flap. The rating beside it stays honest; only
  the title is sticky, only downward, and it chains one band at a time (a 1900 peak
  at 1660 shows Champion, not Warlord, not Veteran). All wire/API `tier` fields are
  display tiers now.
- **Form dots**: the last ≤10 results as W/L pips (oldest → newest) under the record
  — streaks made visible. Read off `ranked_matches` (`recentForm`), no new state.
- **Considered, deferred**: season-wins milestones paying Glory (a pure-progress
  track) — economy territory, owned by monetisation.md if taken up.

## Glory payouts

Written by the **game server** into `glory_ledger` at `matchEnd` — the first real
writer, exactly the shape glory-economy.md reserved. Numbers live in **server-side
config** (monetisation.md: keep earn rates server-side, tune against retention).

- **Loser:** flat **5 Glory** (participation — playing ranked always pays *something*).
- **Winner:** `WIN_FLOOR (15) + WIN_RANGE (15) × (1 − E)` *(revised 2026-07-29: floor
  lowered, scaling range widened — stomps now pay ~35% under an even fight, without a
  visible penalty)*:
  - farm someone −400 below you (E ≈ 0.91) → **16 Glory** (the floor, basically)
  - beat an equal (E = 0.5) → **23 Glory**
  - upset someone +400 above you (E ≈ 0.09) → **29 Glory**
- **Idempotency keys:** `ranked:<matchId>:<playerId>` (one row per player per match,
  retries can never double-credit). Source string: `ranked:<matchId>`.
- **Smurf honesty note:** the bonus reads *current* rating, so a fresh smurf account
  briefly earns equal-opponent rates while stomping. The real containment is the
  placement K = 24 — ten matches and they've rated out of the low bands. Accepted.

### Economy sizing *(added 2026-07-29)*

Ranked is the **primary Glory faucet**, so store prices must be set against what play
actually pays. At 50% win rate the expected take is `(23 + 5) / 2 ≈ 14 Glory/match`
(a Bo5 match ≈ 6–8 min including queue + arming + ceremony):

| Player | Matches/week | ≈ Glory/week |
| --- | --- | --- |
| Casual | 5 | ~70 |
| Regular | 20 | ~280 |
| Hardcore | 60 | ~850 |

Pricing rails (rails, not prices — actual numbers stay server-side per monetisation.md
and get tuned against telemetry): impulse cosmetic ≈ *a few days of regular play*
(~100–200); weapon/ability sidegrade unlock ≈ *1–2 weeks regular* (~300–600); premium
announcer pack ≈ *3–4 weeks regular or the IAP shortcut* (~800–1200). Glory-via-IAP is
priced against this time-value.

Open follow-up: with ranked as the main faucet, non-ranked players earn ~nothing — a
small skirmish trickle is wanted *eventually* but is farm-able by design (invite a
friend, feed kills), so it needs its own abuse thinking. Deferred (agreed 2026-07-29),
owned by monetisation.md when taken up.

## The ranked screen *(added 2026-07-29)*

Tapping the RANKED card opens **RankedScreen** — the ranked home, not a spinner:

- **Header:** your rating, tier badge, and season W/L for the selected bracket.
- **Bracket cards** in the mode-select art style (mode-bits type, 900×360,
  right-anchored crop): `1v1` live in Season I; future brackets (`2v2`, `3v3`,
  premade teams) shown as locked/"future season" cards for aspiration — same
  greyscale treatment as the locked mode cards.
- **Per-bracket queue info:** how many players are queued right now (a count, and only
  a count — names would enable queue-sniping and dodge-by-name), plus your live wait
  timer once queued.
- **Multi-queue (designed now, shipped later):** the protocol shapes below carry
  *arrays* of brackets so a player can eventually queue several brackets at once —
  first `matchFound` wins, the others are auto-left (WoW battlegrounds model). Season I
  UI exposes only `1v1`, so the array always has one element; shipping multi-queue is
  a UI change, not a protocol bump.
- ~~**v1 simplification:** leaving RankedScreen (or losing the socket) leaves the queue.
  Queueing-while-roaming-the-app is future polish.~~ **Reversed 2026-08-25** — the queue
  now follows the player around the app and a match must be ACCEPTED before it seats
  (§ Queue roaming & match accept). Losing the socket still leaves the queue.

## The queue & matchmaker

In-memory in the game server: one array **per bracket** plus a matcher pass on a slow
tick (every 2 s, piggybacked on the existing 30 Hz loop). 1000+ queued players is
trivial at this shape.

- **Entry:** `queueJoin` over the WS carries `{ playerId, token, brackets }` — the
  first place identity rides the socket (glory-economy.md designed this). Server
  verifies the token via the persistence package (`findPlayerByToken`), caches the
  verdict for the connection's lifetime, loads the player's per-bracket season ratings
  (creating rows at 1500 if absent). Bad token / DB unreachable → `reject` — ranked is
  the one mode that is honestly connectivity-gated.
- **Matcher (per bracket):** sort queue by that bracket's rating, pair adjacent players
  whose gap fits a window that **widens with wait time**:
  `window = 100 + 50 × floor(secondsWaiting / 10)`, using the longer-waiting player's
  window. **Season I launches permissive** — config `matchAnyone: true` skips the
  window entirely (population is tiny; a match now beats a fair match never). Flipping
  to windows later is a config change, not a build.
- **No pair-with-self, no rematch guard in v1** (add a "not your last opponent" rule if
  farming-by-arrangement shows up — see Abuse).
- **Feedback:** while queued the client gets `queueStatus` (per-bracket queue size +
  seconds waited) every few seconds; queue sizes also stream to RankedScreen *before*
  queueing. No fake "estimated wait" — honest numbers only.
  **Decision reversed 2026-08-01** for as long as ranked bot backfill is live
  (bits-ranked-bots.md § queue-size display): queue sizes are fuzzed **server-side**
  on both reads, so "1 in queue → match found" never betrays a bot match. The fuzz
  dies with the backfill kill switch — honest numbers return automatically.
- **Queue is ephemeral by design:** a server deploy drops queues along with rooms
  (accepted in glory-economy.md's topology). Client treats a dropped socket while
  queued as "requeue with one tap", never an error screen.

### Match found → ranked room

On a pairing — **and once everyone has accepted it (§ Queue roaming & match accept,
2026-08-25)** — the server creates a **ranked room** in-process and seats both players —
same `Room` machinery, different rules:

| | Skirmish | Ranked |
| --- | --- | --- |
| Discovery | listed / code / passcode | never listed, unjoinable, no code shown |
| Host | host powers + migration | no host — server owns the room |
| forceStart / cancelStart | host / any-seated | disabled |
| Bots | backfill on forceStart | queue backfill after a 15–25 s empty-queue wait, disguised as players (bits-ranked-bots.md; was "never" — reversed 2026-08-01, env kill switch). Every bracket: 2v2 fills its human-less seats with bots too (was "never in 2v2" — reversed 2026-08-31) |
| switchTeam | open seat hop | disabled |
| Team size | host-picked 1–4 | fixed by bracket (Season I: 1v1) |
| Start | arming wizard, auto-start when full+armed | same wizard, **60 s arm deadline** |
| After matchEnd | back to lobby, rematch flow | room closes, both return to RankedScreen |

- The existing `armingComplete` rule (full room + everyone armed → 5 s countdown)
  already gives ranked its auto-start for free.
- **Arm deadline:** if either player hasn't armed within 60 s the match is **void** —
  no rating change, no Glory, the armed player is auto-requeued at their old wait
  priority, the idle player gets a **30 s queue lockout** (dodge penalty).
- **Disconnect mid-match:** unchanged from the arena's law — the match never pauses,
  the body idles, the rejoin window stands. If they never return the wipe happens
  naturally and the result **stands as a loss**. Abandoning is losing; no special case.
- `WINS_TO_TAKE_MATCH = 3` (first to three round wins) stands for ranked.

### Result recording

On the sim's `{type:"matchEnd", winnerTeam}` event in a ranked room, the server (not
the client, never the client):

1. Computes both Elo updates (pure `elo.ts`).
2. Writes in **one libsql batch**: both `ranked_ratings` upserts, one `ranked_matches`
   row, two `glory_ledger` rows. Idempotency key on the match id — a retry after a
   crash can never double-apply.
3. Emits the results into the room (`rankedResult` message: old/new rating, delta,
   tier, Glory earned) so the post-match screen shows the ceremony without an API poll.

If the DB write fails, retry with backoff; the batch is idempotent. Players may see
their new rating a beat late — never wrong.

## Persistence additions

Two tables beside `players` / `glory_ledger` (idempotent DDL in `ensureSchema`, same
pattern). *(Revised 2026-07-29: ratings are per-bracket, and the rated subject is
generalised beyond players.)*

```
ranked_ratings   subject_id (text) · season (int) · bracket (text) · rating (int)
                 · wins · losses · updated_at        PK (subject_id, season, bracket)
ranked_matches   id (text pk, server-minted uuid) · season · bracket
                 · winner_id · loser_id (subject ids)
                 · winner_rating_before/after · loser_rating_before/after
                 · winner_loadout (json) · loser_loadout (json) · created_at
```

- **`bracket` is a key string** (`"1v1"`, later `"2v2"`, `"2v2-premade"`, …). One
  player, many rows — a 1700 `1v1` rating and a 1400 `2v2` rating are simply two rows,
  fully independent.
- **`subject_id` is what's being rated**: a player id. *(2026-08-24: the "team id
  for premade brackets" idea is retired with the separate premade ladder — premades
  rate as individuals in the shared `2v2` pool, so `subject_id` is always a player
  id and the column name is simply roomier than it needs to be.)*
- `ranked_matches` is the audit trail *and* the analytics tap monetisation.md asked
  for ("log per-weapon pick rate + win rate at match end from day one") — loadouts as
  JSON (an array once team brackets exist), queried offline, no new pipeline.
- Leaderboard = `ORDER BY rating DESC LIMIT n` per bracket (index on
  `(season, bracket, rating)`).

### API additions (`apps/blood-in-the-sand-api`)

```
GET /ranked/me                     → { season, brackets: [{ bracket, rating, tier,
                                       division: 1|2|3|null, rankFloor,
                                       nextRank: {tier, division, floor} | null,
                                       peak, form: boolean[], wins, losses,
                                       placementsLeft }] }                (bearer)
GET /ranked/leaderboard?bracket=   → { season, bracket, top: [{name?, rating, tier}] }
                                                              (public, cached 60 s)
```

The client reads ratings from `/ranked/me` on RankedScreen; live updates during play
come from the in-room `rankedResult` message. (Leaderboard names: `players` has no
display name today — v1 leaderboard shows tier + rating with anonymous handles, and a
persisted display name column is a fast follow decided at build time.)

## Protocol (v19) — as built

- Client: `queueJoin { v, token, playerName, brackets: string[] }` (token alone
  authenticates — the server derives the player id, never trusts a claimed one;
  Season I always `["1v1"]`, array from day one so multi-queue is additive),
  `queueLeave`, `queueInfo` (unauthenticated queue-size read for the RankedScreen
  population display).
- Server: `queueStatus { brackets: [{ bracket, size, waitedSec? }] }` (on queueInfo,
  on entry, every matcher beat), `queueLeft`, `matchFound { bracket, code }`
  (informational — the server SEATS both players itself and the standard `welcome`
  follows on the same socket; no joinRoom round-trip), `rankedResult { matchId,
  bracket, winnerTeam, results[] }` after matchEnd — rows carry `peak` + `newBest`,
  a display-grace `tier`, and `division` since display v2 + divisions (folded into
  v19, unshipped). Matched accounts auto-leave their other queues (first match wins).
- Ranked rooms reject `forceStart` / `cancelStart` / `switchTeam` / outside
  `joinRoom` (the mid-match rejoin of a disconnected seat is the one exception).

## Queue roaming & match accept *(designed + BUILT 2026-08-25 · protocol v30)*

> Tom, 2026-08-25: the queue shouldn't hold the player hostage on one screen, and a
> match should be something you say yes to, not something you're dumped into. Both
> came out of a bigger idea — queue, background the app, get a push notification when
> a match lands (the League of Legends model) — that we **parked** (§ Parked: background
> queue + push). This is the slice that stands on its own today: no native modules, no
> credentials, OTA-shippable, and the accept step is exactly what the push version
> would bolt onto later.

### Decisions

1. **The queue follows the player.** Once queued, every menu surface is open: home,
   the mode select, the Armory, Deeds, Settings, Feedback, even a Primer replay. The
   socket stays alive because the app is foregrounded — nothing changes server-side
   for roaming; the client simply stops leaving the queue on back. **The only doors
   that leave the queue are the ones into another match**: SKIRMISH and PRACTICE on
   the mode select confirm ("Leave the ranked queue?") before proceeding. Losing the
   socket still loses the spot (the reconnect layer's rule, unchanged).
2. **A queued pill in the shared header** (`ScreenHeader`, between the chevron and the
   purse — and on the title screen): `IN QUEUE · 1:23`, breathing like the ranked
   screen's SEARCHING line, tap → back to RankedScreen. The purse door stays open
   while queued (it was inert before — "a match can land any second and the ranked
   route is where it shows" no longer applies: the match shows *everywhere*).
3. **Explicit accept, 15 s.** A pairing no longer seats anyone. It opens a **pending
   match**: everyone gets `matchReady`, a full-screen sheet rises over whatever screen
   they're on (the summons sting + a heavy haptic play HERE now — this is the real
   "match found" moment; the room mount is silent), and each player has 15 s to
   ACCEPT or DECLINE. Accepting shows `N OF M ACCEPTED` until the last one lands; then
   the standard `matchFound` → seat → `welcome` → arming wizard flow runs unchanged
   (the 60 s arm deadline stands — after a yes it's generous, not hostage-taking).
4. **Not accepting is dodging.** Decline, letting the 15 s lapse, or dropping the socket
   mid-pending all read as the existing dodge: **30 s queue lockout**, `matchCancelled
   { dodged: true, lockoutSec }`, out of the queue. Everyone else gets `matchCancelled
   { dodged: false }` and goes **straight back in line with their earned wait**
   (`joinedMs` preserved = the widest rating window = the front of the line in
   practice — the same void rule the arming lobby already had). A void re-queues only
   the matched bracket (existing behaviour; a multi-queue's other bracket evaporated at
   match time).
5. **Bots accept too.** A backfill match (bits-ranked-bots.md) goes through the same
   pending stage: the humans see the same sheet, each bot "accepts" after its own
   jittered 1–5 s (a fraction of the window, so `1 OF 2 ACCEPTED` — or a 2v2's
   `3 OF 4` — shows up organically and an instant full house isn't a tell), and only
   then does the bot room build — the disguised identities are drawn at room time as
   before, so a declined bot match burns no roster names. A human who declines a bot
   match eats the lockout like any other dodge.
6. **One live ranked seat per account** extends to pending matches: a second socket on
   the same token can't queue while its twin has a match pending (the parallel-farm
   hole from the store audit, closed at this stage too).
7. **No new sounds.** `queueMatchFound` moves from the ranked-room mount to
   `matchReady` (a catalogue comment change, not a new clip); ACCEPT = `uiConfirm`,
   DECLINE = `uiBack`, the last five seconds tick with `countdownTick`.

### Server

- `PendingMatch` (`ranked.ts`, pure, tested): the matched `teams`, the accept
  `deadlineMs`, the set of accepted account ids, and for a bot match each bot's
  accept moment (`botAccepts[]` since 2026-08-31). `everyoneIn(now)`, `expired(now)`,
  `dodgers(now)` (the humans who haven't accepted, plus anyone whose socket died).
- The manager keeps `pending: PendingMatch[]`. The beat now runs **tendPending →
  tendRankedRooms → match → backfill**: a pairing (`queue.match`) or an overdue entry
  (`takeOverdue`) opens a pending match instead of a room. `matchAccept` resolves
  immediately when it completes the set (no waiting for the beat); `matchDecline`,
  `queueLeave`, a `joinRoom`/`createRoom`/`queueJoin` re-send, and socket close while
  pending all void it at once with that account as the dodger. Expiry and the bot's
  accept are beat-granular (≤ 2 s late — invisible under a 15 s window).
- Room creation is the unchanged `createRankedRoom` / `createRankedBotRoom`, called
  from the pending stage's "go" — their dead-socket guards still stand.

### Client

- `ArenaClient.pendingMatch` (`matchReady` → `matchPending` progress → either
  `matchFound`, which clears it, or `matchCancelled`, which parks the outcome on it
  for the sheet's farewell beat, then `dismissPending()`), `acceptMatch()`,
  `declineMatch()`. A dodge also sets `lastError` so RankedScreen explains the
  lockout.
- `MatchAcceptSheet` (App-level, over every route): eyebrow `MATCH FOUND · 1v1`, the
  countdown ring in the arming veil's vocabulary, ACCEPT (the brand red) / DECLINE
  (ghost); after accepting, `WAITING FOR THE OTHERS · 1 OF 2 ACCEPTED`; on a cancel,
  2.5 s of `AN OPPONENT DIDN'T ANSWER — BACK IN LINE` (innocent — you're still queued,
  the pill keeps counting) or `YOU MISSED THE MATCH — QUEUE LOCKED 30 S` (dodged —
  then the ranked screen).
- App routing: a `welcome` that belongs to a ranked match pulls the route to `ranked`
  from wherever the player was roaming. `QueueContext` (queued + server wait +
  go-to-ranked) feeds the header pill without threading props through seven screens.
- RankedScreen's back and the Android back gesture no longer leave the queue; the
  CANCEL on the bracket card is the one way out (plus the match doors above).

### Parked: background queue + push *(2026-08-25)*

The full idea — queue, background the app, a push notification (and an iOS Live
Activity / Android ongoing notification for "in queue · 1:23") when a match lands, tap
to accept from outside the app — is **possible but not worth it yet**: the queue
would have to become account-keyed and survive socket death (iOS suspends the app
within seconds of backgrounding; the socket WILL die), it needs `expo-notifications`
+ APNs/FCM credentials + a native rebuild, push delivery is 1–5 s on a good day and
device-only to test, and ghost queuers (queued, backgrounded, went to dinner) void
matches for live players unless TTLs and escalating lockouts are added. And today
the bot pops at 15–25 s regardless, so a backgrounded player never waits long enough
for the notification to matter. Revisit when the population makes "wait three minutes
for a human instead of twenty seconds for a bot" a real trade; the accept stage
above is the piece it bolts onto.

## 2v2 solo queue *(designed + BUILT 2026-08-24 · protocol v29)*

The second bracket: four solo players matched into a 2v2. Same ladder mechanics as
1v1 — its own rating, its own placements, same tiers and Glory — extended to teams.
Nearly all of the plumbing was laid for it on 2026-07-29 (string brackets,
`RANKED_BRACKETS → teamSize`, array-shaped `queueJoin`/`queueStatus`/`rankedResult`,
the team Elo rule above, the forged `bracket-2v2` card); what remains is the handful
of places that assume exactly two people.

### Decisions (Tom, 2026-08-24)

1. ~~**No bot backfill in 2v2 — ever.** A bot teammate feels awful (and a disguised
   ally is far easier to catch out than a disguised enemy). 2v2 waits for four humans;
   an empty 2v2 queue is honest about it.~~ **REVERSED 2026-08-31** (Tom, after
   outside counsel: "the population initially isn't going to be high enough to
   support it"): 2v2 backfills too — seats the queue can't fill with humans get
   bots after the same 15–25 s window, humans land on random sides, and the fuzz
   rides 2v2 as well. `RANKED_BRACKETS.botBackfill` is now true for both; the
   per-bracket flag survives for future brackets. Full mechanics:
   bits-ranked-bots.md § 2v2 backfill. Multi-queue
   (already built server-side, `queueJoin.brackets[]`, first match wins) remains
   the first line against a thin 2v2 population: a player queued for both gets
   whichever fills first — see § Client below.
2. **Premade pairs (future) queue into the SAME 2v2 pool.** One `2v2` ladder, players
   are the rated subject — no `2v2-premade` bracket, no `teams` table. Splitting the
   queue would halve an already-small population. The solo-vs-premade fairness gap is
   the premade design's problem to solve when it comes (matcher preference for
   premade-vs-premade first, widening with wait, and/or a small rating handicap —
   **deferred, not designed**). Nothing below boxes that in: a premade is a queue
   entry with two accounts that the matcher must keep on one side.

### Matcher

- A bracket's match takes **`2 × teamSize` entries** (4 for 2v2). `pairBracket`
  generalises to `groupBracket`: sort by rating (then wait), walk in contiguous
  groups of `n`; `QueueMatch` becomes `{ bracket, teams: [QueueEntry[], QueueEntry[]] }`
  (1v1 = two singletons — one code path).
- **Team split** of a 4-group sorted by rating: **best + worst vs the middle two** —
  the split that minimises the gap between team means, deterministic, no dice.
- **Window:** with `matchAnyone` (Season I) a group forms as soon as four are queued.
  When windows go live, the group's spread (`max − min` rating) must fit the
  longest-waiter's window — same widening schedule as 1v1.
- **Seating:** the matcher dictates sides. `room.seat` gains an optional `team` (ranked
  only — skirmish keeps its random-balanced assignment); `createRankedRoom` seats each
  team's entries onto it. Formation spawns already derive from team size.

### Ratings, Glory, settle

- **Elo per member** (the rule in § Ratings): each player's `E` is computed against
  the **enemy team's mean** rating; update with their *own* K and their *own*
  placement count in the `2v2` bracket. Placements are 10 per bracket, independent —
  a 1v1 veteran places fresh in 2v2.
- **Glory is per member and never split:** each winner gets the full
  `floor + range × (1 − E_team)` (E of the winning team's mean vs the losing team's
  mean), each loser gets `GLORY_LOSS`. Glory is renown, not a pot to share.
- **Recorder:** `recordRankedMatch` generalises to team sides
  (`winners: Subject[]`, `losers: Subject[]`; 1v1 is the size-1 case, old signature
  retired). One idempotent batch, keyed on the match id as today:
  - `ranked_ratings` upsert per member (4 rows);
  - one `ranked_matches` header row — **existing columns kept**: `winner_id`/`loser_id`
    hold the member ids comma-joined, the four `rating_before/after` columns hold the
    **team means** (rounded; enough to reconstruct expected score offline), the two
    `loadout` columns hold JSON **arrays** (the doc anticipated this). 1v1 rows are
    unchanged;
  - **NEW `ranked_match_players`** `(match_id · subject_id · team · won ·
    rating_before · rating_after · loadout json)` PK `(match_id, subject_id)` — the
    per-player truth, written for **every** bracket from now on (1v1 included, so
    pick-rate analytics have one table to read). Idempotent DDL in `ensureSchema`;
  - `glory_ledger` row per member (4 rows).
- `rankedResult.results[]` carries four rows (one per seat — the wire shape is already
  an array; no protocol bump for the message, but **protocol v29** for the client-side
  bracket unlock + `team` seating expectations).
- **Bot recorder untouched:** `recordRankedBotMatch` stays 1v1-only by construction
  (decision 1).

### Lifecycle (unchanged, checked against four seats)

- **Arm deadline / void:** `voidRanked` already walks every account — any dodger(s)
  eat the 30 s lockout, the other three re-queue with their earned wait. No change.
- **Disconnect mid-match:** the arena's law, unchanged — the body idles, the rejoin
  window stands, the result **stands for all four**. The innocent partner eats the
  loss exactly as 1v1's "abandoning is losing"; accepted for v1, revisit (loss
  forgiveness for the abandoned partner) only if it shows up in `ranked_matches`.
- **One live ranked seat per account** and first-match-wins multi-queue already
  cover the 1v1+2v2 double-queue case.
- **Deeds:** per-seat with team — ranked-win counters count 2v2 wins (ranked is
  ranked). The 2v2-ONLY board (partnership moments: assists, avenged partners,
  clutches, concert kills…) was designed + built the same day — achievements.md
  § Wave-3.

### Client

- **RankedScreen gets a selected bracket** (tap a card): the standing header, W/L
  line and CTA bind to it instead of the hard-coded `"1v1"`. The 2v2 card unlocks
  (art already forged).
- **Multi-queue UI ships with 2v2** — this is where the array-shaped protocol pays
  off: queue for 1v1, 2v2, or both (two toggles, one QUEUE button); the population
  count on each card tells you which is worth waiting on. Leaving the screen still
  leaves every queue (v1 simplification stands).
- **Ceremony:** `mine` is unchanged; the epilogue line grows from "the opponent" to
  the other three rows (teammate first, then both enemies).
- Room screen / wizard: already handles 2×2 seats from skirmish; the SEASON I badge,
  no-force-start and no-side-switch rules apply as they do in 1v1.

### Build order (M5)

1. ✅ Persistence: team-shaped `recordRankedMatch` + `ranked_match_players` + fixtures
   (team-mean Elo, per-member Glory, 1v1 as the size-1 case still passing).
2. ✅ Server: `groupBracket` + team split + `QueueMatch.teams`, `room.seat(team)`,
   team settle broadcast, backfill/fuzz gated per bracket; fake-socket tests for a
   4-entry match, a 4-seat void, and "2v2 never pops a bot".
3. ✅ Client: bracket selection + multi-queue + protocol v29 (ceremony epilogue —
   see as-built).
4. ☐ On-device 2v2 pass (four devices — or two humans + two skirmish-style bots in a
   dev-menu-only rehearsal, never in the live queue).

### As built (2026-08-24)

- **Persistence** (`ranked.ts`): `recordRankedMatch({ winners[], losers[] })` is
  the one path — the old `winnerId/loserId` signature is gone; the result is
  `{ winners[], losers[] }` in input order. `teamMean` lives in `elo.ts`. The header
  row's team-mean rating columns are rounded; a single-subject side writes its
  loadout verbatim (1v1 rows byte-identical to before), a team side writes a JSON
  array. `ranked_match_players` is written by BOTH writers — the bot writer includes
  the bot's fabricated row (history only; `ranked_ratings`/`glory_ledger` stay
  bot-free). `recentForm` now reads the players table; `ensureSchema` backfills it
  from pre-table 1v1 header rows on every boot (guarded, idempotent — tested).
- **Server**: `groupBracket(entries, size)` + `splitTeams` (snake: positions 0 and 3
  vs 1 and 2) in `ranked.ts`; `canGroup` is the spread-fits-longest-waiter window
  rule, `canPair`/`pairBracket` kept as its size-two readings. `RANKED_BRACKETS`
  entries carry `botBackfill`; the manager derives `BACKFILL_BRACKETS` from it for
  both `takeOverdue` and the queue-size fuzz. `Room.seat` takes an optional `team`
  (ignored on a reclaim). **Deviation:** a `queueJoin` re-send now KEEPS the wait
  earned per bracket (`RankedQueue.waitsOf` snapshotted before `leaveFirst` drops
  the entries, `enqueue` also min()s against a superseded entry) — without it,
  adding 2v2 to a 1v1 wait would have reset the 1v1 clock.
- **Client**: the standing panel grew a row of bracket pills (one ladder at a time
  — a settlement pulls focus to its bracket); both cards are live, each with its own
  count and CTA. Multi-queue is per-card rather than "two toggles + one button":
  QUEUE FOR 2v2 on a card while already searching reads ALSO QUEUE 2v2 and re-sends
  the union; CANCEL on a card leaves that line only (the last one leaves the queue).
  Live cards cap at 200 (was 230) so both keep a scene on small screens.
  `ArenaClient.lastSettlement` carries `bracket` + `others[]` (was `theirs`).
  **Not built:** the ceremony epilogue for the other three rows — the 1v1 ceremony
  never rendered the opponent's row either, so there was no line to grow; owed with
  the on-device pass if it's missed.
- Tests: persistence 23 (7 new), server 67 (12 new), all packages green.

## Abuse & integrity (v1 posture)

- **Server-authoritative everything:** results come from the sim the server ran;
  ratings and Glory are computed and written server-side; the client only ever renders.
- **Smurfing:** contained by placement K + difficulty-scaled payouts (above).
- **Win-trading / feeding:** visible in `ranked_matches` (repeat pairs, one-sided
  streaks). No automated action in v1 — audit trail first, enforcement when there's a
  population worth protecting.
- **Queue dodging:** 30 s lockout via the arm deadline — and, since 2026-08-25, via
  the match-accept stage (decline / no answer / dropped socket). Escalating lockouts
  if it becomes a pattern — deferred.

## Seasons

- `season` column everywhere from day one; server config `SEASON = 1`.
- Season I has **no end date yet** — rolling it over is a config bump plus a seeding
  policy. Sketch (decide when real): new season rows seeded at
  `1500 + (old − 1500) / 2` per bracket (soft reset), placements re-run. Old rows are
  history, never mutated.

## Build order

1. **M1 — rating core + schema** ✅ *(built 2026-07-29)*: `elo.ts` pure functions +
   `ranked.ts` DB helpers in the persistence package, bracket-keyed from day one,
   tested against fixtures and `:memory:`.
2. **M2 — server queue + ranked rooms (protocol v19)** ✅ *(built 2026-07-29)*:
   persistence dep into the game server (boots "ranked OFF" without a DB — skirmish
   untouched), token verification on `queueJoin`, per-bracket matcher on a 2s beat,
   ranked `Room` variant, void/dodge lifecycle, matchEnd settle batch + retries.
   Tested with fake sockets + in-memory DB (`apps/blood-in-the-sand-server/src/ranked.test.ts`).
3. **M3 — client** ✅ *(built 2026-07-29)*: RANKED card live; **RankedScreen**
   (standing header via `GET /ranked/me` — pulled forward from M4, unplayed
   brackets synthesized at 1500 server-side; 1v1 bracket card on the painted
   gradient fallback until the Forge art lands; queue population via `queueInfo`;
   queue/cancel + pulsing wait timer; post-void/lockout reasons surface as the
   error line; settlement banner held until the next queue). matchFound flows
   into the existing RoomScreen wizard (`ranked` prop: no force start, no side
   switch, no crowns, SEASON I badge instead of the copyable code) → match →
   VICTORY/DEFEAT plate (title + score; the settlement moved to the ceremony
   overlay 2026-08-02 — § The ceremony) → the client auto-leaves the dead
   post-match lobby back to RankedScreen, where the ceremony plays. On-device
   pass owed.
4. **M4 — ladder polish:** leaderboard endpoint + UI, tier badge art, ranked
   sounds, dodge lockout UX. Season-roll tooling and premade teams stay deferred.
5. **M5 — 2v2 solo queue** *(designed 2026-08-24, § 2v2 solo queue)*: team-shaped
   recorder + `ranked_match_players`, group matcher + dictated seating, no bots,
   bracket selection + multi-queue UI on RankedScreen.
6. **M6 — queue roaming + match accept** ✅ *(built 2026-08-25, protocol v30, § Queue
   roaming & match accept)*: `PendingMatch` accept stage before every ranked room
   (humans and bots), dodge-on-no-answer, the header queue pill + `QueueContext`,
   `MatchAcceptSheet`, roaming rules. On-device pass owed.

## Audio & art owed (Forge done-tick, per bits-audio.md)

- `queue_match_found` sting · `rank_up` fanfare · `rank_down` (subtle, non-punishing)
  · Glory payout tick on the post-match ceremony. **WIRED 2026-08-01, clips owed**: all
  four are on the sfx-bits checklist + catalogue (`queueMatchFound` on `matchReady`
  since 2026-08-25 — the accept sheet IS the match-found moment; it used to play on
  the ranked-room mount; `rankUp`/`rankDown` off the settle
  broadcast's server-computed `rankChange` — display-rung compare, so a grace-absorbed
  dip is silent and placements never fire it; `gloryEarned` with every settlement —
  a low wordless CHORAL SWELL, deliberately never a coin sound: Glory is renown and
  must not read as money (Tom, 2026-08-01; a forged coin-chink take was cut for it)).
  Silent until forged (missing-manifest rule). *(2026-08-02: all three settle sounds
  now fire from `RankedCeremony`, not GameScreen — same triggers, new stage.)*
- `ceremony_shift` **NEW 2026-08-02, clip owed**: a soft airy whoosh on the
  ceremony's crossfade from the Glory count to the rating reveal — transition
  texture, not a stinger. On the catalogue (`ceremonyShift`), silent until forged.
- ~~Tier badge art ×6~~ **FORGED + wired 2026-08-01** (`badge-bits`, shield anchor + per-tier
  dominant-colour system — asset-forge.md; `RANK_BADGES` in RankedScreen.tsx). Division
  numerals composite client-side. Squint-verified at 28px on the void: the colour ramp names
  the rank; Warlord is the darkest of the set (gold trim carries it) — the one candidate for
  a brightness re-roll if on-device testing frowns.
- ~~Bracket card art~~ **FORGED + wired 2026-07-31** (`bracket-1v1` + `bracket-2v2` on the
  mode-bits pipeline; `BRACKET_ART` in RankedScreen.tsx, locked cards greyscale the art).
- RANKED mode card already forged (2026-07-28) — it just unlocks.
