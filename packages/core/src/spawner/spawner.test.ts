import { describe, expect, test } from "bun:test";
import {
  initSpawnerState,
  parseSpawnerConfig,
  rollDefenderWave,
  SPAWNER_DEFAULTS,
  SPAWNER_TUNING,
  stepSpawner,
  type SpawnerConfig,
  type SpawnerInput,
  type SpawnerState,
} from "./spawner";
import type { Rng } from "../rng";

const DT = 1 / 60;

const CONFIG: SpawnerConfig = {
  creature: "zombie",
  maxHp: 100,
  activationRadius: 400,
  cadence: 3,
  maxAlive: 5,
  capacity: 20,
};

/** A do-nothing rng: `next() → 0` means "no jitter" (interval re-arms to the full
 *  cadence), so the lifecycle/cadence tests keep their exact-cadence expectations. */
const RNG: Rng = { next: () => 0 };
/** A fixed-sequence rng for determinism/spy assertions. */
const seqRng = (vals: number[]): Rng => {
  let i = 0;
  return { next: () => vals[i++ % vals.length]! };
};

/** Build an ACTIVE state with full capacity; override any field per case. */
const active = (cooldown: number, over: Partial<SpawnerState> = {}): SpawnerState => ({
  phase: "active",
  cooldown,
  remaining: CONFIG.capacity,
  wavesSpawned: 0,
  ...over,
});

/** Defaults for one step's perception; override per case. `seen` defaults true so
 *  cadence/cap tests exercise an already-revealed nest. */
const input = (over: Partial<SpawnerInput> = {}): SpawnerInput => ({
  dt: DT,
  playerDist: 9999,
  seen: true,
  aliveCount: 0,
  destroyed: false,
  ...over,
});

describe("stepSpawner — lifecycle", () => {
  test("starts dormant and stays dormant beyond the activation radius", () => {
    const s = initSpawnerState(CONFIG);
    expect(s.phase).toBe("dormant");
    const step = stepSpawner(s, CONFIG, input({ playerDist: 401 }), RNG);
    expect(step.state.phase).toBe("dormant");
    expect(step.spawn).toBe(0);
  });

  test("stays dormant while unseen, even with the player on top of it", () => {
    const step = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0, seen: false }), RNG);
    expect(step.state.phase).toBe("dormant");
    expect(step.spawn).toBe(0);
    // The same nest, now revealed → it wakes.
    const woken = stepSpawner(step.state, CONFIG, input({ playerDist: 0, seen: true }), RNG);
    expect(woken.state.phase).toBe("active");
  });

  test("spawns immediately on first entry, then re-arms the full cadence", () => {
    const step = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 399 }), RNG);
    expect(step.state.phase).toBe("active");
    // A long-cadence nest reacts at once, so it can't be killed before doing anything.
    expect(step.spawn).toBe(1);
    expect(step.state.cooldown).toBe(CONFIG.cadence);
  });

  test("active → dormant when the player leaves, PRESERVING the countdown", () => {
    const step = stepSpawner(active(1.2), CONFIG, input({ playerDist: 500 }), RNG);
    expect(step.state.phase).toBe("dormant");
    expect(step.state.cooldown).toBe(1.2); // not reset — resumes on re-entry
  });

  test("destroyed is terminal — never spawns again even with the player on top of it", () => {
    const dead = stepSpawner(active(0), CONFIG, input({ destroyed: true }), RNG);
    expect(dead.state.phase).toBe("destroyed");
    const again = stepSpawner(dead.state, CONFIG, input({ playerDist: 0 }), RNG);
    expect(again.state.phase).toBe("destroyed");
    expect(again.spawn).toBe(0);
  });

  test("carries the capacity/wave ledger through phase transitions", () => {
    const mid = active(0.5, { remaining: 7, wavesSpawned: 1 });
    const dormant = stepSpawner(mid, CONFIG, input({ playerDist: 999 }), RNG).state;
    expect(dormant.remaining).toBe(7);
    expect(dormant.wavesSpawned).toBe(1);
    const destroyed = stepSpawner(mid, CONFIG, input({ destroyed: true }), RNG).state;
    expect(destroyed.remaining).toBe(7);
    expect(destroyed.wavesSpawned).toBe(1);
  });
});

