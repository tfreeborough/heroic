import { describe, expect, test } from "bun:test";
import { type Ink, LOCKED_LOOK, type Look, darkSide, freeWidth, inkFromRGBA, landedCount, planBuild, progress, sampleGrid } from "./index";

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

describe("darkSide", () => {
  const half = (lit: "left" | "right"): Ink => {
    const w = 20, h = 10, data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((lit === "left") === x < w / 2) data[y * w + x] = 1;
    return { data, w, h };
  };
  test("the words go opposite the lit subject", () => {
    expect(darkSide(half("right"))).toBe("left");
    expect(darkSide(half("left"))).toBe("right");
  });
  test("the words get only the empty width", () => {
    expect(freeWidth(half("right"), "left")).toBe(0.5);
    expect(freeWidth(half("right"), "right")).toBe(0);
  });
});

describe("punch and outline (BEATS_LOOK, 11-05)", () => {
  /** A soft photo: a grey wash everywhere with a brighter disc in it. */
  const softPhoto = (): Ink => {
    const w = 80, h = 80, data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.hypot(x - 40, y - 40) < 18 ? 0.9 : 0.35 + ((x * 7 + y * 3) % 5) * 0.02;
    return { data, w, h };
  };
  const look = (extra: Partial<Look>): Look => ({ ...LOCKED_LOOK, cols: 40, edge: "hard", ...extra });
  const build = (l: Look, ink: Ink = softPhoto()) => planBuild({ ink, look: l, box: { x: 0, y: 0, w: 400, h: 400 }, frame: { w: 400, h: 400 }, start: 0, end: 1, seed: 3, arrival: "pop", order: "random" });

  test("punch drops a photo's grey wash and keeps the lit subject", async () => {
    const { punchInk } = await import("./index");
    const p = punchInk(softPhoto(), "strong");
    expect(p.data[40 * 80 + 40]).toBe(1);
    expect(p.data[5 * 80 + 5]).toBe(0);
    expect(build(look({ punch: "strong" })).cells.length).toBeLessThan(build(look({})).cells.length);
  });

  test("outline puts edge characters round the subject and leaves its middle alone", () => {
    const b = build(look({ punch: "strong", outline: "strong" }));
    const edge = new Set(["-", "=", "|", "/", "\\"]);
    const centre = b.cells.find((c) => c.gx === 20 && c.gy === Math.floor(b.rows / 2))!;
    expect(edge.has(centre.ch)).toBe(false);
    const lefts = b.cells.filter((c) => c.gy === Math.floor(b.rows / 2) && c.gx < 20).sort((a, z) => a.gx - z.gx);
    expect(lefts[0]!.ch).toBe("|");
    expect(b.cells.some((c) => edge.has(c.ch))).toBe(true);
  });

  test("off by default: the old look is untouched", () => {
    const a = build(look({})), z = build({ ...LOCKED_LOOK, cols: 40, edge: "hard" });
    expect(a.cells.map((c) => c.ch).join("")).toBe(z.cells.map((c) => c.ch).join(""));
  });
});

