/**
 * Scripted scenes on the REAL sim (bits-onboarding.md § live scenes, Tom
 * 2026-08-24: "we'd want to show actual combat"). A ScenarioRunner owns a
 * 1v1 ArenaSim — you (seat 0, team 1) and one opponent (seat 1, team 2) —
 * steps it at the match tick with inputs a script writes per tick, and
 * loops: whenever a round ends (or the scene's own clock runs out) the sim
 * is reset for a round and the script re-places everyone. Nothing here is
 * a fake — every swing, orb, dash, blood pool and cooldown is the match
 * sim's own, so the Primer can never drift from the game it teaches.
 *
 * Deterministic: fixed seed, no wall clock — a scene loops identically on
 * every mount.
 */
import {
  addPlayer,
  ARENA_00,
  createSim,
  makeClientConfig,
  resetForRound,
  setPlayerAbilities,
  setPlayerWeapon,
  SnapshotBuffer,
  startMatch,
  stepSim,
  TICK_DT,
  TICK_RATE,
  toSnapshot,
  type AbilityId,
  type ArenaClientConfig,
  type ArenaEvent,
  type ArenaPlayer,
  type ArenaSim,
  type InterpolatedView,
  type PlayerInput,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";

export interface Loadout {
  weapon: WeaponId;
  abilities: AbilityId[];
}

/** One tick's scripted input for a seat (stick + slot presses). */
export interface ScriptInput {
  sx: number;
  sy: number;
  casts?: boolean[];
}

export interface ScenarioPlacement {
  x: number;
  y: number;
  /** Radians, 0 = +x. Defaults to facing the other fighter. */
  facing?: number;
  /** Start the round at this HP (a weakened foe so the kill lands on cue). */
  hp?: number;
  /** Host-side speed multiplier (the bot tiers' dial) — a slowed approach
   * so a ring crossing reads. */
  moveFactor?: number;
}

export interface Scenario {
  you: Loadout;
  foe: Loadout;
  /** Where everyone stands at every (re)start. */
  place: (seat: "you" | "foe") => ScenarioPlacement;
  /** The script: inputs for a seat at scene time `t` (seconds since the
   * last restart), given the live bodies. Omit a seat to leave it idle. */
  input: (seat: "you" | "foe", t: number, you: ArenaPlayer, foe: ArenaPlayer) => ScriptInput | null;
  /** The camera, from the sampled view (world centre + zoom). */
  camera: (view: InterpolatedView, stageW: number, stageH: number) => { cx: number; cy: number; zoom: number };
  /** Restart the scene after this many seconds even if nobody fell. */
  loopSeconds: number;
  /** How long the fallen lie before the scene restarts. */
  holdAfterRoundEnd?: number;
}

/** The arena's open centre-right pocket (Tom, 2026-08-24: the first cut
 * fought against the east wall with the crowd in shot). arena-00's props
 * are spread evenly, so the longest clear lane is VERTICAL: x ≈ 1090 from
 * y ≈ 470 (under the hoodoo) to y ≈ 940 (above the cactus), the rock pile to
 * the west and the tree to the east dressing the frame. Scenes stage north–
 * south along x = LANE_X (the stage card is near-square on a phone). */
export const LANE_X = 1090;
export const LANE_TOP = 470;
export const LANE_BOTTOM = 940;

const SEED = 7;
const DEFAULT_HOLD = 2.2;

export class ScenarioRunner {
  readonly sim: ArenaSim;
  readonly buffer = new SnapshotBuffer(TICK_RATE);
  readonly config: ArenaClientConfig = makeClientConfig();
  /** Seat ids — you are always 0, the foe 1. */
  readonly youId: number;
  readonly foeId: number;
  private t = 0;
  private roundEndedAt: number | null = null;
  private seq = 0;
  private pendingPlace = false;

  constructor(private readonly scenario: Scenario) {
    // A real match sim: no training dummies, no practice charge lift — the
    // charge pips the Arm chapter shows are the match's own budget.
    this.sim = createSim(ARENA_00, SEED, 1, false, false);
    const you = addPlayer(this.sim, "You", 1)!;
    const foe = addPlayer(this.sim, "Crixus", 2)!;
    this.youId = you.id;
    this.foeId = foe.id;
    setPlayerWeapon(this.sim, you.id, scenario.you.weapon);
    setPlayerAbilities(this.sim, you.id, scenario.you.abilities);
    setPlayerWeapon(this.sim, foe.id, scenario.foe.weapon);
    setPlayerAbilities(this.sim, foe.id, scenario.foe.abilities);
    const events: ArenaEvent[] = [];
    startMatch(this.sim, events); // → countdown at the spawns
    this.restart();
  }

  /** Scene time — seconds since the last restart (overlays sync to it). */
  get time(): number {
    return this.t;
  }

  private get you(): ArenaPlayer {
    return this.sim.state.players[this.youId]!;
  }

  private get foe(): ArenaPlayer {
    return this.sim.state.players[this.foeId]!;
  }

  /** Fresh round, everyone re-placed, the fight on from the next tick. */
  private restart(): void {
    const { round } = this.sim.state;
    // Never let the scoreboard reach a match end: the loop is the point.
    round.wins = [0, 0];
    if (round.phase !== "countdown") {
      const events: ArenaEvent[] = [];
      resetForRound(this.sim, events);
    }
    round.timer = 0; // the countdown collapses — the next tick is FIGHT
    this.placeAll();
    this.t = 0;
    this.roundEndedAt = null;
    this.pendingPlace = false;
  }

  private placeAll(): void {
    const you = this.you;
    const foe = this.foe;
    const py = this.scenario.place("you");
    const pf = this.scenario.place("foe");
    const put = (p: ArenaPlayer, at: ScenarioPlacement, other: ScenarioPlacement): void => {
      p.mover.pos.x = at.x;
      p.mover.pos.y = at.y;
      p.mover.vel.x = 0;
      p.mover.vel.y = 0;
      p.facing = at.facing ?? Math.atan2(other.y - at.y, other.x - at.x);
      p.lockedFacing = p.facing;
      if (at.hp !== undefined) p.combatant.hp = at.hp;
      p.moveFactor = at.moveFactor ?? 1;
    };
    put(you, py, pf);
    put(foe, pf, py);
  }

  /** One sim tick. Returns the events the buffer drained this tick. */
  step(nowMs: number): ArenaEvent[] {
    const { round } = this.sim.state;
    // The machine reset everyone to the spawns on its own (its round-end
    // clock beat ours) — re-place before the fight resumes.
    if (this.pendingPlace && round.phase === "countdown") {
      round.timer = 0;
      this.placeAll();
      this.pendingPlace = false;
    }
    const inputs = new Map<number, PlayerInput>();
    if (round.phase === "active") {
      const you = this.you;
      const foe = this.foe;
      for (const [seat, id] of [
        ["you", this.youId],
        ["foe", this.foeId],
      ] as const) {
        const s = this.scenario.input(seat, this.t, you, foe);
        if (!s) continue;
        inputs.set(id, { seq: this.seq++, sx: s.sx, sy: s.sy, casts: s.casts ?? [] });
      }
    }
    const events = stepSim(this.sim, inputs, TICK_DT);
    this.t += TICK_DT;
    for (const e of events) {
      if (e.type === "roundEnd") this.roundEndedAt = this.t;
    }
    const drained = this.buffer.push(toSnapshot(this.sim.state, events), nowMs);
    const hold = this.scenario.holdAfterRoundEnd ?? DEFAULT_HOLD;
    if (this.roundEndedAt !== null && this.t - this.roundEndedAt >= hold) this.restart();
    else if (this.roundEndedAt === null && this.t >= this.scenario.loopSeconds) this.restart();
    else if (round.phase === "countdown" && !this.pendingPlace && this.roundEndedAt !== null) {
      // The sim's own round-end clock expired first: it respawned everyone
      // at the spawns and started a countdown. Hold our loop, but re-place
      // as soon as the fight resumes.
      this.pendingPlace = true;
    }
    return drained;
  }

  sample(nowMs: number): InterpolatedView | null {
    return this.buffer.sample(nowMs);
  }

  camera(view: InterpolatedView, w: number, h: number): { cx: number; cy: number; zoom: number } {
    return this.scenario.camera(view, w, h);
  }
}
