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
import {
  ABILITIES,
  DEPLOYABLE_ID_BASE,
  LOADOUT_ABILITY_COUNT,
  PLAYER_RADIUS,
  PLAYER_STATS,
  type AbilityId,
  type WeaponId,
} from "./config";
import { pickTeamNames } from "./teamNames";

export type Team = 1 | 2;

/** One player's input for one tick — the entire per-tick network payload. */
export interface PlayerInput {
  /** Client's own counter, echoed back in snapshots for latency debugging. */
  seq: number;
  /** Stick direction × magnitude; |(sx, sy)| ≤ 1 (the sim clamps regardless). */
  sx: number;
  sy: number;
  /** Ability presses this tick, indexed by slot (= pick = button order). The
   * server latches presses between ticks, exactly as the old dash flag did. */
  casts: boolean[];
}

export const NO_CASTS: readonly boolean[] = Object.freeze(
  Array.from({ length: LOADOUT_ABILITY_COUNT }, () => false),
);

export const IDLE_INPUT: PlayerInput = Object.freeze({
  seq: 0,
  sx: 0,
  sy: 0,
  casts: NO_CASTS as boolean[],
});

/**
 * One drafted ability slot at match time (the gauntlet's DashRuntime shape,
 * generalised — see skills-architecture): the pick, core's generic lifecycle,
 * and a flat per-ability scratch area. Scratch fields are meaningful only to
 * the ability named by `id`; everyone else leaves them at rest. Flat (not a
 * per-kind union) so the state stays plain JSON with no tag juggling.
 */
export interface AbilityRuntime {
  id: AbilityId;
  /** Generic lifecycle (ready/active/cooldown), advanced by core's stepAbility. */
  ability: AbilityState;
  /** Uses left this round (the per-round budget, Tom 2026-07-15) — the round
   * reset rebuilds slots, which is what replenishes these. */
  chargesLeft: number;
  /** Dash: committed roll direction (unit), locked when the roll fires. */
  dirX: number;
  dirY: number;
  /** Dash: dodge-invulnerability timer — its own clock so i-frames outlast the movement. */
  invulnLeft: number;
  /** Harpoon: the mark latched at cast (the chain lands when the windup ends),
   * then the entity being REELED while `reelLeft` runs. */
  targetId: number | null;
  /** Harpoon: seconds of reel remaining; 0 = no chain attached. While > 0 the
   * victim is hauled toward the (rooted) caster each tick. */
  reelLeft: number;
  /** Harpoon: a Mirror Guard reflect flips the reel — the slot OWNER is the one
   * hauled, toward `targetId` (the guard, who stays free), instead of the owner
   * rooting and dragging the target in. Same slow speed, opposite direction. */
  reelReversed: boolean;
}

export const createAbilityRuntime = (id: AbilityId): AbilityRuntime => ({
  id,
  ability: ABILITY_READY,
  chargesLeft: ABILITIES[id].charges,
  dirX: 0,
  dirY: 0,
  invulnLeft: 0,
  targetId: null,
  reelLeft: 0,
  reelReversed: false,
});

/** Fresh slots for a drafted hand — every cooldown clean (each round resets). */
export const createAbilitySlots = (abilities: readonly AbilityId[]): AbilityRuntime[] =>
  abilities.map(createAbilityRuntime);

/** The player's slot running `id`, if they drafted it. */
export const slotOf = (p: ArenaPlayer, id: AbilityId): AbilityRuntime | undefined =>
  p.slots.find((s) => s.id === id);

/** Is the named ability's effect window open on this player right now? */
export const abilityActive = (p: ArenaPlayer, id: AbilityId): boolean =>
  p.slots.some((s) => s.id === id && s.ability.phase === "active");

