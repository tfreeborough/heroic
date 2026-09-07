# The 6-Way Brawl — six enter, one leaves (free-for-all)

*Designed 2026-09-03 (Tom + Claude). Status: BUILT same day (protocol v32) —
on-device pass and combat-pacing tuning owed. Renamed from "Melee" and moved
from its own mode-select card into the Skirmish flow the same day (below).*

## Why

Every mode today is two sides of a mirror. Brawl is the third shape: **six
players, each their own team, last one standing wins the round**. The drama it
buys is the one team modes can't produce — third-party politics. Two fighters
commit, a third circles the winner, alliances of convenience form and betray
themselves in the same breath. The feasibility audit (2026-09-01) found the
engine already mostly speaks this language: every enemy/ally check in the sim
is relational (`p.team !== me.team`), so combat, abilities, friendly-fire,
relative colours, and — crucially — the bot brains all work for N teams
unchanged. Untouched bots in a 6-way will naturally produce the classic
"gang the leader" dynamic, because "nearest/weakest enemy" simply has more
candidates.

The Closing Sands (built the same week, happily) is the missing FFA
ingredient arriving on schedule: a 6-way round can't stall into a
circle-each-other standoff because the blood tide ends the argument.

## Ratified decisions

- **Six teams of one.** `teamCount = 6, teamSize = 1`. Six is the number
  because a square arena seats six symmetrically where five never sits right,
  and 6 players is inside every existing capacity assumption (a 4v4 room
  already holds 8).
- **First to 2 round wins takes the match** (team modes stay first to 3).
  Six contenders spread wins out; first-to-3 could run 13 rounds worst case,
  first-to-2 tops out at 7 and typically lands 2–4. The multi-round rhythm
  (arming, round plates, comeback arcs) survives.
- **A room shape inside Skirmish, not a mode of its own.** (REVERSED
  2026-09-03, same day — the first cut gave Brawl its own mode-select card;
  Tom folded it into Skirmish instead: it's casual rooms either way, a fifth
  card crowds the PLAY fork, and no forged card art is needed.) The create
  sheet's size row reads `1v1 / 2v2 / 3v3 / 4v4 / BRAWL`; brawl rooms list
  beside team rooms with a red **6-WAY BRAWL** tag on the row. Practice's
  MATCH SIZE row gains the same BRAWL chip, so the mode is learnable offline
  against bots (and testable on a plane).
- **Hex ring spawns.** Six anchors on a circle around arena centre —
  identical neighbour distances, identical exposure, and `spawnFacing`
  already points everyone at the middle: six fighters stepping out of the
  crowd toward the centre. Authored in Realmsmith as ordinary `playerSpawn`
  objects carrying `props: { team: 1..6, brawl: true }` — a separate anchor
  set, because the classic pair lives on diagonal corners and stays exactly
  where it is for team modes.
- **Unranked at launch.** Elo is pairwise; ranked/queue/match-accept are
  never entered by a Brawl room. Deliberated 2026-09-03: a ranked brawl
  would need 6 humans queued at once (the launch population can't fill a
  4-human 2v2 without bots), invites collusion/kingmaking, and needs a
  placement-based rating — while the bracket architecture already makes a
  future `"brawl"` ladder purely additive, so nothing is pre-built. If it
  proves popular: a seasonal wins leaderboard (no rating to corrupt, scores
  ordinary rooms) before any Elo-style ladder.
- **Team = seat.** No balance logic, no coin flip: seat *n* is team *n+1*.
  This sidesteps the rngDraws determinism contract (the 2-team balance flip
  consumes a sim RNG draw; Brawl consumes none) and makes join order
  irrelevant. `switchTeam` is meaningless (every other team is full) and is
  ignored in Brawl rooms, the same way ranked rooms already ignore it.
