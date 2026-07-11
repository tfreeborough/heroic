/**
 * The room registry + the one clock. Rooms live purely in this process's
 * memory (decided 2026-07-09 — a room is exactly as ephemeral as the match
 * inside it, so a DB would only persist pointers to vanished matches).
 *
 * One 30Hz interval steps every room off a single real-time accumulator; a
 * 60s sweep collects rooms that have sat empty past the grace window. The
 * decision logic (codes, join rules, GC policy) is pure in the sim package.
 */
import type { Server } from "bun";
import { advanceFixed } from "@heroic/core";
import {
  MAX_ROOMS,
  PROTOCOL_VERSION,
  TICK_DT,
  TICK_RATE,
  WEAPONS,
  canJoin,
  generateRoomCode,
  sanitizePasscode,
  sanitizeRoomName,
  shouldCollect,
  type ClientMsg,
  type RoomListing,
  type ServerMsg,
} from "@heroic/blood-in-the-sand-sim";
import { Room, type ClientData, type Socket } from "./room";

const SWEEP_MS = 60_000;
const MAX_PLAYER_NAME = 16;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private server: Server<ClientData> | null = null;
  private accumulator = 0;
  private lastMs = 0;

  start(server: Server<ClientData>): void {
    this.server = server;
    this.lastMs = performance.now();
    // ~30 firings/s, but each firing measures REAL elapsed time and runs the
    // accumulator — interval jitter never drifts the sim clocks.
    setInterval(() => this.tick(), 1000 / TICK_RATE);
    setInterval(() => this.sweep(), SWEEP_MS);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  message(ws: Socket, raw: string | Buffer): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return; // not our protocol — drop it
    }
    switch (msg.t) {
      case "createRoom":
        return this.onCreate(ws, msg);
      case "joinRoom":
        return this.onJoin(ws, msg);
      case "listRooms":
        return this.sendRooms(ws);
      case "watchRoom":
        return this.onWatch(ws, msg.code);
      case "leaveRoom": {
        this.roomOf(ws)?.dropSocket(ws, performance.now());
        return this.send(ws, { t: "left" });
      }
      case "setWeapon": {
        const id = ws.data.playerId;
        // Never trust the wire: the pick must be a real weapon id.
        if (id !== null && typeof msg.weapon === "string" && msg.weapon in WEAPONS) {
          this.roomOf(ws)?.setWeapon(id, msg.weapon, performance.now());
        }
        return;
      }
      case "startMatch": {
        const id = ws.data.playerId;
        if (id !== null) this.roomOf(ws)?.startByHost(id);
        return;
      }
      case "input": {
        const id = ws.data.playerId;
        if (id !== null) this.roomOf(ws)?.input(id, msg);
        return;
      }
    }
  }

  close(ws: Socket): void {
    this.roomOf(ws)?.dropSocket(ws, performance.now());
  }

  private roomOf(ws: Socket): Room | undefined {
    return ws.data.roomCode === null ? undefined : this.rooms.get(ws.data.roomCode);
  }

  private onCreate(ws: Socket, msg: Extract<ClientMsg, { t: "createRoom" }>): void {
    if (!this.versionOk(ws, msg.v) || this.leaveFirst(ws)) return;
    if (this.rooms.size >= MAX_ROOMS) {
      return this.send(ws, { t: "reject", reason: "the server is at its room limit — try again soon" });
    }
    const playerName = sanitizeName(msg.playerName);
    const code = generateRoomCode(new Set(this.rooms.keys()), Math.random);
    const room = new Room(
      this.server!,
      {
        code,
        name: sanitizeRoomName(msg.roomName, `${playerName}'s room`),
        passcode: sanitizePasscode(msg.pass),
        hostId: 0, // the creator takes seat 0 below
      },
      Date.now() >>> 0,
      performance.now(),
    );
    this.rooms.set(code, room);
    room.seat(ws, playerName, performance.now());
    console.log(`⚔ room ${code} "${room.meta.name}" created by ${playerName}${room.meta.passcode ? " (locked)" : ""}`);
  }

  private onJoin(ws: Socket, msg: Extract<ClientMsg, { t: "joinRoom" }>): void {
    if (!this.versionOk(ws, msg.v) || this.leaveFirst(ws)) return;
    const room = this.rooms.get((msg.code ?? "").trim().toUpperCase());
    if (!room) return this.send(ws, { t: "reject", reason: "no such room" });

    const verdict = canJoin({
      freeSeatInLobby: room.hasFreeSeatInLobby(),
      disconnectedSeat: room.hasDisconnectedSeat(),
      passcode: room.meta.passcode,
      offeredPass: typeof msg.pass === "string" ? msg.pass.trim() : null,
    });
    if (verdict !== "ok") return this.send(ws, { t: "reject", reason: verdict });

    const playerName = sanitizeName(msg.playerName);
    const id = room.seat(ws, playerName, performance.now());
    if (id === null) return this.send(ws, { t: "reject", reason: "room full" });
    console.log(`⚔ ${playerName} joined room ${room.meta.code} as player ${id}`);
  }

  private onWatch(ws: Socket, code: string): void {
    if (this.leaveFirst(ws)) return;
    const room = this.rooms.get((code ?? "").trim().toUpperCase());
    if (!room) return this.send(ws, { t: "reject", reason: "no such room" });
    room.watch(ws);
  }

  private sendRooms(ws: Socket): void {
    const rooms: RoomListing[] = [...this.rooms.values()].map((r) => r.listing());
    this.send(ws, { t: "rooms", rooms });
  }

  /** A socket already in a room must leave it before creating/joining another. */
  private leaveFirst(ws: Socket): boolean {
    this.roomOf(ws)?.dropSocket(ws, performance.now());
    return false; // never blocks — just cleans up
  }

  private versionOk(ws: Socket, v: number): boolean {
    if (v === PROTOCOL_VERSION) return true;
    this.send(ws, {
      t: "reject",
      reason: `protocol mismatch (server v${PROTOCOL_VERSION}, you v${v}) — update the app`,
    });
    return false;
  }

  private tick(): void {
    const now = performance.now();
    const elapsed = (now - this.lastMs) / 1000;
    this.lastMs = now;
    const result = advanceFixed(this.accumulator, elapsed, { step: TICK_DT, maxSteps: 4 });
    this.accumulator = result.accumulator;
    if (result.steps === 0) return;
    for (const room of this.rooms.values()) room.step(result.steps, now);
  }

  private sweep(): void {
    const now = performance.now();
    for (const [code, room] of this.rooms) {
      if (shouldCollect(room.connectedCount(), room.emptySinceMs, now)) {
        this.rooms.delete(code);
        console.log(`✝ room ${code} "${room.meta.name}" collected (empty)`);
      }
    }
  }

  private send(ws: Socket, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }
}

const sanitizeName = (name: unknown): string =>
  ((typeof name === "string" ? name : "").trim().slice(0, MAX_PLAYER_NAME)) || "player";
