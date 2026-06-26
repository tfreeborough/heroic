import { describe, expect, test } from "bun:test";
import {
  initSpawnerState,
  parseSpawnerConfig,
  SPAWNER_DEFAULTS,
  stepSpawner,
  type SpawnerConfig,
  type SpawnerInput,
} from "./spawner";

const DT = 1 / 60;

const CONFIG: SpawnerConfig = {
  creature: "zombie",
  maxHp: 100,
  activationRadius: 400,
  cadence: 3,
  maxAlive: 5,
};

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
    const s = initSpawnerState();
    expect(s.phase).toBe("dormant");
    const step = stepSpawner(s, CONFIG, input({ playerDist: 401 }));
    expect(step.state.phase).toBe("dormant");
    expect(step.spawn).toBe(0);
  });

  test("stays dormant while unseen, even with the player on top of it", () => {
    const step = stepSpawner(initSpawnerState(), CONFIG, input({ playerDist: 0, seen: false }));
    expect(step.state.phase).toBe("dormant");
    expect(step.spawn).toBe(0);
    // The same nest, now revealed → it wakes.
    const woken = stepSpawner(step.state, CONFIG, input({ playerDist: 0, seen: true }));
    expect(woken.state.phase).toBe("active");
  });

  test("spawns immediately on first entry, then re-arms the full cadence", () => {
    const step = stepSpawner(initSpawnerState(), CONFIG, input({ playerDist: 399 }));
    expect(step.state.phase).toBe("active");
    // A long-cadence nest reacts at once, so it can't be killed before doing anything.
    expect(step.spawn).toBe(1);
    expect(step.state.cooldown).toBe(CONFIG.cadence);
  });

  test("active → dormant when the player leaves, PRESERVING the countdown", () => {
    const active = { phase: "active" as const, cooldown: 1.2 };
    const step = stepSpawner(active, CONFIG, input({ playerDist: 500 }));
    expect(step.state.phase).toBe("dormant");
    expect(step.state.cooldown).toBe(1.2); // not reset — resumes on re-entry
  });

  test("destroyed is terminal — never spawns again even with the player on top of it", () => {
    const dead = stepSpawner({ phase: "active", cooldown: 0 }, CONFIG, input({ destroyed: true }));
    expect(dead.state.phase).toBe("destroyed");
    const again = stepSpawner(dead.state, CONFIG, input({ playerDist: 0 }));
    expect(again.state.phase).toBe("destroyed");
    expect(again.spawn).toBe(0);
  });
});

describe("stepSpawner — cadence & cap", () => {
  test("first entry spawns at once, then one per cadence", () => {
    let state = initSpawnerState();
    let spawns = 0;
    const steps = Math.ceil((CONFIG.cadence * 2.1) / DT);
    for (let i = 0; i < steps; i++) {
      const step = stepSpawner(state, CONFIG, input({ playerDist: 0, aliveCount: 0 }));
      state = step.state;
      spawns += step.spawn;
    }
    // Immediate (t≈0) + t≈cadence + t≈2·cadence, all within 2.1 cadences.
    expect(spawns).toBe(3);
  });

  test("leaving mid-countdown pauses, not resets (no stalling a slow nest)", () => {
    // Enter → immediate first spawn, cooldown re-armed to a full cadence.
    let s = stepSpawner(initSpawnerState(), CONFIG, input({ playerDist: 0 })).state;
    expect(s.cooldown).toBe(CONFIG.cadence);
    // Burn ~1s of in-range time off the countdown (under the cap, so no extra spawn yet).
    for (let i = 0; i < Math.round(1 / DT); i++) {
      s = stepSpawner(s, CONFIG, input({ playerDist: 0, aliveCount: 1 })).state;
    }
    const mid = s.cooldown;
    expect(mid).toBeLessThan(CONFIG.cadence);
    // Step out: dormant, but the countdown is preserved (not reset to cadence).
    s = stepSpawner(s, CONFIG, input({ playerDist: 500, aliveCount: 1 })).state;
    expect(s.phase).toBe("dormant");
    expect(s.cooldown).toBeCloseTo(mid, 5);
    // Step back in: resumes from `mid` (minus this step), proving no reset.
    const back = stepSpawner(s, CONFIG, input({ playerDist: 0, aliveCount: 1 }));
    expect(back.state.cooldown).toBeCloseTo(mid - DT, 5);
  });

  test("never spawns past the max-alive cap, but pops the instant a slot frees", () => {
    // Cooldown elapsed and already at the cap → no spawn, timer held ready at 0.
    const capped = stepSpawner(
      { phase: "active", cooldown: 0 },
      CONFIG,
      input({ playerDist: 0, aliveCount: CONFIG.maxAlive }),
    );
    expect(capped.spawn).toBe(0);
    expect(capped.state.cooldown).toBe(0);
    // A slot frees → the very next step spawns without waiting another cadence.
    const freed = stepSpawner(
      capped.state,
      CONFIG,
      input({ playerDist: 0, aliveCount: CONFIG.maxAlive - 1 }),
    );
    expect(freed.spawn).toBe(1);
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
    });
    expect(c).toEqual({
      creature: "wolf",
      maxHp: 250,
      activationRadius: 600,
      cadence: 1.5,
      maxAlive: 8,
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
