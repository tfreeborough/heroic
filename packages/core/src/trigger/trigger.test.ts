import { describe, expect, test } from "bun:test";
import {
  initTriggerState,
  parseTriggerConfig,
  regionContains,
  stepTrigger,
  TRIGGER_DEFAULTS,
  TRIGGER_TEXT_DURATION_MS,
  type TriggerConfig,
} from "./trigger";
import type { Aabb } from "../physics/crowd";

const ONCE: TriggerConfig = {
  action: { type: "text", text: "hello", durationMs: 2000 },
  repeat: false,
};
const REPEAT: TriggerConfig = { ...ONCE, repeat: true };

/** Feed a sequence of inside/outside booleans; return the step where each fired. */
const run = (config: TriggerConfig, insides: boolean[]): boolean[] => {
  let state = initTriggerState();
  const fires: boolean[] = [];
  for (const inside of insides) {
    const step = stepTrigger(state, config, { inside });
    state = step.state;
    fires.push(step.fire);
  }
  return fires;
};

describe("stepTrigger — firing", () => {
  test("fires on the rising edge of entering, not while already inside", () => {
    // out, in(fire), in, in — only the first inside step fires.
    expect(run(ONCE, [false, true, true, true])).toEqual([false, true, false, false]);
  });

  test("one-shot: does not re-fire after leaving and re-entering", () => {
    expect(run(ONCE, [true, false, true, false, true])).toEqual([true, false, false, false, false]);
  });

  test("repeat: re-arms on exit and fires on every entry", () => {
    expect(run(REPEAT, [true, false, true, false, true])).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  test("repeat: does not fire while staying inside", () => {
    expect(run(REPEAT, [true, true, true])).toEqual([true, false, false]);
  });

  test("starting already inside fires on the first step", () => {
    expect(run(ONCE, [true])).toEqual([true]);
    // `fired` latches so a subsequent re-entry stays silent.
    const first = stepTrigger(initTriggerState(), ONCE, { inside: true });
    expect(first.state.fired).toBe(true);
    expect(first.state.inside).toBe(true);
  });
});

describe("regionContains", () => {
  const region: Aabb = { x: 100, y: 100, w: 40, h: 20 };
  test("true at the centre and inside the half-extents", () => {
    expect(regionContains(region, { x: 100, y: 100 })).toBe(true);
    expect(regionContains(region, { x: 119, y: 109 })).toBe(true);
  });
  test("inclusive on the edge, false beyond it", () => {
    expect(regionContains(region, { x: 120, y: 110 })).toBe(true); // exactly on the corner
    expect(regionContains(region, { x: 121, y: 100 })).toBe(false);
    expect(regionContains(region, { x: 100, y: 111 })).toBe(false);
  });
});

describe("parseTriggerConfig", () => {
  test("fills every field from defaults when props is empty", () => {
    const cfg = parseTriggerConfig({});
    expect(cfg).toEqual(TRIGGER_DEFAULTS);
    expect(cfg.action.durationMs).toBe(TRIGGER_TEXT_DURATION_MS);
  });

  test("reads authored text / duration / repeat", () => {
    const cfg = parseTriggerConfig({ text: "The air grows cold", durationMs: 5000, repeat: true });
    expect(cfg.action).toEqual({ type: "text", text: "The air grows cold", durationMs: 5000 });
    expect(cfg.repeat).toBe(true);
  });

  test("an unknown action type falls back to the text action", () => {
    const cfg = parseTriggerConfig({ action: "spawn", text: "boo" });
    expect(cfg.action.type).toBe("text");
    expect(cfg.action.text).toBe("boo");
  });

  test("malformed scalar props fall back rather than throwing", () => {
    // durationMs as a non-number, repeat as a string → both fall back to defaults.
    const cfg = parseTriggerConfig({ durationMs: "soon" as unknown as number });
    expect(cfg.action.durationMs).toBe(TRIGGER_TEXT_DURATION_MS);
    expect(cfg.repeat).toBe(false);
  });
});
