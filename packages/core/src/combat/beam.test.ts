import { describe, expect, test } from "bun:test";
import { stepBeamLink, type BeamState } from "./beam";

describe("stepBeamLink", () => {
  test("a held link accumulates and ticks on the interval", () => {
    let state: BeamState | null = null;
    let ticks = 0;
    // 2 simulated seconds at 30Hz on one target, 0.5s interval → 4 ticks.
    for (let i = 0; i < 60; i++) {
      const step = stepBeamLink(state, 7, 0.5, 1 / 30);
      state = step.state;
      ticks += step.ticks;
    }
    expect(ticks).toBe(4);
    expect(state!.linkSeconds).toBeCloseTo(2, 5);
  });

  test("the first tick is EARNED — a fresh link fires nothing until a full interval passes", () => {
    let state: BeamState | null = null;
    let ticks = 0;
    for (let i = 0; i < 14; i++) {
      // 14 × 1/30 ≈ 0.47s — just under the interval.
      const step = stepBeamLink(state, 7, 0.5, 1 / 30);
      state = step.state;
      ticks += step.ticks;
    }
    expect(ticks).toBe(0);
    const step = stepBeamLink(state, 7, 0.5, 1 / 30); // 0.5s crossed
    expect(step.ticks).toBe(1);
  });

  test("a target change is a NEW link, never a transfer", () => {
    let state: BeamState | null = null;
    for (let i = 0; i < 30; i++) state = stepBeamLink(state, 7, 0.5, 1 / 30).state;
    expect(state!.linkSeconds).toBeCloseTo(1, 5);
    state = stepBeamLink(state, 9, 0.5, 1 / 30).state; // switched
    expect(state!.targetId).toBe(9);
    expect(state!.linkSeconds).toBeCloseTo(1 / 30, 5); // ramp reset
  });

  test("no nomination drops the link", () => {
    let state: BeamState | null = stepBeamLink(null, 7, 0.5, 1 / 30).state;
    const step = stepBeamLink(state, null, 0.5, 1 / 30);
    expect(step.state).toBeNull();
    expect(step.ticks).toBe(0);
  });

  test("a large dt fires several ticks", () => {
    let state: BeamState | null = stepBeamLink(null, 7, 0.5, 1 / 30).state;
    const step = stepBeamLink(state, 7, 0.5, 2);
    expect(step.ticks).toBe(4);
  });
});

describe("stepBeamLink grace", () => {
  const heldFor = (seconds: number): BeamState => {
    let state: BeamState | null = null;
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      state = stepBeamLink(state, 7, 0.5, 1 / 30, 1.5).state;
    }
    return state!;
  };

  test("a brief loss holds the link in grace — frozen, tickless — and the same target resumes it intact", () => {
    let state: BeamState | null = heldFor(4);
    const ramped = state.linkSeconds;
    // 0.5s of nothing nominated: memory holds, clocks frozen, no ticks.
    for (let i = 0; i < 15; i++) {
      const step = stepBeamLink(state, null, 0.5, 1 / 30, 1.5);
      expect(step.ticks).toBe(0);
      state = step.state;
      expect(state).not.toBeNull();
    }
    expect(state!.linkSeconds).toBeCloseTo(ramped, 5); // frozen, not grown
    // The same target returns: the ramp continues from where it froze.
    state = stepBeamLink(state, 7, 0.5, 1 / 30, 1.5).state;
    expect(state!.targetId).toBe(7);
    expect(state!.linkSeconds).toBeCloseTo(ramped + 1 / 30, 5);
    expect(state!.graceLeft).toBe(0);
  });

  test("grace expiry drops the link for real", () => {
    let state: BeamState | null = heldFor(4);
    for (let i = 0; i < Math.round(1.6 * 30); i++) {
      state = stepBeamLink(state, null, 0.5, 1 / 30, 1.5).state;
    }
    expect(state).toBeNull();
  });

  test("a DIFFERENT nomination during grace abandons the memory for a fresh link", () => {
    let state: BeamState | null = heldFor(4);
    state = stepBeamLink(state, null, 0.5, 1 / 30, 1.5).state; // into grace
    state = stepBeamLink(state, 9, 0.5, 1 / 30, 1.5).state; // someone else
    expect(state!.targetId).toBe(9);
    expect(state!.linkSeconds).toBeCloseTo(1 / 30, 5); // fresh, not inherited
  });

  test("graceSeconds 0 keeps the old drop-immediately contract", () => {
    let state: BeamState | null = heldFor(4);
    expect(stepBeamLink(state, null, 0.5, 1 / 30).state).toBeNull();
  });
});
