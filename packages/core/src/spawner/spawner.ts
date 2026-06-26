/**
 * Spawners — destructible monster nests that let a zone repopulate in a way you
 * can *watch* (docs/design/spawners.md). Creatures walk out of a visible nest
 * instead of popping into existence, so full top-down visibility becomes the
 * threat rather than a liability: you can see the nest pumping out monsters, and
 * rushing it (through the trickle) vs. farming the trickle is the decision.
 *
 * This is the **pure** half — the state machine and accounting:
 *
 *     DORMANT ──player enters activation radius──► ACTIVE ──hp to 0──► DESTROYED
 *        ▲                                            │
 *        └────────player leaves activation radius─────┘
 *
 * The game owns the nest's `Combatant` (it takes hits exactly like a breakable)
 * and the real creature creation; each step it feeds this FSM the player's
 * distance, how many of the nest's creatures are currently alive, and whether
 * the nest has been destroyed, then applies the `spawn` count it returns.
 *
 * v1 is the **watchable loop**: dormant/active/destroyed, spawn cadence, and a
 * max-alive cap. The XP-budget ledger and the threshold-crossing defender waves
 * (docs/design/spawners.md) are deferred — they layer onto this state without
 * reshaping it (see the reserved notes below).
 */
import { parseCreatureId, type CreatureId } from "../creature/roster";

export type SpawnerPhase = "dormant" | "active" | "destroyed";

/**
 * A nest's footprint, in tiles per side. Shared so the game (which builds the
 * destructible structure) and Realmsmith (which draws it) agree on its size by
 * construction. Creatures spawn hugging this footprint (see the game's spawn loop).
 */
export const SPAWNER_NEST_TILES = 1.5;

/** Authored tuning for a spawner, parsed from a `ZoneObject`'s `props` bag. */
export interface SpawnerConfig {
  /** What it spawns — any creature in the roster. */
  creature: CreatureId;
  /** Nest hit points; destroyed at 0 (the game's Combatant owns the live hp). */
  maxHp: number;
  /** Dormant→active when the player is within this distance (px); active→dormant beyond it. */
  activationRadius: number;
  /** Seconds between spawns while active. */
  cadence: number;
  /** Most of *this* nest's creatures alive at once — pressure stays constant, counts stay phone-safe. */
  maxAlive: number;
  // Reserved (docs/design/spawners.md, deferred): a fixed `xpBudget` ledger and
  // defender-wave tuning slot in here without changing the lifecycle above.
}

/** Sensible starting values (also the editor's placement defaults). */
export const SPAWNER_DEFAULTS: SpawnerConfig = {
  creature: "zombie",
  maxHp: 120,
  activationRadius: 420,
  cadence: 3,
  maxAlive: 5,
};

/** Live, mutable spawner state (the game holds one per nest). */
export interface SpawnerState {
  phase: SpawnerPhase;
  /** Seconds until the next spawn while active (counts down; ≤0 = ready to pop). */
  cooldown: number;
}

export const initSpawnerState = (): SpawnerState => ({ phase: "dormant", cooldown: 0 });

/** Per-step perception the game feeds the FSM. */
export interface SpawnerInput {
  dt: number;
  /** Distance from the player to the nest, px. */
  playerDist: number;
  /**
   * The player has *seen* this nest (had line of sight to it) at least once — the
   * game latches this. A nest stays silent until revealed, so breaking open a wall
   * to expose a nest is the moment it springs to life. (Latched, so it stays true.)
   */
  seen: boolean;
  /** How many of this nest's creatures are alive right now. */
  aliveCount: number;
  /** The nest's hp has reached 0 (the game owns the Combatant). Terminal once true. */
  destroyed: boolean;
}

export interface SpawnerStep {
  state: SpawnerState;
  /** Creatures to spawn this step (0 or 1 in v1 — one per cadence tick, below the cap). */
  spawn: number;
}

/**
 * Advance a spawner one fixed step. Pure and deterministic (no RNG — *where* a
 * spawned creature appears is the game's call, like the summoner's): same
 * (state, config, input) in → same step out, so it's replayable and unit-tested.
 */
export const stepSpawner = (
  state: SpawnerState,
  config: SpawnerConfig,
  input: SpawnerInput,
): SpawnerStep => {
  // Destroyed is terminal — dead stays dead for the visit.
  if (state.phase === "destroyed" || input.destroyed) {
    return {
      state: state.phase === "destroyed" ? state : { phase: "destroyed", cooldown: 0 },
      spawn: 0,
    };
  }

  // Armed = the player has revealed this nest (`seen`) AND is within its activation
  // radius. Seeing it is what wakes it — a walled-off nest stays silent until you
  // break through, so the reveal is the "oh damn" moment; proximity then gates the
  // actual spawning so a nest doesn't pump while you're across the zone.
  const armed = input.seen && input.playerDist <= config.activationRadius;

  if (!armed) {
    // Stand down to dormant, but PRESERVE the cooldown: stepping out and back in
    // resumes the countdown rather than restarting it, so you can't stall a nest by
    // skirting its edge (the old reset made a long-cadence nest never spawn).
    return { state: { phase: "dormant", cooldown: state.cooldown }, spawn: 0 };
  }

  // Count the cadence down. A freshly-entered nest starts at cooldown 0
  // (initSpawnerState), so its FIRST armed step spawns at once — a long-cadence nest
  // reacts the moment you reveal/enter it, instead of being killable before it does
  // anything. A *paused* countdown (you stepped out mid-cycle) simply resumes from
  // where it left off, since `cooldown` is preserved while dormant.
  let cooldown = state.cooldown - input.dt;
  let spawn = 0;
  if (cooldown <= 0) {
    if (input.aliveCount < config.maxAlive) {
      spawn = 1;
      cooldown = config.cadence;
    } else {
      // At the cap: hold ready (0) so a creature pops the instant a slot frees.
      cooldown = 0;
    }
  }
  return { state: { phase: "active", cooldown }, spawn };
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * Resolve a `ZoneObject.props` bag (untyped string/number/boolean values, as
 * Realmsmith writes them) into a typed `SpawnerConfig`, filling anything missing
 * or malformed from `fallback`. An unknown `creature` id falls back too, so a
 * stale zone file can never spawn a creature that no longer exists.
 */
export const parseSpawnerConfig = (
  props: Record<string, string | number | boolean>,
  fallback: SpawnerConfig = SPAWNER_DEFAULTS,
): SpawnerConfig => {
  return {
    creature: parseCreatureId(props.creature, fallback.creature),
    maxHp: num(props.maxHp, fallback.maxHp),
    activationRadius: num(props.activationRadius, fallback.activationRadius),
    cadence: num(props.cadence, fallback.cadence),
    maxAlive: num(props.maxAlive, fallback.maxAlive),
  };
};
