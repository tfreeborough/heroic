import { describe, expect, test } from "bun:test";
import {
  ATTACK_CYCLE_READY,
  stepAttackCycle,
  type AttackCycleInputs,
  type AttackCycleState,
} from "./attack";

const CONFIG = { windup: 0.2, recovery: 0.4 };
const DT = 1 / 60;

const inputs = (overrides: Partial<AttackCycleInputs> = {}): AttackCycleInputs => ({
  targetInRange: true,
  lockValid: true,
  ...overrides,
});

/** Run repeated steps with constant inputs; returns the trace of results. */
const run = (state: AttackCycleState, steps: number, input = inputs()) => {
  const trace = [];
  let s = state;
  for (let i = 0; i < steps; i++) {
    const result = stepAttackCycle(s, CONFIG, DT, input);
    trace.push(result);
    s = result.state;
  }
  return trace;
};

describe("stepAttackCycle", () => {
  test("stays ready with no target in range", () => {
    const result = stepAttackCycle(ATTACK_CYCLE_READY, CONFIG, DT, inputs({ targetInRange: false }));
    expect(result.state.phase).toBe("ready");
    expect(result.windupStarted).toBe(false);
  });

  test("starts a windup when a target enters range", () => {
    const result = stepAttackCycle(ATTACK_CYCLE_READY, CONFIG, DT, inputs());
    expect(result.state).toEqual({ phase: "windup", remaining: CONFIG.windup });
    expect(result.windupStarted).toBe(true);
    expect(result.struck).toBe(false);
  });

  test("strikes when the windup completes", () => {
    // windup 0.2s ≈ 12 ticks at 1/60 (float drift may push it one tick).
    const trace = run(ATTACK_CYCLE_READY, 15);
    const strikeTick = trace.findIndex((r) => r.struck);
    expect(strikeTick).toBeGreaterThanOrEqual(12);
    expect(strikeTick).toBeLessThanOrEqual(13);
    expect(trace.filter((r) => r.struck)).toHaveLength(1);
    expect(trace[strikeTick]!.state.phase).toBe("recovery");
  });

  test("carries windup overshoot into recovery to keep cadence exact", () => {
    const windup: AttackCycleState = { phase: "windup", remaining: DT / 2 };
    const result = stepAttackCycle(windup, CONFIG, DT, inputs());
    expect(result.struck).toBe(true);
    expect(result.state.remaining).toBeCloseTo(CONFIG.recovery - DT / 2);
  });

  test("a lock break aborts the windup without striking", () => {
    const windup: AttackCycleState = { phase: "windup", remaining: 0.1 };
    const result = stepAttackCycle(windup, CONFIG, DT, inputs({ lockValid: false }));
    expect(result.state.phase).toBe("ready");
    expect(result.lockBroken).toBe(true);
    expect(result.struck).toBe(false);
  });

  test("recovery ignores the lock and returns to ready", () => {
    const recovery: AttackCycleState = { phase: "recovery", remaining: DT };
    const result = stepAttackCycle(recovery, CONFIG, DT, inputs({ lockValid: false }));
    expect(result.state.phase).toBe("ready");
    expect(result.lockBroken).toBe(false);
  });

  test("full cycle cadence: strikes repeat every windup + recovery", () => {
    // 2 full cycles = 2 × 0.6s = 72 ticks; expect exactly 2 strikes.
    const trace = run(ATTACK_CYCLE_READY, 73);
    expect(trace.filter((r) => r.struck)).toHaveLength(2);
  });
});
