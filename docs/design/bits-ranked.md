# Blood in the Sand — Ranked, Ratings & the Queue

Status: **designed 2026-07-28 · revised 2026-07-29 · M1+M2+M3 BUILT 2026-07-29**
(rating core + schema + server queue/ranked rooms/recorder + client — protocol
v19; on-device pass + M4 ladder polish pending) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-29

> Season I: solo-queue 1v1 ranked with Elo ratings, tier badges, and Glory payouts
> scaled by opponent difficulty — reached through a dedicated ranked screen built to
> grow into multiple brackets. Companion to [glory-economy.md](./glory-economy.md)
> (identity + ledger this builds on), [monetisation.md](./monetisation.md) (what Glory
> buys), and [bits-mode-select.md](./bits-mode-select.md) (the locked RANKED card this
> finally opens). The pick ceremony ([pvp-pick-ceremony.md](./pvp-pick-ceremony.md))
> stays parked as a *future* ranked flavour — Season I uses the standard arming wizard.

## Decisions locked

1. **Brackets, each with its own rating** *(revised 2026-07-29)*. A bracket is a ranked
   format — `1v1` now; `2v2`, `3v3`, premade-team ladders later. **A player's rating is
   per-bracket**: 1700 in 1v1 and 1400 in 2v2 coexist, so a bad 2v2 teammate can never
   dent your 1v1 number. Season I ships the `1v1` bracket only.
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
- **K-factor schedule:** `K = 40` for a player's first **10** matches *in that bracket*
  this season ("placement" — new accounts and smurfs settle fast), `K = 20` after.
  Both sides use their *own* K.
- **Placements hide the numbers** *(decided 2026-07-30)*: until the 10 placement
  matches are done, the client shows NO rank and NO rating anywhere — the ranked
  home shows placement progress ("N/10 · X matches until your rank is forged") and
  the match-end plate shows "PLACEMENT MATCH N OF 10 · +Glory" instead of the Elo
  movement. Sells the reveal, and stops players reading meaning into a 1500 that
  hasn't converged. Server-driven: `/ranked/me` carries `placementsLeft`,
  `rankedResult` rows carry `placement {number, of} | null` — the client never
  re-implements the threshold.
- All math is **pure functions** — a new
  `packages/blood-in-the-sand-persistence/src/elo.ts` (no DB imports), unit-tested with
  known fixtures. The server calls it; nothing else re-implements it.
- **Team brackets (future, stated now so shapes don't box us in):** solo-queue team
  brackets rate each player *within that bracket* — a team's strength is the mean of
  its members' bracket ratings, and every member updates against the enemy mean with
  their own K. **Premade teams** are a different thing again: the named team itself is
  the rated subject with its own row (see Persistence) — a WoW-arena-team-style ladder.

### Tiers

Bands over the rating number, arena-flavoured — 8 tiers *(revised 2026-07-29: rebanded
around the 1500 start, deeper ladder)*. Badge + name are presentation only — no
gameplay effect, no promotion matches (the number is the truth). Tiers are per-bracket,
same bands everywhere.

| Tier | Rating |
| --- | --- |
| **Initiate** | < 1300 |
| **Pit Fighter** | 1300–1399 |
| **Blooded** | 1400–1499 |
| **Gladiator** | 1500–1599 |
| **Veteran** | 1600–1699 |
| **Champion** | 1700–1849 |
| **Warlord** | 1850–1999 |
| **Immortal** | 2000+ |

A fresh player starts mid-table as a Gladiator-in-waiting (1500 sits at the Gladiator
floor) — placements sort them fast. Tier art + a `rank_up` moment are owed to the Forge
(see Audio & art owed).

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
  placement K = 40 — ten matches and they've rated out of the low bands. Accepted.

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
- **v1 simplification:** leaving RankedScreen (or losing the socket) leaves the queue.
  Queueing-while-roaming-the-app is future polish.

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
- **Queue is ephemeral by design:** a server deploy drops queues along with rooms
  (accepted in glory-economy.md's topology). Client treats a dropped socket while
  queued as "requeue with one tap", never an error screen.

### Match found → ranked room

On a pairing the server creates a **ranked room** in-process and seats both players —
same `Room` machinery, different rules:

| | Skirmish | Ranked |
| --- | --- | --- |
| Discovery | listed / code / passcode | never listed, unjoinable, no code shown |
| Host | host powers + migration | no host — server owns the room |
| forceStart / cancelStart | host / any-seated | disabled |
| Bots | backfill on forceStart | never |
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
- **`subject_id` is what's being rated**: a player id in solo-queue brackets, a
  **team id** in future premade-team brackets (teams get their own table when built —
  `teams: id · name · member player_ids`). The bracket key tells you which kind of
  subject its rows hold, so no `subject_type` column is needed and today's queries stay
  plain. Solo and premade versions of the same size are distinct bracket keys by
  construction.
- `ranked_matches` is the audit trail *and* the analytics tap monetisation.md asked
  for ("log per-weapon pick rate + win rate at match end from day one") — loadouts as
  JSON (an array once team brackets exist), queried offline, no new pipeline.
- Leaderboard = `ORDER BY rating DESC LIMIT n` per bracket (index on
  `(season, bracket, rating)`).

### API additions (`apps/blood-in-the-sand-api`)

```
GET /ranked/me                     → { season, brackets: [{ bracket, rating, tier,
                                       wins, losses }] }                  (bearer)
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
  bracket, winnerTeam, results[] }` after matchEnd. Matched accounts auto-leave
  their other queues (first match wins).
- Ranked rooms reject `forceStart` / `cancelStart` / `switchTeam` / outside
  `joinRoom` (the mid-match rejoin of a disconnected seat is the one exception).

## Abuse & integrity (v1 posture)

- **Server-authoritative everything:** results come from the sim the server ran;
  ratings and Glory are computed and written server-side; the client only ever renders.
- **Smurfing:** contained by placement K + difficulty-scaled payouts (above).
- **Win-trading / feeding:** visible in `ranked_matches` (repeat pairs, one-sided
  streaks). No automated action in v1 — audit trail first, enforcement when there's a
  population worth protecting.
- **Queue dodging:** 30 s lockout via the arm deadline. Escalating lockouts if it
  becomes a pattern — deferred.

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
   the VICTORY/DEFEAT plate carries a gold settlement line (rating movement +
   Glory) → the client auto-leaves the dead post-match lobby back to
   RankedScreen. On-device pass owed.
4. **M4 — ladder polish:** leaderboard endpoint + UI, tier badge art, ranked
   sounds, dodge lockout UX. Season-roll tooling, multi-queue UI, premade teams
   stay deferred.

## Audio & art owed (Forge done-tick, per bits-audio.md)

- `queue_match_found` sting · `rank_up` fanfare · `rank_down` (subtle, non-punishing)
  · Glory payout tick on the post-match ceremony.
- Tier badge art ×8 (dark-fantasy woodcut set, style bible).
- **Bracket card art:** `1v1` live card + locked future-bracket cards (mode-bits type,
  900×360, right-anchored crop — same pipeline as the mode cards, 2026-07-28).
- RANKED mode card already forged (2026-07-28) — it just unlocks.
