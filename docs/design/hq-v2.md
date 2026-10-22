# HQ v2 — health, and one window per player

Status: **designed + BUILT 2026-10-22** (stages 1–3, same day; stage 4
parked by Tom's decision) — owed: Tom's first look on the Render HQ,
a game-server + API deploy (the seat table, day rows and names start
recording on the first boot after it), `CLERK_SECRET_KEY` on the HQ Render
service · Applies to: `apps/hq`,
`packages/blood-in-the-sand-persistence`, one small write each in the game
server and the API · Companions: [hq.md](./hq.md) (v1: the console as built,
its two decisions still stand), [glory-economy.md](./glory-economy.md),
[bits-ranked.md](./bits-ranked.md), [bits-challenges.md](./bits-challenges.md),
[achievements.md](./achievements.md), [bits-store.md](./bits-store.md),
[bits-regions.md](./bits-regions.md).

> **The need (Tom, 2026-10-22):** there's a steady influx of players now and
> HQ isn't much use for digging into what's actually happening. Two asks:
> a better way to digest and show the state and health of the game, and the
> option to see everything about one player in a single window — match
> history, Glory, store activity, challenges, deeds, and so on.

## Why v1 falls short now

v1 was built before there were players. Every page is a set of lifetime or
last-N-days totals read from one table each. That answers "how many" and
never "is it getting better", "who", or "what happened". Specifically:

1. **No per-player view at all.** Player ids appear as `short(id)` on the
   ladder and on feedback cards and link nowhere. The data for a player
   page is mostly there already (ledgers, unlocks, counters, entitlements,
   redemptions, feedback, tokens, ranked rows) — nobody joined it up.
2. **Match history exists only for ranked.** `match_log` carries counts
   (humans, bots, rounds, duration) and no player ids, so for skirmish and
   brawl a player's history is a lifetime counter and nothing else. The
   server knows everything at settle time (every seat's account id, name,
   team, weapon, abilities, kills, deaths, damage, result) and throws it
   away.
3. **No names.** The one place a name is stored is `feedback.player_name`.
   Finding "the player who emailed" or "the one at the top of the ladder"
   means matching ids by eye.
4. **"Active" is a floor, not a history.** `last_seen_at` gives today's
   DAU and nothing older; the by-day chart puts each player on their last
   visit only. Retention (does anyone come back on day 2? day 7?) is the
   single most important health number for a game with new players arriving
   and we can't compute it.
5. **Health = totals with no comparison.** A tile that says `14` doesn't
   say whether 14 is up or down. Nothing on the dashboard says what needs
   attention today.
6. **Match quality is invisible.** Queue waits, voids, mid-match
   disconnects, rooms closed by abandonment, and ping tails live in server
   memory and in the Render log. The ranked table shows one rtt median.

## What v2 is

Four things, in build order. Stages 1 and 3 need no schema change and can
ship first; stage 2 is the small data addition that makes the match history
and the retention numbers true.

### Stage 1 — the player window (existing data only)

`/blood-in-the-sand/players/[id]`: one page, everything about one player,
sections stacked (one scroll, no tabs — Tom asked for a single window):

| Section | Reads | Shows |
|---|---|---|
| Header | `players`, `player_tokens`, `feedback` | id (copyable), name where known (stage 2 makes this reliable; until then the last feedback stamp), linked account or not, registered, last seen, device count, platform + app version from their last feedback |
| At a glance | ranked rows, counters, ledgers | tiles: matches (ranked / skirmish / brawl from counters), ranked rating + W/L per bracket, Glory balance, Signets balance, money spent (sum of `iap:` rows at list price), deeds unlocked / total, challenges cleared / 12 |
| Matches | `ranked_match_players` ⋈ `ranked_matches` (stage 2: `match_players` ⋈ `match_log`) | newest first: when, mode, bracket, result, rating before → after, loadout (weapon + abilities by name), opponents (linked), ping, duration |
| Wallet | `glory_ledger` ∪ `signet_ledger` | one chronological strip, both currencies, source decoded into words ("match win", "deed: Gravedigger", "exchanged for 1 Signet", "pack of 3, Apple") |
| Store | `signet_ledger` (`iap:`, `store:`), `entitlements` | purchases with platform + SKU + transaction id, Signet exchanges, what they own and how it arrived |
| Deeds | `achievement_unlocks`, `achievement_counters` | unlocked, with dates, grouped by board; then the nearest unfinished deeds as counter / threshold bars |
| Challenges | `achievement_counters` (`challenge:` keys) | one row per challenge: tier, cleared?, clears, attempts; the tier titles earned |
| Companions | `skirmish_companions` | who they play with and against, counts, each a link |
| Feedback | `feedback` | their reports in full |
| Codes | `code_redemptions` | what they redeemed and when |

Every player id anywhere in HQ (ladder, feedback, matches, companions,
the activity feed) becomes a link to this page.

**Players list** rebuilt as a table: search box (id prefix, name, feedback
email), columns last seen · registered · matches · ranked rating · Glory ·
Signets · spent · deeds · linked, each sortable, with filter pills (active
this week, new this week, paid, linked, ranked). Default sort: last seen.
The tiles and charts v1 has stay above it.

**Activity feed** (`/blood-in-the-sand/activity`): one chronological
stream across tables — registrations, match ends, purchases, exchanges,
unlocks, deed unlocks, challenge clears, feedback, code redemptions — each
line linking to the player. At today's scale this is the single most
useful page: it answers "what happened on the platform since I last
looked" in one glance. It's one UNION query over seven tables, newest
first, paged by timestamp, filterable by kind.

New persistence reads, all in `stats.ts` beside the existing seventeen,
`:memory:`-tested like them: `playerCard`, `playerMatches`, `playerWallet`,
`playerStore`, `playerDeeds`, `playerChallenges`, `playerFeedback`,
`playerCodes`, `playersTable`, `activityFeed`. Source decoding (ledger
`source` strings → words) is one HQ-side function in `lib/bits.ts`, next
to the SKU prices, because the sim owns names and the ledger namespaces
are an open set.

### Stage 2 — the data v1 threw away (schema, three additions)

All additive, all `CREATE TABLE IF NOT EXISTS` / `addColumnIfMissing`,
applied by `ensureSchema` on the next boot of any service. No protocol
bump — the client never sees any of it.

**1. `match_players`** — one row per human seat per online match, written
by `RoomManager.logMatch` in the same fire-and-forget call as `match_log`
(the server already holds every field at that moment):

```
match_players (
  match_id TEXT NOT NULL REFERENCES match_log(id),
  player_id TEXT NOT NULL,
  team INTEGER NOT NULL,
  won INTEGER NOT NULL,
  weapon TEXT, abilities TEXT,          -- abilities as JSON, like ranked_match_players.loadout
  kills INTEGER, deaths INTEGER, damage_dealt INTEGER, damage_taken INTEGER,
  rtt_ms INTEGER,                        -- the seat's median, as ranked already records
  PRIMARY KEY (match_id, player_id)
)  + INDEX (player_id)
```

plus two columns on `match_log`: `arena TEXT` (which map — the arenas
page nobody can build today) and `winner_team INTEGER`. Bots are not
written (bot ids are already excluded from every number). Ranked keeps
`ranked_match_players` as the rating truth; the player page reads both
and de-duplicates on match id, so ranked rows show rating deltas and
everything else shows kills and loadouts.

**2. `player_days`** — `(player_id, day) PRIMARY KEY`, one `INSERT OR
IGNORE` per player per UTC day, fired from `touchPlayerSeen` (already
throttled to once per ten minutes, so this adds at most one tiny write a
day per player). This is what makes DAU a *history* and retention
computable: D1 / D7 / D30 by registration cohort, weekly actives,
stickiness (DAU/MAU), churned-paid-players. The by-day chart stops being
a floor and says so.

**3. `players.name`** — the sanitised name the player last joined a room
with, stamped by the game server on every join (`sanitizeName` already
ran; the server already stores it per seat and logs it). Nullable; the
player page says "last seen as". No new privacy surface: the same name is
already shown to every opponent and already lands in feedback rows.

Backfill: none possible for 1 and 2 (the data was never kept); the player
page labels where each history starts, as v1 does for the match log.

### Stage 3 — the health dashboard, rebuilt

The BITS dashboard becomes a page that says *whether things are getting
better* and *what wants a look*, top to bottom:

1. **Pulse** — the same tiles as today but each carries a 14-day
   sparkline and a delta against the previous period: DAU (vs 7-day
   mean), new players, matches, human-only matches, revenue, feedback.
   Colour only on the delta, and only when it's outside noise.
2. **Attention** — a short list computed server-side, empty when all is
   well: game server offline · feedback since your last visit · a paid
   player not seen for 7+ days · ping p90 over 150 ms in a bracket ·
   queue p90 wait over 60 s · a deed in the unlock table that isn't in
   this build's defs · void rate up. Each line links to the page that
   explains it. (The "last visit" stamp is a cookie, not a table.)
3. **Retention** — a cohort grid: registration week × D1/D7/D30 (stage 2
   data; shows "from <date>" until then).
4. **Funnel** — registered → played a match → played 5 → played ranked →
   linked an account → paid. Counts and conversion, from counters,
   ratings, `clerk_user_id`, `iap:` ledger rows. Where new players drop
   off is the one chart that steers what to build next.
5. **Match quality** — human-only share, bot share, duration, abandon
   rate, queue wait p50/p90 per bracket, void rate, ping p50/p90 — the
   last four need the stage 4 event log and say so until then.
6. The two existing 30-day bar charts, kept.

A `Sparkline` SVG component joins `Bars`; no chart library — the
hand-rolled SVG has been enough and keeps the page fast.

### Stage 4 (optional) — match-quality events

A small `server_events (id, kind, player_id, bracket, value, created_at)`
written by the game server when: a queue entry is matched (value = wait
seconds), a ranked summons voids (value = who didn't answer), a human
disconnects mid-match, a room closes by abandonment. One INSERT each,
fire-and-forget, indexed on `(kind, created_at)`. This is what turns
"match quality" from a feeling into the queue-wait and void-rate lines
above, and gives bits-regions.md its second-region gate in numbers.
Deferred until stages 1–3 are in use, because it's the only one that
touches hot server paths in more than one place.

## Decisions (Tom, 2026-10-22)

1. **Names on `players`: yes.** Stamped by the game server on every
   skirmish seat claim and every ranked queue join (`stampPlayerName`,
   written only when changed). The player window falls back to the last
   feedback name and says so.
2. **Linked-account email: yes, if we have it.** `apps/hq/src/lib/clerk.ts`
   reads the Clerk user by `clerk_user_id` with `CLERK_SECRET_KEY` (the
   API's key), cached an hour per process; unset = the pill says "linked"
   and nothing more.
3. **Actions: yes.** The player window carries a Grant form (Glory or
   Signets, signed amount, a required note that lands in the ledger as
   source `hq:<note>`, idempotent on a key minted per render) and a Note
   box (`players.note`, HQ-only). Both re-check the allowlist.
4. **Stage 4: parked.** The match-quality block says which lines it's
   missing.

## As built

- Persistence: `src/profile.ts` (playerCard · namesOf · playerMatches ·
  playerWallet · playerCodes · playerDays · playersTable · activityFeed ·
  hqGrant · setPlayerNote), six health reads at the end of `stats.ts`
  (pulseByDay · playerDaysSince · retentionCohorts · funnel ·
  quietPaidPlayers · rttSummary), `recordMatchLog` takes `arena`,
  `winnerTeam` and `players`, `touchPlayerSeen` writes the day row on its
  throttled path, `listFeedback` filters by player. 15 new tests.
- Game server: `logMatch(room, winnerTeam)` builds the seat rows off the
  ranked accounts / skirmish snapshot and the match-stats accumulator;
  names stamped in `claimSkirmishSeat` and `verifyAndEnqueue`.
- HQ: Health (was Dashboard) · Activity (new) · Players (table with
  search, filters, sortable columns) · Players/[id] (the window) · every
  player id on Ranked and Feedback is a `PlayerLink`. New components
  `Sparkline`, `Pulse`, `PlayerLink`.
- Economy and Deeds reworked the same evening (Tom: "a time-ordered list
  of purchases, better display on both"). Economy: pulse tiles (revenue,
  packs, Glory minted/spent, Signets spent), who-pays tiles (paying
  players, first-time and repeat buyers, revenue ever, per payer,
  exchanges, unlocks), the **purchases list** (when, player, pack, store,
  price, transaction id; paged), revenue a day by pack, Glory and Signets
  minted-vs-spent a day, flows by source with share bars, wallet
  distribution (Glory buckets around the 800 Signet price; Signet
  buckets), top spenders, what Signets buy + latest unlocks. Deeds:
  overview tiles (bounties paid from the ledger vs the full board), unlocks
  a day, hot-this-week / rarest / commonest, orphan ids, a recent-unlocks
  feed, a challenge board (tried by, cleared by, clear rate, attempts per
  clear, from the counters), and the board by Chronicle chapter with
  share bars, first and last earned, a rarity sort. Reads: `purchases` ·
  `ledgerByDay` · `topSpenders` · `balanceBuckets` · `storeUnlocks` ·
  `economyPulse` · `deedStats` · `deedOverview` · `unlocksByDay` ·
  `recentUnlocks` · `counterTotals` (stats.ts, tested in
  `economyDeeds.test.ts`).
- Pre-existing, unrelated: three server tests in `ranked.test.ts` expect a
  30 s lockout and get 45 s; they failed before this work too.

## Not in scope

Player-facing anything · alerting (the Attention list is pull, not push)
· a second game's pages (the player window pattern is per game by
design) · editing ratings or unlocks · deleting players.

## Rules carried from v1

Direct Turso through the persistence package, never service HTTP; `bot:`
ids excluded from every player number; the allowlist on every page and
action; every new read is a `stats.ts` function with a `:memory:` test;
the clock is always passed in.
