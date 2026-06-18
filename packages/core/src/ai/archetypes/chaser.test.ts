import { describe, expect, test } from "bun:test";
import {
  chaser,
  MAX_SPEED_MULT,
  RAMP_PER_SEC,
  SPEED_VARIANCE,
  type ChaserConfig,
} from "./chaser";
import { LEASH_MULT } from "../perception";
import { length, vec2, type Vec2 } from "../../math/vec2";

const DT = 1 / 60;
const CFG: ChaserConfig = { speed: 120, separationRadius: 50, aggroRadius: 500 };
/** A distance comfortably past the leash, where even an engaged chaser gives up. */
const BEYOND_LEASH = vec2(CFG.aggroRadius * LEASH_MULT + 1000, 0);

const perceive = (selfPos: Vec2) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors: [],
});

/** Tick `n` times from a fresh state inside aggro and return the final intent. */
const chaseFor = (state = chaser.initState(CFG, 0), n = 1, selfPos = vec2(300, 0)): Vec2 => {
  let v = vec2(0, 0);
  for (let i = 0; i < n; i++) v = chaser.tick(state, CFG, perceive(selfPos), DT);
  return v;
};

describe("chaser archetype", () => {
  test("seeks straight at the player inside aggro", () => {
    const v = chaseFor();
    expect(v.y).toBeCloseTo(0); // self is due east of the player → heads due west
    expect(v.x).toBeLessThan(0);
  });

  test("idles beyond aggro", () => {
    const v = chaser.tick(chaser.initState(CFG, 0), CFG, perceive(vec2(600, 0)), DT);
    expect(v).toEqual(vec2(0, 0));
  });

  describe("randomised spawn speed", () => {
    test("each individual spawns within ±SPEED_VARIANCE of config.speed", () => {
      for (let index = 0; index < 50; index++) {
        const { baseSpeed } = chaser.initState(CFG, index);
        expect(baseSpeed).toBeGreaterThanOrEqual(CFG.speed * (1 - SPEED_VARIANCE) - 1e-9);
        expect(baseSpeed).toBeLessThanOrEqual(CFG.speed * (1 + SPEED_VARIANCE) + 1e-9);
      }
    });

    test("the spread genuinely varies across a wave", () => {
      const speeds = Array.from({ length: 20 }, (_, i) => chaser.initState(CFG, i).baseSpeed);
      expect(new Set(speeds).size).toBeGreaterThan(15); // not all clustered on one value
    });

    test("is deterministic per spawn index (replayable)", () => {
      expect(chaser.initState(CFG, 7).baseSpeed).toBe(chaser.initState(CFG, 7).baseSpeed);
      expect(chaser.initState(CFG, 7).baseSpeed).not.toBe(chaser.initState(CFG, 8).baseSpeed);
    });

    test("the fresh speed equals the spawn speed", () => {
      const s = chaser.initState(CFG, 3);
      expect(s.speed).toBe(s.baseSpeed);
    });
  });

  describe("chase ramp", () => {
    test("accelerates linearly while chasing", () => {
      const state = chaser.initState(CFG, 4);
      const base = state.baseSpeed;
      chaseFor(state, 60); // one second
      expect(state.speed).toBeCloseTo(base * (1 + RAMP_PER_SEC), 4);
      chaseFor(state, 60); // a second second — still linear in the spawn speed
      expect(state.speed).toBeCloseTo(base * (1 + 2 * RAMP_PER_SEC), 4);
    });

    test("the intent magnitude tracks the ramped speed", () => {
      const state = chaser.initState(CFG, 4);
      const v = chaseFor(state, 120); // two seconds
      expect(length(v)).toBeCloseTo(state.speed, 4);
    });

    test("is capped at MAX_SPEED_MULT× the spawn speed", () => {
      const state = chaser.initState(CFG, 4);
      const base = state.baseSpeed;
      chaseFor(state, 60 * 600); // ten minutes — far past the cap
      expect(state.speed).toBeCloseTo(base * MAX_SPEED_MULT, 6);
      expect(state.speed).toBeLessThanOrEqual(base * MAX_SPEED_MULT + 1e-9);
    });

    test("does not ramp or reset while idle past the leash, then resumes", () => {
      const state = chaser.initState(CFG, 4);
      chaseFor(state, 120); // ramp up for two seconds
      const earned = state.speed;
      expect(earned).toBeGreaterThan(state.baseSpeed);

      // Player slips the leash: it disengages, and the earned speed is retained,
      // neither accrued nor reset.
      for (let i = 0; i < 300; i++) chaser.tick(state, CFG, perceive(BEYOND_LEASH), DT);
      expect(state.engaged).toBe(false);
      expect(state.speed).toBe(earned);

      // Back within the notice radius: ramp continues from where it left off.
      chaseFor(state, 60);
      expect(state.speed).toBeGreaterThan(earned);
    });
  });

  describe("leash hysteresis", () => {
    test("keeps chasing well past the aggro radius once engaged", () => {
      const state = chaser.initState(CFG, 0);
      chaseFor(state, 1); // engage inside aggro
      // Out past aggroRadius but inside the leash: still pursuing, not idling.
      const v = chaser.tick(state, CFG, perceive(vec2(CFG.aggroRadius * 2, 0)), DT);
      expect(state.engaged).toBe(true);
      expect(length(v)).toBeGreaterThan(0);
    });

    test("a fresh chaser does not bite between the aggro radius and the leash", () => {
      // Never engaged: the wide leash must not widen the *notice* range.
      const v = chaser.tick(chaser.initState(CFG, 0), CFG, perceive(vec2(CFG.aggroRadius * 2, 0)), DT);
      expect(v).toEqual(vec2(0, 0));
    });
  });
});
