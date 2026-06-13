import { describe, expect, test } from "bun:test";
import { arrive, clampSpeed, flee, keepDistance, orbit, seek, separation } from "./steering";
import { dot, length, normalize, sub, vec2 } from "../math/vec2";

const SPEED = 200;

describe("seek", () => {
  test("heads straight at the target at full speed", () => {
    const v = seek(vec2(0, 0), vec2(100, 0), SPEED);
    expect(v).toEqual(vec2(SPEED, 0));
  });

  test("full speed regardless of distance", () => {
    expect(length(seek(vec2(0, 0), vec2(3, 4), SPEED))).toBeCloseTo(SPEED);
  });
});

describe("flee", () => {
  test("heads straight away from the target at full speed", () => {
    const v = flee(vec2(0, 0), vec2(100, 0), SPEED);
    expect(v).toEqual(vec2(-SPEED, 0));
  });

  test("is the exact inverse of seek", () => {
    const pos = vec2(10, -20);
    const target = vec2(70, 40);
    expect(flee(pos, target, SPEED)).toEqual(seek(target, pos, SPEED));
  });
});

describe("arrive", () => {
  test("full speed outside the slow radius", () => {
    expect(arrive(vec2(0, 0), vec2(500, 0), SPEED, 100)).toEqual(vec2(SPEED, 0));
  });

  test("scales down inside the slow radius", () => {
    const v = arrive(vec2(0, 0), vec2(50, 0), SPEED, 100);
    expect(v.x).toBeCloseTo(SPEED * 0.5);
  });

  test("zero at the target (no jitter)", () => {
    expect(arrive(vec2(10, 10), vec2(10, 10), SPEED, 100)).toEqual(vec2(0, 0));
  });
});

describe("orbit", () => {
  test("on the ring, motion is purely tangential", () => {
    // Enemy due west of the target, exactly at ring distance.
    const v = orbit(vec2(-150, 0), vec2(0, 0), SPEED, 150, 1);
    const radial = normalize(sub(vec2(0, 0), vec2(-150, 0)));
    expect(dot(v, radial)).toBeCloseTo(0);
    expect(length(v)).toBeCloseTo(SPEED);
  });

  test("inside the ring, steers outward while circling", () => {
    const v = orbit(vec2(-50, 0), vec2(0, 0), SPEED, 150, 1);
    const radialOut = normalize(sub(vec2(-50, 0), vec2(0, 0)));
    expect(dot(v, radialOut)).toBeGreaterThan(0);
  });

  test("outside the ring, steers inward while circling", () => {
    const v = orbit(vec2(-300, 0), vec2(0, 0), SPEED, 150, 1);
    const radialIn = normalize(sub(vec2(0, 0), vec2(-300, 0)));
    expect(dot(v, radialIn)).toBeGreaterThan(0);
  });

  test("direction flips the circling sense", () => {
    const cw = orbit(vec2(-150, 0), vec2(0, 0), SPEED, 150, 1);
    const ccw = orbit(vec2(-150, 0), vec2(0, 0), SPEED, 150, -1);
    expect(cw.y).toBeCloseTo(-ccw.y);
  });

  test("dead-centre overlap holds still rather than NaN", () => {
    expect(orbit(vec2(0, 0), vec2(0, 0), SPEED, 150, 1)).toEqual(vec2(0, 0));
  });
});

describe("keepDistance", () => {
  test("silent at or beyond the minimum distance", () => {
    expect(keepDistance(vec2(-100, 0), vec2(0, 0), SPEED, 100)).toEqual(vec2(0, 0));
  });

  test("pushes away when too close, harder when closer", () => {
    const near = keepDistance(vec2(-20, 0), vec2(0, 0), SPEED, 100);
    const nearer = keepDistance(vec2(-10, 0), vec2(0, 0), SPEED, 100);
    expect(near.x).toBeLessThan(0);
    expect(nearer.x).toBeLessThan(near.x);
  });
});

describe("separation", () => {
  test("no neighbours, no push", () => {
    expect(separation(vec2(0, 0), [], SPEED, 80)).toEqual(vec2(0, 0));
  });

  test("ignores neighbours beyond the radius", () => {
    expect(separation(vec2(0, 0), [vec2(100, 0)], SPEED, 80)).toEqual(vec2(0, 0));
  });

  test("pushes away from a close neighbour", () => {
    const v = separation(vec2(0, 0), [vec2(20, 0)], SPEED, 80);
    expect(v.x).toBeLessThan(0);
    expect(v.y).toBe(0);
  });

  test("symmetric neighbours cancel", () => {
    const v = separation(vec2(0, 0), [vec2(20, 0), vec2(-20, 0)], SPEED, 80);
    expect(v.x).toBeCloseTo(0);
  });

  test("total push never exceeds maxSpeed", () => {
    const crowd = [vec2(5, 0), vec2(0, 5), vec2(-5, 0), vec2(3, 3)];
    expect(length(separation(vec2(0, 0), crowd, SPEED, 80))).toBeLessThanOrEqual(SPEED + 1e-9);
  });
});

describe("clampSpeed", () => {
  test("leaves slow vectors alone", () => {
    expect(clampSpeed(vec2(10, 0), SPEED)).toEqual(vec2(10, 0));
  });

  test("caps fast vectors preserving direction", () => {
    const v = clampSpeed(vec2(600, 800), SPEED);
    expect(length(v)).toBeCloseTo(SPEED);
    expect(v.x / v.y).toBeCloseTo(600 / 800);
  });
});
