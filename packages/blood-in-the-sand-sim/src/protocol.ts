/**
 * The wire contract — pure types shared by the Bun server and the Expo client
 * (the realmsmith forge/protocol.ts precedent). JSON text frames over a
 * WebSocket; every message is a tagged union so fields stay strictly-additive.
 *
 * Design notes:
 * - Snapshots go out every tick (30Hz ≈ 21KB/s per client — nothing on LAN);
 *   SNAPSHOT_DIVISOR in config.ts is the one-constant path to 15Hz later.
 * - Transient events ride INSIDE snapshots: the socket is already ordered and
 *   reliable, so one stream needs no second channel.
 * - The zone itself is never sent — both ends import ARENA_00 from this
 *   package; `welcome.zoneId` only asserts they agree.
 */
import type { AttackPhase } from "@heroic/core";
import type { WeaponId } from "./config";
import type { ArenaEvent } from "./events";
import type { RoundPhase, Team } from "./state";

/**
 * v2 (2026-07-09): rooms + host-driven lobbies replaced the single global room.
 * v3 (2026-07-10): lobby weapon picks (setWeapon), per-player weapon in
 * snapshots/room state, projectiles in snapshots; per-weapon telegraph config
 * moved off ArenaClientConfig (the client imports WEAPONS, like ARENA_00).
 * v4 (2026-07-12): `slowed` on player snapshots (the hammer's slow debuff
 * replaced its knockback — the client renders a slowed marker).
 */
export const PROTOCOL_VERSION = 4;
export const DEFAULT_PORT = 7777;

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  | { t: "createRoom"; v: number; playerName: string; roomName?: string; pass?: string }
  | { t: "joinRoom"; v: number; code: string; playerName: string; pass?: string }
  | { t: "listRooms" }
  /** Spectate without taking a seat (debug tooling now; bench-viewing later). */
  | { t: "watchRoom"; code: string }
  | { t: "leaveRoom" }
  /** Lobby weapon pick (repick freely until the match starts). */
  | { t: "setWeapon"; weapon: WeaponId }
  /** Host only; ignored unless the lobby is full, connected, and all-picked. */
  | { t: "startMatch" }
  | { t: "input"; seq: number; sx: number; sy: number; dash: boolean };

// ── server → client ────────────────────────────────────────────────────────

/** Everything the renderer needs from the tuning table, sent once at welcome —
 * the client never duplicates sim constants. (Per-weapon telegraph numbers are
 * NOT here: the client imports WEAPONS from this package, the ARENA_00 rule.) */
export interface ArenaClientConfig {
  tickRate: number;
  playerRadius: number;
  dashCooldown: number;
  winsToTake: number;
  countdownSeconds: number;
}

export interface PlayerSnapshot {
  id: number;
  team: Team;
  name: string;
  /** Drives the per-player telegraph (reach/arc/windup from WEAPONS[weapon]). */
  weapon: WeaponId | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  facing: number;
  /** Attack phase + seconds left in it — the windup telegraph derives from these. */
  atk: AttackPhase;
  atkLeft: number;
  /** Arc telegraph direction, latched at windup start. */
  lockedFacing: number;
  dashing: boolean;
  /** Under the hammer's movement slow — the client marks slowed bodies. */
  slowed: boolean;
  /** Dash cooldown seconds remaining — drives the button's clock overlay. */
  dashCd: number;
  /** Last input seq the sim applied for this player — latency debugging. */
  lastSeq: number;
}

export interface RoundSnapshot {
  phase: RoundPhase;
  timer: number;
  roundNumber: number;
  wins: [number, number];
  lastWinner: Team | 0;
}

export interface RoomStatePlayer {
  id: number;
  name: string;
  team: Team;
  connected: boolean;
  /** null until the player picks — the lobby shows "choosing…". */
  weapon: WeaponId | null;
}

/** A live shot, projected for rendering (the client lerps x/y/angle by id). */
export interface ProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  /** Travel direction, radians. */
  angle: number;
  weapon: WeaponId;
}

/** Public directory entry — never carries the passcode. */
export interface RoomListing {
  code: string;
  name: string;
  players: number;
  capacity: number;
  locked: boolean;
  phase: "lobby" | "in-match";
}

export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  round: RoundSnapshot;
  players: PlayerSnapshot[];
  projectiles: ProjectileSnapshot[];
  events: ArenaEvent[];
}

export type ServerMsg =
  | {
      t: "welcome";
      v: number;
      playerId: number;
      team: Team;
      roomCode: string;
      roomName: string;
      hostId: number;
      zoneId: string;
      config: ArenaClientConfig;
    }
  | { t: "rooms"; rooms: RoomListing[] }
  /** Membership/host changes — sent to the room on join/leave/migration. */
  | { t: "roomState"; players: RoomStatePlayer[]; hostId: number }
  /** Watcher acknowledgment (no seat, snapshots only). */
  | { t: "watching"; roomCode: string; roomName: string }
  /** You left (or were never in) a room — back to the room list. */
  | { t: "left" }
  | SnapshotMsg
  | { t: "reject"; reason: string };
