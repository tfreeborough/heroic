import { describe, expect, test } from "bun:test";
import {
  applyDot,
  applyStackingDot,
  stepDots,
  stepStackingDot,
  type DotState,
  type StackingDotConfig,
  type StackingDotState,
} from "./status";

const bleed = (overrides: Partial<DotState> = {}): DotState => ({
  ticksLeft: 3,
  tLeft: 1,
  interval: 1,
  damage: 3,
  sourceId: 0,
  ...overrides,
});

describe("stepDots", () => {
  test("ticks fire on the interval and the dot removes itself when spent", () => {
    const dots: DotState[] = [];
    applyDot(dots, bleed());

    const fired: number[] = [];
    // 3.5 simulated seconds at 10Hz — enough for all 3 ticks.
    for (let i = 0; i < 35; i++) {
      const ticks = stepDots(dots, 0.1);
      for (const t of ticks) fired.push(i);
      for (const t of ticks) expect(t).toEqual({ damage: 3, sourceId: 0 });
    }
    expect(fired).toHaveLength(3);
    // Ticks land ~1s apart (step index 9, 19, 29 at 0.1s steps).
    expect(fired[1]! - fired[0]!).toBe(10);
    expect(fired[2]! - fired[1]!).toBe(10);
    expect(dots).toHaveLength(0);
  });

  test("multiple dots stack independently and fire in array order", () => {
    const dots: DotState[] = [];
    applyDot(dots, bleed({ sourceId: 0, tLeft: 0.05 }));
    applyDot(dots, bleed({ sourceId: 1, tLeft: 0.05 }));
    const ticks = stepDots(dots, 0.1);
    expect(ticks.map((t) => t.sourceId)).toEqual([0, 1]);
    expect(dots).toHaveLength(2); // both still have ticks left
  });

  test("a large dt fires multiple ticks from one dot", () => {
    const dots: DotState[] = [bleed()];
    const ticks = stepDots(dots, 10);
    expect(ticks).toHaveLength(3);
    expect(dots).toHaveLength(0);
  });

  test("finished dots are compacted in place without disturbing survivors", () => {
    const dots: DotState[] = [
      bleed({ ticksLeft: 1, tLeft: 0.05, sourceId: 0 }),
      bleed({ ticksLeft: 3, tLeft: 5, sourceId: 1 }),
    ];
    stepDots(dots, 0.1);
    expect(dots).toHaveLength(1);
    expect(dots[0]!.sourceId).toBe(1);
  });
});

const POISON: StackingDotConfig = { maxStacks: 4, interval: 1, damagePerStack: 2, duration: 4 };

describe("stepStackingDot", () => {
  test("each application adds a stack and tick damage scales with stacks", () => {
    let dot = applyStackingDot(null, POISON, 7);
    dot = applyStackingDot(dot, POISON, 7);
    dot = applyStackingDot(dot, POISON, 7);
    expect(dot.stacks).toBe(3);
    const ticks = stepStackingDot(dot, 1);
    expect(ticks).toEqual([{ damage: 6, sourceId: 7 }]);
  });

  test("stacks cap at maxStacks", () => {
    let dot = applyStackingDot(null, POISON, 0);
    for (let i = 0; i < 10; i++) dot = applyStackingDot(dot, POISON, 0);
    expect(dot.stacks).toBe(POISON.maxStacks);
  });

  test("an application refreshes the shared clock and all stacks expire together", () => {
    let dot = applyStackingDot(null, POISON, 0);
    stepStackingDot(dot, 3.5); // 0.5s from death…
    dot = applyStackingDot(dot, POISON, 0); // …but a fresh hit resets the clock
    expect(dot.expiresLeft).toBe(POISON.duration);
    expect(dot.stacks).toBe(2);
    // Run it dry: exactly duration seconds of ticks remain, then nothing.
    const ticks = stepStackingDot(dot, 100);
    expect(ticks).toHaveLength(4);
    expect(dot.expiresLeft).toBe(0);
    expect(stepStackingDot(dot, 100)).toHaveLength(0); // spent — no zombie ticks
  });

  test("a tick scheduled past the expiry instant never lands", () => {
    const dot: StackingDotState = {
      stacks: 2,
      expiresLeft: 0.5, // dies before the next 1s tick is due
      tLeft: 1,
      interval: 1,
      damagePerStack: 2,
      sourceId: 0,
    };
    expect(stepStackingDot(dot, 10)).toHaveLength(0);
    expect(dot.expiresLeft).toBe(0);
  });

  test("applying onto a spent state starts fresh at one stack", () => {
    let dot = applyStackingDot(null, POISON, 1);
    stepStackingDot(dot, 100);
    dot = applyStackingDot(dot, POISON, 2);
    expect(dot.stacks).toBe(1);
    expect(dot.sourceId).toBe(2);
    expect(dot.expiresLeft).toBe(POISON.duration);
  });

  test("kill credit follows the freshest applier", () => {
    let dot = applyStackingDot(null, POISON, 1);
    dot = applyStackingDot(dot, POISON, 2);
    expect(stepStackingDot(dot, 1)[0]!.sourceId).toBe(2);
  });
});
