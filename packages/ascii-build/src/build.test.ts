import { describe, expect, test } from "bun:test";
import { LOCKED_LOOK, type Look, inkFromRGBA, landedCount, planBuild, progress, sampleGrid } from "./index";

/** A white canvas with a dark square in the middle (opaque, like the tonal art). */
const squareImage = (w = 64, h = 64) => {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = h / 4; y < (3 * h) / 4; y++) for (let x = w / 4; x < (3 * w) / 4; x++) {
    const i = (y * w + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 20;
  }
  return px;
};

/** Dark all the way to the frame edge: a picture that runs off the page. */
const fullBleed = (w = 64, h = 64) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = px[i + 1] = px[i + 2] = 200; px[i + 3] = 255; }
  return px;
};

/** A night scene: black to every edge with one lit square in the middle. */
const nightScene = (w = 64, h = 64) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const x = p % w, y = (p / w) | 0, lit = x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
    px[p * 4] = px[p * 4 + 1] = px[p * 4 + 2] = lit ? 255 : 0;
    px[p * 4 + 3] = 255;
  }
  return px;
};

const plan = (seed: number, extra: Partial<Parameters<typeof planBuild>[0]> = {}) =>
  planBuild({
    ink: inkFromRGBA(squareImage(), 64, 64, "dark"),
    look: { ...LOCKED_LOOK, cols: 40 },
    box: { x: 0, y: 0, w: 400, h: 400 },
    frame: { w: 400, h: 700 },
    start: 0.5, end: 10, seed, arrival: "rain", order: "ground",
    ...extra,
  });

describe("ink", () => {
  test("cuts the white background away", () => {
    const ink = inkFromRGBA(squareImage(), 64, 64, "dark");
    expect(ink.data[0]).toBe(0);
    expect(ink.data[32 * 64 + 32]).toBeCloseTo(1, 1);
  });

  test("light tone lights the subject's bright parts, not the background", () => {
    const ink = inkFromRGBA(squareImage(), 64, 64, "light");
    expect(ink.data[0]).toBe(0);
    expect(ink.data[32 * 64 + 32]).toBeGreaterThan(0);
  });

  test("shadow: dim builds the black as faint ink, empty builds it as nothing", () => {
    expect(inkFromRGBA(nightScene(), 64, 64, "light").data[2 * 64 + 2]).toBeGreaterThan(0);
    expect(inkFromRGBA(nightScene(), 64, 64, "light", "empty").data[2 * 64 + 2]).toBe(0);
  });

  test("shadow: auto empties a full-bleed night scene but keeps a cut-out's shape", () => {
    const night = inkFromRGBA(nightScene(), 64, 64, "light", "auto");
    expect(night.data[2 * 64 + 2]).toBe(0);
    expect(night.data[32 * 64 + 32]).toBeCloseTo(1, 1);
    expect(inkFromRGBA(squareImage(), 64, 64, "light", "auto").data[32 * 64 + 32]).toBeGreaterThan(0);
  });
});

describe("edges", () => {
  const ink = inkFromRGBA(fullBleed(), 64, 64, "dark");
  const filled = (look: Look) => sampleGrid(ink, 40, 24, look);
  const rowFill = (g: Float32Array, row: number) => g.slice(row * 40, row * 40 + 40).filter((v) => v > 0).length;

  test("hard keeps the ruled edge", () => {
    expect(rowFill(filled({ ...LOCKED_LOOK, edge: "hard" }), 0)).toBe(40);
  });

  test("dither thins cells towards the border", () => {
    const g = filled({ ...LOCKED_LOOK, edge: "dither", edgeZone: 0.25 });
    expect(rowFill(g, 0)).toBeLessThan(rowFill(g, 3));
    expect(rowFill(g, 12)).toBeGreaterThan(rowFill(g, 0));
  });
});

describe("plan", () => {
  test("same seed, same build", () => {
    const a = plan(3), b = plan(3);
    expect(a.cells.map((c) => [c.gx, c.gy, c.release, c.land])).toEqual(b.cells.map((c) => [c.gx, c.gy, c.release, c.land]));
  });

  test("ground order lands the bottom rows first", () => {
    const b = plan(1);
    const early = b.byLand.slice(0, 20).reduce((s, c) => s + c.gy, 0) / 20;
    const late = b.byLand.slice(-20).reduce((s, c) => s + c.gy, 0) / 20;
    expect(early).toBeGreaterThan(late);
  });

  test("progress runs 0 → 1 across the build", () => {
    const b = plan(2);
    expect(progress(b, 0)).toBe(0);
    expect(progress(b, 5)).toBeGreaterThan(0.2);
    expect(progress(b, 5)).toBeLessThan(0.8);
    expect(progress(b, 20)).toBe(1);
    expect(landedCount(b, 20)).toBe(b.cells.length);
  });

  test("an exit has every glyph gone by its end", () => {
    const b = plan(4, { exit: { start: 12, end: 14 } });
    for (const c of b.cells) expect(c.leave + 0.9).toBeLessThanOrEqual(14 + 1e-9);
  });

  test("fits a portrait picture inside the box without stretching", () => {
    const b = planBuild({
      ink: { data: new Float32Array(40 * 60).fill(1), w: 40, h: 60 },
      look: LOCKED_LOOK, box: { x: 0, y: 0, w: 1000, h: 1000 }, frame: { w: 1080, h: 1920 },
      start: 0, end: 5, seed: 1, arrival: "pop", order: "random",
    });
    expect(b.pic.w / b.pic.h).toBeCloseTo(40 / 60, 5);
    expect(b.pic.h).toBe(1000);
  });
});

describe("terminal captions", () => {
  test("a line fills to its width, a pause starts a fresh one", async () => {
    const { terminalLines } = await import("./remotion");
    const w = (text: string, start: number) => ({ text, start, end: start + 0.25 });
    const lines = terminalLines([w("one", 0), w("two", 0.3), w("three", 0.6), w("four", 0.9), w("after", 3)], 13);
    expect(lines.map((l) => l.words.map((x) => x.text).join(" "))).toEqual(["one two three", "four", "after"]);
  });
});
