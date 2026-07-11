/**
 * One room: a lobby-plus-match owned by its host. All game rules live in
 * @heroic/blood-in-the-sand-sim — this class is transport: it turns socket
 * traffic into per-tick inputs, broadcasts snapshots on the room's topic, and
 * keeps the seat/host bookkeeping honest. The RoomManager owns the clock; a
 * room never sets its own timers.
 *
 * Input model per player:
 * - stick: latest-input-wins (an old stick sample is worthless).
 * - dash: an OR-latch — a press that lands between ticks is held until the
 *   next simulated step, so a tap is never lost to timing.
 */
import type { Server, ServerWebSocket } from "bun";
import {
  ARENA_00,
  PROTOCOL_VERSION,
  SNAPSHOT_DIVISOR,
  TICK_DT,
  addPlayer,
  createSim,
  makeClientConfig,
  markDisconnected,
  reconnectPlayer,
  removePlayer,
  sanitizeInput,
  seatedPlayers,
  setPlayerWeapon,
  startMatch,
  stepSim,
  toRoomStatePlayers,
  toSnapshot,
  type ArenaEvent,
  type ArenaSim,
  type ClientMsg,
  type PlayerInput,
  type RoomListing,
  type ServerMsg,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";

export interface ClientData {
  roomCode: string | null;
  playerId: number | null;
}

export type Socket = ServerWebSocket<ClientData>;

export interface RoomMeta {
  code: string;
  name: string;
  passcode: string | null;
  hostId: number;
}

export class Room {
  readonly meta: RoomMeta;
  readonly sim: ArenaSim;
  /** When the last connected player left, for the GC sweep. Null while occupied. */
  emptySinceMs: number | null;

  private readonly server: Server<ClientData>;
  private readonly seats = new Map<number, Socket>();
  private readonly inputs = new Map<number, PlayerInput>();
  private readonly dashLatch = new Set<number>();
  private eventBuffer: ArenaEvent[] = [];
  private lastRoomStateKey = "";

  constructor(server: Server<ClientData>, meta: RoomMeta, seed: number, nowMs: number) {
    this.server = server;
    this.meta = meta;
    this.sim = createSim(ARENA_00, seed);
    this.emptySinceMs = nowMs; // occupied the moment the creator is seated
  }

  private get topic(): string {
    return `room:${this.meta.code}`;
  }

  connectedCount(): number {
    return seatedPlayers(this.sim.state).filter((p) => p.connected).length;
  }

  listing(): RoomListing {
    return {
      code: this.meta.code,
      name: this.meta.name,
      players: this.connectedCount(),
      capacity: this.sim.state.players.length,
      locked: this.meta.passcode !== null,
      phase: this.sim.state.round.phase === "lobby" ? "lobby" : "in-match",
    };
  }

  hasFreeSeatInLobby(): boolean {
    return this.sim.state.round.phase === "lobby" && this.sim.state.players.includes(null);
  }

  hasDisconnectedSeat(): boolean {
    return seatedPlayers(this.sim.state).some((p) => !p.connected);
  }

  /**
   * Seat a validated joiner: a disconnected seat is reclaimed first (mid-match
   * rejoin takes over the live body), else a free lobby seat. Returns the
   * player id, or null if the room filled up in the meantime.
   */
  seat(ws: Socket, name: string, nowMs: number): number | null {
    const ghost = seatedPlayers(this.sim.state).find((p) => !p.connected);
    let playerId: number | null = null;
    if (ghost) {
      reconnectPlayer(this.sim, ghost.id, name);
      playerId = ghost.id;
    } else {
      playerId = addPlayer(this.sim, name)?.id ?? null;
    }
    if (playerId === null) return null;

    // A stale socket may still hold the seat (rejoin racing the close event).
    this.seats.get(playerId)?.close();
    this.seats.set(playerId, ws);
    ws.data.roomCode = this.meta.code;
    ws.data.playerId = playerId;
    ws.subscribe(this.topic);
    this.emptySinceMs = null;

    const player = this.sim.state.players[playerId]!;
    this.send(ws, {
      t: "welcome",
      v: PROTOCOL_VERSION,
      playerId,
      team: player.team,
      roomCode: this.meta.code,
      roomName: this.meta.name,
      hostId: this.meta.hostId,
      zoneId: this.sim.zone.id,
      config: makeClientConfig(),
    });
    this.syncRoomState(nowMs);
    return playerId;
  }

  watch(ws: Socket): void {
    ws.data.roomCode = this.meta.code;
    ws.data.playerId = null;
    ws.subscribe(this.topic);
    this.send(ws, { t: "watching", roomCode: this.meta.code, roomName: this.meta.name });
  }

  /**
   * A seated socket left (message or close). Lobby: the seat frees. Mid-match:
   * the body idles and stays killable — the match NEVER pauses (2026-07-09).
   */
  dropSocket(ws: Socket, nowMs: number): void {
    const id = ws.data.playerId;
    ws.unsubscribe(this.topic);
    ws.data.roomCode = null;
    ws.data.playerId = null;
    if (id === null) return; // watcher

    if (this.seats.get(id) !== ws) return; // superseded by a rejoin
    this.seats.delete(id);
    if (this.sim.state.round.phase === "lobby") {
      removePlayer(this.sim, id);
    } else {
      markDisconnected(this.sim, id);
      console.log(`[${this.meta.code}] player ${id} dropped — body idles on`);
    }
    this.syncRoomState(nowMs);
  }

  startByHost(playerId: number): void {
    if (playerId !== this.meta.hostId) return;
    if (startMatch(this.sim, this.eventBuffer)) {
      console.log(`[${this.meta.code}] host started a match`);
    }
  }

  /** A lobby weapon pick; the roomState diff broadcasts the change. */
  setWeapon(playerId: number, weapon: WeaponId, nowMs: number): void {
    if (setPlayerWeapon(this.sim, playerId, weapon)) this.syncRoomState(nowMs);
  }

  input(playerId: number, msg: Extract<ClientMsg, { t: "input" }>): void {
    const input = sanitizeInput({ seq: msg.seq, sx: msg.sx, sy: msg.sy, dash: msg.dash });
    this.inputs.set(playerId, input);
    if (input.dash) this.dashLatch.add(playerId);
  }

  /** Advance `steps` fixed ticks and broadcast. Called by the manager's loop. */
  step(steps: number, nowMs: number): void {
    for (let i = 0; i < steps; i++) {
      const stepInputs = new Map<number, PlayerInput>();
      for (const [id, input] of this.inputs) {
        // The latch fires on the first catch-up step only — one press, one dash.
        stepInputs.set(id, { ...input, dash: i === 0 && this.dashLatch.has(id) });
      }
      this.eventBuffer.push(...stepSim(this.sim, stepInputs, TICK_DT));
    }
    this.dashLatch.clear();
    this.logEvents();

    if (this.sim.state.tick % SNAPSHOT_DIVISOR === 0) {
      this.broadcast(toSnapshot(this.sim.state, this.eventBuffer));
      this.eventBuffer = [];
    }

    // The sim itself can change membership (ghost seats freed at lobby return)
    // — diffing here catches that without event plumbing.
    this.syncRoomState(nowMs);
  }

  /** Host migration + roomState broadcast + empty tracking, on any change. */
  private syncRoomState(nowMs: number): void {
    // Host gone entirely (seat freed)? Crown the lowest occupied seat.
    if (!this.sim.state.players[this.meta.hostId]) {
      const next = seatedPlayers(this.sim.state)[0];
      if (next) {
        this.meta.hostId = next.id;
        console.log(`[${this.meta.code}] host left — crown passes to ${next.name}`);
      }
    }
    this.emptySinceMs = this.connectedCount() === 0 ? (this.emptySinceMs ?? nowMs) : null;

    const players = toRoomStatePlayers(this.sim.state);
    const key = JSON.stringify([players, this.meta.hostId]);
    if (key !== this.lastRoomStateKey) {
      this.lastRoomStateKey = key;
      this.broadcast({ t: "roomState", players, hostId: this.meta.hostId });
    }
  }

  private logEvents(): void {
    for (const e of this.eventBuffer) {
      const tag = `[${this.meta.code}]`;
      if (e.type === "roundStart") console.log(`${tag} — round ${e.roundNumber} —`);
      else if (e.type === "roundEnd") console.log(`${tag} round to team ${e.winnerTeam} · ${e.wins[0]}–${e.wins[1]}`);
      else if (e.type === "matchEnd") console.log(`${tag} ★ MATCH to team ${e.winnerTeam} ★`);
    }
  }

  private send(ws: Socket, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    this.server.publish(this.topic, JSON.stringify(msg));
  }
}
