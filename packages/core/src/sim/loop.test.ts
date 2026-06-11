import { describe, expect, it } from "bun:test";
import { advanceFixed, DEFAULT_STEP } from "./loop";

describe("advanceFixed", () => {
  const config = { step: DEFAULT_STEP, maxSteps: 5 };

  it("runs exactly one step when a full step has accumulated", () => {
    const result = advanceFixed(0, DEFAULT_STEP, config);
    expect(result.steps).toBe(1);
    expect(result.accumulator).toBeCloseTo(0, 6);
  });

  it("carries remainder into alpha for interpolation", () => {
    const result = advanceFixed(0, DEFAULT_STEP * 1.5, config);
    expect(result.steps).toBe(1);
    expect(result.alpha).toBeCloseTo(0.5, 5);
  });

  it("accumulates fractional frames until a step fires", () => {
    let acc = 0;
    let totalSteps = 0;
    for (let i = 0; i < 4; i++) {
      const r = advanceFixed(acc, DEFAULT_STEP / 4, config);
      acc = r.accumulator;
      totalSteps += r.steps;
    }
    expect(totalSteps).toBe(1);
  });

  it("caps steps to avoid the spiral of death after a long stall", () => {
    const result = advanceFixed(0, 100, config);
    expect(result.steps).toBe(5);
  });
});
