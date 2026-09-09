/**
 * The client's side of the wire: one WebSocket, typed send/receive, and the
 * SnapshotBuffer the renderer samples. No React in here — screens hold an
 * ArenaClient instance and subscribe via the two callbacks.
 *
 * v2 flow: connect (no handshake) → browse/create/join rooms → seated in a
 * room lobby → the host starts → snapshots drive the match → back to lobby.
 */
import {
  DEFAULT_PORT,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  SnapshotBuffer,
  TICK_RATE,
  type AbilityId,
  type ArenaClientConfig,
  type ArenaEvent,
  type ClientMsg,
  type RoomListing,
  type RoomStatePlayer,
  type RoundPhase,
  type ServerMsg,
  type Team,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import { getActiveAnnouncer } from "../audio/announcer";
import { getWornTitle } from "../deeds/wornTitle";
import { grantFromDeedUnlocks } from "../deeds/entitlements";

export type ConnectionStatus = "connecting" | "open" | "closed" | "rejected";

/** Unacked input sends kept for RTT stamping (readNetStats) — ~4s at 30Hz. */
const SENT_WINDOW = 128;

/** Pong samples the ping readout is the median of — a handful, so one
 * hiccup can't paint the pill red and one lucky frame can't paint it green. */
const RTT_WINDOW = 5;
/** Input round trips the IN-MATCH readout is the median of: one per tick,
 * so 30 ≈ the last second. A spike has to hold for ~half a second to move
 * the number — a single late packet is the interp delay's job to hide, and
 * flashing red for it would teach players to blame the wire for every whiff. */
const LIVE_RTT_WINDOW = 30;
/** The entry burst: pings this many times, this far apart, the moment the
 * socket opens, so the pill has a number seconds before the heartbeat's
 * first 5s tick would give it one. */
const RTT_PROBE_COUNT = 3;
const RTT_PROBE_GAP_MS = 250;

/** The most recent measured round trip on ANY client this process has run
 * (ms), or null before the first pong. Module-level so the feedback form
 * (support.ts) can stamp a report without holding a client. */
let lastRttMs: number | null = null;
export const lastMeasuredRtt = (): number | null => lastRttMs;

/**
 * Baked in at build time (Expo inlines EXPO_PUBLIC_*). Convention: the
 * committed `.env` carries the Render hostname (drives builds); the
 * gitignored `.env.local` overrides it for local dev (LAN server).
 */
export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_DEFAULT_SERVER ?? "";

/**
 * What the address field accepts, resolved to a WebSocket URL:
 * - `192.168.1.23` / `192.168.1.23:7777` / `localhost` / `toms-mac.local`
 *   → plain `ws://` on the game port (LAN dev server, no TLS)
 * - `blood-in-the-sand.onrender.com` → `wss://` on 443 (the PaaS proxy
 *   terminates TLS and forwards to the server's PORT)
 * - a full pasted URL (`https://…` / `wss://…`) → honored, http(s) mapped to ws(s)
 */
export const resolveServerUrl = (input: string): string => {
  const t = input.trim().replace(/\/+$/, "");
  if (t.includes("://")) return t.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const [host = "", portStr] = t.split(":");
  const port = portStr ? Number(portStr) : undefined;
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLocal = isIp || host === "localhost" || host.endsWith(".local");
  if (isLocal) return `ws://${host}:${port ?? DEFAULT_PORT}`;
  return port ? `wss://${host}:${port}` : `wss://${host}`;
};

/**
 * The seat's rejoin secret (bits-reconnect.md § seat tokens), stamped by
 * every `welcome` and cleared only on DELIBERATE exits (leaveRoom,
 * roomClosed). Module state, not ArenaClient state, on purpose: the client
 * dies with its socket (the silent-redial layer builds a fresh one per dial
 * — useArenaConnection), and the whole point of the token is surviving that
 * death so a rejoin by code can prove the seat is ours. Since protocol v28
 * the server reclaims a disconnected seat ONLY on a matching token — ranked
 * rooms admit nobody without one. Memory-only by design (v1): an app restart
 * forfeits the seat; AsyncStorage persistence is the design doc's "later".
 */
let lastSeat: { code: string; seatToken: string } | null = null;

export interface WelcomeInfo {
  playerId: number;
  team: Team;
  /** Players per side — capacity (teamCount×N) and empty-seat rows derive
   * from this. */
  teamSize: number;
  /** How many teams: 2 in classic rooms, 6 in Brawl (bits-brawl.md) — the
   * presentation switch (teamCount > 2 = free-for-all). */
  teamCount: number;
  /** The sides' faction names, indexed team − 1 — your side renders blue,
   * the rest red (bits-bot-backfill.md § team identity). */
  teamNames: string[];
  roomCode: string;
  roomName: string;
  hostId: number;
  zoneId: string;
  config: ArenaClientConfig;
}

export interface RoomStateInfo {
  players: RoomStatePlayer[];
  hostId: number;
}

/** One seat's settlement from the post-match `rankedResult` broadcast. */
export interface RankedResultRow {
  playerId: number;
  before: number;
  after: number;
  delta: number;
  /** Display tier — the sticky-badge grace is applied server-side. */
  tier: string;
  /** Division inside the tier (3 entry → 1 top); null in Initiate/Immortal. */
  division: 1 | 2 | 3 | null;
  /** The displayed rank moved this match (server-computed, grace included) —
   * the rank_up / rank_down audio cue. */
  rankChange: "up" | "down" | null;
  glory: number;
  /** Season-high rating after this settle; `newBest` = this match set it —
   * the ceremony's celebration hook. */
  peak: number;
  newBest: boolean;
  /** Non-null while that player is still placing — show "match N of 10",
   * never the rating movement. */
  placement: { number: number; of: number } | null;
}

export interface RankedResultInfo {
  matchId: string;
  bracket: string;
  winnerTeam: Team;
  results: RankedResultRow[];
}

/** The summons (protocol v30, bits-ranked.md § Queue roaming & match
 * accept): a pairing awaiting everyone's yes. Lives from `matchReady` until
 * either `matchFound` (everyone in — cleared, the welcome follows) or
 * `matchCancelled`, which parks the `outcome` here so the accept sheet can
 * say its farewell before `dismissPending()` clears it. */
export interface PendingMatchInfo {
  bracket: string;
  /** Seats in the match (2 in 1v1, 4 in 2v2). */
  players: number;
  /** How many have said yes so far — the sheet's "N OF M". */
  accepted: number;
  acceptSec: number;
  /** Local clock at the summons — the sheet's countdown anchor. */
  readyAtMs: number;
  /** Whether WE have said yes. */
  mine: "pending" | "accepted";
  /** Non-null once the match fell through: `dodged` = we were the one who
   * didn't answer (out of the queue, `lockoutSec` to serve); otherwise
   * someone else was and we're already back in line. */
  outcome: { dodged: boolean; lockoutSec: number | null } | null;
}

/** One bracket's queue population (queueStatus) — `waitedSec` present only
 * on brackets THIS socket is queued in. */
export interface BracketQueueStatus {
  bracket: string;
  size: number;
  waitedSec?: number;
}

/**
 * The slice of client GameScreen actually consumes — satisfied by ArenaClient
 * (a real networked match) and PracticeClient (the offline bot match, which
 * steps the sim in-process). The renderer can't tell them apart, by design.
 */
export interface GameClient {
  readonly buffer: SnapshotBuffer;
  status: ConnectionStatus;
  welcome: WelcomeInfo | null;
  roomState: RoomStateInfo | null;
  onEvents: ((events: ArenaEvent[]) => void) | null;
  readonly myWeapon: WeaponId | null;
  /** The post-match settlement in a RANKED room (rating deltas + Glory) —
   * absent/null everywhere else; practice never sets it. */
  readonly rankedResult?: RankedResultInfo | null;
  /** True on PracticeClient only. The RENDERER still can't tell them apart —
   * this exists for the wizard's try-before-buy unlocks (bits-store.md) and
   * so GameScreen counts only ONLINE wins toward the first-win account nudge
   * (bits-accounts.md — offline wins bank nothing worth saving). */
  readonly practice?: boolean;
  /** `casts` indexed by ability slot (= pick = button order). */
  sendInput(sx: number, sy: number, casts: boolean[]): void;
  /** Dev perf overlay: drain the wire timings gathered since the last read.
   * OPTIONAL — a networked client only; practice has no wire (null/absent =
   * no `net` line). */
  readNetStats?(): NetStats | null;
  /** The ping readout (bits-regions.md § Stage 1): median round trip of the
   * last few ping/pong pairs, ms. OPTIONAL — a networked client only, and
   * null until the first pong; the PingPill hides on both. */
  readonly rttMs?: number | null;
  /** The IN-MATCH ping (Tom, 2026-09-09: "help players identify a spike"):
   * median INPUT round trip over the last ~second, from the snapshots'
   * lastSeq echo — a live 30Hz signal where the heartbeat pong is a 5s one.
   * Reads ~a half tick above the lobby ping (it includes the server's tick
   * wait), which is the honest number for how the fight actually feels.
   * OPTIONAL like rttMs; null before the first echo (lobby, spectating). */
  liveRttMs?(): number | null;
}

/**
 * Wire timings for the dev perf overlay (bits-dev-menu.md § Tool 1), all ms,
 * accumulated between reads. `rtt` is the INPUT round trip: sendInput → the
 * server ticks it → the snapshot echoing our `lastSeq` lands (so it includes
 * up to one server tick, but NOT the interp delay or a render). `gap` is the
 * time between consecutive snapshot arrivals — 33 is a clean 30Hz feed;
 * a big max with a normal average means arrivals are BUNCHING (a stall in
 * the socket stack or the network), which the renderer rides out as freeze +
 * jump, felt as lag.
 */
export interface NetStats {
  rttAvg: number;
  rttMax: number;
  /** Input round trips measured in the window (0 = no echo seen — e.g. not
   * seated, or the server never applied one of our inputs). */
  rttN: number;
  gapAvg: number;
  gapMax: number;
  /** Snapshots that arrived in the window. */
  snaps: number;
}

/** A transient lobby toast (host handoff), with the wall-clock it arrived so
 * the UI can fade it after a few seconds. */
export interface Notice {
  text: string;
  atMs: number;
}

/**
 * What RoomScreen needs on top of GameClient to run the lobby + arming wizard
 * — satisfied by ArenaClient (real rooms) AND PracticeClient (offline, so the
 * whole flow is testable without a second player). Nobody starts the match:
 * the sim's arming countdown does (pvp-loadout-flow.md).
 */
export interface LobbyClient extends GameClient {
  phase: RoundPhase;
  readonly hostId: number | null;
  readonly isHost: boolean;
  /** Latest transient lobby toast (host handoff), or null — the RoomScreen
   * banner reads this and fades it on its own timer. */
  readonly notice: Notice | null;
  /** Own picked hand, in button order (from the team-filtered roomState). */
  readonly myAbilities: AbilityId[];
  setWeapon(weapon: WeaponId): void;
  setAbilities(abilities: AbilityId[]): void;
  /** Host-only: bots fill the empty seats, stragglers auto-arm; the countdown
   * follows (bits-bot-backfill.md). */
  forceStart(): void;
  /** Any seated player's veto on a bot-filled countdown. OPTIONAL — real
   * rooms only; practice never reaches a cancellable state (its bots seat at
   * construction, so the roster is always full). */
  cancelStart?(): void;
  /** Hop to the other team while it has a free seat. OPTIONAL like
   * cancelStart — practice rooms are always full, so there's nowhere to hop. */
  switchTeam?(): void;
  /** Deeds the last SKIRMISH match unlocked (bits-skirmish-deeds.md) — the
   * lobby plays them as cards on return, then clears. OPTIONAL: practice
   * earns nothing, so its client has none. */
  readonly skirmishDeeds?: string[] | null;
  clearSkirmishDeeds?(): void;
}

export class ArenaClient {
  /** Interpolation source — the renderer samples this every frame. */
  readonly buffer = new SnapshotBuffer(TICK_RATE);
  status: ConnectionStatus = "connecting";
  /** Fatal-connection reason (protocol mismatch / socket death). */
  rejectReason: string | null = null;
  /** Recoverable action failure (wrong passcode, room full, no such room). */
  lastError: string | null = null;

  /** Non-null while seated in a room. */
  welcome: WelcomeInfo | null = null;
  roomState: RoomStateInfo | null = null;
  rooms: RoomListing[] = [];
  /** Newest transient lobby toast (host handoff), or null. */
  notice: Notice | null = null;
  /** Round phase from the newest snapshot — drives screen routing. */
  phase: RoundPhase = "lobby";

  // ── ranked (bits-ranked.md) ──────────────────────────────────────────────
  /** Per-bracket queue populations — refreshed by queueInfo and every matcher
   * beat while queued. RankedScreen renders straight from this. */
  queueStatus: BracketQueueStatus[] = [];
  /** True while this socket holds a place in line. */
  queued = false;
  /** The live summons, if any (v30) — App raises the accept sheet over
   * whatever screen the player is roaming while this is set. */
  pendingMatch: PendingMatchInfo | null = null;
  /** Set at matchFound — the current (or just-ended) room is a ranked one.
   * Cleared when the seat drops. */
  rankedMatch: { bracket: string } | null = null;
  /** The last match's settlement — survives the room closing so RankedScreen
   * can keep showing the ceremony; cleared on the next queue entry. */
  rankedResult: RankedResultInfo | null = null;
  /** My side of that settlement, resolved WHILE the seat still existed (the
   * result rows are keyed by in-room seat id, which means nothing once
   * welcome is gone). RankedScreen reads this after the room closes. */
  lastSettlement: { won: boolean; bracket: string; mine: RankedResultRow; others: RankedResultRow[] } | null = null;
  /** MY newly-unlocked deeds from the last settle (achievements.md § unlock
   * ceremony) — the server sends them per-socket, so this is never the
   * opponent's list. Survives the room closing like rankedResult (the
   * ceremony plays on RankedScreen); cleared on the next queue entry. */
  deedUnlocks: string[] | null = null;
  /** MY newly-unlocked deeds from the last SKIRMISH match (bits-skirmish-
   * deeds.md) — arrive at matchEnd, shown by the lobby on return, cleared
   * by the lobby once celebrated (or by leaving the room). */
  skirmishDeeds: string[] | null = null;

  /** Fired on status / room / phase changes (drive React re-renders). */
  onChange: (() => void) | null = null;
  /** Fired with each snapshot's freshly-drained events (drive FX/audio). */
  onEvents: ((events: ArenaEvent[]) => void) | null = null;
  /** The ping readout — see GameClient.rttMs. onChange fires when it moves. */
  rttMs: number | null = null;
  private readonly rttSamples: number[] = [];
  private probeTimers: ReturnType<typeof setTimeout>[] = [];

  private readonly ws: WebSocket;
  private seq = 0;
  // --- Wire diagnostics (readNetStats — the dev perf overlay's `net` line).
  // Bounded and allocation-light: one Map set per input send, one scan per
  // snapshot; nothing here renders or is read unless the overlay is on.
  /** seq → performance.now() at send, insertion order = ascending seq. */
  private readonly sentAt = new Map<number, number>();
  /** Highest lastSeq echoed for us so far — each seq's RTT counts once. */
  private ackedSeq = -1;
  private lastSnapAt = -1;
  private readonly net = { rttSum: 0, rttMax: 0, rttN: 0, gapSum: 0, gapMax: 0, gapN: 0, snaps: 0 };
  /** Ring of the last LIVE_RTT_WINDOW input round trips (liveRttMs). */
  private readonly liveRtts = new Float64Array(LIVE_RTT_WINDOW);
  private liveRttCount = 0;
  private readonly liveSorted = new Float64Array(LIVE_RTT_WINDOW);
  /** Heartbeat so the server can tell a quiet-but-alive lobby seat from a ghost
   * (force-quit / lost network with no close frame). Runs only while open. */
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.status = "open";
      this.listRooms();
      this.pingTimer ??= setInterval(() => this.send({ t: "ping", at: performance.now() }), HEARTBEAT_INTERVAL_MS);
      this.probeLatency();
      this.onChange?.();
    };
    this.ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.handle(msg);
    };
    this.ws.onclose = () => {
      if (this.status !== "rejected") this.status = "closed";
      this.stopHeartbeat();
      this.onChange?.();
    };
    // onclose follows onerror; no separate handling needed.
    this.ws.onerror = () => {};
  }

  get hostId(): number | null {
    return this.roomState?.hostId ?? this.welcome?.hostId ?? null;
  }

  get isHost(): boolean {
    return this.welcome !== null && this.hostId === this.welcome.playerId;
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.welcome = {
          playerId: msg.playerId,
          team: msg.team,
          teamSize: msg.teamSize,
          teamCount: msg.teamCount,
          teamNames: msg.teamNames,
          roomCode: msg.roomCode,
          roomName: msg.roomName,
          hostId: msg.hostId,
          zoneId: msg.zoneId,
          config: msg.config,
        };
        // Remember how to prove this seat is ours across a socket death — a
        // later joinRoom on the same code sends it back (see lastSeat).
        lastSeat = { code: msg.roomCode, seatToken: msg.seatToken };
        this.roomState = null;
        this.phase = "lobby";
        this.lastError = null;
        this.buffer.reset(); // a new room's tick counter starts over
        this.liveRttCount = 0; // …and the in-match ping readout starts blank
        this.onChange?.();
        return;
      case "roomState": {
        this.roomState = { players: msg.players, hostId: msg.hostId };
        // A SWITCH SIDE hop changes our team server-side; welcome was stamped
        // at join. Sync it here so every welcome.team reader (GameScreen's
        // friend/foe tint, the lobby's YOUR TEAM grouping) follows the hop.
        const mine = msg.players.find((p) => p.id === this.welcome?.playerId);
        if (this.welcome && mine) this.welcome.team = mine.team;
        this.onChange?.();
        return;
      }
      case "rooms":
        this.rooms = msg.rooms;
        this.onChange?.();
        return;
      case "notice":
        this.notice = { text: msg.text, atMs: performance.now() };
        this.onChange?.();
        return;
      case "watching":
      case "left":
        return;
      case "roomClosed":
        // Kicked (host gone / ranked room over or voided). Drop the seat and
        // fall back — to the room list or RankedScreen — showing the reason.
        // EXCEPT the settled ranked close: the server now ends every ranked
        // match with roomClosed (the ceremony hold — bits-ranked-bots.md
        // § match end), and "match complete" under the settlement plate
        // would read as an error. The plate IS the message there.
        this.welcome = null;
    this.skirmishDeeds = null;
        this.skirmishDeeds = null; // the lobby that would have shown them is gone
        this.roomState = null;
        this.phase = "lobby";
        lastSeat = null; // the room is gone — the seat can never be reclaimed
        this.lastError = this.rankedMatch && this.rankedResult ? null : msg.reason;
        this.rankedMatch = null;
        this.buffer.reset();
        this.listRooms();
        this.onChange?.();
        return;
      case "pong": {
        const rtt = performance.now() - msg.at;
        if (!Number.isFinite(rtt) || rtt < 0) return;
        this.rttSamples.push(rtt);
        if (this.rttSamples.length > RTT_WINDOW) this.rttSamples.shift();
        const sorted = [...this.rttSamples].sort((a, b) => a - b);
        const next = Math.round(sorted[sorted.length >> 1]!);
        lastRttMs = next;
        if (next !== this.rttMs) {
          this.rttMs = next;
          this.onChange?.();
        }
        return;
      }
      case "snapshot": {
        const now = performance.now();
        this.noteSnapshot(msg, now);
        const events = this.buffer.push(msg, now);
        if (events.length > 0) this.onEvents?.(events);
        if (msg.round.phase !== this.phase) {
          this.phase = msg.round.phase; // lobby ↔ match transitions re-route the UI
          // A ranked room has no post-match lobby: once the settlement is in
          // and the sim returns to "lobby", leave at once (beating the
          // server's own close) so the player lands back on RankedScreen
          // without a flash of the arming wizard. Belt-and-braces against a
          // pre-ceremony-hold server — the current server never steps a
          // ranked sim back to lobby (roomClosed lands first); deletable once
          // every server is on the hold.
          if (this.phase === "lobby" && this.rankedMatch && this.rankedResult) {
            this.rankedMatch = null;
            this.leaveRoom();
            return;
          }
          this.onChange?.();
        }
        return;
      }
      case "queueStatus":
        this.queueStatus = msg.brackets;
        this.queued = msg.brackets.some((b) => b.waitedSec !== undefined);
        this.onChange?.();
        return;
      case "queueLeft":
        this.queued = false;
        this.onChange?.();
        return;
      case "matchReady":
        // Summoned: the server took us out of the line for the duration —
        // no queueStatus reaches a pending socket, so clear the flag here.
        this.queued = false;
        this.pendingMatch = {
          bracket: msg.bracket,
          players: msg.players,
          accepted: 0,
          acceptSec: msg.acceptSec,
          readyAtMs: performance.now(),
          mine: "pending",
          outcome: null,
        };
        this.onChange?.();
        return;
      case "matchPending":
        if (this.pendingMatch) {
          this.pendingMatch = { ...this.pendingMatch, accepted: msg.accepted, players: msg.players };
          this.onChange?.();
        }
        return;
      case "matchCancelled":
        if (this.pendingMatch) {
          this.pendingMatch = { ...this.pendingMatch, outcome: { dodged: msg.dodged, lockoutSec: msg.lockoutSec ?? null } };
        }
        if (msg.dodged) {
          // Out of the line and locked out — RankedScreen's error line
          // explains why the QUEUE button bounces for the next while.
          this.queued = false;
          this.lastError = `you missed the match — queue locked for ${msg.lockoutSec ?? 30}s`;
        }
        // Innocent: the server re-queued us and a queueStatus is right behind.
        this.onChange?.();
        return;
      case "matchFound":
        this.queued = false;
        this.pendingMatch = null; // everyone's in — the welcome follows
        this.rankedMatch = { bracket: msg.bracket };
        // The server seats us itself — the welcome follows on this socket.
        this.onChange?.();
        return;
      case "rankedResult": {
        this.rankedResult = msg;
        const myId = this.welcome?.playerId;
        const mine = msg.results.find((r) => r.playerId === myId);
        if (mine && this.welcome) {
          this.lastSettlement = {
            won: this.welcome.team === msg.winnerTeam,
            bracket: msg.bracket,
            mine,
            // Every other seat's row — one opponent in 1v1, a teammate and
            // two opponents in 2v2 (rows carry no team; the roster does).
            others: msg.results.filter((r) => r.playerId !== myId),
          };
        }
        // The settlement outran the phase flip (a pre-ceremony-hold server
        // whose sim already returned to lobby): the snapshot handler's
        // leave-at-once was a one-shot on the transition, so fire it here or
        // the player sits in a ghost arming lobby. Same rollout note as the
        // snapshot-side guard — dead code against the current server.
        if (this.phase === "lobby" && this.rankedMatch) {
          this.rankedMatch = null;
          this.leaveRoom();
          return;
        }
        this.onChange?.();
        return;
      }
      case "deedUnlocks":
        // Whatever these deeds PAY is usable immediately — the trident is
        // pickable in the very next lobby, no API round-trip
        // (bits-secret-items.md; server still validates ranked picks).
        grantFromDeedUnlocks(msg.unlocks);
        // Arrives on the settle's heels (same socket, ordered after
        // rankedResult) while the ceremony hold keeps the room open — store
        // it for the ceremony's deeds beat. A list from some OTHER match
        // (can't happen with an honest server, but the wire is the wire) is
        // ignored rather than pinned to the wrong settlement.
        if (this.rankedResult?.matchId === msg.matchId) {
          this.deedUnlocks = msg.unlocks;
          this.onChange?.();
        } else if (this.rankedMatch === null) {
          // A skirmish match's unlocks (bits-skirmish-deeds.md): no
          // settlement to pin to — the lobby shows them on return.
          this.skirmishDeeds = msg.unlocks;
          this.onChange?.();
        }
        return;
      case "reject":
        if (msg.reason.includes("protocol mismatch")) {
          this.status = "rejected";
          this.rejectReason = msg.reason;
          this.ws.close();
        } else {
          this.lastError = msg.reason; // recoverable: stay on the room list
        }
        this.onChange?.();
    }
  }

  /** Enter the ranked queue (bits-ranked.md). `token` is the persistence
   * bearer secret from ensureIdentity(); the server derives who we are from
   * it — no claimed id rides the wire. `brackets` is the FULL set to wait in
   * (multi-queue, first match wins): re-sending with a different set adds or
   * drops brackets, and the server keeps the wait already earned in each. */
  queueRanked(playerName: string, token: string, brackets: string[] = ["1v1"]): void {
    this.lastError = null;
    this.rankedResult = null; // a fresh campaign — the old ceremony is done
    this.lastSettlement = null;
    this.deedUnlocks = null;
    this.send({
      t: "queueJoin",
      v: PROTOCOL_VERSION,
      token,
      playerName,
      brackets,
      announcer: getActiveAnnouncer(),
      title: getWornTitle(),
    });
  }

  queueLeave(): void {
    this.send({ t: "queueLeave" });
  }

  /** Answer the summons. Idempotent; the server's matchPending / matchFound
   * carry the consequences back. */
  acceptMatch(): void {
    if (!this.pendingMatch || this.pendingMatch.mine === "accepted") return;
    this.pendingMatch = { ...this.pendingMatch, mine: "accepted" };
    this.send({ t: "matchAccept" });
    this.onChange?.();
  }

  /** Decline the summons — a dodge (lockout). The server answers with
   * matchCancelled { dodged: true }; the sheet's farewell reads from that. */
  declineMatch(): void {
    if (!this.pendingMatch || this.pendingMatch.outcome !== null) return;
    this.send({ t: "matchDecline" });
  }

  /** The accept sheet has shown its farewell — drop the dead summons. */
  dismissPending(): void {
    if (this.pendingMatch === null) return;
    this.pendingMatch = null;
    this.onChange?.();
  }

  /** Unauthenticated queue-size read — RankedScreen's population display. */
  refreshQueueInfo(): void {
    this.send({ t: "queueInfo" });
  }

  /** `token` (bits-skirmish-deeds.md): the persistence bearer secret, so the
   * seat's skirmish deeds credit this account and the worn title is
   * verified. Optional — without it the seat plays as before, earns nothing. */
  createRoom(playerName: string, roomName: string, pass: string, teamSize: number, brawl = false, token?: string): void {
    this.lastError = null;
    this.queued = false; // entering the skirmish flow leaves the queue server-side
    this.skirmishDeeds = null;
    this.send({
      t: "createRoom",
      v: PROTOCOL_VERSION,
      playerName,
      roomName,
      teamSize,
      ...(token ? { token } : {}),
      // Brawl (v32): the free-for-all shape — the server ignores teamSize.
      ...(brawl ? { brawl: true } : {}),
      // The cosmetics are claimed at seat time (like the name) — read here
      // rather than passed in, so every screen's create/join carries them.
      announcer: getActiveAnnouncer(),
      title: getWornTitle(),
      ...(pass.trim() ? { pass: pass.trim() } : {}),
    });
  }

  joinRoom(playerName: string, code: string, pass: string, token?: string): void {
    this.lastError = null;
    this.queued = false; // ditto createRoom
    this.skirmishDeeds = null;
    const normalized = code.trim().toUpperCase();
    this.send({
      t: "joinRoom",
      v: PROTOCOL_VERSION,
      code: normalized,
      playerName,
      ...(token ? { token } : {}),
      announcer: getActiveAnnouncer(),
      title: getWornTitle(),
      ...(pass.trim() ? { pass: pass.trim() } : {}),
      // Rejoining the room we lost a socket in: the seat token proves the
      // disconnected seat is OURS (any other room gets a plain fresh join).
      ...(lastSeat?.code === normalized ? { seatToken: lastSeat.seatToken } : {}),
    });
  }

  listRooms(): void {
    this.send({ t: "listRooms" });
  }

  /** The lobby celebrated the skirmish cards. */
  clearSkirmishDeeds(): void {
    if (this.skirmishDeeds === null) return;
    this.skirmishDeeds = null;
    this.onChange?.();
  }

  setWeapon(weapon: WeaponId): void {
    this.send({ t: "setWeapon", weapon });
  }

  setAbilities(abilities: AbilityId[]): void {
    this.send({ t: "setAbilities", abilities });
  }

  /** Host-only: fill empty seats with bots + auto-arm the stragglers; the
   * server ignores it from others. */
  forceStart(): void {
    this.send({ t: "forceStart" });
  }

  /** The veto — the server ignores it unless a bot-filled countdown runs. */
  cancelStart(): void {
    this.send({ t: "cancelStart" });
  }

  /** SWITCH SIDE — the server ignores it unless the other side has a seat. */
  switchTeam(): void {
    this.send({ t: "switchTeam" });
  }

  /** Our own row in the latest team-filtered roomState broadcast. */
  private get myRow(): RoomStatePlayer | undefined {
    const myId = this.welcome?.playerId;
    if (myId === undefined) return undefined;
    return this.roomState?.players.find((p) => p.id === myId);
  }

  get myWeapon(): WeaponId | null {
    return this.myRow?.weapon ?? null;
  }

  get myAbilities(): AbilityId[] {
    return this.myRow?.abilities ?? [];
  }

  leaveRoom(): void {
    this.send({ t: "leaveRoom" });
    lastSeat = null; // a deliberate leave forfeits the seat — never rejoin it
    this.welcome = null;
    this.skirmishDeeds = null;
    this.roomState = null;
    this.phase = "lobby";
    this.buffer.reset();
    this.listRooms();
    this.onChange?.();
  }

  sendInput(sx: number, sy: number, casts: boolean[]): void {
    const seq = this.seq++;
    this.sentAt.set(seq, performance.now());
    // Cap the unacked window (a seat the server never echoes — spectating,
    // lobby — would otherwise grow it forever).
    if (this.sentAt.size > SENT_WINDOW) this.sentAt.delete(this.sentAt.keys().next().value!);
    this.send({ t: "input", seq, sx, sy, casts });
  }

  /** Stamp a snapshot's arrival: the inter-arrival gap, and — if it echoes a
   * newer lastSeq for our seat — the input round trip for that seq. */
  private noteSnapshot(msg: Extract<ServerMsg, { t: "snapshot" }>, now: number): void {
    const n = this.net;
    n.snaps += 1;
    if (this.lastSnapAt >= 0) {
      const gap = now - this.lastSnapAt;
      n.gapSum += gap;
      n.gapN += 1;
      if (gap > n.gapMax) n.gapMax = gap;
    }
    this.lastSnapAt = now;
    const myId = this.welcome?.playerId;
    if (myId === undefined) return;
    let lastSeq = -1;
    for (let i = 0; i < msg.players.length; i++) {
      const p = msg.players[i]!;
      if (p.id === myId) {
        lastSeq = p.lastSeq;
        break;
      }
    }
    if (lastSeq <= this.ackedSeq) return;
    this.ackedSeq = lastSeq;
    const sent = this.sentAt.get(lastSeq);
    if (sent !== undefined) {
      const rtt = now - sent;
      n.rttSum += rtt;
      n.rttN += 1;
      if (rtt > n.rttMax) n.rttMax = rtt;
      this.liveRtts[this.liveRttCount++ % LIVE_RTT_WINDOW] = rtt;
    }
    // Everything at or below the echoed seq is answered (or superseded).
    for (const seq of this.sentAt.keys()) {
      if (seq > lastSeq) break;
      this.sentAt.delete(seq);
    }
  }

  liveRttMs(): number | null {
    const n = Math.min(this.liveRttCount, LIVE_RTT_WINDOW);
    if (n === 0) return null;
    // Insertion sort into the scratch buffer — 30 entries, called at 2Hz.
    const sorted = this.liveSorted;
    for (let i = 0; i < n; i++) {
      const v = this.liveRtts[i]!;
      let j = i - 1;
      for (; j >= 0 && sorted[j]! > v; j--) sorted[j + 1] = sorted[j]!;
      sorted[j + 1] = v;
    }
    return Math.round(sorted[n >> 1]!);
  }

  readNetStats(): NetStats | null {
    const n = this.net;
    if (n.snaps === 0) return null;
    const out: NetStats = {
      rttAvg: n.rttN > 0 ? n.rttSum / n.rttN : 0,
      rttMax: n.rttMax,
      rttN: n.rttN,
      gapAvg: n.gapN > 0 ? n.gapSum / n.gapN : 0,
      gapMax: n.gapMax,
      snaps: n.snaps,
    };
    n.rttSum = n.rttMax = n.rttN = n.gapSum = n.gapMax = n.gapN = n.snaps = 0;
    return out;
  }

  private send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const t of this.probeTimers) clearTimeout(t);
    this.probeTimers = [];
  }

  /** A short burst of stamped pings so the readout fills fast — on open, and
   * for any screen that wants a fresh number on entry (RankedScreen). */
  probeLatency(): void {
    for (const t of this.probeTimers) clearTimeout(t);
    this.probeTimers = [];
    for (let i = 0; i < RTT_PROBE_COUNT; i++) {
      this.probeTimers.push(setTimeout(() => this.send({ t: "ping", at: performance.now() }), i * RTT_PROBE_GAP_MS));
    }
  }

  close(): void {
    this.onChange = null;
    this.onEvents = null;
    this.stopHeartbeat();
    this.ws.close();
  }
}
