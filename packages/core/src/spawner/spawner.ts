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
 * On top of the watchable loop (dormant/active/destroyed, cadence, max-alive
 * cap) this now carries the rest of docs/design/spawners.md: a **cadence jitter**
 * so spawns don't metronome, a finite **capacity** (the nest emits a fixed number
 * of creatures then goes spent — anti-farm by construction, since total XP is
 * capped whether you farm the trickle or destroy the nest for the remainder), and
 * the **defender-wave** rolls provoked by damaging the nest. The one departure from
 * "pure" is a single injected `Rng` (for the jitter and the wave rolls) — the same
 * deterministic-through-the-rng contract as `rollCreatureLevel`, so it stays
 * replayable and unit-tested; *where* a creature appears is still the game's call.
 */
import { parseCreatureId, type CreatureId } from "../creature/roster";
import { parseLevelRange, type LevelRange } from "../progression/levelGap";
import type { Rng } from "../rng";

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
  /**
   * The nest's **capacity**: the total number of creatures it will ever emit
   * (spawners.md). Each spawn — cadence *or* a defender burst — spends one; when
   * it hits 0 the nest is **spent** and stops spawning. Every creature it emits is
   * worth normal XP (no special ledger), so the total XP a nest yields is capped at
   * `capacity` however you play: farm the whole trickle, or destroy the nest to
   * claim the un-spawned remainder at once (see the game's breakOne payout).
   */
  capacity: number;
  /**
   * Authored level window for this nest's spawns (creature-levels.md): replaces
   * the zone range (still clamped by the creature's own bounds), so a nest deep
   * in the zone can run hotter than the door. Absent → the zone range applies.
   */
  levels?: LevelRange;
}

/**
 * Mechanic tunables shared by every nest (placeholder — the shapes are the
 * design, the numbers are playtest food, like GAP_TUNING/XP_TUNING).
 */
export const SPAWNER_TUNING = {
  /** Max fraction a jittered interval runs *faster* than the cadence (0.3 = up to 30% sooner). */
  cadenceJitter: 0.3,
  /** Hard cap on defender waves a single nest can ever provoke (spawners.md). */
  defenderMaxWaves: 2,
} as const;

/** Sensible starting values (also the editor's placement defaults). */
export const SPAWNER_DEFAULTS: SpawnerConfig = {
  creature: "zombie",
  maxHp: 120,
  activationRadius: 420,
  cadence: 3,
  maxAlive: 5,
  capacity: 20,
};

/** Live, mutable spawner state (the game holds one per nest). */
export interface SpawnerState {
  phase: SpawnerPhase;
  /** Seconds until the next spawn while active (counts down; ≤0 = ready to pop). */
  cooldown: number;
  /**
   * Creatures the nest can still emit (starts at `config.capacity`). Every spawn —
   * cadence or defender burst — spends one; at 0 the nest is **spent** and stops
   * spawning, and destroying it pays out this remainder as XP.
   */
  remaining: number;
  /** Defender waves already provoked (capped at SPAWNER_TUNING.defenderMaxWaves). */
  wavesSpawned: number;
}

export const initSpawnerState = (config: SpawnerConfig): SpawnerState => ({
  phase: "dormant",
  cooldown: 0,
  remaining: config.capacity,
  wavesSpawned: 0,
});

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
 * Advance a spawner one fixed step. Deterministic through the injected `rng`
 * (same contract as `rollCreatureLevel`): same (state, config, input, rng-stream)
 * in → same step out, so it's replayable and unit-tested. `rng` is consumed *only*
 * on an actual spawn (for the cadence jitter), never per idle step.
 */
