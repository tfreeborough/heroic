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
import type { ArenaEvent } from "./events";
import type { RoundPhase, Team } from "./state";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 7777;

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  | { t: "hello"; v: number; name: string }
  | { t: "input"; seq: number; sx: number; sy: number; dash: boolean };

// ── server → client ────────────────────────────────────────────────────────

/** Everything the renderer needs from the tuning table, sent once at welcome —
 * the client never duplicates sim constants. */
export interface ArenaClientConfig {
  tickRate: number;
  playerRadius: number;
  reach: number;
  arcWidth: number;
  windup: number;
  dashCooldown: number;
  winsToTake: number;
  countdownSeconds: number;
}

export interface PlayerSnapshot {
  id: number;
  team: Team;
  name: string;
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

export interface LobbyPlayer {
  id: number;
  name: string;
  team: Team;
  connected: boolean;
}

export interface SnapshotMsg {
  t: "snapshot";
  tick: number;
  round: RoundSnapshot;
  players: PlayerSnapshot[];
  events: ArenaEvent[];
}

export type ServerMsg =
  | {
      t: "welcome";
      v: number;
      playerId: number;
      team: Team;
      zoneId: string;
      config: ArenaClientConfig;
    }
  | { t: "lobby"; players: LobbyPlayer[] }
  | SnapshotMsg
  | { t: "reject"; reason: string };
