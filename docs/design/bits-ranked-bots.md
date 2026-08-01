# Blood in the Sand — Ranked Bot Backfill (Implementation Plan)

Status: **agreed direction 2026-08-01 — NOT YET BUILT, this doc is the build plan** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-08-01

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

### Bot's reported rating

`clamp(humanRating + uniform(±50), RATING_FLOOR…)`, frozen at room creation.
The human's Elo delta depends only on opponent rating and own K, so transfer
≈ K/2 ± ~7% — indistinguishable from an even human match. The fabricated bot
side of `rankedResult` uses matchesPlayed=20 → `placement: null` (a bot
opponent must never render as "in placements").

### Names

Parts-based gamer-tag generator in the **server** package — never the sim
(the sim ships in the client bundle; a datamined name list is a receipt) —
and distinct from the casual gladiator pool `BOT_NAMES` (`room.ts:61`) that
players already recognize as bot names. ~40 handle stems × 3 patterns (bare /
digit-suffixed / lowercase compound), ≤16 chars (the wire name cap). A
`BotIdentityBook` keeps a per-account ring of the last 10 names served plus a
live-rooms in-use set — no "same stranger twice in 10 minutes".

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
  `moveFactor = DIFFICULTIES[difficulty].speedFactor` → brain entry →
  `pendingBotArms.set(id, now + 2000 + rand*6000)`.
- In `step()`:
  - Gate the lobby bot-reaper (:491-494) on `!this.ranked` — it currently
    dismisses bots whenever `phase==="lobby" && timer<=0 && !armingComplete`,
    which is true the whole time the human is arming; an un-gated reaper
    removes the ranked bot on the next tick.
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
- `tendRankedRooms` needs NO change: the bot seat is `connected: true`, and
  the bot arms ≤8 s so the 60 s arm deadline only ever catches the human.

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

## Edge cases

- **Mid-match disconnect**: existing law — the body idles, the bot wipes it,
  the loss stands (`bits-ranked.md` § disconnect). No special case.
- **Multi-queue**: `takeOverdue` claims the account from every bracket
  (first-match-wins preserved).
- **`db === null`**: ranked (and therefore backfill) already off.
- **Settle failure**: existing 3× retry + `settled = true` in finally.
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
- Client-side changes: none — the disguise is entirely server-side.