export interface ArenaPlayer {
  /** Seat index, stable for the whole match. */
  id: number;
  name: string;
  team: Team;
  connected: boolean;
  alive: boolean;
  /** Lobby pick (setPlayerWeapon); null only until the wizard's first step —
   * a force-start random-fills any null before a match can begin. */
  weapon: WeaponId | null;
  /** Picked abilities in pick order (= in-match button order), max
   * LOADOUT_ABILITY_COUNT, no duplicates. `slots` is rebuilt from this at
   * every round reset. */
  abilities: AbilityId[];
  /** Active damage-over-time riders (the blade's bleed) — core stepDots ticks these. */
  dots: DotState[];
  /** Seconds of movement slow left (the hammer's debuff); 0 = unslowed. */
  slowLeft: number;
  /** Max-speed multiplier while slowLeft > 0 (from the slowing weapon's config). */
  slowFactor: number;
  /** Permanent max-speed multiplier — HOST-set only (never wire-settable):
   * the top bot difficulty tiers run 5–10% hot (bot-brains.md, Tom
   * 2026-07-20 — the one stat difficulty touches; damage/HP stay even). */
  moveFactor: number;
  /** Kinematic body — handed to stepCrowd, which mutates it in place (state owns it). */
  mover: Mover;
  /** Radians, 0 = +x, clockwise (screen y down). */
  facing: number;
  /** hp + stats — resolveAttack mutates .hp in place (state owns it). */
  combatant: Combatant;
  attack: AttackCycleState;
  /** Current auto-target (an enemy player OR deployable id), with hysteresis. */
  targetId: number | null;
  /** Latched on windupStarted — the lock-break rule checks THIS, not targetId. */
  lockedTargetId: number | null;
  /** Latched on windupStarted — drives the arc resolve AND the client telegraph. */
  lockedFacing: number;
  /** Straw Man's hold: seconds this player's aim stays force-locked (0 = free). */
  tauntLeft: number;
  /** The dummy id the taunt binds the aim to while tauntLeft > 0. */
  tauntTargetId: number | null;
  /** The drafted hand at match time, one runtime per pick, in button order. */
  slots: AbilityRuntime[];
  /** Last input seq applied — echoed in snapshots. */
  lastSeq: number;
  /** A training-mode target dummy (the dev menu's firing range): never targets,
   * never swings, and the training pass respawns it after death. Real players
   * are never dummies — only addDummy sets this. */
  dummy: boolean;
  /** A server-run backfill bot (docs/design/bits-bot-backfill.md): seated by a
   * host force-start to fill an empty seat, thought for by the server, and
   * dismissed at every lobby return. Fights exactly like a player — the flag
   * exists so rooms can tell humans from bots (host succession, GC, the
   * cancel window, roster markers). Only addBot sets this. */
  bot: boolean;
  /** Training only: seconds until a dead dummy is replaced; 0 = none pending. */
  respawnLeft: number;
  /** Announcer-pack id (cosmetic, sim-meaningless — carried like `name` and
   * broadcast via RoomStatePlayer so every client can play the killer's
   * voice). "default" unless the seat's client claimed a pack; bots and
   * dummies keep the default. */
  announcer: string;
}

export type RoundPhase = "lobby" | "countdown" | "active" | "roundEnd" | "matchEnd";

/** An armed loadout: a weapon plus a full ability hand — the wizard guarantees
 * this by construction; the arming countdown gates on it. */
export const loadoutComplete = (p: ArenaPlayer): boolean =>
  p.weapon !== null && p.abilities.length === LOADOUT_ABILITY_COUNT;

/** A room seat: a player, or empty. Seat index = player id (stable across the
 * match); team is stored on the player — addPlayer assigns it random-balanced. */
export type Seat = ArenaPlayer | null;

export interface RoundState {
  phase: RoundPhase;
  /** Seconds left in the timed phases (countdown / roundEnd / matchEnd) — and,
   * while the phase is "lobby", the ARMING countdown (0 = not running). */
  timer: number;
  /** 1-based; 0 before the first round starts. */
  roundNumber: number;
  /** Round wins, indexed team − 1. */
  wins: [number, number];
  /** 0 until a round has been won (also the draw sentinel). */
  lastWinner: Team | 0;
  /** The host's force-start override: lets the arming gate pass with empty
   * seats. Cleared by any join/leave (the party changed — the override is
   * stale) and at match start, so it can never linger. */
  forced: boolean;
}

/** What a live shot came out of — a weapon's attack cycle. (The harpoon left
 * this space 2026-07-15: it's an instant chain now, not a projectile.) */
export type ProjectileKind = WeaponId;

/** A live shot: core's kinematics plus arena identity/attribution. */
export interface ArenaProjectile extends ProjectileState {
  /** Monotonic per-match id — NEVER reset (the client lerps projectiles by id). */
  id: number;
  ownerId: number;
  kind: ProjectileKind;
  /** Homing shots steer toward this entity while it lives; null = straight. */
  targetId: number | null;
  /** Bounced off a Mirror Guard: ownership flipped, homing hard at the shooter. */
  reflected?: boolean;
}

export type DeployableKind = "sandtrap" | "straw-man" | "blood-font" | "sandstorm" | "quake";

/**
 * A placed thing (docs/design/pvp-abilities.md): one entity array carries the
 * mine, the decoy, the heal zone, the no-target zone and the quake. Shaped like
 * projectiles — monotonic ids (the client keys by id), stepped after them,
 * cleared each round. Clearly visible to BOTH teams, always (the readability
 * rule): deployables are area denial and target pollution, never ambushes.
 */
