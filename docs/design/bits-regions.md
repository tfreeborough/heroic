# Blood in the Sand — Latency & Regions

Status: **Stage 1 BUILT 2026-09-09** (pong, ping pill, rtt logging — see
§ Build notes; deploy = server + API + client OTA, in any order, no protocol
bump) · Stage 2 not built · Stage 3 (a second region) is GATED on the
Stage 1 data showing a non-European population worth serving ·
Applies to: **Blood in the Sand** ·
Last decided: 2026-09-09

> "Almost every other competitive game uses regions so I don't see why this
> would be any different for us but agree we should check out who is
> playing before committing." (Tom, 2026-09-09)

## Where this came from

Tom felt the stick land ~0.5s late on iOS in online skirmish, not in
practice, not on Android. The perf overlay's new `net` line
(bits-dev-menu.md § Tool 1 — input round trip via the `lastSeq` echo)
read 250–300ms on the prod build. Cause: a VPN on the iPhone routing
UK → US → Frankfurt and back. With it off, the wire is what it should be.
The game code was never at fault — but the episode showed two gaps: the
player had NO way to see that the lag was distance, and we have NO record of
where players actually connect from.

## The numbers

Felt latency = input round trip + the 66ms interpolation delay
(`INTERP_DELAY_TICKS = 2`, interp.ts) + one frame. Both Render services
(game server + API) are in **Frankfurt** — provisioned there on purpose. Do
NOT infer the region from DNS: every `*.onrender.com` host CNAMEs to a
shared `gcp-us-west1-1.origin.onrender.com` ingress; time a warm connection
instead (UK → LHR edge → Frankfurt → back measured at ~38–40ms, 2026-09-09).

| Player | Input rtt (wire + ≤1 server tick) | Felt |
|---|---|---|
| UK / western Europe | 40–75ms | ~120ms |
| US east | 110–150ms | ~200ms |
| US west | 170–200ms | ~250ms |
| Australia / east Asia | 250–330ms | ~350ms+ |

Every attack has a windup telegraph and movement is stick-driven, so
~200ms is playable in skirmish. The real problem is **ranked fairness**: a
40ms player against a 180ms player has an edge the loser cannot see. That
is what regions are for — and why they are gated on evidence, not built
speculatively.

## Stage 1 — see it and log it *(pre-launch, ~a day)*

1. **Pong.** The server answers the existing `ping` (today: liveness only,
   `return`) with `{ t: "pong", at }` echoing a client timestamp. Additive
   message; no protocol bump needed if the client ignores unknown types.
   The client's heartbeat already pings every 5s (HEARTBEAT_INTERVAL_MS) —
   rtt rides it for free; a screen can ask for a burst of 3 on entry.
2. **Ping pill.** A small `42ms` readout on RankedScreen (beside the queue
   pill) and in the skirmish room lobby. Colour bands: green < 80, amber
   80–150, red > 150. In-match it stays OFF the HUD (the perf overlay is the
   dev read) — the pill's job is to make "180ms" a fact the player saw
   BEFORE the round, so a soft thumb reads as distance, not a bug.
3. **Log it.** Each ranked seat's median input rtt over the match (the
   server already knows: it holds `lastSeq` timing if it stamps input
   arrival) → a new `rtt_ms INTEGER` column on `ranked_match_players`.
   The feedback form (`feedback` table) gains `rtt_ms` too, taken from the
   last pong. One SQL query then answers "who is playing from where" in
   latency terms — the only trigger for Stage 3.

## Stage 2 — cheap feel, optional

**Not client-side prediction.** The client "never simulates" (interp.ts)
and reconciliation would be the largest architectural change in the
project, for a problem Stage 1 can't yet size. The cheap lever is **local
intent feedback**: the moment the stick moves, turn the body's facing
toward it and kick a footstep puff — before the server confirms. Position
still comes from the server, so nothing can desync; the thumb just feels
answered. Do it only if Stage 1 shows a big mid-latency (100–200ms)
population.

## Stage 3 — a second region *(when the data says so)*

Trigger: Stage 1 logs show a sustained population whose rtt floor is
> ~120ms (i.e. the Americas or APAC), enough to fill a ranked pool with the
existing bot backfill covering the thin hours (bits-ranked-bots.md).

Shape — region is a property of the CONNECTION, nothing else changes:

- **Servers.** One more game-server service per region (Render Ohio first
  — the Americas; Singapore only on APAC evidence). Each is already
  self-contained: rooms and queues live in that process's memory. The
  **API stays single-region in Frankfurt** — Turso-backed, off the hot
  path; a 100ms API call costs nobody a round.
