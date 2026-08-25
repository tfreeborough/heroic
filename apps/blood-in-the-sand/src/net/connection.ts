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
  /** Players per side — capacity (2×N) and empty-seat rows derive from this. */
  teamSize: number;
  /** The two sides' faction names, [team 1, team 2] — your side renders blue,
   * the other red (bits-bot-backfill.md § team identity). */
  teamNames: [string, string];
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

  /** Fired on status / room / phase changes (drive React re-renders). */
  onChange: (() => void) | null = null;
  /** Fired with each snapshot's freshly-drained events (drive FX/audio). */
  onEvents: ((events: ArenaEvent[]) => void) | null = null;

  private readonly ws: WebSocket;
  private seq = 0;
  /** Heartbeat so the server can tell a quiet-but-alive lobby seat from a ghost
   * (force-quit / lost network with no close frame). Runs only while open. */
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.status = "open";
      this.listRooms();
      this.pingTimer ??= setInterval(() => this.send({ t: "ping" }), HEARTBEAT_INTERVAL_MS);
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
        this.roomState = null;
        this.phase = "lobby";
        lastSeat = null; // the room is gone — the seat can never be reclaimed
        this.lastError = this.rankedMatch && this.rankedResult ? null : msg.reason;
        this.rankedMatch = null;
        this.buffer.reset();
        this.listRooms();
        this.onChange?.();
        return;
      case "snapshot": {
        const events = this.buffer.push(msg, performance.now());
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
      case "matchFound":
        this.queued = false;
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

  /** Unauthenticated queue-size read — RankedScreen's population display. */
  refreshQueueInfo(): void {
    this.send({ t: "queueInfo" });
  }

  createRoom(playerName: string, roomName: string, pass: string, teamSize: number): void {
    this.lastError = null;
    this.queued = false; // entering the skirmish flow leaves the queue server-side
    this.send({
      t: "createRoom",
      v: PROTOCOL_VERSION,
      playerName,
      roomName,
      teamSize,
      // The cosmetics are claimed at seat time (like the name) — read here
      // rather than passed in, so every screen's create/join carries them.
      announcer: getActiveAnnouncer(),
      title: getWornTitle(),
      ...(pass.trim() ? { pass: pass.trim() } : {}),
    });
  }

  joinRoom(playerName: string, code: string, pass: string): void {
    this.lastError = null;
    this.queued = false; // ditto createRoom
    const normalized = code.trim().toUpperCase();
    this.send({
      t: "joinRoom",
      v: PROTOCOL_VERSION,
      code: normalized,
      playerName,
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
    this.roomState = null;
    this.phase = "lobby";
    this.buffer.reset();
    this.listRooms();
    this.onChange?.();
  }

  sendInput(sx: number, sy: number, casts: boolean[]): void {
    this.send({ t: "input", seq: this.seq++, sx, sy, casts });
  }

  private send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  close(): void {
    this.onChange = null;
    this.onEvents = null;
    this.stopHeartbeat();
    this.ws.close();
  }
}
