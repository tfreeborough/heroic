import { describe, expect, test } from "bun:test";
import { charger, type ChargerConfig } from "./charger";
import { length, vec2, type Vec2 } from "../../math/vec2";

const DT = 1 / 60;
const CFG: ChargerConfig = {
  speed: 120, // approach
  maxSpeed: 600, // dash
  separationRadius: 56,
  aggroRadius: 560,
  chargeRange: 300,
  windupTime: 0.5,
  dashDuration: 0.4,
  recoverTime: 0.6,
};

const perceive = (selfPos: Vec2) => ({
  selfPos,
  playerPos: vec2(0, 0),
  playerFacing: 0,
  neighbors: [],
});

/** Advance one state's timer to completion under constant perception. */
const runFor = (state: ReturnType<typeof charger.initState>, seconds: number, at: Vec2) => {
  const steps = Math.ceil(seconds / DT) + 1;
  for (let i = 0; i < steps; i++) charger.tick(state, CFG, perceive(at), DT);
};

/** Tick until the FSM leaves its current mode; returns the mode it lands in. */
const tickUntilModeChange = (state: ReturnType<typeof charger.initState>, at: Vec2): string => {
  const start = state.mode;
  for (let i = 0; i < 1000; i++) {
    charger.tick(state, CFG, perceive(at), DT);
    if (state.mode !== start) return state.mode;
  }
  return state.mode;
};

describe("charger archetype", () => {
  test("approaches at the (slow) approach speed when out of charge range", () => {
    const v = charger.tick(charger.initState(CFG, 0), CFG, perceive(vec2(500, 0)), DT);
    expect(v.x).toBeCloseTo(-CFG.speed); // toward player, at approach speed
    expect(length(v)).toBeCloseTo(CFG.speed);
  });

  test("idles beyond aggro", () => {
    expect(charger.tick(charger.initState(CFG, 0), CFG, perceive(vec2(700, 0)), DT)).toEqual(
      vec2(0, 0),
    );
  });

  test("enters windup and locks the dash line when within charge range", () => {
    const state = charger.initState(CFG, 0);
    const v = charger.tick(state, CFG, perceive(vec2(250, 0)), DT); // inside chargeRange
    expect(state.mode).toBe("windup");
    expect(v).toEqual(vec2(0, 0)); // holds still while winding up
    expect(state.dashDir.x).toBeCloseTo(-1); // locked toward the player (west)
  });

  test("telegraphs the committed line during windup, nothing otherwise", () => {
    const state = charger.initState(CFG, 0);
    expect(charger.telegraph!(state, CFG)).toBeNull(); // approaching
    charger.tick(state, CFG, perceive(vec2(250, 0)), DT); // → windup
    const tele = charger.telegraph!(state, CFG);
    expect(tele?.kind).toBe("charge");
    expect(tele?.dir).toBeCloseTo(Math.PI); // pointing west, at the player
    expect(tele!.progress).toBeGreaterThanOrEqual(0);
  });

  test("dashes at maxSpeed along the locked line, ignoring later player moves", () => {
    const state = charger.initState(CFG, 0);
    charger.tick(state, CFG, perceive(vec2(250, 0)), DT); // windup, locks west
    runFor(state, CFG.windupTime, vec2(250, 0)); // finish windup
    expect(state.mode).toBe("dash");
    // Player has since jumped north; the dash must NOT redirect.
    const v = charger.tick(state, CFG, perceive(vec2(0, 300)), DT);
    expect(length(v)).toBeCloseTo(CFG.maxSpeed!);
    expect(v.x).toBeCloseTo(-CFG.maxSpeed!); // still due west, the committed line
    expect(v.y).toBeCloseTo(0);
  });

  test("cycles windup → dash → recover → approach", () => {
    const state = charger.initState(CFG, 0);
    charger.tick(state, CFG, perceive(vec2(250, 0)), DT);
    expect(state.mode).toBe("windup");
    expect(tickUntilModeChange(state, vec2(250, 0))).toBe("dash");
    expect(tickUntilModeChange(state, vec2(250, 0))).toBe("recover");
    // Lands back in approach (and would immediately re-charge next tick, since
    // the player is still in range — that re-trigger is the loop, by design).
    expect(tickUntilModeChange(state, vec2(250, 0))).toBe("approach");
  });
});
