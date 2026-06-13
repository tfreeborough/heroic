import { describe, expect, test } from "bun:test";
import { ambusher, type AmbusherConfig } from "./ambusher";
import { length, vec2, type Vec2 } from "../../math/vec2";

const DT = 1 / 60;
const CFG: AmbusherConfig = {
  speed: 300,
  separationRadius: 50,
  triggerRadius: 150,
  releaseRadius: 360,
};

const perceive = (selfPos: Vec2) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors: [],
});

describe("ambusher archetype", () => {
  test("lies dormant while the player is beyond the trigger radius", () => {
    const state = ambusher.initState(CFG, 0);
    const v = ambusher.tick(state, CFG, perceive(vec2(300, 0)), DT);
    expect(v).toEqual(vec2(0, 0));
    expect(state.mode).toBe("dormant");
  });

  test("wakes and lunges full-speed once the player crosses the trigger", () => {
    const state = ambusher.initState(CFG, 0);
    const v = ambusher.tick(state, CFG, perceive(vec2(120, 0)), DT);
    expect(state.mode).toBe("lunging");
    expect(length(v)).toBeCloseTo(CFG.speed);
    expect(v.x).toBeLessThan(0); // toward the player
  });

  test("keeps chasing between trigger and release (no flicker on the edge)", () => {
    const state = ambusher.initState(CFG, 0);
    ambusher.tick(state, CFG, perceive(vec2(120, 0)), DT); // wake
    const v = ambusher.tick(state, CFG, perceive(vec2(250, 0)), DT); // past trigger, within release
    expect(state.mode).toBe("lunging");
    expect(length(v)).toBeCloseTo(CFG.speed);
  });

  test("re-arms when the player escapes beyond the release radius", () => {
    const state = ambusher.initState(CFG, 0);
    ambusher.tick(state, CFG, perceive(vec2(120, 0)), DT); // wake
    const v = ambusher.tick(state, CFG, perceive(vec2(400, 0)), DT); // beyond release
    expect(state.mode).toBe("dormant");
    expect(v).toEqual(vec2(0, 0));
  });
});