describe("stepSpawner — cadence & cap", () => {
  test("first entry spawns at once, then one per cadence", () => {
    let state = initSpawnerState(CONFIG);
    let spawns = 0;
    const steps = Math.ceil((CONFIG.cadence * 2.1) / DT);
    for (let i = 0; i < steps; i++) {
      const step = stepSpawner(state, CONFIG, input({ playerDist: 0, aliveCount: 0 }), RNG);
      state = step.state;
      spawns += step.spawn;
    }
    // Immediate (t≈0) + t≈cadence + t≈2·cadence, all within 2.1 cadences (no jitter).
    expect(spawns).toBe(3);
  });

  test("leaving mid-countdown pauses, not resets (no stalling a slow nest)", () => {
    // Enter → immediate first spawn, cooldown re-armed to a full cadence (RNG = no jitter).
    let s = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), RNG).state;
    expect(s.cooldown).toBe(CONFIG.cadence);
    // Burn ~1s of in-range time off the countdown (under the cap, so no extra spawn yet).
    for (let i = 0; i < Math.round(1 / DT); i++) {
      s = stepSpawner(s, CONFIG, input({ playerDist: 0, aliveCount: 1 }), RNG).state;
    }
    const mid = s.cooldown;
    expect(mid).toBeLessThan(CONFIG.cadence);
    // Step out: dormant, but the countdown is preserved (not reset to cadence).
    s = stepSpawner(s, CONFIG, input({ playerDist: 500, aliveCount: 1 }), RNG).state;
    expect(s.phase).toBe("dormant");
    expect(s.cooldown).toBeCloseTo(mid, 5);
    // Step back in: resumes from `mid` (minus this step), proving no reset.
    const back = stepSpawner(s, CONFIG, input({ playerDist: 0, aliveCount: 1 }), RNG);
    expect(back.state.cooldown).toBeCloseTo(mid - DT, 5);
  });

  test("never spawns past the max-alive cap, but pops the instant a slot frees", () => {
    // Cooldown elapsed and already at the cap → no spawn, timer held ready at 0.
    const capped = stepSpawner(active(0), CONFIG, input({ playerDist: 0, aliveCount: CONFIG.maxAlive }), RNG);
    expect(capped.spawn).toBe(0);
    expect(capped.state.cooldown).toBe(0);
    // A slot frees → the very next step spawns without waiting another cadence.
    const freed = stepSpawner(capped.state, CONFIG, input({ playerDist: 0, aliveCount: CONFIG.maxAlive - 1 }), RNG);
    expect(freed.spawn).toBe(1);
  });
});

describe("capacity — a finite reservoir", () => {
  test("initialises remaining from the config", () => {
    expect(initSpawnerState(CONFIG).remaining).toBe(CONFIG.capacity);
  });

  test("spends one from remaining per spawn", () => {
    const first = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), RNG);
    expect(first.spawn).toBe(1);
    expect(first.state.remaining).toBe(CONFIG.capacity - 1);
  });

  test("stops spawning once capacity is exhausted (spent nest is inert but awake)", () => {
    const small: SpawnerConfig = { ...CONFIG, capacity: 3, maxAlive: 99 };
    let state = initSpawnerState(small);
    let spawns = 0;
    // Run well past what a capacity of 3 could ever produce.
    const steps = Math.ceil((small.cadence * 6) / DT);
    for (let i = 0; i < steps; i++) {
      const step = stepSpawner(state, small, input({ playerDist: 0, aliveCount: 0 }), RNG);
      state = step.state;
      spawns += step.spawn;
    }
    expect(spawns).toBe(3); // never more than capacity, however long you wait
    expect(state.remaining).toBe(0);
    expect(state.phase).toBe("active"); // awake, just silent
  });

  test("a spent nest emits nothing and never touches the rng", () => {
    let pulled = 0;
    const spyRng: Rng = { next: () => (pulled++, 0) };
    const step = stepSpawner(active(0, { remaining: 0 }), CONFIG, input({ playerDist: 0 }), spyRng);
    expect(step.spawn).toBe(0);
    expect(pulled).toBe(0);
  });
});

