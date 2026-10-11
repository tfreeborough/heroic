/**
 * Picture → "ink": one 0..1 value per pixel saying how much drawing is
 * there, then → a grid of glyph cells at a few grey levels.
 *
 * Works on raw RGBA so it runs anywhere (browser, Remotion, bun tests);
 * `inkFromImage` is the canvas convenience for pages.
 */
import { type Look, clamp, edgeCell, edgeRamp, lerp, smooth } from "./look";

export type Tone = "light" | "dark";

export type Ink = { data: Float32Array; w: number; h: number };

/** What the black inside a "light" picture builds as: "dim" = faint dots (the
 * picture's whole shape shows), "empty" = nothing (only what's lit glows, so a
 * full-bleed night scene melts into the screen), "auto" = empty when the
 * picture has (almost) no white paper round it, else dim. */
export type Shadow = "dim" | "empty" | "auto";
/** Under this share of white paper, "auto" counts a picture as full bleed. Measured
 * 10-10: cut-outs on paper flood 14–40%, full-bleed night scenes 0–8% (lit bits
 * touching the frame flood too). */
const FULL_BLEED = 0.1;

/**
 * Transparent line art reads its alpha. Opaque art has its white
 * background cut away (flood fill in from the edges through anything
 * lighter than 0.8) and then reads either its light parts ("light": the
 * highlights glow, like a photo on a screen) or its dark parts.
 */
export const inkFromRGBA = (rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, tone: Tone, shadow: Shadow = "dim"): Ink => {
  const n = w * h;
  let clear = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 128) clear++;
  const data = new Float32Array(n);
  if (clear / n > 0.2) {
    for (let p = 0; p < n; p++) data[p] = rgba[p * 4 + 3]! / 255;
  } else {
    const lum = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) lum[p] = (0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!) / 255;
    const bg = new Uint8Array(n);
    const stack: number[] = [];
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
    while (stack.length) {
      const p = stack.pop()!;
      if (bg[p] || lum[p]! < 0.8) continue;
      bg[p] = 1;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    let paper = 0;
    for (let p = 0; p < n; p++) paper += bg[p]!;
    const floor = shadow === "empty" || (shadow === "auto" && paper / n < FULL_BLEED) ? 0 : 0.12;
    for (let p = 0; p < n; p++) data[p] = bg[p] ? 0 : tone === "light" ? floor + (1 - floor) * lum[p]! : 1 - lum[p]!;
  }
  // Normalise so the 99.5th percentile of what's drawn reads as full ink.
  const drawn = Array.from(data).filter((v) => v > 0.02).sort((a, b) => a - b);
  const top = drawn[Math.floor(drawn.length * 0.995)] || 1;
  for (let p = 0; p < n; p++) data[p] = clamp(data[p]! / top, 0, 1);
  return { data, w, h };
};

/** Draw an image at `width` (height follows its aspect) and read its ink. */
export const inkFromImage = (img: CanvasImageSource & { width: number; height: number }, tone: Tone, width = 512, shadow: Shadow = "dim"): Ink => {
  const w = width, h = Math.round((width * img.height) / img.width);
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return inkFromRGBA(g.getImageData(0, 0, w, h).data, w, h, tone, shadow);
};

/** Greyscale → `look.levels` steps: one 0..1 value per cell (0 = empty),
 * straight edges already thinned. */
export const sampleGrid = (ink: Ink, cols: number, rows: number, look: Look): Float32Array => {
  const out = new Float32Array(cols * rows);
  const cw = ink.w / cols, ch = ink.h / rows;
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const x0 = Math.floor(gx * cw), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cw));
    const y0 = Math.floor(gy * ch), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * ch));
    let sum = 0, max = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const v = ink.data[y * ink.w + x]!;
      sum += v;
      if (v > max) max = v;
      n++;
    }
    const v = Math.pow(clamp(look.gain * lerp(sum / n, max, look.pool), 0, 1), look.gamma);
    const q = Math.round(v * (look.levels - 1)) / (look.levels - 1);
    out[gy * cols + gx] = q > 0 ? edgeCell(gx, gy, cols, rows, q, look) : 0;
  }
  return out;
};

/** The finished picture as a white alpha mask (same gain, gamma and edge as
 * the glyphs), for the end-of-build underglow. */
export const glowAlpha = (ink: Ink, look: Look): Uint8ClampedArray<ArrayBuffer> => {
  const out = new Uint8ClampedArray(ink.w * ink.h * 4);
  for (let p = 0; p < ink.w * ink.h; p++) {
    const e = edgeRamp((p % ink.w + 0.5) / ink.w, (Math.floor(p / ink.w) + 0.5) / ink.h, look);
    const keep = look.edge === "ragged" ? (e > 0.5 ? 1 : 0) : smooth(e);
    out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = 255;
    out[p * 4 + 3] = 255 * keep * Math.pow(clamp(look.gain * ink.data[p]!, 0, 1), look.gamma);
  }
  return out;
};
