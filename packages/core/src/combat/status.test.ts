import { describe, expect, test } from "bun:test";
import { applyDot, stepDots, type DotState } from "./status";

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
