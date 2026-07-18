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
import type { DeployableKind, ProjectileKind, RoundPhase, Team } from "./state";

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
 * v8 (2026-07-14): abilities are castable (pvp-abilities.md). `input.dash`
 * generalises to `casts[]` (one latched flag per drafted slot); player
 * snapshots carry the slot list (id + cooldown + active seconds — cooldown
 * clocks and body-effect rings derive from these, replacing `dashCd`);
 * snapshots gain `deployables`; projectiles carry `kind` (weapon or harpoon);
 * events gain cast/detonate/heal. `dashCooldown` leaves the welcome config —
 * the client reads ABILITIES[id].cooldown from this package, the WEAPONS rule.
 * Amended 2026-07-15 (still unshipped, folded in): deployables carry `team`
 * (the sandtrap's yours/theirs rendering); slots carry `charges` (the
 * per-round budget); the harpoon is an instant chain — its projectile kind is
 * gone and a `harpoon` event carries the chain-line endpoints.
 * v9 (2026-07-15): the guided loadout flow (pvp-loadout-flow.md) replaces the
 * draft ceremony. GONE: `lockIn` + `startMatch` messages, the `pick`/`reveal`
 * RoundPhases, and `picked`/`locked`/`revealed`/`revealedAbilities` on
 * RoomStatePlayer (there is no reveal, ever — in-match, ability picks show
 * only through cast events, the cast flash). NEW: `armed` on RoomStatePlayer
 * (public: weapon + full hand picked), `forceStart` (host-only AFK backstop —
 * random-fills stragglers, then the same countdown runs). The 5s arming
 * countdown rides `round.timer` while the phase is "lobby" (0 = not running);
 * the `armingComplete` event cues the banner. Snapshots scrub picks in the
 * lobby only.
 * v10 (2026-07-16): loadouts drop from three abilities to two
 * (LOADOUT_ABILITY_COUNT). The wire shape is unchanged (casts[] and the slot
 * list were always variable-length), but the count is a compatibility
 * contract — a two-ability client can't share a match with a three-ability
 * server — so the version gates it.
 * v11 (2026-07-16): events gain `shoot` — a ranged weapon loosing a projectile,
 * so the bow/staff SFX fires on release (every shot) instead of only on impact.
 * Purely additive (older clients would ignore an unknown event), but bumped per
 * convention so client and server agree on the event vocabulary.
 * v12 (2026-07-16): host-selectable team sizes (1v1–4v4). `createRoom` gains
 * `teamSize` (1–4 → 2×N seats, sanitized server-side); `welcome` gains
 * `teamSize` (the client renders capacity/empty seats from it). Team
 * assignment is random-balanced server-side (join the smaller side, sim-rng
 * coin-flip on ties). The arming countdown now gates on a FULL room, with the
 * host's forceStart doubling as the partial-room launcher (a `forced` sim
 * override, cleared by any join/leave). The break is behavioural (full-room
 * gating + variable seat counts), so the version gates it.
 * v13 (2026-07-17): tremor REWORKED into an earthquake zone (pvp-abilities
 * §2) — the cast now spawns a `quake` DeployableKind fixed at the caster's
 * feet (chip ticks + a refreshed slow on enemies inside) instead of
 * resolving an instant slam — and the slam's peel becomes the NEW
 * `warding-shout` ability (§11), an instant no-damage knockback cone off the
 * facing. The wire SHAPE is unchanged, but both vocabularies grow
 * (deployable kinds, ability ids) and tremor's meaning flips, so the
 * version gates it.
 */
export const PROTOCOL_VERSION = 13;
export const DEFAULT_PORT = 7777;

