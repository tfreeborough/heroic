import { describe, expect, test } from "bun:test";
import { ABILITY_READY, stepAbility, type AbilityConfig, type AbilityState } from "./ability";

const CONFIG: AbilityConfig = { activeDuration: 0.2, cooldown: 1 };
const DT = 1 / 60;

/** Run repeated steps; `trigger(i)` decides if the activation request is set that step. */
const run = (state: AbilityState, steps: number, trigger: (i: number) => boolean = () => false) => {
  const trace = [];
  let s = state;
  for (let i = 0; i < steps; i++) {
    const result = stepAbility(s, CONFIG, DT, trigger(i));
    trace.push(result);
    s = result.state;
  }
  return trace;
};

describe("stepAbility", () => {
  test("stays ready until triggered", () => {
    const result = stepAbility(ABILITY_READY, CONFIG, DT, false);
    expect(result.state.phase).toBe("ready");
    expect(result.activated).toBe(false);
  });

  test("fires on trigger, opening the active window and full cooldown", () => {
    const result = stepAbility(ABILITY_READY, CONFIG, DT, true);
    expect(result.activated).toBe(true);
    expect(result.ended).toBe(false);
    expect(result.state).toEqual({
      phase: "active",
      activeRemaining: CONFIG.activeDuration,
      cooldownRemaining: CONFIG.cooldown,
    });
  });

  test("active window lasts ~activeDuration, then ends into cooldown exactly once", () => {
    // 0.2s ≈ 12 ticks at 1/60 (float drift may shift it a tick).
    const trace = run(ABILITY_READY, 20, (i) => i === 0);
    const endedAt = trace.findIndex((r) => r.ended);
    expect(endedAt).toBeGreaterThanOrEqual(12);
    expect(endedAt).toBeLessThanOrEqual(13);
    expect(trace.filter((r) => r.ended)).toHaveLength(1);
    expect(trace[endedAt]!.state.phase).toBe("cooldown");
  });

  test("ignores re-triggers while active or cooling — fires only once", () => {
    const trace = run(ABILITY_READY, 30, () => true); // mash the button every step
    expect(trace.filter((r) => r.activated)).toHaveLength(1);
    expect(trace[0]!.activated).toBe(true);
  });

  test("returns to ready after the cooldown elapses (measured from activation)", () => {
    // cooldown 1s = 60 ticks from activation; run past it.
    const trace = run(ABILITY_READY, 70, (i) => i === 0);
    const readyAt = trace.findIndex((r) => r.state.phase === "ready");
    expect(readyAt).toBeGreaterThanOrEqual(59);
    expect(readyAt).toBeLessThanOrEqual(61);
  });

  test("cooldownRemaining decreases monotonically through active and cooldown", () => {
    const trace = run(ABILITY_READY, 70, (i) => i === 0);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]!.state.cooldownRemaining).toBeLessThanOrEqual(trace[i - 1]!.state.cooldownRemaining);
    }
  });

  test("an instantaneous ability fires and ends the same step, then cools down", () => {
    const instant: AbilityConfig = { activeDuration: 0, cooldown: 0.5 };
    const result = stepAbility(ABILITY_READY, instant, DT, true);
    expect(result.activated).toBe(true);
    expect(result.ended).toBe(true);
    expect(result.state.phase).toBe("cooldown");
    expect(result.state.cooldownRemaining).toBe(0.5);
  });
});
