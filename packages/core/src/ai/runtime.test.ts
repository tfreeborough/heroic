import { describe, expect, test } from "bun:test";
import { makeBrain, tickBrain, type Archetype } from "./runtime";
import type { CommonConfig } from "./perception";
import { length, vec2, type Vec2 } from "../math/vec2";

const DT = 1 / 60;

/** A stub archetype that always wants to move at a fixed intent, for testing the wrapper. */
const fixedIntent = (intent: Vec2): Archetype<CommonConfig, null> => ({
  id: "fixed",
  initState: () => null,
  tick: () => intent,
});

const CONFIG: CommonConfig = { speed: 200, separationRadius: 80 };

const perceive = (selfPos: Vec2, neighbors: Vec2[] = []) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors,
});

describe("makeBrain", () => {
  test("seeds per-instance state from the archetype", () => {
    let seenIndex = -1;
    const probe: Archetype<CommonConfig, { index: number }> = {
      id: "probe",
      initState: (_c, index) => {
        seenIndex = index;
        return { index };
      },
      tick: () => vec2(0, 0),
    };
    const brain = makeBrain(probe, CONFIG, 3);
    expect(seenIndex).toBe(3);
    expect(brain.state).toEqual({ index: 3 });
  });
});

describe("tickBrain", () => {
  test("passes the archetype's intent through untouched when alone and within speed", () => {
    const brain = makeBrain(fixedIntent(vec2(50, 0)), CONFIG);
    expect(tickBrain(brain, perceive(vec2(100, 0)), DT)).toEqual(vec2(50, 0));
  });

  test("blends in separation from a packed ally", () => {
    const brain = makeBrain(fixedIntent(vec2(0, 0)), CONFIG); // no intent of its own
    const v = tickBrain(brain, perceive(vec2(0, 0), [vec2(20, 0)]), DT);
    expect(v.x).toBeLessThan(0); // pushed away from the ally
  });

  test("clamps the blended result to the creature's top speed", () => {
    const brain = makeBrain(fixedIntent(vec2(500, 0)), CONFIG); // intent over speed
    const v = tickBrain(brain, perceive(vec2(0, 5), [vec2(0, 10)]), DT); // + separation
    expect(length(v)).toBeLessThanOrEqual(CONFIG.speed + 1e-9);
  });
});
