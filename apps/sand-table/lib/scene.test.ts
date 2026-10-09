import { describe, expect, test } from "bun:test";
import { type Element, DEFAULT_STYLE, progressAt, timeline } from "./scene";
import { bounds, fitInto, hits, resizeRect } from "./geometry";

const base = { ...DEFAULT_STYLE, x: 0, y: 0, seed: 1, dur: 0 };
const rect = (id: string, t: number, extra: Partial<Element> = {}): Element => ({ ...base, id, type: "rect", w: 100, h: 50, t, ...extra } as Element);

describe("timeline", () => {
  test("empty scene has no length", () => {
    expect(timeline([])).toEqual({ beats: [], total: 0 });
  });
  test("plays in drawing order with gaps clamped", () => {
    const els = [rect("b", 1000 + 60_000), rect("a", 1000), rect("c", 1000 + 60_010)];
    const tl = timeline(els, { lead: 100, tail: 200, maxGap: 300, minGap: 50 });
    expect(tl.beats.map((b) => b.id)).toEqual(["a", "b", "c"]);
    const [a, b, c] = tl.beats;
    expect(a!.start).toBe(100);
    expect(b!.start - a!.end).toBe(300); // a minute of thinking → maxGap
    expect(c!.start - b!.end).toBe(50); // 10 ms → minGap
    expect(tl.total).toBe(c!.end + 200);
  });
  test("a frame is not content", () => {
    const frame = { ...base, id: "f", type: "frame", w: 10, h: 10, format: "vertical", t: 0 } as Element;
    expect(timeline([frame, rect("a", 1)]).beats.map((b) => b.id)).toEqual(["a"]);
  });
  test("pen strokes keep their real duration", () => {
    const pen = { ...base, id: "p", type: "pen", points: [[0, 0], [10, 10]], t: 0, dur: 900 } as Element;
    const [b] = timeline([pen], { lead: 0 }).beats;
    expect(b!.end - b!.start).toBe(900);
  });
  test("progress runs 0 → 1 across a beat", () => {
    const beat = { id: "x", start: 100, end: 300 };
    expect(progressAt(beat, 50)).toBe(0);
    expect(progressAt(beat, 200)).toBe(0.5);
    expect(progressAt(beat, 400)).toBe(1);
  });
});

describe("geometry", () => {
  test("bounds of a line are its points' extent", () => {
    const line = { ...base, id: "l", type: "line", x: 10, y: 10, points: [[0, 0], [30, -20]], t: 0 } as Element;
    expect(bounds(line)).toEqual({ x: 10, y: -10, w: 30, h: 20 });
  });
  test("an unfilled rect is hit on its edge, not its middle", () => {
    const r = rect("r", 0);
    expect(hits(r, [50, 0], 4)).toBe(true);
    expect(hits(r, [50, 25], 4)).toBe(false);
    expect(hits({ ...r, fill: "#fff", fillStyle: "solid" } as Element, [50, 25], 4)).toBe(true);
  });
  test("resize from the south-east corner keeps the origin", () => {
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, "se", 20, 10, false)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
    expect(resizeRect({ x: 0, y: 0, w: 100, h: 50 }, "nw", 20, 10, false)).toEqual({ x: 20, y: 10, w: 80, h: 40 });
  });
  test("fitInto scales points with the group", () => {
    const line = { ...base, id: "l", type: "line", x: 0, y: 0, points: [[0, 0], [100, 0]], t: 0 } as Element;
    const out = fitInto(line, { x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 10, w: 50, h: 50 });
    expect(out.x).toBe(10);
    expect((out as { points: [number, number][] }).points[1]).toEqual([50, 0]);
  });
});
