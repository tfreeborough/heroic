# Blood in the Sand — Ranked Bot Backfill (Implementation Plan)

Status: **BUILT 2026-08-01** (steps 1–7 including the ceremony hold + client
touches; on-device pass owed — see § verification) ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-01

Build-time deviations (all minor):

- Persistence: the SQL snippet builders (`ratingUpsert`/`gloryInsert`/
  `matchInsert`) were hoisted to module level so both writers share them —
  no behavior change. The bot's fictional prior is wins 10 / losses 9
  (19 played → settled K; `sideOf` then reports matchesPlayed 20).
- Manager: a `requeued()` helper stamps the fresh `botAtMs` on BOTH requeue
  paths (void + dead-socket) and strips it when the switch is off.
- Fuzz rides a shared `queueStatusFor()` wrapper covering all four
  queueStatus sends, not per-payload edits.
- The bot side's fabricated `rankedResult` glory is the real formula's value
  (not 0) — a wire inspector sees a plausible payout.
- The existing ranked-flow test suite is pinned to a kill-switch-off config
  (it asserts honest queue numbers); the lifecycle test now asserts the
  ceremonyOver close + "match complete" roomClosed.

> "when a player enters the ranked 1v1 queue we try to match them with a player
> if there is one in the queue to match with, but if there isn't maybe we could
> have them play against the AI but style the AI in a way that they seem like a
> real player." (Tom, 2026-08-01)

Early-population ranked queues will often be empty, and an empty ranked queue
kills the game's perceived liveness. When a ranked 1v1 queuer finds no human
opponent within ~15–25 s, match them against a server-side bot styled as a
real player. Temporary by design: every dial is env-tunable and the whole
feature has a kill switch for when the population can carry itself.

## Product posture (decided 2026-08-01)

- **Soft disclosure** (the Fortnite model): ToS/FAQ will state matches "may
  include AI opponents during low-population periods"; in-game the bot
  presents as a player — human-plausible name, zero bot markers on the wire.
  If discovered, the story is "we said we do that", not "we lied". The copy
  itself is owed (website/store listing, not this repo).
- **Full rating impact**: bot matches count for Elo exactly like human
  matches; bot *difficulty* scales with the player's rating, so climbing means
  fighting harder bots.
- **Trigger**: only after the human pairing pass fails, on a per-entry
  jittered threshold of 15–25 s (mobile players won't wait 30–90 s; an
  always-exactly-20s pop is itself a tell).
- **Queue-size display**: fuzz the number **server-side** so "1 in queue →
  match found" never appears. This REVERSES bits-ranked.md's "honest numbers
  only" queue-feedback rule (decision-log it there when building). Server-side
  keeps the fabrication out of the datamine-able client bundle and ties it to
  the kill switch — when backfill goes, honest numbers come back automatically.
- **Kill switch**: env config; ops can disable without a build.

The bot AI already exists and is production-quality (`bot-brains.md`:
`botThink`, 8 execution-quality tiers in `botDifficulty.ts`, archetypes,
nav). Bots already backfill casual matches and run practice mode. This task
is **plumbing + disguise, not AI work**.

## Key design decisions

### Bot identity: synthetic subjects, one-sided settlement (NO players rows)

Each bot match uses a throwaway subject id `bot:<uuid>` written ONLY into
`ranked_matches.winner_id/loser_id`. Verified: `ranked_matches` and
`ranked_ratings` have no FKs (`packages/blood-in-the-sand-persistence/src/db.ts:68-99`);
only `glory_ledger` references `players(id)`, and the bot never gets a glory
row. A new writer `recordRankedBotMatch` settles the human's side only.

Why not real bot accounts:

1. The future leaderboard reads `ranked_ratings` directly
   (`bits-ranked.md` § API additions) — a forgotten filter would put bots ON
   the leaderboard, the classic discovery receipt.
2. `recordRankedMatch` re-reads the opponent's rating from the DB, so a bot
   row would need pre-seeding near the human's rating and would drift.
3. A fresh row has matchesPlayed=1 → the human's post-match plate would show
   every bot opponent "in placements" — a hard tell.

One-sided settlement gives exact Elo control, zero ladder contamination, and
a DB that stays honest for auditing (consistent with soft disclosure).

### Difficulty ← rating mapping

Aligned to the Elo tier bands (`elo.ts`): `<1200` novice · `1200–1349`
average · `1350–1449` experienced · `1450–1599` skilled (start rating 1500
lands here) · `1600–1749` adept · `1750–1899` masterful · `1900–2049`
inhuman · `≥2050` godlike.

