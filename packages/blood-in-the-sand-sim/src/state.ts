/**
 * The whole match — players, round machine, RNG bookkeeping — as ONE plain
 * JSON-able object. This is the contract that makes the game networkable and
 * replayable: no class instances, no closures, no platform handles anywhere in
 * here. Derived/non-serialisable runtime (zone geometry, the live Rng, the
 * spatial grid) lives beside it in `ArenaSim` (sim.ts).
 */
import type { AbilityState, AttackCycleState, Combatant, Mover } from "@heroic/core";
import { ABILITY_READY, ATTACK_CYCLE_READY, createMover, makeCombatant } from "@heroic/core";
import type { Vec2 } from "@heroic/core";
import { PLAYER_RADIUS, PLAYER_STATS } from "./config";

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

export type RoundPhase = "waiting" | "countdown" | "active" | "roundEnd" | "matchEnd";

export interface RoundState {
  phase: RoundPhase;
  /** Seconds left in the timed phases (countdown / roundEnd / matchEnd). */
  timer: number;
  /** 1-based; 0 before the first round starts. */
  roundNumber: number;
  /** Round wins, indexed team − 1. */
  wins: [number, number];
  /** 0 until a round has been won (also the draw sentinel). */
  lastWinner: Team | 0;
}

export interface ArenaState {
  tick: number;
  /** RNG identity: the seed plus how many draws have happened. The live Rng sits
   * in ArenaSim; restoreRng(seed, rngDraws) rebuilds it from these two numbers. */
  seed: number;
  rngDraws: number;
  players: ArenaPlayer[];
  round: RoundState;
}

export const createArenaState = (seed: number): ArenaState => ({
  tick: 0,
  seed,
  rngDraws: 0,
  players: [],
  round: { phase: "waiting", timer: 0, roundNumber: 0, wins: [0, 0], lastWinner: 0 },
});

export const createPlayer = (id: number, name: string, team: Team, spawn: Vec2, facing: number): ArenaPlayer => ({
  id,
  name,
  team,
  connected: true,
  alive: true,
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
