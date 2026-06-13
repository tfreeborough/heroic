import { describe, expect, test } from "bun:test";
import { kiter, type KiterConfig } from "./kiter";
import { length, vec2, type Vec2 } from "../../math/vec2";

const DT = 1 / 60;
const CFG: KiterConfig = {
  speed: 200,
  separationRadius: 50,
  aggroRadius: 700,
  preferredRange: 250,
  rangeBand: 40,
};

const perceive = (selfPos: Vec2) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors: [],
});

describe("kiter archetype", () => {
  test("closes in when the player is beyond the preferred band", () => {
    const v = kiter.tick(kiter.initState(CFG, 0), CFG, perceive(vec2(400, 0)), DT);
    expect(v.x).toBeLessThan(0); // toward the player
    expect(length(v)).toBeCloseTo(CFG.speed);
  });

  test("backs off when the player is inside the preferred band", () => {
    const v = kiter.tick(kiter.initState(CFG, 0), CFG, perceive(vec2(150, 0)), DT);
    expect(v.x).toBeGreaterThan(0); // away from the player
    expect(length(v)).toBeCloseTo(CFG.speed);
  });

  test("holds position inside the comfortable band", () => {
    const v = kiter.tick(kiter.initState(CFG, 0), CFG, perceive(vec2(250, 0)), DT);
    expect(v).toEqual(vec2(0, 0));
  });

  test("idles beyond aggro", () => {
    const v = kiter.tick(kiter.initState(CFG, 0), CFG, perceive(vec2(800, 0)), DT);
    expect(v).toEqual(vec2(0, 0));
  });
});