Note: these are a standalone 8-way split, NOT the `elo.ts` TIERS (six tiers,
floors 1300/1450/1600/1750/1900) — four cut points coincide, the rest don't.
In ranked the top two bands lose their practice-mode speed edge (see
`seatRankedBot` below), so they differ from practice inhuman/godlike.

### Bot's reported rating

`clamp(humanRating + uniform(±50), RATING_FLOOR…)`, frozen at room creation.
The human's Elo delta depends only on opponent rating and own K, so transfer
≈ K/2 ± ~7% — indistinguishable from an even human match. The fabricated bot
side of `rankedResult` uses matchesPlayed=20 → `placement: null` (a bot
opponent must never render as "in placements").

### Names — the rotating roster *(reworked 2026-08-02)*

A fixed **96-name roster** in the **server** package — never the sim (the sim
ships in the client bundle; a datamined name list is a receipt) — and distinct
from the casual gladiator pool `BOT_NAMES` (`room.ts`) that players already
recognize as bot names. Curated from the texture of real EU WoW ladder
top-500 handles (Tom's call — the first invented-stem cut didn't sell):
accent-marked tags (Krôna, Doînk), spelled-number suffixes (Rycntwo),
confident plain words (Totemfear, Spongeman). Generic handles lifted
near-verbatim, distinctive ones mutated; excluded: famous-player references,
real-name lookalikes, Cyrillic (device font risk). ≤16 chars (the wire cap),
flavours interleaved around the ring so any online window reads mixed.

*(v1 was a parts-based generator — infinite fresh strangers, which is itself a
tell once you play a lot. Tom, 2026-08-02: static names that keep hours.)*

**Rotation — a population that keeps hours:** 4 names are "online" at any
moment; at the top of each hour 2 clock off and the next 2 on the ring clock
on (`onlineNames`). Each name works a **2-hour shift**, and the ring cycles
every `ROSTER.length/2` hours — at 96 names a **48-hour cycle**, so each
regular shows up every OTHER day (Tom, 2026-08-02: sized up from 48/daily
once the real-handle source made curation cheap — real people don't play
daily, and an every-evening player now sees two alternating casts instead of
the same metronomic four). The ring's first two names work the
cycle-wrapping night shift. Pure function of wall-clock hour: restarts never
reshuffle who's on.

**`BotIdentityBook` (the front desk)** serves `{name, rating}` under three
rules:

- **Never the same stranger twice in a row** per account (was: a 10-name
  ring). A re-match with one game in between is *allowed* — that's exactly
  what a small real population feels like.
- **Never a name already fighting** in a live room (release on room close).
  If the whole online window is busy or ruled out, the next names on the ring
  come online early — exhaustion is impossible.
