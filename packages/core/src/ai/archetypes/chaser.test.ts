import { describe, expect, test } from "bun:test";
import { chaser, type ChaserConfig } from "./chaser";
import { vec2, type Vec2 } from "../../math/vec2";

const DT = 1 / 60;
const CFG: ChaserConfig = { speed: 120, separationRadius: 50, aggroRadius: 500 };

const perceive = (selfPos: Vec2) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors: [],
});

describe("chaser archetype", () => {
  test("seeks straight at the player inside aggro", () => {
    const v = chaser.tick(chaser.initState(CFG, 0), CFG, perceive(vec2(300, 0)), DT);
    expect(v.x).toBeCloseTo(-CFG.speed);
    expect(v.y).toBeCloseTo(0);
  });

  test("idles beyond aggro", () => {
    const v = chaser.tick(chaser.initState(CFG, 0), CFG, perceive(vec2(600, 0)), DT);
    expect(v).toEqual(vec2(0, 0));
  });
});