export interface Deployable {
  /** Monotonic per-match, from DEPLOYABLE_ID_BASE up — shares the target-id
   * space with players (a straw man is a valid auto-target). */
  id: number;
  kind: DeployableKind;
  ownerId: number;
  team: Team;
  pos: Vec2;
  /** Sandtrap: seconds until armed (0 = live). 0 for every other kind. */
  armLeft: number;
  /** Seconds until it expires and is removed. */
  lifeLeft: number;
  /** Straw man durability; 0 for kinds that can't be hit. */
  hp: number;
  /** Blood font / quake: seconds until the next heal/damage tick fires. */
  tickLeft: number;
}

export const isDeployableId = (id: number): boolean => id >= DEPLOYABLE_ID_BASE;

export interface ArenaState {
  tick: number;
  /** The two sides' faction names, indexed team − 1 (teamNames.ts). Assigned
   * at creation from the seed and never touched again — a room wears the same
   * two names from open to close, rematches included. Pure presentation: the
   * name is the absolute identity, colour is the relative allegiance cue. */
  teamNames: [string, string];
  /** Training mode (the dev menu's target-dummy range): rounds never end —
   * checkRoundOver stands down and dead dummies respawn in place instead. */
  training: boolean;
  /** RNG identity: the seed plus how many draws have happened. The live Rng sits
   * in ArenaSim; restoreRng(seed, rngDraws) rebuilds it from these two numbers. */
  seed: number;
  rngDraws: number;
  /** Fixed seats (null = free). Loops skip nulls; ids stay stable across leaves. */
  players: Seat[];
  round: RoundState;
  /** Live shots (bow/staff/harpoon), stepped after attack cycles, cleared each round. */
  projectiles: ArenaProjectile[];
  nextProjectileId: number;
  /** Placed things (mines/decoys/zones), stepped after projectiles, cleared each round. */
  deployables: Deployable[];
  nextDeployableId: number;
}

export const createArenaState = (seed: number, seatCount: number, training = false): ArenaState => ({
  tick: 0,
  teamNames: pickTeamNames(seed),
  training,
  seed,
  rngDraws: 0,
  players: Array.from({ length: seatCount }, () => null),
  round: { phase: "lobby", timer: 0, roundNumber: 0, wins: [0, 0], lastWinner: 0, forced: false },
  projectiles: [],
  nextProjectileId: 0,
  deployables: [],
  nextDeployableId: DEPLOYABLE_ID_BASE,
});

/** The occupied seats, in id order. */
export const seatedPlayers = (state: ArenaState): ArenaPlayer[] =>
  state.players.filter((p): p is ArenaPlayer => p !== null);

/** Seated head-count per team, indexed team − 1. */
export const teamCounts = (state: ArenaState): [number, number] => {
  const counts: [number, number] = [0, 0];
  for (const p of seatedPlayers(state)) {
    if (p.team === 1) counts[0] += 1;
    else counts[1] += 1;
  }
  return counts;
};

/** Players per side (seats are always 2×N by construction). */
export const teamSizeOf = (state: ArenaState): number => state.players.length / 2;

export const createPlayer = (id: number, name: string, team: Team, spawn: Vec2, facing: number): ArenaPlayer => ({
  id,
  name,
  team,
  connected: true,
  alive: true,
  weapon: null,
  abilities: [],
  dots: [],
  slowLeft: 0,
  slowFactor: 1,
  moveFactor: 1,
  mover: createMover(spawn.x, spawn.y, PLAYER_RADIUS),
  facing,
  combatant: makeCombatant(PLAYER_STATS),
  attack: ATTACK_CYCLE_READY,
  targetId: null,
  lockedTargetId: null,
  lockedFacing: facing,
  tauntLeft: 0,
  tauntTargetId: null,
  slots: [],
  lastSeq: 0,
  dummy: false,
  bot: false,
  respawnLeft: 0,
  announcer: "default",
});

/** Defensive input scrubbing — the sim never trusts the wire. */
export const sanitizeInput = (input: PlayerInput): PlayerInput => {
  const sx = Number.isFinite(input.sx) ? input.sx : 0;
  const sy = Number.isFinite(input.sy) ? input.sy : 0;
  const len = Math.hypot(sx, sy);
  const k = len > 1 ? 1 / len : 1;
  const raw = Array.isArray(input.casts) ? input.casts : [];
  return {
    seq: Number.isFinite(input.seq) ? input.seq : 0,
    sx: sx * k,
    sy: sy * k,
    casts: Array.from({ length: LOADOUT_ABILITY_COUNT }, (_, i) => raw[i] === true),
  };
};
