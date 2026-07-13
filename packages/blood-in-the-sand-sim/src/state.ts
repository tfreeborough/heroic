/**
 * The whole match — players, round machine, RNG bookkeeping — as ONE plain
 * JSON-able object. This is the contract that makes the game networkable and
 * replayable: no class instances, no closures, no platform handles anywhere in
 * here. Derived/non-serialisable runtime (zone geometry, the live Rng, the
 * spatial grid) lives beside it in `ArenaSim` (sim.ts).
 */
import type { AbilityState, AttackCycleState, Combatant, DotState, Mover, ProjectileState } from "@heroic/core";
import { ABILITY_READY, ATTACK_CYCLE_READY, createMover, makeCombatant } from "@heroic/core";
import type { Vec2 } from "@heroic/core";
import { PLAYER_RADIUS, PLAYER_STATS, type AbilityId, type WeaponId } from "./config";

export type Team = 1 | 2;

/** One player's input for one tick — the entire per-tick network payload. */
export interface PlayerInput {
  /** Client's own counter, echoed back in snapshots for latency debugging. */
  seq: number;
  /** Stick direction × magnitude; |(sx, sy)| ≤ 1 (the sim clamps regardless). */
  sx: number;
  sy: number;
  /** Dash requested this tick (the server latches presses between ticks). */
  dash: boolean;
}

export const IDLE_INPUT: PlayerInput = Object.freeze({ seq: 0, sx: 0, sy: 0, dash: false });

/** Gauntlet's DashRuntime, as plain data (see skills-architecture). */
export interface DashState {
  /** Generic lifecycle (ready/active/cooldown), advanced by core's stepAbility. */
  ability: AbilityState;
  /** Committed roll direction (unit), locked when the roll fires. */
  dirX: number;
  dirY: number;
  /** Dodge-invulnerability timer — its own clock so i-frames outlast the movement. */
  invulnLeft: number;
}

export const createDashState = (): DashState => ({
  ability: ABILITY_READY,
  dirX: 0,
  dirY: 0,
  invulnLeft: 0,
});

export interface ArenaPlayer {
  /** Slot index (0 | 1 in M1), stable for the whole match. */
  id: number;
  name: string;
  team: Team;
  connected: boolean;
  alive: boolean;
  /** Lobby pick (setPlayerWeapon); null auto-fills at lock-in (startMatch). */
  weapon: WeaponId | null;
  /** The pick snapshotted at lock-in — what the enemy team was shown. Null
   * outside the ceremony (cleared on the return to lobby). */
  revealedWeapon: WeaponId | null;
  /** Drafted abilities in pick order (= in-match button order), max
   * LOADOUT_ABILITY_COUNT, no duplicates. Auto-filled at lock-in like the
   * weapon. The match doesn't consume these yet (dash stays hardwired until
   * the ability-slot slice) — the draft carries them. */
  abilities: AbilityId[];
  /** Ability picks snapshotted at lock-in (the reveal), like revealedWeapon. */
  revealedAbilities: AbilityId[] | null;
  /** Locked this draft phase (pick or counterpick). All-connected-locked ends
   * the phase early; cleared at every phase boundary and on lobby return. */
  lockedIn: boolean;
  /** Active damage-over-time riders (the blade's bleed) — core stepDots ticks these. */
  dots: DotState[];
  /** Seconds of movement slow left (the hammer's debuff); 0 = unslowed. */
  slowLeft: number;
  /** Max-speed multiplier while slowLeft > 0 (from the slowing weapon's config). */
  slowFactor: number;
  /** Kinematic body — handed to stepCrowd, which mutates it in place (state owns it). */
  mover: Mover;
  /** Radians, 0 = +x, clockwise (screen y down). */
  facing: number;
  /** hp + stats — resolveAttack mutates .hp in place (state owns it). */
  combatant: Combatant;
  attack: AttackCycleState;
  /** Current auto-target (an enemy player id), with hysteresis. */
  targetId: number | null;
  /** Latched on windupStarted — the lock-break rule checks THIS, not targetId. */
  lockedTargetId: number | null;
  /** Latched on windupStarted — drives the arc resolve AND the client telegraph. */
  lockedFacing: number;
  dash: DashState;
  /** Last input seq applied — echoed in snapshots. */
  lastSeq: number;
}