export const stepSpawner = (
  state: SpawnerState,
  config: SpawnerConfig,
  input: SpawnerInput,
  rng: Rng,
): SpawnerStep => {
  // Destroyed is terminal — dead stays dead for the visit.
  if (state.phase === "destroyed" || input.destroyed) {
    return {
      state: state.phase === "destroyed" ? state : { ...state, phase: "destroyed", cooldown: 0 },
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
    return { state: { ...state, phase: "dormant", cooldown: state.cooldown }, spawn: 0 };
  }

  // A spent nest (capacity exhausted) stays awake but silent — it never spawns
  // again this visit. Reads as active-but-inert; the game drops its spiral.
  if (state.remaining <= 0) {
    return { state: { ...state, phase: "active", cooldown: 0 }, spawn: 0 };
  }

  // Count the cadence down. A freshly-entered nest starts at cooldown 0
  // (initSpawnerState), so its FIRST armed step spawns at once — a long-cadence nest
  // reacts the moment you reveal/enter it, instead of being killable before it does
  // anything. A *paused* countdown (you stepped out mid-cycle) simply resumes from
  // where it left off, since `cooldown` is preserved while dormant.
  let cooldown = state.cooldown - input.dt;
  let remaining = state.remaining;
  let spawn = 0;
  if (cooldown <= 0) {
    if (input.aliveCount < config.maxAlive) {
      spawn = 1;
      remaining -= 1; // spend one from the nest's capacity
      // Jitter the NEXT interval up to `cadenceJitter` faster (never slower), so a
      // nest never metronomes — 6s, then 5.5s, then 7s. rng is pulled only here, on
      // a real spawn, keeping the stream stable and the sim replayable. The first
      // (immediate) spawn is untouched: jitter shapes the *steady* cadence.
      cooldown = config.cadence * (1 - rng.next() * SPAWNER_TUNING.cadenceJitter);
    } else {
      // At the cap: hold ready (0) so a creature pops the instant a slot frees.
      cooldown = 0;
    }
  }
  return { state: { ...state, phase: "active", cooldown, remaining }, spawn };
};

/**
 * Roll for a defender wave when the nest takes a hit (spawners.md). Waves are
 * rolled per 25% HP band crossed (75/50/25%), capped at `defenderMaxWaves` per
 * nest; a firing wave bursts up to `config.maxAlive` creatures at once (ignoring
 * the alive cap — a burst, not a new steady state). Defenders are **drawn from the
 * nest's capacity** like any other spawn (so they front-load its population rather
 * than adding to it), so `waves` is clamped to `state.remaining` and spends it.
 * Deterministic through `rng`.
 *
 * Burst rule: a single hit crossing ≥1 band rolls **once** at `chance = 1 −
 * hpFracAfter` (a chip hit crosses one band ≈ per-threshold; a big hit crosses
 * several for the same one roll → fewer expected waves), and a hit that destroys
 * the nest (`hpFracAfter ≤ 0`) rolls **none** — deleting it before it reacts is
 * the payoff for overwhelming force.
 */
export const rollDefenderWave = (
  state: SpawnerState,
  config: SpawnerConfig,
  hpFracBefore: number,
  hpFracAfter: number,
  rng: Rng,
): { state: SpawnerState; waves: number } => {
  if (hpFracAfter <= 0) return { state, waves: 0 }; // overkill/destroyed → no reaction
  if (state.remaining <= 0) return { state, waves: 0 }; // spent → nothing left to send
  if (state.wavesSpawned >= SPAWNER_TUNING.defenderMaxWaves) return { state, waves: 0 };
  const crossed = DEFENDER_HP_BANDS.some((t) => hpFracBefore > t && hpFracAfter <= t);
  if (!crossed) return { state, waves: 0 };
  if (rng.next() >= 1 - hpFracAfter) return { state, waves: 0 }; // rolled safe
  const waves = Math.min(config.maxAlive, state.remaining);
  return {
    state: { ...state, wavesSpawned: state.wavesSpawned + 1, remaining: state.remaining - waves },
    waves,
  };
};

/** The HP fractions whose downward crossing arms a defender-wave roll. */
const DEFENDER_HP_BANDS = [0.75, 0.5, 0.25] as const;

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
    capacity: num(props.capacity, fallback.capacity),
    levels: parseLevelRange(props) ?? fallback.levels,
  };
};
