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
        // Kicked because the host left / is gone. Drop the seat and fall back to
        // the room list, surfacing the reason there.
        this.welcome = null;
        this.roomState = null;
        this.phase = "lobby";
        this.lastError = msg.reason;
        this.buffer.reset();
        this.listRooms();
        this.onChange?.();
        return;
      case "snapshot": {
        const events = this.buffer.push(msg, performance.now());
        if (events.length > 0) this.onEvents?.(events);
        if (msg.round.phase !== this.phase) {
          this.phase = msg.round.phase; // lobby ↔ match transitions re-route the UI
          this.onChange?.();
        }
        return;
      }
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

  createRoom(playerName: string, roomName: string, pass: string, teamSize: number): void {
    this.lastError = null;
    this.send({
      t: "createRoom",
      v: PROTOCOL_VERSION,
      playerName,
      roomName,
      teamSize,
      // The announcer pack is claimed at seat time (like the name) — read here
      // rather than passed in, so every screen's create/join carries it.
      announcer: getActiveAnnouncer(),
      ...(pass.trim() ? { pass: pass.trim() } : {}),
    });
  }

  joinRoom(playerName: string, code: string, pass: string): void {
    this.lastError = null;
    this.send({
      t: "joinRoom",
      v: PROTOCOL_VERSION,
      code: code.trim().toUpperCase(),
      playerName,
      announcer: getActiveAnnouncer(),
      ...(pass.trim() ? { pass: pass.trim() } : {}),
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