- **Picking.** The connect screen (bits-reconnect.md) pings every region's
  host once and dials the lowest; Settings gets a manual override
  (`bits.region`) for players who know better (travel, VPNs). The chosen
  region shows in the ping pill (`FRA 42ms`).
- **Ranked.** Queues are per region — no cross-region ranked, ever (the
  fairness rule above). Season, ratings, ladders stay global in the one
  DB; only the POOL splits. Bot backfill makes a small regional pool
  viable from day one.
- **Skirmish.** A room lives on its host's region server, so room codes
  carry a region prefix (`FRA-K7Q2`) and `generateRoomCode` stays as it
  is; a joiner with a foreign-prefixed code dials that region's server for
  that room only. Cross-region friends CAN play — the pill shows what
  they're accepting.
- **Deploys.** `EXPO_PUBLIC_DEFAULT_SERVER` becomes a region table in
  `.env.production` (bits-ota-env-gotcha.md rules still apply). Adding a
  region is an OTA, not a binary.

Cost: one Render service per region plus the picker; the room, queue and
ranked code need no change.

## Build notes — Stage 1 (2026-09-09)

Two independent measurements, on purpose:

- **Client-measured, for the player.** `ping` gained an optional `at`
  (client clock); the server answers `{ t: "pong", at }` only when it's
  there. `ArenaClient.rttMs` = median of the last 5 pongs (RTT_WINDOW);
  the heartbeat's 5s ping carries a stamp for free, and `probeLatency()`
  fires a burst of 3 at 250ms on open so the number lands in under a
  second. Additive on both ends — an old client ignores `pong`, an old
  server ignores `at` — so **no PROTOCOL_VERSION bump** and no coordinated
  deploy. `lastMeasuredRtt()` (module-level) is what the feedback form
  stamps (`rttMs` on `POST /feedback` → `feedback.rtt_ms`; the "attached"
  list shows `ping: 42ms`).
- **Server-measured, for the record.** The manager sends a WebSocket-level
  `ping` frame (its clock as payload) to every seated socket on the
  heartbeat beat; the phone's socket stack pongs it back per RFC 6455 with
  no app code involved, and `ClientData.rtt` keeps the last 64 samples.
  At ranked settle each human seat's **median** goes to
  `ranked_match_players.rtt_ms` (`RankedSubjectInput.rttMs`; bots null).
  A player can't self-report this one, so it's the number Stage 3's
  trigger reads:

  ```sql
  SELECT CASE WHEN rtt_ms < 80 THEN 'eu' WHEN rtt_ms < 150 THEN 'mid'
              ELSE 'far' END AS band, COUNT(DISTINCT subject_id) players
    FROM ranked_match_players WHERE rtt_ms IS NOT NULL GROUP BY band;
  ```

- **The pill.** `PingPill` (components/PingPill.tsx): dot + `42ms`, the
  QueuePill's clothes; green < 80, amber ≤ 150, red above; hidden until the
  first pong (no dash flashing on entry). Placed in ScreenHeader's new
  `middle` slot on RankedScreen and in the skirmish lobby head beside the
  room code. Practice clients have no `rttMs` → nothing renders.
- **In-match, top-right** (Tom, 2026-09-09 — REVERSES the "never on the HUD"
  rule above: "it would help players identify if there is a spike"). Same
  pill in `quiet` dress (opacity 0.72), under the notch at the right edge,
  gone with the match-end plate. It does NOT read the heartbeat pong (5s is
  too coarse to catch anything): it reads `GameClient.liveRttMs()` — the
  median INPUT round trip over the last ~30 ticks from the snapshots'
  lastSeq echo, sampled 2×/sec. So it sits ~a half server tick above the
  lobby number (it includes the tick wait) and a spike must hold ~half a
  second to show — one late packet is the interp delay's job to hide, and a
  red flash per whiff would teach players to blame the wire.
- Both new columns are `addColumnIfMissing` migrations; NULL = unknown.

## Decisions

- 2026-09-09 — Ship on Frankfurt alone. Build Stage 1 in the pre-launch
  on-device pass. Hold Stage 3 until Stage 1's logs show who is playing.
  Client-side prediction is off the table (Tom agreed the architecture
  cost outweighs an unmeasured problem).
- 2026-09-09 — Regions, when they come, are per-connection with per-region
  ranked pools and cross-region skirmish allowed with the ping visible.
- 2026-09-09 — The logged rtt is server-measured (protocol-level ping), the
  displayed one client-measured (app-level pong); they are never mixed, so
  the record can't be gamed and the pill never waits on the server's beat.
- 2026-09-09 — In-match ping pill top-right (Tom), fed by the live input
  round trip, quiet dress, hidden on the match-end plate.