- **No faction names.** Six single-player "factions" named from the pool
  would be noise — in Brawl your name *is* your banner. The lobby and
  pre-round hint drop the `X vs Y` line for a fixed epigraph:
  **SIX ENTER. ONE LEAVES.** (Fewer than six seated via force-start: the
  line stays; it's a motto, not a headcount.)
- **Double wipe replays.** If the sands (or a mutual kill) wipe the last two
  on the same tick, nobody scores and the round replays — the existing
  2-team rule, generalised: round ends when **at most one team has a living
  member**, which *is* last-one-standing.

## The engine (from the audit — ~15 localized edits)

Already N-team-agnostic, zero changes: all combat/ability checks, bot
targeting and brains (a lone-team bot rides the existing 1v1 "last stand,
never flee" path — correct), relative body colours (you blue, all five
others red — the protocol v16 flip), per-team roomState fanout, spawn
formation math (teams of 1 stand exactly on their anchor), the arming
wizard, announcer/kill feed/killstreaks, achievements event ingestion, the
Closing Sands.

The 2-team hardcoding to generalise:

- `Team = 1 | 2` widens to `1..6` (state.ts) — then the compiler surfaces
  every remaining assumption.
- Tuples become arrays sized by team count: `round.wins`, `teamNames`,
  `zone.spawns`, the `roundEnd` event's `wins`.
- `teamCounts` / `teamSizeOf` read the room's `teamCount` instead of
  assuming `players.length / 2`.
- `checkRoundOver` → "count teams with a living member; ≤ 1 ends the round".
- `matchEnd` winner → argmax over the wins array (ties can't happen at
  first-to-N by construction).
- `forceStartMatch` → "≥ 2 distinct teams seated" instead of "a body on
  team 1 and team 2".
- `addPlayer` → pinned seat teams when `teamCount > 2`; the 2-team balance
  path is byte-identical to today (replays/seeds unaffected).
- Room shape becomes `(teamCount, teamSize)`: classic rooms `(2, 1..4)`,
  Brawl `(6, 1)`. Server room create + practice take the shape; bot
  backfill (`forceStart` seat-filling) rides `addPlayer` and just works —
  five bots, five separate teams.
- `deriveArenaZone` picks the anchor set by team count: the classic
  diagonal pair, or the six `brawl: true` anchors (throws if the map lacks
  them, same as today). Realmsmith's "only the first spawn is used" warning
  relaxes to understand team-tagged sets.

## Wire — protocol v32

`welcome` gains `teamCount`; `roundEnd.wins` and `welcome.teamNames`/
`RoundSnapshot.wins` become variable-length arrays (JSON-identical to
today's tuples in 2-team rooms, so classic rooms stay compatible; old
clients simply can't join Brawl rooms — the version bump's job). No new
per-tick cost: snapshots already carry `team` per player.

## Presentation

- **Entry**: the Skirmish room list — the BRAWL chip on the create sheet's
  size row (with a one-line "six enter, one leaves" hint when selected), and
  the red 6-WAY BRAWL tag on listed brawl rooms. Gate = connectivity
  (Skirmish's rule). No mode-select changes.
- **Lobby**: one roster block of six rows — you highlighted `C_FRIEND` blue,
  everyone else `C_FOE` red (the RosterTicker already does exactly this).
  No SWITCH SIDE row. The "last match: won X–Y" line becomes "last match:
  <winner name> took it, you won N rounds".
- **In-round HUD**: the `yourWins — theirWins` pair has no 6-way form.
  Replaced in Brawl by a **remain strip**: six small fighter pips that dim
  as players fall (the at-a-glance "how many left" every battle royale
  teaches), with your round-win tally as small crowns under your pip.
- **Round plate**: "<name> STANDS ALONE" + the six-way wins tally; match
  plate crowns the winner (title flex moments fire as normal — kill calls,
  slain-by, honour roll are all id-keyed and don't care about teams).
- **Identity colours** (Tom, 2026-09-03: "I want opponent one to always be
  purple… so I can decide who I want to target"): five uniform-red bodies
  are indistinguishable, so in a brawl each TEAM wears one colour for the
  whole match — `BRAWL_TEAM_HEX` (render.ts), indexed team − 1: crimson,
  violet, emerald, ember, rose, teal. Blue stays reserved: YOU are always
  friend-blue to yourself (the invariant every mode teaches), and everyone
  else sees your team's palette colour. The colour appears everywhere the
  fighter does — body disc, remain-strip pip (the strip doubles as the
  legend), lobby row dot, roster-ticker name, entrance-card name — so
  "hunt the violet one" is learnable before round 1 starts. A seatless
  spectator sees all six palette colours. Offscreen ally chevrons still
  have no allies to draw.

## Deeds, sounds, edges

- Achievement ingestion is relational and just works; the 2v2 board is
  bracket-gated and stays inert. The one 2-team predicate — Flawless
  (`roundWins[team === 1 ? 1 : 0] === 0`) — gets guarded for Brawl.
  Brawl-specific deeds (a third board: win a 6-way flawless, triple-kill in
  a brawl, win without being touched by the sands…) are future work.
- **Audio** (per bits-audio.md): no new SFX needed — rounds reuse the full
  existing flow. One owed nicety: a distinct match-win sting when you're
  last of six could come later with the Brawl deed board.
- **Pacing is the real unknown.** Nothing breaks with 5 simultaneous
  enemies, but nothing's tuned for it: nearest/weakest focus, harpoon
  stickiness, third-party pile-ons. First playtest is practice-mode Brawl
  vs bots, on device, before any dial gets touched by prose (the gore-FX
  rule applies to game feel too).
- **2v2v2 comes free later**: the `(teamCount, teamSize)` shape makes a
  three-way team variant a data point, not a project.

## Files (as built)

Sim: `state.ts` (`Team` widened 1..6, `teamCount` on state, `wins`/
`teamNames` → arrays, `teamCounts`/`teamSizeOf`/`winsToTakeOf`), `config.ts`
(`BRAWL_TEAM_COUNT`, `WINS_TO_TAKE_MATCH_BRAWL`), `sim.ts` (`deriveArenaZone`
reads the tagged anchor set, `createSim(teamCount)`, `addPlayer` seat-pinning,
`switchTeam` refusal), `round.ts` (distinct-living-teams close, argmax match
winner, ≥2-teams force-start), `teamNames.ts` (`pickTeamNames(seed, count)`,
first two picks unchanged), `protocol.ts` (v32: `createRoom.brawl`,
`welcome.teamCount`, `RoomListing.brawl`), `snapshot.ts`
(`makeClientConfig(state)`), `events.ts`, `achievements/` (roundWins →
array; By a Thread / Flawless / The Last Word predicates N-team-safe),
`brawl.test.ts`. Server: `room.ts` (Room teamCount, listing badge, welcome),
`manager.ts` (brawl create). Zone: `arena-00.json` — six `spawn-m1..6`
anchors, hex ring r=540 about centre, verified 60px clear of all collision
(re-placeable in Realmsmith); `realmsmith/src/edit/validate.ts` understands
team-tagged spawn sets. Client: `RoomListScreen` (BRAWL create chip +
6-WAY BRAWL row tag — mode select untouched), `RoomScreen` (single six-row
lobby under SIX ENTER · ONE LEAVES with identity dots, tinted roster
ticker, brawl last-match line, no switch side), `GameScreen.tsx`
(identity-coloured remain-strip pips + win dots, epigraph pre-round hint,
winner-named plates, honour roll by winnerTeam), `game/render.ts`
(`BRAWL_TEAM_HEX` + per-team `bodyColorFor`), `game/EntranceCard.tsx`
(per-seat colour), `RoundBanner` (score optional), `PracticeScreen` (BRAWL
size chip), `net/practice.ts` (brawl constructor — five bots, five teams),
`net/connection.ts`.