// ── client → server ────────────────────────────────────────────────────────
export type ClientMsg =
  /** `teamSize` 1–4 (the host's 1v1/2v2/3v3/4v4 pick) → 2×N seats; absent or
   * off-menu falls back to 1v1 (sanitizeTeamSize). */
  | { t: "createRoom"; v: number; playerName: string; roomName?: string; pass?: string; teamSize?: number }
  | { t: "joinRoom"; v: number; code: string; playerName: string; pass?: string }
  | { t: "listRooms" }
  /** Spectate without taking a seat (debug tooling now; bench-viewing later). */
  | { t: "watchRoom"; code: string }
  | { t: "leaveRoom" }
  /** Weapon pick — lobby only; picks replace, never clear. */
  | { t: "setWeapon"; weapon: WeaponId }
  /** The whole picked hand each change (idempotent) — same gate as setWeapon. */
  | { t: "setAbilities"; abilities: AbilityId[] }
  /** Host-only AFK backstop: random-fill every unarmed seat, then the normal
   * 5s arming countdown runs (never instant). Ignored from non-hosts. */
  | { t: "forceStart" }
  | { t: "input"; seq: number; sx: number; sy: number; casts: boolean[] };

// ── server → client ────────────────────────────────────────────────────────

/** Everything the renderer needs from the tuning table, sent once at welcome —
 * the client never duplicates sim constants. (Per-weapon telegraph numbers are
 * NOT here: the client imports WEAPONS from this package, the ARENA_00 rule.) */
export interface ArenaClientConfig {
  tickRate: number;
  playerRadius: number;
  winsToTake: number;
  countdownSeconds: number;
}

/** One drafted slot as the HUD sees it: which ability, how long until it's
 * ready (drives the button clock), how long its effect window has left
 * (drives body-effect rings and zone auras), and the round budget left
 * (drives the charge pips; 0 = spent until the next round). */
export interface AbilitySlotSnapshot {
  id: AbilityId;
  /** Cooldown seconds remaining; 0 = ready. */
  cd: number;
  /** Active-window seconds remaining; 0 = not running. */
  active: number;
  /** Uses left this round. */
  charges: number;
}

export interface PlayerSnapshot {
  id: number;
  team: Team;
  name: string;
  /** Drives the per-player telegraph (reach/arc/windup from WEAPONS[weapon]).
   * Scrubbed to null for EVERYONE while the phase is "lobby" — snapshots are
   * one uniform broadcast and must not leak hidden picks. */
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
  /** The picked hand in button order. Scrubbed to [] alongside `weapon` in
   * the lobby. In-match it IS broadcast (cooldown clocks need it), but the
   * client renders enemy abilities only as they're cast — the cast flash. */
  abilities: AbilitySlotSnapshot[];
  /** The player id this player's harpoon chain is currently REELING in, or
   * null — the client draws the taut chain between the two for the haul. */
  reeling: number | null;
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
  /** VIEWER-DEPENDENT: the live pick for your own team; ALWAYS null for the
   * enemy team and for watchers — there is no reveal, ever. */
  weapon: WeaponId | null;
  /** VIEWER-DEPENDENT like `weapon`: picked abilities in button order. */
  abilities: AbilityId[] | null;
  /** Public: weapon + full hand picked — enemies see "armed"/"choosing…". */
  armed: boolean;
}

/** A live shot, projected for rendering (the client lerps x/y/angle by id). */
export interface ProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  /** Travel direction, radians. */
  angle: number;
  kind: ProjectileKind;
}

/** A placed thing, projected for rendering (keyed by id; static once placed).
 * Sent to everyone — but the sandtrap RENDERS team-dependent (Tom,
 * 2026-07-14): the owning team sees a clear marker, enemies a faint
 * occasional glint. Every other kind stays uniformly visible. */
export interface DeployableSnapshot {
  id: number;
  kind: DeployableKind;
  /** Who placed it — drives the sandtrap's yours/theirs rendering split. */
  team: Team;
  x: number;
  y: number;
  /** Sandtrap: seconds until armed (drives the arming countdown circle). */
  armLeft: number;
  /** Seconds until it expires (zones fade on this). */
  lifeLeft: number;
  /** Straw man durability left; 0 for kinds without hp. */
  hp: number;
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
  deployables: DeployableSnapshot[];
  events: ArenaEvent[];
}

export type ServerMsg =
  | {
      t: "welcome";
      v: number;
      playerId: number;
      team: Team;
      /** Players per side — the client renders capacity (2×N) and empty-seat
       * rows from this. Per-room, like zoneId, so NOT in ArenaClientConfig. */
      teamSize: number;
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
