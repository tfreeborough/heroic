# Blood in the Sand — Reconnect & Rejoin

Status: **connection layer (silent redial + connect screen) BUILT 2026-07-30 ·
seat rejoin DESIGNED, not built** ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-07-30

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

**What a mid-match blip still costs: the seat.** That's the unbuilt half.

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
- Tokens live in client memory only (v1). Persisting to AsyncStorage would
  survive an app restart mid-match — nice, later, and needs a room-still-
  exists probe to avoid a doomed rejoin dance on every cold launch.

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

- **R1 — seat tokens + auto-rejoin.** Protocol bump (token in welcome/join),
  manager `lastSeat`, ranked join gate becomes token-only. Kills both flaws.
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
- AsyncStorage token persistence for app-restart rejoin (see above).
