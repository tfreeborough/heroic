import { describe, expect, test } from "bun:test";
import { circler, type CirclerConfig, type CirclerState } from "./circler";
import { dot, length, normalize, sub, vec2, type Vec2 } from "../../math/vec2";

const DT = 1 / 60;
const CFG: CirclerConfig = {
  speed: 220,
  separationRadius: 50,
  aggroRadius: 600,
  orbitDistance: 150,
  circleSpeedScale: 0.5,
  frontArcWidth: Math.PI / 2, // half-arc = 45°
  arcMargin: Math.PI / 36, // 5°
  minModeTime: 0.25,
};

const perceive = (selfPos: Vec2, playerFacing: number) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing,
  neighbors: [],
});

// Wolf due east of the player at orbit distance; facing 0 = straight at it.
const wolfPos = vec2(150, 0);

/** Tick a state enough for minModeTime to elapse under a constant perception. */
const settle = (state: CirclerState, p: ReturnType<typeof perceive>): Vec2 => {
  let v = vec2(0, 0);
  const steps = Math.ceil(CFG.minModeTime / DT) + 1;
  for (let i = 0; i < steps; i++) v = circler.tick(state, CFG, p, DT);
  return v;
};

describe("circler archetype", () => {
  test("approaches while the player faces away", () => {
    const state = circler.initState(CFG, 0);
    const v = settle(state, perceive(wolfPos, Math.PI)); // player looks west, wolf is east
    expect(state.mode).toBe("approach");
    expect(v.x).toBeLessThan(0);
  });

  test("circles when watched: motion is mostly tangential", () => {
    const state = circler.initState(CFG, 0);
    const v = settle(state, perceive(wolfPos, 0)); // player stares right at it
    expect(state.mode).toBe("circle");
    const radial = normalize(sub(vec2(0, 0), wolfPos));
    expect(Math.abs(dot(v, radial))).toBeLessThan(CFG.speed * 0.2);
  });

  test("circles at prowl speed, not full speed", () => {
    const state = circler.initState(CFG, 0);
    const v = settle(state, perceive(wolfPos, 0));
    expect(length(v)).toBeCloseTo(CFG.speed * CFG.circleSpeedScale);
  });

  test("backpedal from a diving player is faster than the prowl", () => {
    const state = circler.initState(CFG, 0);
    settle(state, perceive(wolfPos, 0)); // enter circle on the ring
    const v = circler.tick(state, CFG, perceive(vec2(40, 0), 0), DT); // player dives inside
    expect(state.mode).toBe("circle");
    expect(length(v)).toBeGreaterThan(CFG.speed * CFG.circleSpeedScale);
    expect(v.x).toBeGreaterThan(0); // net motion away from the player
  });

  test("a switch waits out the minimum mode time", () => {
    const state = circler.initState(CFG, 0);
    circler.tick(state, CFG, perceive(wolfPos, 0), DT); // one watched tick
    expect(state.mode).toBe("approach");
  });

  test("arc-edge wobble inside the margin does not flip the mode", () => {
    const state = circler.initState(CFG, 0);
    settle(state, perceive(wolfPos, 0));
    expect(state.mode).toBe("circle");
    settle(state, perceive(wolfPos, CFG.frontArcWidth / 2 + CFG.arcMargin * 0.5)); // within margin
    expect(state.mode).toBe("circle");
    settle(state, perceive(wolfPos, CFG.frontArcWidth / 2 + CFG.arcMargin * 2)); // clearly outside
    expect(state.mode).toBe("approach");
  });

  test("idles beyond aggro whatever the mode", () => {
    const state = circler.initState(CFG, 0);
    expect(circler.tick(state, CFG, perceive(vec2(700, 0), 0), DT)).toEqual(vec2(0, 0));
  });

  test("orbit direction alternates by spawn index", () => {
    const even = circler.initState(CFG, 0);
    const odd = circler.initState(CFG, 1);
    const cw = settle(even, perceive(wolfPos, 0));
    const ccw = settle(odd, perceive(wolfPos, 0));
    expect(Math.sign(cw.y)).toBe(-Math.sign(ccw.y));
  });
});