describe("camera moves (11-05)", () => {
  const lit: Ink = (() => { const w = 40, h = 30, data = new Float32Array(w * h); for (let y = 5; y < 15; y++) for (let x = 25; x < 35; x++) data[y * w + x] = 1; return { data, w, h }; })();
  test("push in 10%, pull back and pan 20% (Tom's sizes)", async () => {
    const { cameraMove } = await import("./remotion");
    expect(cameraMove(lit, 1, 0.1, ["push"])!.to.s).toBeCloseTo(1.1);
    expect(cameraMove(lit, 1, 0.1, ["pull"])!.from.s).toBeCloseTo(1.2);
    expect(cameraMove(lit, 1, 0.1, ["pan"])!.from.s).toBeCloseTo(1.2);
    // The pan slides two thirds as far as the pull's scale would allow (11-06).
    const pan = cameraMove(lit, 1, 0.1, ["pan"])!;
    expect(Math.abs(pan.to.x - pan.from.x)).toBeCloseTo(0.1 * 0.9 * (2 / 3), 5);
  });
  test("a push heads for the light, and nothing moves at 0", async () => {
    const { cameraMove } = await import("./remotion");
    const m = cameraMove(lit, 1, 0.1, ["push"])!;
    expect(m.fx).toBeGreaterThan(0.6);
    expect(m.fy).toBeLessThan(0.5);
    expect(cameraMove(lit, 1, 0)).toBeNull();
  });
  test("the default mix is mostly push in, some pull back and pan, nothing else", async () => {
    const { cameraMove } = await import("./remotion");
    const n: Record<string, number> = {};
    for (let s = 1; s <= 1000; s++) { const k = cameraMove(lit, s, 0.1)!.kind; n[k] = (n[k] ?? 0) + 1; }
    expect(Object.keys(n).sort()).toEqual(["pan", "pull", "push"]);
    expect(n.push!).toBeGreaterThan(450);
  });
  test("with a depth map the mix is push, pull and pan (the arc only by name); without one the depth moves drop out", async () => {
    const { cameraMove } = await import("./remotion");
    const kinds = new Set<string>();
    for (let s = 1; s <= 400; s++) kinds.add(cameraMove(lit, s, 0.1, undefined, true)!.kind);
    expect([...kinds].sort()).toEqual(["pan", "pull", "push"]);
    expect(cameraMove(lit, 5, 0.1, ["orbit"], true)!.kind).toBe("orbit");
    for (let s = 1; s <= 200; s++) expect(["orbit", "warp", "layers"]).not.toContain(cameraMove(lit, s, 0.1, ["orbit", "push"], false)!.kind);
  });
  test("a smooth-tone build shades by unstepped brightness; a plain one doesn't carry it", () => {
    const smoothB = plan(3, { smoothTone: true }), plain = plan(3);
    expect(smoothB.cells.length).toBe(plain.cells.length);
    expect(smoothB.cells.every((c) => c.tone !== undefined && c.tone > 0)).toBe(true);
    expect(plain.cells.every((c) => c.tone === undefined)).toBe(true);
  });
  test("a near thing moving across the wall leaves the wall behind it, not a ghost of itself", async () => {
    const { splatThrough } = await import("./remotion");
    const w = 40, h = 6;
    const ink = { w, h, data: new Float32Array(w * h).fill(0.2) }, depth = { w, h, data: new Float32Array(w * h).fill(0.2) };
    for (let y = 0; y < h; y++) for (let x = 10; x < 16; x++) { ink.data[y * w + x] = 1; depth.data[y * w + x] = 0.9; }
    const out = splatThrough(ink, depth, (d) => ({ s: 1, x: d * 10, y: 0 }));
    // The square went 9 right, the wall 2: where the square was is wall again, and the square is whole where it went.
    for (const x of [12, 14, 17]) expect(out.data[3 * w + x]!).toBeCloseTo(0.2, 2);
    for (const x of [20, 22, 23]) expect(out.data[3 * w + x]!).toBeCloseTo(1, 1);
  });
  test("crisp depth snaps a blurred step to its two sides and leaves a gentle slope alone", async () => {
    const { crispDepth } = await import("./remotion");
    const w = 800, h = 4;
    const step = { w, h, data: new Float32Array(w * h) }, slope = { w, h, data: new Float32Array(w * h) };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { step.data[y * w + x] = clamp01((x - 396) / 8) * 0.6 + 0.2; slope.data[y * w + x] = x / w; }
    const a = crispDepth(step), b = crispDepth(slope);
    for (let x = 390; x < 406; x++) expect([0.2, 0.8].some((v) => Math.abs(a.data[x]! - v) < 1e-6)).toBe(true);
    expect(b.data[400]!).toBeCloseTo(0.5, 5);
  });
  test("with a depth map push, pull and pan go through the scene; without one, or at parallax 0, they stay flat", async () => {
    const { cameraMove, DEPTH_PARALLAX } = await import("./remotion");
    for (const k of ["push", "pull", "pan"] as const) {
      expect(cameraMove(lit, 3, 0.1, [k], true)!.deep).toBe(DEPTH_PARALLAX);
      expect(cameraMove(lit, 3, 0.1, [k], false)!.deep).toBeUndefined();
      expect(cameraMove(lit, 3, 0.1, [k], true, 0)!.deep).toBeUndefined();
    }
    expect(cameraMove(lit, 3, 0.1, ["orbit"], true)!.deep).toBeUndefined();
  });
});

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
