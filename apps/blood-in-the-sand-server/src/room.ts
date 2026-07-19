/**
 * One room: a lobby-plus-match owned by its host. All game rules live in
 * @heroic/blood-in-the-sand-sim — this class is transport: it turns socket
 * traffic into per-tick inputs, broadcasts snapshots on the room's topic, and
 * keeps the seat/host bookkeeping honest. The RoomManager owns the clock; a
 * room never sets its own timers.
 *
 * Input model per player:
 * - stick: latest-input-wins (an old stick sample is worthless).
 * - ability presses: an OR-latch per slot — a press that lands between ticks
 *   is held until the next simulated step, so a tap is never lost to timing.
 */
import type { Server, ServerWebSocket } from "bun";
import {
  ARENA_00,
  PROTOCOL_VERSION,
  SNAPSHOT_DIVISOR,
  TICK_DT,
  addPlayer,
  createSim,
  forceStartMatch,
  makeClientConfig,
  markDisconnected,
  nextHost,
  reconnectPlayer,
  removePlayer,
  sanitizeInput,
  seatedPlayers,
  setPlayerAbilities,
  setPlayerWeapon,
  stepSim,
  toRoomStatePlayers,
  toSnapshot,
  type ArenaEvent,
  type ArenaSim,
  type ClientMsg,
  type PlayerInput,
  type RoomListing,
  type ServerMsg,
  type AbilityId,
  type Team,
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
  /** Last time (ms) we heard ANYTHING from each seated socket — the heartbeat
   * sweep frees a seat gone silent past HEARTBEAT_TIMEOUT_MS (a ghost that
   * never sent a close frame). Keyed by playerId, mirrors `seats`. */
  private readonly lastSeen = new Map<number, number>();
  /** The outgoing host's name, stashed the instant their seat is dropped — the
   * sim player object may be gone by the time the crown reassigns, so the
   * "X left" half of the handoff notice is captured here. */
  private departedHostName: string | null = null;
  /** Seatless spectators — they get the neutral (team-0) roomState view. */
  private readonly watchers = new Set<Socket>();
  private readonly inputs = new Map<number, PlayerInput>();
  /** Per-player OR-latch of ability presses since the last simulated step. */
  private readonly castLatch = new Map<number, boolean[]>();
  private eventBuffer: ArenaEvent[] = [];
  private lastRoomStateKey = "";

  constructor(server: Server<ClientData>, meta: RoomMeta, seed: number, teamSize: number, nowMs: number) {
    this.server = server;
    this.meta = meta;
    this.sim = createSim(ARENA_00, seed, teamSize);
    this.emptySinceMs = nowMs; // occupied the moment the creator is seated
  }

  private get topic(): string {
    return `room:${this.meta.code}`;
  }

  connectedCount(): number {
    return seatedPlayers(this.sim.state).filter((p) => p.connected).length;
  }

  /** No bodies left at all — every seat freed. (Distinct from "no CONNECTED
   * seats": mid-match, disconnected players keep their idling seat for the
   * rejoin-resume window, so such a room is NOT deserted and must survive.) */
  isDeserted(): boolean {
    return seatedPlayers(this.sim.state).length === 0;
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
    this.lastSeen.set(playerId, nowMs); // fresh — don't sweep a just-seated player
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
      teamSize: this.sim.state.players.length / 2,
      roomCode: this.meta.code,
      roomName: this.meta.name,
      hostId: this.meta.hostId,
      zoneId: this.sim.zone.id,
      config: makeClientConfig(),
    });
    this.syncRoomState(nowMs);
    return playerId;
  }

  /** Tear the room down: tell every seat and watcher why, detach them, and let
   * the manager drop the room from its registry. Idempotent. */
  kickAll(reason: string): void {
    const msg: ServerMsg = { t: "roomClosed", reason };
    for (const ws of this.seats.values()) this.detach(ws, msg);
    for (const ws of this.watchers) this.detach(ws, msg);
    this.seats.clear();
    this.lastSeen.clear();
    this.watchers.clear();
  }

  private detach(ws: Socket, farewell: ServerMsg): void {
    this.send(ws, farewell);
    ws.unsubscribe(this.topic);
    ws.data.roomCode = null;
    ws.data.playerId = null;
  }

  watch(ws: Socket): void {
    ws.data.roomCode = this.meta.code;
    ws.data.playerId = null;
    ws.subscribe(this.topic);
    this.watchers.add(ws);
    this.send(ws, { t: "watching", roomCode: this.meta.code, roomName: this.meta.name });
    this.send(ws, this.roomStateFor(0));
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
    if (id === null) {
      this.watchers.delete(ws);
      return;
    }

    if (this.seats.get(id) !== ws) return; // superseded by a rejoin
    this.seats.delete(id);
    this.lastSeen.delete(id);
    // Capture the departing host's name NOW — reassignHost runs after the sim
    // may have removed the player object, so "X left" can't be read back then.
    if (id === this.meta.hostId) this.departedHostName = this.sim.state.players[id]?.name ?? null;
    if (this.sim.state.round.phase === "lobby") {
      removePlayer(this.sim, id);
    } else {
      markDisconnected(this.sim, id);
      console.log(`[${this.meta.code}] player ${id} dropped — body idles on`);
    }
    this.syncRoomState(nowMs);
  }

  /** Stamp a seated socket as alive (called for every inbound message). */
  markSeen(playerId: number, nowMs: number): void {
    if (this.seats.has(playerId)) this.lastSeen.set(playerId, nowMs);
  }

  /** Drop every seat gone silent past `timeoutMs` — a ghost that force-quit or
   * lost its network without a close frame. Each drop runs the normal
   * dropSocket path (lobby → seat freed; mid-match → body idles on). */
  sweepStale(nowMs: number, timeoutMs: number): void {
    const stale: Socket[] = [];
    for (const [id, ws] of this.seats) {
      if (nowMs - (this.lastSeen.get(id) ?? nowMs) > timeoutMs) stale.push(ws);
    }
    for (const ws of stale) {
      console.log(`[${this.meta.code}] player ${ws.data.playerId} timed out (${timeoutMs}ms silent) — freeing ghost seat`);
      this.dropSocket(ws, nowMs); // sim bookkeeping first…
      ws.close(); // …then release the dead socket
    }
  }

  /**
   * Make sure the crown sits on a CONNECTED seated player. Returns the handoff
   * (old + new names) if it moved — the manager turns that into a lobby notice
   * — "empty" if nobody's left to hold it (the manager closes the room), or
   * null if the current host is fine. Idempotent: a no-op on a healthy room.
   */
  reassignHost(nowMs: number): { from: string; to: string } | "empty" | null {
    const connected = seatedPlayers(this.sim.state)
      .filter((p) => p.connected)
      .map((p) => p.id);
    const next = nextHost(connected, this.meta.hostId);
    if (next === null) return "empty";
    if (next === this.meta.hostId) return null;

    const from = this.departedHostName ?? this.sim.state.players[this.meta.hostId]?.name ?? "The host";
    const to = this.sim.state.players[next]?.name ?? "A player";
    this.departedHostName = null;
    this.meta.hostId = next;
    this.syncRoomState(nowMs); // the new hostId rides the roomState diff to everyone
    console.log(`[${this.meta.code}] host handed off: ${from} → ${to}`);
    return { from, to };
  }

  /** Broadcast a transient lobby toast to the whole room (host handoff). */
  notice(text: string): void {
    this.broadcast({ t: "notice", text });
  }

  /** The host's start-early control: fills every unarmed seat AND overrides
   * the full-room gate on a partial lobby, then the sim's own 5s arming
   * countdown runs (the machine notices the gate passing — the server never
   * starts a match; pvp-loadout-flow.md). */
  forceStart(playerId: number, nowMs: number): void {
    if (playerId !== this.meta.hostId) return;
    if (forceStartMatch(this.sim)) {
      console.log(`[${this.meta.code}] host force-started — stragglers auto-armed, empty seats waived`);
      this.syncRoomState(nowMs);
    }
  }

  /** A lobby weapon pick; the roomState diff sends the change. */
  setWeapon(playerId: number, weapon: WeaponId, nowMs: number): void {
    if (setPlayerWeapon(this.sim, playerId, weapon)) this.syncRoomState(nowMs);
  }

  /** The picked hand (whole list each change); same lobby-only gate. */
  setAbilities(playerId: number, abilities: AbilityId[], nowMs: number): void {
    if (setPlayerAbilities(this.sim, playerId, abilities)) this.syncRoomState(nowMs);
  }

  input(playerId: number, msg: Extract<ClientMsg, { t: "input" }>): void {
    const input = sanitizeInput({ seq: msg.seq, sx: msg.sx, sy: msg.sy, casts: msg.casts });
    this.inputs.set(playerId, input);
    if (input.casts.some(Boolean)) {
      const latch = this.castLatch.get(playerId) ?? input.casts.map(() => false);
      for (let i = 0; i < input.casts.length; i++) latch[i] = latch[i] || input.casts[i]!;
      this.castLatch.set(playerId, latch);
    }
  }

  /** Advance `steps` fixed ticks and broadcast. Called by the manager's loop. */
  step(steps: number, nowMs: number): void {
    const noCasts: boolean[] = [];
    for (let i = 0; i < steps; i++) {
      const stepInputs = new Map<number, PlayerInput>();
      for (const [id, input] of this.inputs) {
        // The latch fires on the first catch-up step only — one press, one cast.
        stepInputs.set(id, { ...input, casts: i === 0 ? (this.castLatch.get(id) ?? noCasts) : noCasts });
      }
      this.eventBuffer.push(...stepSim(this.sim, stepInputs, TICK_DT));
    }
    this.castLatch.clear();
    this.logEvents();

    if (this.sim.state.tick % SNAPSHOT_DIVISOR === 0) {
      this.broadcast(toSnapshot(this.sim.state, this.eventBuffer));
      this.eventBuffer = [];
    }

    // The sim itself can change membership (ghost seats freed at lobby return)
    // — diffing here catches that without event plumbing.
    this.syncRoomState(nowMs);
  }

  /** roomState broadcast + empty tracking, on any change. (Host handoff rides
   * this too: reassignHost mutates meta.hostId then calls here, so the new
   * crown reaches every viewer through the roomState diff — see the manager's
   * reconcileHost.) */
  private syncRoomState(nowMs: number): void {
    this.emptySinceMs = this.connectedCount() === 0 ? (this.emptySinceMs ?? nowMs) : null;

    // Diff on the OMNISCIENT roster (any viewer's view derives from it), but
    // send per-viewer: live picks are team secrets, so roomState can't ride
    // the room topic any more (pvp-pick-ceremony.md).
    const key = JSON.stringify([
      seatedPlayers(this.sim.state).map((p) => [
        p.id, p.name, p.team, p.connected, p.weapon, p.abilities,
      ]),
      this.meta.hostId,
    ]);
    if (key !== this.lastRoomStateKey) {
      this.lastRoomStateKey = key;
      const byTeam = new Map<Team | 0, ServerMsg>();
      const viewFor = (team: Team | 0): ServerMsg => {
        let msg = byTeam.get(team);
        if (!msg) byTeam.set(team, (msg = this.roomStateFor(team)));
        return msg;
      };
      for (const [id, ws] of this.seats) {
        const team = this.sim.state.players[id]?.team;
        if (team) this.send(ws, viewFor(team));
      }
      for (const ws of this.watchers) this.send(ws, viewFor(0));
    }
  }

  private roomStateFor(viewerTeam: Team | 0): ServerMsg {
    return {
      t: "roomState",
      players: toRoomStatePlayers(this.sim.state, viewerTeam),
      hostId: this.meta.hostId,
    };
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
