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
import type { AbilityId, WeaponId } from "./config";
import type { ArenaEvent } from "./events";
import type { RoundPhase, Team } from "./state";

/**
 * v2 (2026-07-09): rooms + host-driven lobbies replaced the single global room.
 * v3 (2026-07-10): lobby weapon picks (setWeapon), per-player weapon in
 * snapshots/room state, projectiles in snapshots; per-weapon telegraph config
 * moved off ArenaClientConfig (the client imports WEAPONS, like ARENA_00).
 * v4 (2026-07-12): `slowed` on player snapshots (the hammer's slow debuff
 * replaced its knockback — the client renders a slowed marker).
 * v5 (2026-07-12): `slowed` → `slowLeft` + `bleedLeft` seconds — the client's
 * status rings pulse faster as the effect nears expiry, which needs time, not
 * a flag.
 * v6 (2026-07-12): the pick ceremony (pvp-pick-ceremony.md). roomState becomes
 * VIEWER-DEPENDENT (per-team weapon/ability filtering; adds `picked`, `locked`,
 * `revealed`, `revealedAbilities`), RoundPhase gains "pick" + "reveal", client
 * gains `lockIn` (all-locked ends a draft phase early), and snapshots scrub
 * `weapon` during the hidden-pick phases. Ability loadouts ride the draft
 * (setAbilities), picked via the loadout sheet.
 * v7 (2026-07-13): the host owns the room — when the host leaves (or is gone
 * after the match), the room closes for everyone instead of migrating the crown.
 * Adds `roomClosed` (a kick with a reason; the client drops back to the list).
 */
export const PROTOCOL_VERSION = 7;
export const DEFAULT_PORT = 7777;

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  | { t: "createRoom"; v: number; playerName: string; roomName?: string; pass?: string }
  | { t: "joinRoom"; v: number; code: string; playerName: string; pass?: string }
  | { t: "listRooms" }
  /** Spectate without taking a seat (debug tooling now; bench-viewing later). */
  | { t: "watchRoom"; code: string }
  | { t: "leaveRoom" }
  /** Weapon pick — lobby or an open draft phase (rejected once locked in). */
  | { t: "setWeapon"; weapon: WeaponId }
  /** The whole drafted hand each change (idempotent) — same gate as setWeapon. */
  | { t: "setAbilities"; abilities: AbilityId[] }
  /** "I'm done adjusting" during a draft phase; everyone locked ends it early. */
  | { t: "lockIn" }
  /** Host only; ignored unless the lobby is full and connected. */
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
  /** Drives the per-player telegraph (reach/arc/windup from WEAPONS[weapon]).
   * Scrubbed to null for EVERYONE while the phase is lobby/reveal — snapshots
   * are one uniform broadcast and must not leak hidden picks. */
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
  /** Seconds left on the hammer's movement slow (0 = unslowed) — drives the
   * blue status ring, whose pulse quickens as this runs out. */
  slowLeft: number;
  /** Seconds until the last pending bleed tick lands (0 = clean) — the red
   * status ring, same pulse rule. */
  bleedLeft: number;
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
  /** VIEWER-DEPENDENT: the live pick for your own team; always null for the
   * enemy team (their pick is hidden — see `revealed`) and for watchers. */
  weapon: WeaponId | null;
  /** VIEWER-DEPENDENT like `weapon`: drafted abilities in button order. */
  abilities: AbilityId[] | null;
  /** Public: has this player picked — enemies see "ready"/"choosing…". */
  picked: boolean;
  /** Public: locked in for this draft phase (the League-style check mark). */
  locked: boolean;
  /** Public: the pick snapshotted at lock-in, shown to both teams through the
   * adjust window. Post-reveal repicks do NOT update this — that's the game. */
  revealed: WeaponId | null;
  /** Public partner of `revealed` for the drafted abilities. */
  revealedAbilities: AbilityId[] | null;
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
  /** The room was closed under you (host left / gone after the match) — the
   * client drops its seat and returns to the list showing `reason`. */
  | { t: "roomClosed"; reason: string }
  | SnapshotMsg
  | { t: "reject"; reason: string };
