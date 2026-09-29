import { describe, expect, test } from "bun:test";
import { speechOf } from "./align";
import { NOISE_LEVELS, denoise, pausesOf } from "./denoise";

const rate = 48000;
/** Deterministic hiss. */
const hiss = (n: number, level: number) => {
  let s = 12345;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff - 0.5) * 2 * level;
  });
};
/** Something voice-like: a few harmonics of 140 Hz, swelling and fading. */
const voice = (n: number, level: number) => Float32Array.from({ length: n }, (_, i) => Math.sin((Math.PI * i) / n) * level * [1, 2, 3, 5, 8].reduce((v, h) => v + Math.sin((2 * Math.PI * 140 * h * i) / rate) / h, 0));
const db = (x: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = Math.floor(from * rate); i < Math.floor(to * rate); i++) sum += x[i]! * x[i]!;
  return 10 * Math.log10(sum / ((to - from) * rate) + 1e-20);
};
// 1s of room, 1s of talk, 0.6s of room, 1s of talk, 0.5s of room
const plan: [number, boolean][] = [[1, false], [1, true], [0.6, false], [1, true], [0.5, false]];
const total = plan.reduce((t, [s]) => t + s, 0);
const clean = new Float32Array(Math.round(total * rate));
let at = 0;
for (const [s, talk] of plan) {
  if (talk) clean.set(voice(Math.round(s * rate), 0.2), at);
  at += Math.round(s * rate);
}
const noise = hiss(clean.length, 0.01);
const take = clean.map((v, i) => v + noise[i]!);
const pauses = pausesOf(speechOf(take, rate), total);

describe("pauses", () => {
  test("everything that isn't speech, clear of its edges", () => {
    expect(pausesOf([{ start: 1, end: 2 }, { start: 2.6, end: 3.6 }], 4.1)).toEqual([
      { start: 0, end: 0.94 },
      { start: 2.06, end: 2.54 },
      { start: 3.66, end: 4.1 },
    ]);
  });
  test("found in a recording", () => {
    expect(pauses).toHaveLength(3);
    expect(pauses[1]!.start).toBeCloseTo(2.06, 1);
  });
});

describe("noise reduction", () => {
  for (const { label, reduce } of NOISE_LEVELS.slice(1)) {
    const out = denoise(take, rate, pauses, { reduce });
    test(`${label}: the room goes down by about ${reduce} dB`, () => {
      const took = db(take, 0.1, 0.9) - db(out, 0.1, 0.9);
      expect(took).toBeGreaterThan(reduce - 2.5);
      expect(took).toBeLessThan(reduce + 1);
    });
    test(`${label}: the voice is left as it was`, () => {
      expect(Math.abs(db(out, 1.2, 1.8) - db(take, 1.2, 1.8))).toBeLessThan(0.3);
      // …and what's left under the voice is closer to the clean voice than what went in.
      const err = (x: Float32Array) => db(x.map((v, i) => v - clean[i]!), 1.2, 1.8);
      expect(err(out)).toBeLessThan(err(take));
    });
  }
  test("the same length out as in, to the sample", () => {
    expect(denoise(take, rate, pauses, { reduce: 15 }).length).toBe(take.length);
    expect(denoise(take.slice(0, 50001), rate, [], { reduce: 15 }).length).toBe(50001);
  });
  test("nothing to take off, nothing changed", () => {
    expect(denoise(take, rate, pauses, { reduce: 0 })).toEqual(take);
  });
  test("with no pauses to learn from, the quietest tenth stands in", () => {
    const out = denoise(take, rate, [], { reduce: 15 });
    expect(db(take, 0.1, 0.9) - db(out, 0.1, 0.9)).toBeGreaterThan(10);
    expect(Math.abs(db(out, 1.2, 1.8) - db(take, 1.2, 1.8))).toBeLessThan(0.3);
  });
  test("silence in, silence out", () => {
    const out = denoise(new Float32Array(rate), rate, [], { reduce: 15 });
    expect(out.every((v) => v === 0)).toBe(true);
  });
});