- **A coherent rating per shift**: the first serve anchors the name's
  advertised rating at the human's ±jitter (`mirrorRating`, as before);
  every later serve in the same 2-hour shift reuses it with a ±8 drift ("been
  playing since you last met") instead of re-mirroring — a recurring name
  whose rating tracked *your* rating would be a tell. If an anchored name
  sits >100 from the queuing human, the book skips it and a fresh name logs
  on early rather than teleporting the rating.

### Anti-tell details (wire hygiene audit)

- `RoomStatePlayer.bot` is broadcast (protocol v15) and drives the client's
  roster bot markers → mask to `bot: false` for EVERYONE in ranked rooms in
  `Room.roomStateFor` (`room.ts:577`). No protocol bump; the sim stays pure.
  Match snapshots carry no bot field (verified `snapshot.ts:41-69`) — clean.
- Bots currently report `seq: 0` forever (`room.ts:535`) → ranked bot seats
  get a climbing input seq.
- Don't insta-arm: seat the bot unarmed, arm it 2–8 s later — humans take
  time to pick a loadout.
- Announcer `"default"`; `[bot]` marker in server logs only.
- Queue-size fuzz applies to `queueStatus` AND the unauthenticated
  `queueInfo` (RankedScreen shows sizes before queueing — the two must
  agree). Slow-varying plausible baseline; dead when the kill switch is off.
- **Accepted risk** (Tom, 2026-08-01): the HTTP root's `"${roomCount()}
  room(s) open"` (`main.ts:45`) counts ranked rooms and can contradict the
  fuzzed queue numbers for anyone polling it. Deliberately NOT fuzzed —
  cross-checking an unauthenticated status endpoint is beyond the audience
  this disguise targets, and soft disclosure covers discovery. Don't "fix"
  this during the build.

### Match end: server closes the room — ranked rooms never return to lobby

(decided 2026-08-01) The sim's matchEnd→lobby transition frees every bot
seat in the same tick it flips phase (`round.ts:230-234`) — right for casual
(a rematch re-seats fresh bots), but in ranked the defeated "player" would
evaporate from the roster. Today the client dodges this by leaving the room
itself when it sees the phase flip (`connection.ts:311-314`) — a
client-inferred flow with a real race: the leave is gated on `rankedResult`
having already arrived and is a one-shot on the transition, so a slow settle
strands the player in a ghost arming lobby facing an empty seat
(pre-existing bug for human ranked matches too; late `rankedResult` never
re-triggers the leave).

Fix at the source, server-authoritative: a ranked room never steps the sim
past the ceremony. When `phase === "matchEnd"` and the timer would expire
this tick, the room holds the final frame instead (`ceremonyOver`); the
lobby return — and its bot-nulling — simply never executes in ranked (sim
package untouched). The manager closes the room once settled, and that
`roomClosed` broadcast IS the "match over, leave" signal for every client.
`lastSettlement` survives room close by design (`connection.ts:196-201`), so
the client lands on RankedScreen with the plate intact.

## Implementation steps

### Step 1 — persistence: `recordRankedBotMatch`

`packages/blood-in-the-sand-persistence/src/ranked.ts`:

```ts
export interface RankedBotMatchInput {
  matchId: string; season: number; bracket: string;
  humanId: string; humanWon: boolean;
  botId: string; botRating: number;
  humanLoadout?: unknown; botLoadout?: unknown;
}
export const recordRankedBotMatch =
  async (db: Db, input: RankedBotMatchInput): Promise<RankedMatchResult | null>
```

Same matchId idempotency probe as `recordRankedMatch` (:111-116); `getRating`
for the human only; Elo vs `botRating` via existing `updateRating`; batch =
human rating upsert + `ranked_matches` row + ONE human glory row. Fabricate
the bot's `RankedSideResult` purely (before=botRating, after via
`updateRating` with matchesPlayed=20, peak=max of the two, matchesPlayed=20).
Same return shape as `recordRankedMatch` so the broadcast path is shared.
Export from `index.ts`.

Tests (persistence `ranked.test.ts`): correctness, replay no-op, NO bot rows
ever appear in `ranked_ratings`/`glory_ledger`, `leaderboard()` unaffected.

### Step 2 — new `apps/blood-in-the-sand-server/src/botBackfill.ts`

- `BotBackfillConfig` + `botBackfillConfigFromEnv`:
  `RANKED_BOT_BACKFILL` (default ON; `0|off|false` disables),
  `RANKED_BOT_MIN_WAIT_MS` (15000), `RANKED_BOT_MAX_WAIT_MS` (25000),
  `RANKED_BOT_RATING_JITTER` (50).
- `difficultyForRating(rating)` (bands above), `mirrorRating(humanRating,
  jitter, rand)`, `botSubjectId()`, `BotIdentityBook` (pick/release), and the
  queue-size fuzz function.
- Pure with injectable rand. Unit tests: band edges, floor clamp, name
  repeat-avoidance and ≤16-char length.

### Step 3 — `apps/blood-in-the-sand-server/src/ranked.ts`

- `QueueEntry.botAtMs?` — set at enqueue: `now + minWait + rand*(maxWait-minWait)`.
- `RankedQueue.takeOverdue(nowMs, brackets)` — splice overdue entries and
  `removeAccount` from every bracket (mirror of `match()` :151-165, same
  claim-immediately rule for multi-queue).
- Requeue paths keep `joinedMs` (earned wait) but get a FRESH `botAtMs` — a
  void must never pop an instant bot.
- Tests alongside the existing `RankedQueue` describe.

### Step 4 — `apps/blood-in-the-sand-server/src/room.ts`

- `botSeats` value → `{ memory, difficulty, seq }` (casual forceStart passes
  `DEFAULT_DIFFICULTY`).
- `RankedSeatAccount.bot?: boolean`.
- New `seatRankedBot(name, difficulty, nowMs): number | null` — `addBot`
  (production addPlayer path, sim `sim.ts:186`) → announcer `"default"` →
  `moveFactor = 1` — **never** `DIFFICULTIES[difficulty].speedFactor`
  (decided 2026-08-01): inhuman/godlike carry 1.05/1.10, a 5–10 %
  super-human run speed that is measurable off snapshot positions AND
  unfair where Elo is at stake. Ranked bots play with human stats at every
  band; difficulty is brain-only (the original even-stats rule). Practice
  and casual keep their speedFactor tuning untouched. → brain entry →
  `pendingBotArms.set(id, now + 2000 + rand*6000)`.
