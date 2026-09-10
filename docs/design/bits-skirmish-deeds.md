# Skirmish deeds — the Company board

*Designed 2026-09-09 (Tom + Claude). Status: **BUILT same day** (Tom: "let's
do it") — S1–S3 below; S4 (the twenty icons) owed, null slots render the
bare medallion. On-device pass owed: the lobby deed beat, the skirmish
title strip, and a real brawl round's stat shapes.*

Companion to [achievements.md](achievements.md) (the deed engine and the
ranked boards), [bits-brawl.md](bits-brawl.md) (the 6-way brawl this board
celebrates), and [bits-sands-deeds.md](bits-sands-deeds.md) (the chapter
this one borrows its shape and title rule from).

## Why

Tom, 2026-09-09: a non-trivial slice of players will only ever play
skirmish and practice, and today they never meet a deed — the Chronicle is
ranked-only, so the codex sits empty for exactly the casual players it would
hook. Three things he wants celebrated: **playing with friends**, **brawl
mode**, and **coordinated silliness** (eight fighters in a 4v4 all wielding
the same weapon — "Doppelganger"). No titles, bar possibly that one.

## The reversal, and what survives it

achievements.md § M4 retired (2026-08-08) made deeds ranked-only for two
reasons. Both still hold, and this design is built so neither is violated:

1. **Ranked is the mode to push players toward; deeds are part of its
   reward gravity.** Kept: the skirmish board pays **nothing material,
   ever** — no Glory, no items. Ranked remains the only place a deed pays
   steel or coin. What skirmish pays is codex ink: entries, chapters, one
   title. That is plenty for the casual player (who is not chasing Glory
   anyway) and changes nothing for the ranked player's incentives.
2. **Per-mode counting rules are too hard to explain.** The built-then-
   reverted version needed "milestones progress in skirmish but feats are
   ranked-only". This design needs no such sentence. The rule is:
   **ranked deeds come from ranked, skirmish deeds come from skirmish,
   practice pays nothing.** Each board is sealed: a skirmish match never
   moves a ranked counter and a ranked match never moves a skirmish one.

The zero-pay rule is the load-bearing decision. It is what makes the
friends-lobby farming policy (the old M4's hardest open question) moot:
a staged lobby can farm codex entries, and codex entries are worth exactly
what you paid to stage them. Doppelganger is *meant* to be staged.

### The milestone-crossing trap, closed properly

`evaluate()` sees each before/after counter pair once; a board's `accepts`
gate blocks the whole board. If a non-accepted context ever applies a
counter a gated milestone reads, the crossing is consumed unfired —
permanently (achievements.md § M4 retired). The reverted build exempted
milestones from the gate. This design instead **namespaces counters per
board**:

- Every skirmish counter is `skirmish:<name>`; `counterDeltas()` takes the
  summary's mode and emits ONLY that mode's namespace (ranked summaries
  keep today's keys byte-for-byte; skirmish summaries emit `skirmish:*`
  and nothing else — no `killing_blows`, no `cast:*`, no `rounds_won:*`).
- A test replaces today's "every def lives on a ranked board": *every
  milestone on a board reads a counter only that board's summaries can
  move* — ranked-summary deltas contain no `skirmish:` key, skirmish-
  summary deltas contain only `skirmish:` keys, and no skirmish def reads
  an unprefixed counter.

With that invariant the full `accepts` gate stays sound on every board,
and nobody has to remember the exemption.

## Trust and identity

Skirmish sockets carry no identity. The fix is the one the 08-08 experiment
already proved out (its notes survive in achievements.md and protocol.ts):

- `createRoom` / `joinRoom` gain an optional `token?` — the persistence
  bearer secret the client already holds from `ensureIdentity()`.
  Additive, **no protocol bump**; shipped clients simply don't send it and
  earn nothing.
- The server resolves it asynchronously (`findPlayerByToken`, the
  `queueJoin` path) into a per-room **seat → account** map. The recorded
  trap: seat ids are re-issued, so the entry is scrubbed the moment a seat
  frees, and the map the award pass reads is **snapshotted at match start**
  (seats are lobby-join only, so the set is fixed for a match).
- A seat with no resolved account plays exactly as today and is skipped by
  the award pass. A bot seat is skipped the same way.
- Free side effect: skirmish title claims can now be verified the way
  ranked's are (achievements.md § wearing titles — "skirmish takes the
  word" closes). Same `entitlementsOf` read; unowned claims stripped
  silently. Recommended, Tom to confirm.

## Anti-farm posture

Two rules, both cheap, both explicable:

- **One other human in the room.** *(REVISED 2026-09-10, Tom — was
  "humans on two distinct teams". Testing solo brawl vs five bots popped
  nothing, and the solo-vs-bots player is exactly who this board is for;
  but a lone human is still practice with extra steps.)* A skirmish match
  counts when at least two humans are seated, whatever their sides — two
  friends versus six bots is company. This is the board's `accepts` gate
  (`twoHumansInRoom`, summary-level, reads `players[].bot`). Deeds that
  need people on both sides say so themselves (Six Strangers, Full House,
  Open House, Doppelganger require no bots; Mirror, Mirror a human foe;
  the companion deeds only ever count accounts).
- **Nothing material is paid** (above). Two phones and an afternoon buy a
  full codex chapter and not one Glory.

Anything else — scripted lobbies, a friend who stands still — is accepted.
The deeds below are written knowing a staged room can earn them; the skill
ones are skill in a real room and a party trick in a staged one, and both
are fine outcomes for a board whose job is to make casual play feel seen.

## Deeds

One board, `skirmish` (`accepts: !ranked && twoHumansInRoom`), three
Chronicle chapters in reading order after *Brothers in Arms*. Titles are
placeholders in the house voice; Tom renames. Following the Blood Tide rule
(one earned title, at most one joke) and Tom's "no titles" brief, the board
pays **exactly one title — Doppelganger** — and no joke title. Counts are
kept to one chain (Tom finds count deeds boring); everything else is a
moment.

### Chapter: Good Company — playing with friends

| Deed | Criteria | Reads |
|---|---|---|
| **Well Met** | Fight a skirmish match with another human in the room. The board's root. | `skirmish:matches` ≥ 1 |
| **Regulars → Old Friends → Thick as Thieves** | Share a room with the same fighter for 5 / 25 / 100 matches. The board's one chain. | `skirmish:companion_best` (adapter, from the companions table) |
| **Both Sides Now** | Fight both beside and against the same fighter. | companions table `with` + `against` both > 0 |
| **Grudge Match** | Beat a fighter who beat you in this room's previous match. | room's last-match memory → `room.grudgeSeats` on the summary |
| **One More** | Play a third consecutive match in the same room with the same humans. | `room.matchIndex` ≥ 3 with an unchanged human set |
| **Behind Closed Doors** | Win a match in a passcode-locked room. | `room.locked` |
| **Open House** | A room of four or more seats you host reaches match end with every seat human (a hosted 1v1 would just be Well Met again). | `room.hostSeat`, `players[].bot`, `players.length ≥ 4` |
| **Full House** | Fight a 4v4 with eight humans. | `teamSize === 4`, no bots |

### Chapter: Six Enter — the brawl

All predicates additionally require `teamCount === 6`. The root milestone's
counter is structurally zero in every team-shaped room, so the single board
stays sound.

| Deed | Criteria | Reads |
|---|---|---|
| **Six Enter** | Fight a brawl. Chapter root. | `skirmish:brawl_matches` ≥ 1 |
| **One Leaves** | Win a brawl match. | `wonMatch` |
| **Six Strangers** | Fight a brawl with six humans. | no bots |
| **Clean House** | Land the killing blow on all five others in one round. | `bestRoundKills` ≥ 5 (new per-player stat) |
| **The Vulture** | Win a brawl round without landing a killing blow — they did your work, or the Blood Tide did. | `roundsWonWithoutKilling` ≥ 1 (new) |
| **Untouchable** | Win a brawl round without taking a point of damage. | `untouchedRoundWins` ≥ 1 (new; per-round damage taken) |
| **Not Today** | Kill a fighter sitting on match point while you are not. | `matchPointKills` ≥ 1 (new; reads the wins array at the lethal) |
| **Always the Bridesmaid** | Be the second-to-last standing in every round of a brawl match of 3+ rounds, and win none of them. The chapter's joke — no title. | `runnerUpRounds === rounds`, `roundsWon === 0` (new) |

### Chapter: Party Tricks — coordinated silliness

| Deed | Criteria | Reads | Pays |
|---|---|---|---|
| **Doppelganger** | In a 4v4 with eight humans, every fighter wields the same weapon. Fires for all eight, win or lose. | `players[].weapon`, no bots, `teamSize === 4` | **title** |
| **Uniform** | Win a 3v3 or 4v4 with your whole side wielding one weapon. | `players[].weapon` | — |
| **The Full Set** | Win a 4v4 with four different weapons on your side. | `players[].weapon` | — |
| **Mirror, Mirror** | Fight a 1v1 against a human carrying your exact loadout — weapon and all three abilities. | `players[].abilities` (new on the summary) | — |
| **Gentlemen's Agreement** | Finish a 2v2 or larger match in which nobody cast a single ability. | `stats[*].casts` all empty | — |
| **Nobody Wins** | Witness a double-wipe round — everyone left standing fell on the same tick. | `roundWinners` contains 0 | — |

Doppelganger's strictness is the one content call worth Tom's eye. As
written it needs eight humans, which at launch population is a genuine
party. The relaxed form — "every fighter in a 4v4, bots allowed" — is
nearly the same deed in practice (bots draft from four free weapons, so six
matching bots is a 1-in-4000 accident, one bot a 1-in-4) but lets a group
of seven pop it. Recommended: **eight humans**. A title should be hard to
stage, and "we got eight people to do this" is the story the title tells.

Twenty-two deeds, twenty icons (the chain shares one). No new SFX: the
`deed_unlock` sting already exists and the skirmish lobby needs nothing
else (bits-audio.md checked — a reveal beat reuses the ceremony's sound).

## Summary and accumulator signals (listed up front)

All **free** — accumulator or adapter only, no sim change, no protocol bump:

1. `MatchSummary` gains `teamCount` (already on sim state) and a `room`
   block the adapter fills: `{ locked, hostSeat, matchIndex, rematch:
   { beatenBy: seatId[] } }`. `MatchSummaryPlayer` gains `abilities`
   (`p.abilities` is on the seated player today).
2. New per-player stats, all derived from per-round scratch the Wave-3
   code already keeps: `bestRoundKills` (max of `round.kills` at
   `roundEnd`), `roundsWonWithoutKilling`, `untouchedRoundWins` (needs a
   per-round `damageTaken` scratch), `runnerUpRounds` (at `death`, if the
   alive set has exactly one member left you were runner-up),
   `matchPointKills` (at a lethal, the victim's team sits at
   `winsToTake − 1` in the last `roundEnd.wins` and yours does not — the
   accumulator needs `winsToTake` from the summary context).
3. Counters: `skirmish:matches`, `skirmish:brawl_matches`,
   `skirmish:companion_best`. That is the whole namespace at launch.

Persistence: one new table, `skirmish_companions (player_id, other_id,
with_count, against_count, PRIMARY KEY (player_id, other_id))` — account
ids only, no names, written for every human pair in an accepted match. The
adapter reads the player's max `with_count + against_count` and writes it
as `skirmish:companion_best` before evaluating, so the chain is an
ordinary milestone. Privacy note for the policy appendix: we now record
which anonymous accounts shared a room.

Match identity: the server mints a `matchId` per skirmish match at
`armingComplete` (ranked mints at room creation). `achievement_progress_marks`
keys on it as today, so a retry never double-applies.

## Server adapter

- `attachMatchStats` runs for skirmish rooms too, at match start, seeded
  from the seated players — and is dropped at the lobby return (bot seats
  free there; the next match seeds afresh). Today it runs once, at ranked
  seating.
- `awardDeeds` splits its context: ranked keeps the settle path untouched;
  skirmish runs on `matchEnd` with `ranked: false`, no Glory backing-out,
  no `streakUpdates`/`undyingStreakUpdates` (those are ranked counters),
  the companions write, then `evaluate` against the full def list — the
  board gates sort the rest. Failures log and never block the lobby
  return.
- `deedUnlocks` is sent per socket exactly as today. Nothing is broadcast.

## Client

- `connection.ts` pins `deedUnlocks` to `rankedResult.matchId`; skirmish
  has no settlement. It stores them keyed on the message's own `matchId`
  instead, for either mode.
- **The lobby deed beat.** Skirmish has no ceremony screen — match end
  plays the plate, then the room returns to lobby. Unlocks surface as a
  deed-card sheet over the lobby on return (the existing `DeedCards`
  reveal and `deed_unlock` sting, one card per deed, tap to dismiss), and
  are recorded as celebrated. Anything missed still replays in the
  Chronicle on entry — that path already exists and needs no change.
- Chronicle: three new chapters in `ACHIEVEMENT_CHAPTERS` after *Brothers
  in Arms*. Chapter header copy in Tom's voice (indie-voice rule): plain
  first person, no slogans.
- Skirmish join/create sends `token` when the device has one (it always
  does post-`ensureIdentity`).

## Practice stays at nothing

Practice steps the sim in-process on the device; there is no server to be
authoritative, and a client-awarded codex row would be the first
untrusted thing in a table Clerk-linking later merges. More to the point,
the gap Tom named is *exposure*: a practice-only player who sees the
skirmish room list offer deeds has a reason to press the other button.
Recommended: no practice deeds; consider a one-line nudge on the practice
screen ("deeds are earned against people — skirmish is next door") once
the board exists. Open for Tom.

## Open questions

- **The reversal itself.** This doc assumes Tom overturns the 08-08
  decision on the zero-pay terms above. If not, nothing here is built.
- Doppelganger: eight humans (recommended) or bots allowed?
- Verify skirmish title claims now that identity is on the socket? (Free;
  recommended.)
- Companions table: comfortable recording who played with whom
  (anonymous ids)? Without it, Regulars / Both Sides Now / Grudge Match go
  and the friends chapter is five deeds.
- Practice nudge copy, if wanted.

## Decisions taken at build (2026-09-09)

Tom ratified the design as written ("let's do it"); the open calls went
with the recommendations: **Doppelganger needs eight humans**; **skirmish
title claims are now verified** (stripped silently when unowned, the ranked
rule); **the companions table exists** (account ids only); **practice stays
at nothing**, no nudge copy yet.

## As built

1. **S1 — plumbing.** `token?` on `createRoom`/`joinRoom` (protocol.ts, no
   bump). Server: `Room.accounts` live seat→account map (scrubbed on seat
   free, fresh seat, kickAll, and swept after every step for seats the sim
   freed), `Room.skirmish` context (per-match `matchId` minted at the
   lobby→match transition in `step()`, snapshot `accounts`, `matchIndex`/
   `lastHumans`/`lastMatch` room memory), `beginSkirmishMatch()`,
   `onSkirmishMatchEnd` fired once from `logEvents`; `Room.titleOf`/
   `setTitle`. Manager: `claimSkirmishSeat` (async token → account, then the
   title check), `settleSkirmish` (gate → parallel reads incl.
   `companionsOf` → one summary with the room block → per-seat evaluate +
   `applyMatchAchievements` with `companions` → per-socket `deedUnlocks` →
   room memory), `awardsOf` shared with the ranked pass. Persistence:
   `skirmish_companions` table, `companionsOf`, `CompanionDelta` on the
   guarded apply batch. Sim: `counterDeltas` returns ONLY `skirmish:*` for
   non-ranked summaries; `MatchSummary.teamCount` + `room`,
   `MatchSummaryPlayer.abilities?`; new stats `bestRoundKills`,
   `roundsWonWithoutKilling`, `untouchedRoundWins`, `runnerUpRounds`,
   `matchPointKills`; accumulator takes `{ winsToTake }`.
2. **S2 — content.** `achievements/defsSkirmish.ts`: `SKIRMISH_BOARD_DEF`
   (`!ranked && twoHumansInRoom`), 22 defs, `SKIRMISH_TITLE_IDS`,
   `CHAPTERS_SKIRMISH` (Good Company · Six Enter · Party Tricks, after
   Brothers in Arms). Tests: the sealed-boards test replaced the old
   "ranked-only" one; the namespace invariant; zero-pay; a scripted 6-way
   brawl pinning every brawl stat; party tricks; the room block; the
   Regulars crossing. Server tests drive two tokened sockets through a
   locked room, a tokenless seat, and a three-match rematch run.
3. **S3 — client.** `createRoom`/`joinRoom` carry the bearer token (the
   room list awaits `ensureIdentity()` first); `deedUnlocks` outside a
   ranked match land in `client.skirmishDeeds`; `RoomScreen` mounts
   `DeedReplayOverlay` over the lobby on return and clears on done (the
   Chronicle replay covers anything missed); `deedIcons.ts` has the
   twenty null slots.
4. **S4 — art (OWED).** Twenty icons through the Forge (briefs in the
   style bible, 32px-on-void test as for the 2v2 set), then paste the
   require lines over the nulls.
