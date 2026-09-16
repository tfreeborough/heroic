# Blood in the Sand — Reconnect & Rejoin

Status: **connection layer (silent redial + connect screen) BUILT 2026-07-30 ·
seat TOKENS built 2026-08-15 (protocol v28, security pass: welcome carries
`seatToken`, reclaim is token-only, ranked joins/watches without proof read as
"no such room") · AUTO-REJOIN + APP-RESTART REJOIN BUILT 2026-09-16 (R1 done:
the seat is persisted to AsyncStorage and the connection manager reclaims it
on every fresh socket — redial and cold launch alike — before the UI settles;
`joinRoom.reclaimOnly`, additive, no bump) · R2 queue resume and R3 the
in-match overlay still not built** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-09-16

> "This can happen randomly and can be quite frustrating […] it's not really
> obvious to a user why this screen is showing or what they can do."
> (Tom, 2026-07-30, on the old connection-lost page)

The app talks to one WebSocket for its whole life, and phones kill sockets
constantly: every sleep, every backgrounding, every wifi↔cellular handoff,
every server deploy. The old behaviour latched the first death into a
permanent "connection lost" page — usually a *stale* death, shown minutes
after the network had recovered.

## Built: the connection layer (2026-07-30)

`useArenaConnection` (client) wraps the one-shot `ArenaClient` in a
dial/watch/redial lifecycle. Policy:

- **Quiet first.** The first 3 failures redial on a 1s/3s/6s backoff while
  the UI shows plain "connecting…" — a blip never becomes an error page.
  A quiet dial still unanswered after 5s adds a "taking longer than usual"
  hint. (The Render service is always-on — confirmed by Tom 2026-07-30 —
  so a slow dial means a bad network path, never a cold start.)
- **Visible after that.** The connect screen flips to a framed failure panel
  but the redial loop keeps running (8s/12s/15s, jittered) with the countdown
  shown; RETRY NOW just accelerates it. A reachability probe (a fetch to
  Android's `generate_204` endpoint — NetInfo is a native module and can't
  ship over OTA) splits the copy into "you're offline" vs "the arena isn't
  answering — our end, not yours".
- **Wake triggers.** App foregrounding and PLAY/RANKED route entry redial
  immediately — the stale-death case became an invisible sub-second
  reconnect. Backgrounding suspends all dialing.
