import { describe, expect, test } from "bun:test";
import { approachVelocity } from "./locomotion";
import { length, vec2, type Vec2 } from "../math/vec2";

const DT = 1 / 60;
const ACCEL = 1600;
const DECEL = 2800;

const step = (current: Vec2, desired: Vec2): Vec2 =>
  approachVelocity(current, desired, DT, ACCEL, DECEL);

describe("approachVelocity", () => {
  test("ramps up at the accel rate, not instantly", () => {
    const v = step(vec2(0, 0), vec2(280, 0));
    expect(v.x).toBeCloseTo(ACCEL * DT);
    expect(v.y).toBe(0);
  });

  test("reaches the desired velocity exactly, without overshoot", () => {
    let v = vec2(0, 0);
    const desired = vec2(280, 0);
    const stepsToMax = Math.ceil(280 / (ACCEL * DT));
    for (let i = 0; i < stepsToMax; i++) v = step(v, desired);
    expect(v).toEqual(desired);
  });

  test("uses the decel rate when the stick is released", () => {
    const v = step(vec2(280, 0), vec2(0, 0));
    expect(v.x).toBeCloseTo(280 - DECEL * DT);
  });

  test("released at full speed, stopping takes a few frames (the skid)", () => {
    let v = vec2(280, 0);
    let frames = 0;
    // "> 1e-9" not "> 0": float residue can leave ~3e-14 px/s after the last
    // real frame, which is stopped for every gameplay purpose.
    while (length(v) > 1e-9) {
      v = step(v, vec2(0, 0));
      frames++;
    }
    // 280 px/s shedding DECEL*DT ≈ 46.7 px/s per frame → 6 frames (~0.1s).
    expect(frames).toBe(6);
  });

  test("uses decel when easing back to a slower speed", () => {
    const v = step(vec2(280, 0), vec2(100, 0));
    expect(v.x).toBeCloseTo(280 - DECEL * DT);
  });

  test("uses accel for a same-speed direction change (momentum)", () => {
    const v = step(vec2(280, 0), vec2(-280, 0));
    expect(v.x).toBeCloseTo(280 - ACCEL * DT);
  });

  test("a stationary player with no input stays put", () => {
    expect(step(vec2(0, 0), vec2(0, 0))).toEqual(vec2(0, 0));
  });
});
