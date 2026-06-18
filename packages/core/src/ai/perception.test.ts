import { describe, expect, test } from "bun:test";
import { beyondAggro, LEASH_MULT, updateAggro } from "./perception";
import { vec2, type Vec2 } from "../math/vec2";

const AGGRO = 100;
const LEASH = AGGRO * LEASH_MULT;

const perceive = (selfPos: Vec2) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors: [],
});

describe("beyondAggro", () => {
  test("true only past the radius", () => {
    expect(beyondAggro(perceive(vec2(AGGRO - 1, 0)), AGGRO)).toBe(false);
    expect(beyondAggro(perceive(vec2(AGGRO + 1, 0)), AGGRO)).toBe(true);
  });
});

describe("updateAggro (leash hysteresis)", () => {
  test("engages once the player is within the aggro radius", () => {
    const s = { engaged: false };
    expect(updateAggro(perceive(vec2(AGGRO + 1, 0)), s, AGGRO, LEASH)).toBe(false); // not yet
    expect(updateAggro(perceive(vec2(AGGRO - 1, 0)), s, AGGRO, LEASH)).toBe(true); // noticed
  });

  test("stays engaged out past the aggro radius — up to the leash", () => {
    const s = { engaged: false };
    updateAggro(perceive(vec2(0, 0)), s, AGGRO, LEASH); // engage
    // Between aggro and leash a *fresh* creature wouldn't bite, but an engaged one holds on.
    expect(updateAggro(perceive(vec2(AGGRO * 5, 0)), s, AGGRO, LEASH)).toBe(true);
    expect(updateAggro(perceive(vec2(LEASH - 1, 0)), s, AGGRO, LEASH)).toBe(true);
  });

  test("releases only once the player passes the leash", () => {
    const s = { engaged: true };
    expect(updateAggro(perceive(vec2(LEASH - 1, 0)), s, AGGRO, LEASH)).toBe(true);
    expect(updateAggro(perceive(vec2(LEASH + 1, 0)), s, AGGRO, LEASH)).toBe(false);
  });

  test("the gap prevents boundary flip-flop: re-aggro needs the tight radius again", () => {
    const s = { engaged: true };
    updateAggro(perceive(vec2(LEASH + 1, 0)), s, AGGRO, LEASH); // released
    // Drifting back to just inside the leash does NOT re-aggro — only the notice radius does.
    expect(updateAggro(perceive(vec2(AGGRO * 5, 0)), s, AGGRO, LEASH)).toBe(false);
    expect(updateAggro(perceive(vec2(AGGRO - 1, 0)), s, AGGRO, LEASH)).toBe(true);
  });

  test("defaults the leash to aggroRadius × LEASH_MULT", () => {
    const s = { engaged: true };
    expect(updateAggro(perceive(vec2(AGGRO * LEASH_MULT - 1, 0)), s, AGGRO)).toBe(true);
    expect(updateAggro(perceive(vec2(AGGRO * LEASH_MULT + 1, 0)), s, AGGRO)).toBe(false);
  });
});