- **Dead-seat notice.** A death that cost a seat or queue spot sets a
  one-shot `lastError` on the next open client ("connection to the arena was
  lost"), so the room list / ranked home say why the player is back at the
  gates.
- **Escape hatch.** Every failure state (down / mismatch / unconfigured)
  offers PRACTICE OFFLINE — a dead server never means "nothing to do".
- Each dial has a 15s timeout (RN's WebSocket has none); protocol mismatch
  never redials — that stays the update flow.

~~**What a mid-match blip still costs: the seat.** That's the unbuilt half.~~
Built 2026-09-16 — see § Built: auto-rejoin below.

## Built: auto-rejoin, across sockets AND app restarts (2026-09-16)

> "If you close the app down accidentally then come back to it, it would be
> nice if we could try and reconnect to our last game […] if the game is still
> ongoing this is the first thing we should do for players when coming back
> into the app." (Tom, 2026-09-16 — he'd lost a match to exactly this.)

The seat is now remembered in `src/net/seat.ts` — an in-memory copy for the
connection manager's hot path, written through to AsyncStorage (`bits.seat`)
so a killed app still knows it. Stamped on every `welcome` (with the name the
seat was claimed under and, for a ranked room, the bracket — the welcome
itself doesn't say, and the client needs it to route the rejoin and to read
the eventual `roomClosed` as the settle rather than an error), re-stamped
every 15 s while snapshots flow (so the 30-minute TTL means "last seen in the
fight", not "joined once"), cleared on `leaveRoom`, `roomClosed`, and every
refused reclaim.

**The manager reclaims on every open.** `ConnectionManager.watch()` sends
`ArenaClient.rejoinSeat(seat)` the moment a socket opens with a seat
remembered — once per socket, after a redial and on a cold launch alike — and
**holds its "connecting" state until the server answers**, so a mid-match blip
reads as one continuous "connecting… → the fight" instead of a flash of the
room list in between. `welcome` → the client restores `rankedMatch` from the
seat, App's route follows it (a seat pulls the route to its flow — `play` or
`ranked` — from wherever the player was, the title screen included), and
GameScreen mounts mid-match through the existing routing. `reject` → the seat
is forgotten, silently: the player asked for nothing, so there is nothing to
apologise for. The dead-seat notice ("connection to the arena was lost") now
fires only when the death cost something the reclaim could NOT recover (a
queue spot, or a seat the server no longer had).

**`reclaimOnly` on the wire** (`joinRoom`, additive — no bump). Room codes
are four letters and get reused, so the remembered seat from yesterday could
otherwise walk a relaunching player into a stranger's fresh lobby that
happens to wear the same code. With the flag, the server admits the join
ONLY as a reclaim; anything else is the same "no such room" a dead room
answers. Manual joins by code are unchanged. (Deploy the server first: an old
server ignores the flag and would fresh-join.)

**Reclaim beats the heartbeat.** `Room.findGhost` no longer requires the seat
to read disconnected. A wifi drop sends no close frame, so for up to
`HEARTBEAT_TIMEOUT_MS` (15 s) the server still thinks the old socket is
alive — while the client, which noticed first, is already back with the
token inside the quiet-redial window. Before this the reclaim bounced and
the client would have forgotten the seat. The token IS the proof; the seat
it names on a still-"connected" player is a zombie socket, which `seat()`
detaches and closes as it hands the seat over (new socket seated FIRST, so
the zombie's late close finds itself superseded). Only the token's holder
can do this — a stranger's token still finds nothing.

**Rejoining into the ceremony hold.** A ranked room keeps its `rankedResult`
(`RankedContext.lastResult`) and hands it to a seat that reclaims after the
settle broadcast — a player who relaunches as the match ends gets the
ceremony, not a red "match complete".

**What it does NOT cover** (unchanged, deliberate): a lobby disconnect still
frees the seat instantly (ranked: the arming room voids and the dropper eats
the lockout), so a relaunch during the arming wizard reclaims nothing — the
attempt costs one round trip and the seat is forgotten. And a 1v1 with an
idling body ends within a couple of minutes (the body dies every round), so
the realistic relaunch window is that long; 2v2 and skirmish rooms hold
longer.

## The server already keeps the seat warm

Built long ago (pvp-arena-concept): a mid-match disconnect never frees the
seat — the body idles, the crown migrates, and `Room.seat()` gives a joiner a
disconnected seat *first*, taking over the live body (`reconnectPlayer`).
Ranked rooms admit joiners **only** through this door
(`hasDisconnectedSeat`). So rejoin works today… by hand, and with two flaws:

1. **The client forgets.** On socket death the client throws away the room
   code and its whole session; nobody re-dials the room.
2. **The seat is unauthenticated.** `joinRoom(code)` reclaims the *first*
   disconnected seat, whoever you are. Anyone with the code can take over
   your body, name themselves, and play your ranked match. Codes are
   unlisted for ranked but short — this is a courtesy lock, not a lock.

## Design: remember the seat, prove it's yours

### Seat tokens (protocol bump)

- `Room.seat()` mints a random per-seat secret (`crypto.randomUUID()` is
  fine) and sends it in `welcome` as `seatToken`.
- `joinRoom` grows an optional `seatToken` field. When present and matching
  a **disconnected** seat, that exact seat is reclaimed — name, team, body.
  When absent, reclaim only seats that never had a token claim… simpler: no
  token → never reclaim, always take a free lobby seat. (Ranked rooms then
  admit *nobody* without a matching token, closing the hijack.)
- ~~Tokens live in client memory only (v1). Persisting to AsyncStorage would
  survive an app restart mid-match — nice, later, and needs a room-still-
  exists probe to avoid a doomed rejoin dance on every cold launch.~~ Built
  2026-09-16 (§ Built: auto-rejoin). The "probe" turned out to be the reclaim
  itself: `reclaimOnly` makes a doomed attempt answer "no such room" in one
  round trip and forget the seat — no separate probe needed.

### Client: the manager remembers

`useArenaConnection` grows a `lastSeat: { code, seatToken, ranked } | null`,
stamped on every `welcome` and cleared on *deliberate* leaves
(`leaveRoom`, `roomClosed`). On the first `open` after a death with
`lastSeat` set, the manager sends the rejoin join before the UI settles:

- Success → `welcome` lands, the buffer resets, snapshots resume; the player
  falls back into RoomScreen/GameScreen through the existing routing. Total
  gap ≈ redial + join round-trip (1–3s on a blip).
- Reject ("no such room" — it closed while we were gone) → clear `lastSeat`,
  fall through to today's dead-seat notice.

No socket-swap inside ArenaClient, no session/socket split: the fresh-client
path reuses the entire existing join flow. The costs of that choice:
GameScreen unmounts during the gap (the player sees the connect screen's
quiet "connecting…" for a beat — acceptable v1, see R3), and input `seq`
restarts at 0 on the new socket (fine: the sim stores seq but never orders
by it — state.ts `sanitizeInput`).

### Queue resume (ranked)

A death while queued re-queues on reconnect: the manager remembers the
brackets + name and re-sends `queueJoin` (the persistence token already
authenticates it). v1 rejoins at the back of the line — a server-side grace
(keep the entry alive ~10s after socket death) would preserve the wait, but
the matcher currently assumes a live socket per entry; not worth it until
queues are long enough to notice.

## Milestones

- **R1 — seat tokens + auto-rejoin.** ✅ Tokens 2026-08-15, auto-rejoin
  2026-09-16 (persisted seat, `reclaimOnly`, reclaim-beats-heartbeat, the
  manager's hold-until-answered). Kills both flaws.
- **R2 — queue resume.** Client-side re-queue on reconnect.
- **R3 — in-match reconnect overlay (polish).** Instead of dropping to the
  connect screen for the gap, GameScreen holds the dead client's last frame
  under a "RECONNECTING…" veil until the new welcome lands (or a ~15s give-up).
  Pure presentation over R1.

## Open questions

- Rejoin only helps **mid-match**: a lobby disconnect frees the seat
  instantly (`dropSocket` → `removePlayer` — deliberate, so ghosts never
  block joiners). That means a blip during the arming wizard still dumps the
  player out with their picks lost. Worth a small grace (keep a lobby seat
  ~10s on a *silent* death, matching the quiet-redial window) — or accept it;
  re-arming is cheap next to losing a live match.
- Should abandoning (deliberate leave) vs dropping (socket death) diverge
  further in ranked penalties once rejoin exists? (bits-ranked.md owns the
  penalty table; rejoin makes "drop" forgivable in a way it couldn't be.)
- ~~AsyncStorage token persistence for app-restart rejoin (see above).~~ Built
  2026-09-16.