- In `step()`:
  - Gate the lobby bot-reaper (:491-494) on `!this.ranked` — it currently
    dismisses bots whenever `phase==="lobby" && timer<=0 && !armingComplete`,
    which is true the whole time the human is arming; an un-gated reaper
    removes the ranked bot on the next tick. (Post-match this gate is moot —
    see the ceremony hold below — but the pre-match arming lobby is a real
    lobby phase and still needs it.)
  - **Ceremony hold** (§ match end above): before stepping the sim, if
    `this.ranked && round.phase === "matchEnd"` and the timer would expire
    this tick, skip the sim step and set `ceremonyOver = true` (public
    readonly for the manager). The room keeps broadcasting the frozen final
    frame; the sim never reaches lobby, so `round.ts:230-234` never nulls
    the bot seat mid-plate.
  - Drain `pendingBotArms` past-deadline by drafting a loadout from the sim
    rng exactly like `forceStartMatch`'s sweep (`round.ts:124-133`). Once
    both seats are armed, the sim's own `armingComplete` → 5 s countdown
    fires with no other plumbing (ranked's `forceStart` rejection stays).
- `thinkBots` (:527): per-seat snapshot staleness
  `history.stale(DIFFICULTIES[difficulty].reactionTicks)`, pass the
  difficulty preset to `botThink` (5th arg, `bot.ts:241-247`), submit with
  `seq: ++seat.seq`.
- `roomStateFor` (:577): mask `bot: false` when `this.ranked`.

### Step 5 — `apps/blood-in-the-sand-server/src/manager.ts`

- Constructor takes `botCfg` + `identityBook` (test-injectable); boot log
  line in `main.ts`.
- `verifyAndEnqueue` (:325) and both requeue sites (void :448-457,
  dead-socket :372) set `botAtMs`.
- `rankedBeat` (:359): AFTER the `queue.match()` pairing loop,
  `takeOverdue(now, ["1v1"])` → `createRankedBotRoom(bracket, entry, now)` —
  human pairing always wins the beat. The new method mirrors
  `createRankedRoom` (:368): guard live socket, mint matchId, `matchFound` →
  seat human → `seatRankedBot` → BOTH `accounts` entries (bot entry:
  `accountId: botSubjectId()`, `bot: true`, mirrored rating) so the
  `settleRanked` guard (:480) passes. `[bot]` marker in the server log only.
  Leave a TODO hook here for v2 population-awareness ("skip when queue
  size ≥ N").
- `settleRanked` (:472): branch to `recordRankedBotMatch` when either account
  has `bot: true`; retry loop + `rankedResult` broadcast unchanged.
- `voidRanked` (:436): skip bot accounts (no lockout, no requeue); release
  the bot's name on room close.
- **Required fix (pre-existing gap, now load-bearing)**: `reconcileHost`'s
  ranked branch (:205-207) closes a deserted ranked lobby with NO dodge
  lockout. With a bot opponent, a human leaving the arming lobby makes the
  room instantly deserted (`isDeserted` ignores bots, `room.ts:179`) → they
  would dodge free, every time. Change to `voidRanked(room, now, () => true)`
  when deserted + un-ended + lobby phase (the accounts map still holds the
  departed human, so the lockout lands; also fixes the pre-existing
  both-humans-bail gap).
- Queue-size fuzz in the `queueStatus`/`queueInfo` payload assembly, gated on
  the kill switch.
- `tendRankedRooms` close condition (:413-418): replace
  `phase === "lobby" && ctx.settled` with `room.ceremonyOver && ctx.settled`
  — load-bearing, not optional: ranked rooms no longer reach lobby (ceremony
  hold), so the old condition would leak every ended room. Worst case the
  plate holds a frozen frame ≤2 s longer (one matcher beat) or until the
  settle retry loop resolves (`settled` is set in the finally either way).
  The arm-deadline / someone-gone branches are unchanged: the bot seat is
  `connected: true`, and the bot arms ≤8 s so the 60 s arm deadline only
  ever catches the human.

### Step 5b — client: `roomClosed` lands the ceremony

`apps/blood-in-the-sand/src/net/connection.ts` — two small touches, OTA-able:

- `roomClosed` handler (:296): when a ranked settlement is in hand
  (`rankedResult` set for this match), do NOT surface the close reason via
  `lastError` — RankedScreen renders `lastError` as an error line
  (`RankedScreen.tsx:396`), and under the server-close design EVERY ranked
  match now ends with `roomClosed`, so "match complete" would render as an
  error under the plate, every match. Route to RankedScreen with the plate,
  quietly.
- Keep the phase-flip leave (:311-314) as belt-and-braces for rollout
  ordering (an old server still steps ranked sims to lobby), and mirror its
  guard into the `rankedResult` case (:335): if the settlement arrives when
  `phase` is already `"lobby"` in a ranked room, leave then — closes the
  ghost-lobby race against old servers. Against the new server both paths
  are dead code; delete once the server is deployed everywhere.

### Step 6 — docs

- `bits-ranked.md`: flip the "Bots | never" row (:270) and decision-log the
  queue-size "honest numbers only" reversal, dated.
- This doc: update Status to built, record any build-time deviations.
- Cross-ref from `bits-bot-backfill.md`.

### Step 7 — integration tests

`apps/blood-in-the-sand-server/src/ranked.test.ts`, existing FakeSocket +
`:memory:` DB + `internals(manager).rankedBeat()` harness (lines 74–130),
with injected tiny-wait config:

- Lone queuer → bot room; serialized roomState contains no `"bot":true`; bot
  input seq climbs.
- Two humans in queue → paired with each other, never a bot.
- Kill switch off → no bot ever; queue sizes honest.
- Settle both directions (drive `room.onRankedMatchEnd` like the existing
  test at :236): human rating/glory recorded, DB one-sided, bot side
  `placement: null`.
- Lobby-leaver eats the dodge lockout (the reconcileHost fix).
- 60 s arm-deadline void; fresh `botAtMs` on requeue; distinct bot names
  across consecutive matches.
- Ceremony hold: after `matchEnd`, a ranked room never broadcasts a
  `round.phase === "lobby"` snapshot; the bot seat is present in every
  snapshot through the ceremony; `roomClosed` is sent only after
  `rankedResult`, and the room is removed from the manager (no leak).

## Edge cases

- **Mid-match disconnect**: existing law — the body idles, the bot wipes it,
  the loss stands (`bits-ranked.md` § disconnect). No special case.
- **Multi-queue**: `takeOverdue` claims the account from every bracket
  (first-match-wins preserved).
- **`db === null`**: ranked (and therefore backfill) already off.
- **Settle failure**: existing 3× retry + `settled = true` in finally. With
  the ceremony hold the room just keeps the frozen final frame until the
  retry loop resolves, then closes — a few extra seconds on a static plate.
- **Human leaves during the ceremony**: the match is already ended and
  settled (or settling) — `reconcileHost`'s deserted-close applies; the
  voidRanked fix targets un-ended lobby-phase rooms only, so no lockout for
  leaving after the result.
- **Future fair-matching mode** (`MATCH_ANYONE=false`): two mutually
  out-of-window humans can each draw a bot — acceptable; they survived the
  pairing pass by definition.

## Rollout / removal path (no code changes)

Raise `RANKED_BOT_MIN/MAX_WAIT_MS` as population grows, then
`RANKED_BOT_BACKFILL=off`. The queue-size fuzz dies with the kill switch.
Population-aware thresholds are v2 (env hook left in `rankedBeat`).

## Verification

- `bun test` at root (packages) AND `cd apps/blood-in-the-sand-server && bun
  test`; `bun run typecheck` at root.
- Local E2E: `RANKED_BOT_MIN_WAIT_MS=2000 RANKED_BOT_MAX_WAIT_MS=4000 bun run
  dev` in the server (local file DB auto-creates), mint a token via API
  `POST /register`, queue from the app's RankedScreen, confirm: match pops in
  ~2–4 s, opponent looks human (name, no roster marker, arms after a delay),
  match plays, settlement plate + `/ranked/me` reflect the rating change.
- `scripts/bot.ts` has no queueJoin support — the FakeSocket suite is the
  headless driver (extending bot.ts with `--ranked --token` is an optional
  follow-up harness).

## Owed

- ToS/FAQ disclosure copy ("matches may include AI opponents during
  low-population periods") — website/store listing, outside this repo.
- Population-aware trigger (v2).
- Client-side changes: the *disguise* is entirely server-side; the only
  client work is Step 5b's two `connection.ts` touches (roomClosed error
  suppression + belt-and-braces leave), both OTA-able.
