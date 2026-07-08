/**
 * The single match room: owns the ArenaSim, turns socket traffic into per-tick
 * inputs, and broadcasts snapshots. All game rules live in @heroic/blood-in-the-sand-sim —
 * this file is pure transport (that's what keeps the sim headless-testable).
 *
 * Input model per player:
 * - stick: latest-input-wins (an old stick sample is worthless).
 * - dash: an OR-latch — a press that lands between ticks is held until the
 *   next simulated step, so a tap is never lost to timing.
 */
import type { Server, ServerWebSocket } from "bun";
import { advanceFixed } from "@heroic/core";
import {
  ARENA_00,
  PROTOCOL_VERSION,
  SNAPSHOT_DIVISOR,
  TICK_DT,
  TICK_RATE,
  addPlayer,
  createSim,
  makeClientConfig,
  markDisconnected,
  reconnectPlayer,
  sanitizeInput,
  stepSim,
  toLobby,
  toSnapshot,
  type ArenaEvent,
  type ArenaSim,
  type ClientMsg,
  type PlayerInput,
  type ServerMsg,
} from "@heroic/blood-in-the-sand-sim";

export interface ClientData {
  playerId: number | null;
}

type Socket = ServerWebSocket<ClientData>;

const TOPIC = "room";
const MAX_NAME = 16;

export class Room {
  private sim: ArenaSim;
  private server: Server<ClientData> | null = null;
  private readonly inputs = new Map<number, PlayerInput>();
  private readonly dashLatch = new Set<number>();
  private eventBuffer: ArenaEvent[] = [];
  private accumulator = 0;
  private lastMs = 0;

  constructor(seed: number = Date.now() >>> 0) {
    this.sim = createSim(ARENA_00, seed);
  }

  start(server: Server<ClientData>): void {
    this.server = server;
    this.lastMs = performance.now();
    // ~30 firings/s, but each firing measures REAL elapsed time and runs the
    // accumulator — interval jitter never drifts the sim clock.
    setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  open(ws: Socket): void {
    // Subscribe before hello: sockets that never claim a slot still receive
    // snapshots, which makes any connected client a free spectator/debug view.
    ws.subscribe(TOPIC);
  }

  message(ws: Socket, raw: string | Buffer): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return; // not our protocol — drop it
    }
    if (msg.t === "hello") this.onHello(ws, msg);
    else if (msg.t === "input") this.onInput(ws, msg);
  }

  close(ws: Socket): void {
    const id = ws.data.playerId;
    if (id === null) return;
    ws.data.playerId = null;
    this.inputs.delete(id);
    this.dashLatch.delete(id);
    markDisconnected(this.sim, id);
    console.log(`✝ player ${id} disconnected — match paused`);
    this.broadcast({ t: "lobby", players: toLobby(this.sim.state) });
  }

  private onHello(ws: Socket, msg: Extract<ClientMsg, { t: "hello" }>): void {
    if (ws.data.playerId !== null) return; // already seated
    if (msg.v !== PROTOCOL_VERSION) {
      this.send(ws, { t: "reject", reason: `protocol mismatch (server v${PROTOCOL_VERSION}, you v${msg.v})` });
      return;
    }
    const name = (typeof msg.name === "string" ? msg.name : "").trim().slice(0, MAX_NAME) || "player";

    let playerId: number | null = null;
    const vacant = this.sim.state.players.find((p) => !p.connected);
    if (this.sim.state.players.length < 2) {
      playerId = addPlayer(this.sim, name)?.id ?? null;
    } else if (vacant) {
      reconnectPlayer(this.sim, vacant.id, name);
      playerId = vacant.id;
    }
    if (playerId === null) {
      this.send(ws, { t: "reject", reason: "room full" });
      return;
    }

    ws.data.playerId = playerId;
    const player = this.sim.state.players[playerId]!;
    console.log(`⚔ ${name} joined as player ${playerId} (team ${player.team})`);
    this.send(ws, {
      t: "welcome",
      v: PROTOCOL_VERSION,
      playerId,
      team: player.team,
      zoneId: this.sim.zone.id,
      config: makeClientConfig(),
    });
    this.broadcast({ t: "lobby", players: toLobby(this.sim.state) });
  }

  private onInput(ws: Socket, msg: Extract<ClientMsg, { t: "input" }>): void {
    const id = ws.data.playerId;
    if (id === null) return;
    const input = sanitizeInput({ seq: msg.seq, sx: msg.sx, sy: msg.sy, dash: msg.dash });
    this.inputs.set(id, input);
    if (input.dash) this.dashLatch.add(id);
  }

  private tick(): void {
    const now = performance.now();
    const elapsed = (now - this.lastMs) / 1000;
    this.lastMs = now;

    const result = advanceFixed(this.accumulator, elapsed, { step: TICK_DT, maxSteps: 4 });
    this.accumulator = result.accumulator;
    if (result.steps === 0) return;

    for (let i = 0; i < result.steps; i++) {
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
  }

  private logEvents(): void {
    for (const e of this.eventBuffer) {
      if (e.type === "roundStart") console.log(`— round ${e.roundNumber} —`);
      else if (e.type === "roundEnd") console.log(`round to team ${e.winnerTeam} · score ${e.wins[0]}–${e.wins[1]}`);
      else if (e.type === "matchEnd") console.log(`★ MATCH to team ${e.winnerTeam} ★`);
      else if (e.type === "death") console.log(`☠ player ${e.playerId} down`);
    }
  }

  private send(ws: Socket, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg): void {
    this.server?.publish(TOPIC, JSON.stringify(msg));
  }
}