export type RoundPhase = "lobby" | "pick" | "reveal" | "countdown" | "active" | "roundEnd" | "matchEnd";

/** A room seat: a player, or empty. Seat index = player id = team − 1. */
export type Seat = ArenaPlayer | null;

export const SEAT_COUNT = 2;

export interface RoundState {
  phase: RoundPhase;
  /** Seconds left in the timed phases (pick / reveal / countdown / roundEnd / matchEnd). */
  timer: number;
  /** Length of the counterpick window that follows the pick phase — latched by
   * startMatch so the machine knows it when the pick clock (or all-locked)
   * closes the phase. 0 = skip straight to countdown. */
  adjustSeconds: number;
  /** 1-based; 0 before the first round starts. */
  roundNumber: number;
  /** Round wins, indexed team − 1. */
  wins: [number, number];
  /** 0 until a round has been won (also the draw sentinel). */
  lastWinner: Team | 0;
}

/** A live shot: core's kinematics plus arena identity/attribution. */
export interface ArenaProjectile extends ProjectileState {
  /** Monotonic per-match id — NEVER reset (the client lerps projectiles by id). */
  id: number;
  ownerId: number;
  weapon: WeaponId;
  /** Homing shots steer toward this seat while it lives; null = straight. */
  targetId: number | null;
}

export interface ArenaState {
  tick: number;
  /** RNG identity: the seed plus how many draws have happened. The live Rng sits
   * in ArenaSim; restoreRng(seed, rngDraws) rebuilds it from these two numbers. */
  seed: number;
  rngDraws: number;
  /** Fixed seats (null = free). Loops skip nulls; ids stay stable across leaves. */
  players: Seat[];
  round: RoundState;
  /** Live shots (bow/staff), stepped after attack cycles, cleared each round. */
  projectiles: ArenaProjectile[];
  nextProjectileId: number;
}

export const createArenaState = (seed: number): ArenaState => ({
  tick: 0,
  seed,
  rngDraws: 0,
  players: Array.from({ length: SEAT_COUNT }, () => null),
  round: { phase: "lobby", timer: 0, adjustSeconds: 0, roundNumber: 0, wins: [0, 0], lastWinner: 0 },
  projectiles: [],
  nextProjectileId: 0,
});

/** The occupied seats, in id order. */
export const seatedPlayers = (state: ArenaState): ArenaPlayer[] =>
  state.players.filter((p): p is ArenaPlayer => p !== null);

export const createPlayer = (id: number, name: string, team: Team, spawn: Vec2, facing: number): ArenaPlayer => ({
  id,
  name,
  team,
  connected: true,
  alive: true,
  weapon: null,
  revealedWeapon: null,
  abilities: [],
  revealedAbilities: null,
  lockedIn: false,
  dots: [],
  slowLeft: 0,
  slowFactor: 1,
  mover: createMover(spawn.x, spawn.y, PLAYER_RADIUS),
  facing,
  combatant: makeCombatant(PLAYER_STATS),
  attack: ATTACK_CYCLE_READY,
  targetId: null,
  lockedTargetId: null,
  lockedFacing: facing,
  dash: createDashState(),
  lastSeq: 0,
});

/** Defensive input scrubbing — the sim never trusts the wire. */
export const sanitizeInput = (input: PlayerInput): PlayerInput => {
  const sx = Number.isFinite(input.sx) ? input.sx : 0;
  const sy = Number.isFinite(input.sy) ? input.sy : 0;
  const len = Math.hypot(sx, sy);
  const k = len > 1 ? 1 / len : 1;
  return {
    seq: Number.isFinite(input.seq) ? input.seq : 0,
    sx: sx * k,
    sy: sy * k,
    dash: input.dash === true,
  };
};