describe("stepSpawner — cadence jitter", () => {
  test("re-arms the next interval up to 30% faster, never slower", () => {
    // rng at its extremes: 0 → full cadence, ~1 → the fastest allowed interval.
    const full = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), { next: () => 0 });
    expect(full.state.cooldown).toBeCloseTo(CONFIG.cadence, 5);
    const fastest = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), { next: () => 0.999999 });
    expect(fastest.state.cooldown).toBeCloseTo(CONFIG.cadence * (1 - SPAWNER_TUNING.cadenceJitter), 3);
    // A mid roll lands strictly inside [0.7·cadence, cadence).
    const mid = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), { next: () => 0.5 });
    expect(mid.state.cooldown).toBeGreaterThan(CONFIG.cadence * (1 - SPAWNER_TUNING.cadenceJitter));
    expect(mid.state.cooldown).toBeLessThan(CONFIG.cadence);
  });

  test("deterministic through the rng — same stream in, same cooldown out", () => {
    const a = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), seqRng([0.42]));
    const b = stepSpawner(initSpawnerState(CONFIG), CONFIG, input({ playerDist: 0 }), seqRng([0.42]));
    expect(a.state.cooldown).toBe(b.state.cooldown);
  });

  test("does not touch the rng on an idle (no-spawn) step", () => {
    let pulled = 0;
    const spyRng: Rng = { next: () => (pulled++, 0) };
    // At the cap → no spawn → rng must be untouched (keeps the stream stable).
    stepSpawner(active(0), CONFIG, input({ playerDist: 0, aliveCount: CONFIG.maxAlive }), spyRng);
    expect(pulled).toBe(0);
  });
});

describe("rollDefenderWave", () => {
  const sure: Rng = { next: () => 0 }; // always under the chance → fires
  const never: Rng = { next: () => 1 }; // always ≥ chance → safe

  test("no roll when the hit crosses no 25% band", () => {
    const r = rollDefenderWave(active(0), CONFIG, 0.9, 0.8, sure); // 90→80%, no band crossed
    expect(r.waves).toBe(0);
    expect(r.state.wavesSpawned).toBe(0);
  });

  test("crossing a band bursts up to maxAlive and spends that from capacity", () => {
    const r = rollDefenderWave(active(0), CONFIG, 0.8, 0.7, sure); // crosses 75%
    expect(r.waves).toBe(CONFIG.maxAlive);
    expect(r.state.wavesSpawned).toBe(1);
    expect(r.state.remaining).toBe(CONFIG.capacity - CONFIG.maxAlive);
  });

  test("clamps the burst to remaining capacity", () => {
    const low = active(0, { remaining: 2 }); // fewer left than maxAlive
    const r = rollDefenderWave(low, CONFIG, 0.8, 0.7, sure);
    expect(r.waves).toBe(2);
    expect(r.state.remaining).toBe(0);
  });

  test("a spent nest sends no defenders", () => {
    const r = rollDefenderWave(active(0, { remaining: 0 }), CONFIG, 0.8, 0.7, sure);
    expect(r.waves).toBe(0);
  });

  test("a safe roll fires nothing (and spends no capacity)", () => {
    const r = rollDefenderWave(active(0), CONFIG, 0.8, 0.7, never);
    expect(r.waves).toBe(0);
    expect(r.state.remaining).toBe(CONFIG.capacity);
  });

  test("caps at defenderMaxWaves per nest", () => {
    const maxed = active(0, { wavesSpawned: SPAWNER_TUNING.defenderMaxWaves });
    const r = rollDefenderWave(maxed, CONFIG, 0.6, 0.4, sure); // crosses 50%, would fire
    expect(r.waves).toBe(0);
  });

  test("a killing blow (hpAfter ≤ 0) provokes nothing — overkill deletes it", () => {
    const r = rollDefenderWave(active(0), CONFIG, 0.3, 0, sure); // destroyed this hit
    expect(r.waves).toBe(0);
    expect(r.state.wavesSpawned).toBe(0);
  });
});

describe("parseSpawnerConfig", () => {
  test("fills missing/malformed fields from the defaults", () => {
    const c = parseSpawnerConfig({});
    expect(c).toEqual(SPAWNER_DEFAULTS);
  });

  test("reads authored values from the props bag", () => {
    const c = parseSpawnerConfig({
      creature: "wolf",
      maxHp: 250,
      activationRadius: 600,
      cadence: 1.5,
      maxAlive: 8,
      capacity: 30,
    });
    expect(c).toEqual({
      creature: "wolf",
      maxHp: 250,
      activationRadius: 600,
      cadence: 1.5,
      maxAlive: 8,
      capacity: 30,
    });
  });

  test("ignores stale/removed props (e.g. an old spawnRadius) without choking", () => {
    const c = parseSpawnerConfig({ creature: "wolf", spawnRadius: 120 } as Record<string, number | string>);
    expect(c).toEqual({ ...SPAWNER_DEFAULTS, creature: "wolf" });
  });

  test("falls back on an unknown creature id (stale file can't spawn a ghost)", () => {
    const c = parseSpawnerConfig({ creature: "dragon" });
    expect(c.creature).toBe(SPAWNER_DEFAULTS.creature);
  });
});
