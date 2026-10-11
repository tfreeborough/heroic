/**
 * The knobs, Tom's locked settings, the palettes, and the edge treatment
 * (generated images often run off the frame and leave a ruled-off side;
 * near the border cells thin out instead).
 */

export type Edge = "hard" | "dither" | "ragged" | "soft";

export type Look = {
  /** Glyph columns across the picture. */
  cols: number;
  gain: number;
  gamma: number;
  /** 0 = average each cell, 1 = take its strongest pixel (thin lines survive). */
  pool: number;
  /** Grey levels, background included. */
  levels: number;
  edge: Edge;
  /** How far in from the border the edge treatment reaches, 0..0.5 of the picture. */
  edgeZone: number;
};

/** Tom's look, 2026-10-09: bold tonal source, light = glyphs, 120 columns, dither. */
export const LOCKED_LOOK: Look = { cols: 120, gain: 1.1, gamma: 1, pool: 0, levels: 6, edge: "dither", edgeZone: 0.12 };

export type RGB = readonly [number, number, number];
export type Palette = { bg: string; ink: RGB; trail: RGB; head: string };

export const PALETTES = {
  matrix: { bg: "#020603", ink: [150, 255, 170], trail: [40, 200, 90], head: "#eaffee" },
  sand: { bg: "#0b0907", ink: [239, 227, 198], trail: [217, 164, 65], head: "#fff8e6" },
} satisfies Record<string, Palette>;

export const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smooth = (k: number) => k * k * (3 - 2 * k);

/** Seeded PRNG: same seed, same build. */
export const mulberry = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A stateless 0..1 hash of an integer. */
export const hash = (n: number) => {
  let t = (n * 9301 + 49297 + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

const valueNoise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const h = (a: number, b: number) => hash(a * 374761 + b * 668265 + 1013);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), xf), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), xf), yf);
};

/** 0 at the frame edge → 1 once inside the zone; u, v are 0..1 across the picture. */
export const edgeRamp = (u: number, v: number, look: Look) => {
  if (look.edge === "hard" || look.edgeZone <= 0) return 1;
  let d = Math.min(u, v, 1 - u, 1 - v) / look.edgeZone;
  if (d >= 1.6) return 1;
  if (look.edge === "ragged") d += (valueNoise(u * 9, v * 9) - 0.5) * 1.1 + (valueNoise(u * 40, v * 40) - 0.5) * 0.35;
  return clamp(d, 0, 1);
};

/** Does this cell survive the edge, and how bright does it end up?
 *   dither — ordered (Bayer) dither, the retro-terminal look
 *   ragged — a torn-paper edge from smooth noise
 *   soft   — glyphs step down to lighter characters, nothing dropped */
export const edgeCell = (gx: number, gy: number, cols: number, rows: number, v: number, look: Look) => {
  const p = edgeRamp((gx + 0.5) / cols, (gy + 0.5) / rows, look);
  if (p >= 1) return v;
  if (look.edge === "soft") return v * smooth(p);
  if (look.edge === "dither") return smooth(p) > BAYER[(gy % 4) * 4 + (gx % 4)]! ? v * (0.5 + 0.5 * p) : 0;
  return p > 0.5 ? v : 0;
};
