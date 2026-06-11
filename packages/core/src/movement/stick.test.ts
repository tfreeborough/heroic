import { describe, expect, test } from "bun:test";
import { faceMovement, resolveStick, STICK_ZERO } from "./stick";

const RADIUS = 100;

describe("resolveStick", () => {
  test("returns zero inside the deadzone", () => {
    expect(resolveStick({ x: 5, y: 5 }, RADIUS)).toEqual(STICK_ZERO);
    expect(resolveStick({ x: 0, y: 0 }, RADIUS)).toEqual(STICK_ZERO);
  });

  test("returns zero for a degenerate radius", () => {
    expect(resolveStick({ x: 50, y: 0 }, 0)).toEqual(STICK_ZERO);
    expect(resolveStick({ x: 50, y: 0 }, -10)).toEqual(STICK_ZERO);
  });

  test("magnitude ramps from 0 at the deadzone edge", () => {
    const { magnitude } = resolveStick({ x: 10.001, y: 0 }, RADIUS, 0.1);
    expect(magnitude).toBeGreaterThan(0);
    expect(magnitude).toBeLessThan(0.001);
  });

  test("magnitude is 0.5 halfway through the live range", () => {
    // deadzone 10px, radius 100px → live range 90px; 55px in = halfway.
    const { magnitude } = resolveStick({ x: 55, y: 0 }, RADIUS, 0.1);
    expect(magnitude).toBeCloseTo(0.5);
  });

  test("magnitude clamps at 1 when the thumb leaves the pad", () => {
    expect(resolveStick({ x: RADIUS, y: 0 }, RADIUS).magnitude).toBe(1);
    expect(resolveStick({ x: 500, y: 300 }, RADIUS).magnitude).toBe(1);
  });

  test("direction is a unit vector, even beyond the rim", () => {
    const { dir } = resolveStick({ x: 300, y: 400 }, RADIUS);
    expect(dir.x).toBeCloseTo(0.6);
    expect(dir.y).toBeCloseTo(0.8);
  });
});

describe("faceMovement", () => {
  test("faces the movement direction while moving", () => {
    const stick = resolveStick({ x: 0, y: 80 }, RADIUS);
    expect(faceMovement(0, stick)).toBeCloseTo(Math.PI / 2);
  });

  test("holds the last facing when idle", () => {
    expect(faceMovement(1.23, STICK_ZERO)).toBe(1.23);
  });
});
