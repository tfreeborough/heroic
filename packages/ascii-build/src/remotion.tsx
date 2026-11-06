/**
 * The glyph look in a Remotion video (docs/design/desk-ascii-scripts.md):
 *
 *   BuildLayer        an edit's BUILD cards: each picture builds itself out
 *                     of glyphs at the start of its card, holds, and falls
 *                     away as rain while the next one is already arriving;
 *                     a PULLED word borrows the picture's glyphs to spell
 *                     itself large as it's said, then gives them back
 *   TextBuild         words built out of glyphs (the title, a chapter, the
 *                     channel name)
 *   ChapterCard       the name built, then rain
 *   EndCard           every picture again as a reel, a mosaic of them all,
 *                     the channel name out of their glyphs, then a hold for
 *                     YouTube's end screen
 *   TerminalCaptions  the voice as a terminal line: each word decodes out
 *                     of scrambled glyphs on the frame it's said, the line
 *                     scrolls up when it fills, a cursor blinks in the pauses
 *
 * Content in, look out: a game's template hands over its palette, font
 * and where things sit. Import from "@heroic/ascii-build/remotion" (the
 * main entry stays free of Remotion for the Desk's pages).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { type BuildCache, FLASH, GLOW_OUT, drawBuild, newCache } from "./draw";
import { type Ink, inkFromImage, layersByDepth, lumaFromImage } from "./ink";
import { inkFromText } from "./text";
import { type Look, type Palette, clamp, hash, lerp, mulberry, rgba, smooth } from "./look";
import { type Arrival, type Build, type Order, type Rect, lookFromSeed, planBuild, progress } from "./plan";
import { CHAPTER_CARD } from "./video";

const srcUrl = (src: string) => (/^(\/|https?:|blob:|data:)/.test(src) ? src : staticFile(src));

// ── builds ──

/** A picture to build: where it is, its look seed, its stretch of the video (seconds), and any pulled words (seconds from its start). */
export type BuildShow = { id: string; src: string; /** The picture's depth map (near = white), for the parallax moves. */ depth?: string; seed: number; at: number; seconds: number; pulls?: { word: string; at: number }[]; /** A fast start: much of the picture lands in the first moments (a short's opening frame, under its hook). */ burst?: boolean };

/** The burst: this share of the glyphs set off in the first this-many seconds (Autosave's first-second hook, quicker). */
export const BURST = { share: 0.45, seconds: 0.6 } as const;

/** Seconds a build keeps falling away after its card ends (the next one is arriving meanwhile). */
export const BUILD_TAIL = 1;

export type BuildTiming = { start: number; end: number; exit?: { start: number; end: number } };

/** When a card's build happens, from its own start: in over the first 60% (at most 8s), out as rain across its end. */
export const buildTiming = (seconds: number) => {
  const end = clamp(Math.min(seconds * 0.6, 8), Math.min(1.2, seconds * 0.7), 8);
  return { start: 0.12, end, exit: { start: Math.max(end + 0.2, seconds - 0.25), end: Math.max(end + 0.2, seconds - 0.25) + BUILD_TAIL + 0.25 } };
};

/** Holds the render until `load` settles (an image, a font). */
const useLoaded = <T,>(label: string, load: () => Promise<T>, deps: unknown[]): T | null => {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    const handle = delayRender(label);
    let live = true;
    let done = false;
    const finish = () => {
      if (!done) (done = true), continueRender(handle);
    };
    load()
      .then((v) => live && setValue(v))
      .catch(() => {})
      .finally(finish);
    return () => {
      live = false;
      finish();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`couldn't load ${src}`));
    img.src = srcUrl(src);
  });

/** A picture's ink, loaded once: at least two ink pixels a column (11-06: 512 wide was barely two at 280 columns, so a moving camera stepped). */
const usePictureInk = (src: string, family: string, cols = 0): Ink | null => {
  const width = Math.max(512, Math.ceil(cols * 2));
  return useLoaded(`glyph picture ${src} ${width}`, async () => {
    const [img] = await Promise.all([loadImage(src), document.fonts.load(`700 20px ${family}`).catch(() => [])]);
    return inkFromImage(img, "light", width, "auto");
  }, [src, family, width]);
};

/** A depth map, loaded once (null without one). */
const usePictureDepth = (src: string | undefined): Ink | null =>
  useLoaded(`depth map ${src ?? "none"}`, async () => (src ? lumaFromImage(await loadImage(src), 512) : null), [src ?? ""]);

/** A map read at another map's size (the depth at the ink's pixels). */
const fitTo = (map: Ink, w: number, h: number): Ink => {
  // Bilinear, not nearest (11-06): a blocky depth map moves in blocks, and the blocks' seams flicker under a moving camera.
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = readAt(map, ((x + 0.5) * map.w) / w - 0.5, ((y + 0.5) * map.h) / h - 0.5);
  return { data, w, h };
};

/** A 0..1 map as a solid colour with that alpha, at a size. */
const tintMask = (map: Ink, w: number, h: number, colour: string): OffscreenCanvas => {
  const src = new OffscreenCanvas(map.w, map.h);
  const px = new Uint8ClampedArray(map.w * map.h * 4);
  for (let p = 0; p < map.w * map.h; p++) px[p * 4 + 3] = Math.round(255 * clamp(map.data[p]! * 1.4, 0, 1));
  src.getContext("2d")!.putImageData(new ImageData(px, map.w, map.h), 0, 0);
  const out = new OffscreenCanvas(Math.ceil(w), Math.ceil(h));
  const g = out.getContext("2d")!;
  g.drawImage(src, 0, 0, w, h);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = colour;
  g.fillRect(0, 0, w, h);
  return out;
};

export { inkFromText };

/** Type builds best with a hard edge (the dither edge eats the first and last letters), and as plain letters: no punch or outline. */
const textLook = (look: Look, cols: number): Look => ({ ...look, cols, edge: "hard", levels: Math.max(look.levels, 4), punch: undefined, outline: undefined });

// ── pulled words ──

/** Seconds a pulled word takes: out, hold, back. It starts a moment before the word is said. */
const PULL = { early: 0.15, out: 0.45, hold: 1.0, back: 0.45 };
export const PULL_SECONDS = PULL.out + PULL.hold + PULL.back;

type PullPlan = { at: number; sources: Build["cells"]; targets: Build["cells"]; fontFrom: number; fontTo: number };

/** Which of the picture's glyphs fly where to spell `word`. */
const planPull = (build: Build, word: string, at: number, family: string, look: Look, seed: number, frame: { w: number; h: number }): PullPlan => {
  const ink = inkFromText(word.toUpperCase(), `800 220px ${family}`, 4000);
  const box = { x: frame.w * 0.1, y: frame.h * 0.26, w: frame.w * 0.8, h: frame.h * 0.36 };
  const cols = Math.round(clamp(word.length * 11, 36, 120));
  const target = planBuild({ ink, look: textLook(look, cols), box, frame, start: 0, end: 0.01, seed, arrival: "pop", order: "random" });
  // The picture's brightest glyphs go first: they're the ones you see leave.
  const r = mulberry(seed * 13 + 7);
  const pool = [...build.cells].sort((a, b) => b.v - a.v + (r() - 0.5) * 0.6);
  const sources = target.cells.map((_, i) => pool[i % Math.max(1, pool.length)]!);
  return { at, sources, targets: target.cells, fontFrom: build.fontPx, fontTo: target.fontPx };
};

/** How far a pulled glyph is towards its letter at `t` (0 = in the picture, 1 = in the word). */
const pullAt = (p: PullPlan, i: number, t: number): number => {
  const t0 = p.at - PULL.early + hash(i * 7 + 3) * 0.15;
  if (t < t0) return 0;
  if (t < t0 + PULL.out + PULL.hold) return smooth(clamp((t - t0) / PULL.out, 0, 1));
  return 1 - smooth(clamp((t - t0 - PULL.out - PULL.hold) / PULL.back, 0, 1));
};

const drawPull = (ctx: CanvasRenderingContext2D, b: Build, p: PullPlan, t: number, pal: Palette, family: string) => {
  const t0 = p.at - PULL.early;
  const t1 = t0 + PULL_SECONDS + 0.2;
  if (t < t0 || t > t1) return;
  // The picture steps back while the word is up.
  const env = Math.min(smooth(clamp((t - t0) / 0.3, 0, 1)), smooth(clamp((t1 - t) / 0.35, 0, 1)));
  ctx.fillStyle = pal.bg;
  ctx.globalAlpha = 0.62 * env;
  ctx.fillRect(0, 0, b.frame.w, b.frame.h);
  ctx.globalAlpha = 1;
  // Where the borrowed glyphs were: holes.
  for (let i = 0; i < p.sources.length; i++) {
    if (pullAt(p, i, t) <= 0.02) continue;
    const s = p.sources[i]!;
    ctx.fillRect(s.x, s.y, b.cw, b.ch);
  }
  ctx.textBaseline = "top";
  let font = -1;
  for (let i = 0; i < p.targets.length; i++) {
    const e = pullAt(p, i, t);
    if (e <= 0.02) continue;
    const s = p.sources[i]!;
    const d = p.targets[i]!;
    const size = Math.round(lerp(p.fontFrom, p.fontTo, e) / 2) * 2;
    if (size !== font) {
      ctx.font = `700 ${size}px ${family}`;
      font = size;
    }
    const settled = e > 0.97;
    ctx.fillStyle = settled ? rgba(pal.ink, 0.55 + 0.45 * d.v) : e > 0.5 ? pal.head : rgba(pal.trail, 0.85);
    ctx.fillText(e > 0.5 ? d.ch : s.ch, lerp(s.x, d.x, e), lerp(s.y, d.y, e));
  }
};

// ── one build ──

/**
 * The camera move on a picture (11-05): the picture builds and holds for up
 * to 8 seconds, so a slow move keeps a long beat alive. Seeded per picture
 * from the kinds allowed (by default: push in 55%, pull back 25%, pan 20%).
 * `amount` is the push in's zoom (0.1 = 10%); the bigger moves (pull back,
 * pan, tilt, drift) go twice as far, Tom's sizes off the look lab. The
 * picture never shrinks below its box.
 *   push     in towards the lit subject (the ink's brightness-weighted centre)
 *   pull     back from it
 *   pan      sideways, from away from the subject towards it
 *   tilt     up or down
 *   drift    diagonally
 *   travel   in while the subject slides towards the middle
 *   rotate   a slow turn, held a little in
 *   handheld a small sway, as if the camera's held
 *   glyph    the glyph grid holds still and the picture slides under it (once built), so the characters change as it moves
 *   layers   parallax: the picture split by its depth map into a front and a back layer, each its own build, sliding at different speeds (no depth map: a pan)
 *   warp     parallax: the glyph camera, with near things shifting more than far ones and growing faster as it pushes in (no depth map: the glyph camera)
 *   orbit    parallax: the camera swings round the subject in a shallow arc; the subject holds, what's behind it swings one way and what's nearer the other (no depth map: holds still)
 */
export const MOVE_KINDS = ["push", "pull", "pan", "tilt", "drift", "travel", "rotate", "handheld", "glyph", "layers", "warp", "orbit"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
type Frame = { s: number; x: number; y: number; r: number };
export type CameraMove = { kind: MoveKind; from: Frame; to: Frame; fx: number; fy: number; sway: number; seed: number; deep?: number };

const DEFAULT_MIX: [MoveKind, number][] = [["push", 0.55], ["pull", 0.25], ["pan", 0.2]];
/** With a depth map, push, pull and pan all go through the scene. The arc was 30% of this until 11-06: it moves near and far things opposite ways, so it tore figures where the depth map had a step mid-limb and uncovered the most; Tom dropped it. Pan gets the arc's share as the move that shows depth best. The arc stays available by name. */
const DEPTH_MIX: [MoveKind, number][] = [["push", 0.45], ["pull", 0.25], ["pan", 0.3]];
/** The pan's slide as a share of the other big moves' (11-06: Tom found the depth pan too much at full slide; with depth its nearest things travel up to 2.5× this). */
const PAN = 2 / 3;
/** The moves that need a depth map. */
const NEEDS_DEPTH: readonly MoveKind[] = ["layers", "warp", "orbit"];
/** The moves that go through the scene when there's a depth map (11-06): near things move more than the subject, far ones less. */
const DEEP_MOVES: readonly MoveKind[] = ["push", "pull", "pan", "tilt", "drift"];
/** How much depth the deep moves take: 0 = flat (everything moves as the subject does), 1 = all of it (the far wall barely moves, the nearest things up to NEAR_MOST times the subject). */
export const DEPTH_PARALLAX = 1; // 0.8 until 11-06 (Tom: more 3D)

export const cameraMove = (ink: Ink, seed: number, amount: number, kinds?: readonly MoveKind[], hasDepth = false, parallax = DEPTH_PARALLAX): CameraMove | null => {
  if (amount <= 0) return null;
  // Where the light is: the subject, as a share of the picture's width and height.
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < ink.h; y += 2) for (let x = 0; x < ink.w; x += 2) {
    const v = ink.data[y * ink.w + x]!;
    const w = v * v;
    sx += x * w; sy += y * w; sw += w;
  }
  const fx = clamp(sw ? sx / sw / ink.w : 0.5, 0.25, 0.75), fy = clamp(sw ? sy / sw / ink.h : 0.5, 0.25, 0.75);
  // mulberry, not hash: neighbouring seeds hash alike (seeds 7–12 all panned).
  const rnd = mulberry(seed * 7 + 3);
  // Without a depth map, the depth moves drop out (and an all-depth list falls back to the plain mix).
  const allowed = kinds?.filter((k) => hasDepth || !NEEDS_DEPTH.includes(k));
  const mix: [MoveKind, number][] = allowed?.length ? allowed.map((k) => [k, 1 / allowed.length]) : hasDepth ? DEPTH_MIX : DEFAULT_MIX;
  let r = rnd(), kind = mix[0]![0];
  for (const [k, w] of mix) { if (r < w) { kind = k; break; } r -= w; }
  const at = (s: number, x = 0, y = 0, rot = 0): Frame => ({ s, x, y, r: rot });
  const near = 1 + amount, far = 1 + amount * 2;
  const slide = amount * 0.9; // share of the picture a 2× move slides (inside the spare the scale leaves)
  const side = fx < 0.5 ? -1 : 1, up = fy < 0.5 ? -1 : 1;
  const deep = hasDepth && parallax > 0 && DEEP_MOVES.includes(kind) ? { deep: parallax } : {};
  const m = (from: Frame, to: Frame, ox = fx, oy = fy, sway = 0): CameraMove => ({ kind, from, to, fx: ox, fy: oy, sway, seed, ...deep });
  switch (kind) {
    case "push": return m(at(1), at(near));
    case "pull": return m(at(far), at(1));
    case "pan": return m(at(far, -side * slide * PAN / 2), at(far, side * slide * PAN / 2), 0.5, 0.5);
    case "tilt": return m(at(far, 0, -up * slide / 2), at(far, 0, up * slide / 2), 0.5, 0.5);
    case "drift": return m(at(far, -side * slide / 2, -up * slide / 2), at(far, side * slide / 2, up * slide / 2), 0.5, 0.5);
    // Travel and the glyph camera: in, while the subject comes towards the middle.
    case "travel":
    case "glyph": return m(at(1, 0, 0), at(far, (0.5 - fx) * amount * 2, (0.5 - fy) * amount * 2));
    case "rotate": { const deg = (rnd() < 0.5 ? -1 : 1) * 1.2; return m(at(far, 0, 0, -deg), at(far, 0, 0, deg), 0.5, 0.5); }
    case "handheld": return m(at(near), at(near), 0.5, 0.5, amount * 0.06);
    // The back layer's pan; the front's is made from it (layerMoves).
    case "layers": return m(at(near, -side * amount * 0.12), at(near, side * amount * 0.12), 0.5, 0.5);
    // x is the parallax offset here (warpThrough), not a slide.
    case "warp": return m(at(1, -side * amount * 0.35), at(near, side * amount * 0.35));
    // The arc's swing: x is how far, as a share of the picture, a thing one whole depth away from the subject moves each way.
    case "orbit": return m(at(1, -side * amount * 0.9), at(1, side * amount * 0.9));
  }
};

/** The move at `k` (0..1 through the card), eased; `t` seconds for the handheld sway. Translation as shares of the picture. */
const frameAt = (m: CameraMove, k: number, t: number): Frame => {
  const e = smooth(clamp(k, 0, 1));
  let s = lerp(m.from.s, m.to.s, e), x = lerp(m.from.x, m.to.x, e), y = lerp(m.from.y, m.to.y, e), r = lerp(m.from.r, m.to.r, e);
  if (m.sway) {
    // A few slow sines out of step: a held camera, never a loop you can spot.
    const ph = m.seed * 1.7;
    x += m.sway * (Math.sin(t * 0.9 + ph) * 0.6 + Math.sin(t * 2.3 + ph * 2) * 0.25);
    y += m.sway * (Math.sin(t * 1.1 + ph * 3) * 0.5 + Math.sin(t * 2.9 + ph) * 0.2);
    r += m.sway * 8 * Math.sin(t * 0.7 + ph);
  }
  // Only as far as the scale leaves spare picture either side.
  const spare = (s - 1) / 2;
  return { s, x: clamp(x, -spare, spare), y: clamp(y, -spare, spare), r };
};

/** The parallax layers' moves, back to front: the back as cameraMove made it, each nearer layer sliding further (1×, 2.5×, 4×) and pushing in a little more. */
const layerMoves = (m: CameraMove, count: number): CameraMove[] =>
  Array.from({ length: count }, (_, i) => {
    const f = count > 1 ? i / (count - 1) : 0;
    const slide = 1 + 3 * f, push = (m.from.s - 1) * 0.6 * f;
    return { ...m, from: { ...m.from, s: m.from.s + push, x: m.from.x * slide }, to: { ...m.to, s: m.to.s + push * 1.5, x: m.to.x * slide } };
  });

/** A map box-blurred by `r` pixels each way (across, then down). */
const boxBlur = (m: Ink, r: number): Ink => {
  const { w, h } = m;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, n = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { a += m.data[y * w + k]!; n++; }
    t[y * w + x] = a / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0, n = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { a += t[k * w + x]!; n++; }
    o[y * w + x] = a / n;
  }
  return { data: o, w, h };
};

/** The ink at a fractional pixel (bilinear, dark outside): a slow move flows smoothly between glyphs instead of snapping a pixel at a time. */
const readAt = (ink: Ink, x: number, y: number): number => {
  const { w, h, data } = ink;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) return 0;
  const ax = x - x0, ay = y - y0;
  const at = (xx: number, yy: number) => (xx >= 0 && xx < w && yy >= 0 && yy < h ? data[yy * w + xx]! : 0);
  return lerp(lerp(at(x0, y0), at(x0 + 1, y0), ax), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), ax), ay);
};

/**
 * Fills what a move uncovered (z < 0: no pixel landed there) from the far
 * side in. Each gap (a connected patch) finds the farthest depth on its
 * rim, grows in ring by ring from the rim pixels at that depth only, and
 * each new pixel is the mean of its already-filled neighbours, so the wall
 * behind a figure seeps in softly and the figure itself never does.
 * (11-06: filling row by row streaked the gap and flickered as the gap
 * grew a row at a time, a bar under the helmets' counter in the pull.) A
 * gap with no far rim stays dark.
 */
const fillGaps = (data: Float32Array, z: Float32Array, w: number, h: number) => {
  const FAR = 0.025; // depth still counted as the far side
  const seen = new Uint8Array(w * h);
  const set = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (z[p]! >= 0) set[p] = 1;
  const comp: number[] = [];
  const nb = (p: number, f: (q: number) => void) => {
    const x = p % w;
    if (x > 0) f(p - 1);
    if (x < w - 1) f(p + 1);
    if (p >= w) f(p - w);
    if (p < w * (h - 1)) f(p + w);
  };
  for (let start = 0; start < w * h; start++) {
    if (set[start] || seen[start]) continue;
    // The gap's pixels, and the farthest depth on its rim.
    comp.length = 0;
    comp.push(start); seen[start] = 1;
    let far = 2;
    for (let i = 0; i < comp.length; i++) nb(comp[i]!, (q) => {
      if (set[q]) { if (z[q]! < far) far = z[q]!; }
      else if (!seen[q]) { seen[q] = 1; comp.push(q); }
    });
    if (far > 1.5) { for (const p of comp) data[p] = 0; continue; }
    // Ring by ring from everything on the rim that's behind the thing that moved off it (not just the very farthest: a bright far window on one corner of the rim flooded the whole gap with sky, 11-06), so each part of the gap takes the background it's nearest to.
    let near = -1;
    for (const p of comp) nb(p, (q) => { if (set[q] && z[q]! > near) near = z[q]!; });
    const lim = far + Math.max(FAR, (near - far) * 0.5);
    let ring: number[] = [];
    for (const p of comp) {
      let ok = false;
      nb(p, (q) => { if (set[q] && z[q]! <= lim) ok = true; });
      if (ok) ring.push(p);
    }
    let left = comp.length;
    while (ring.length && left > 0) {
      const vals = ring.map((p) => {
        let sum = 0, n = 0;
        nb(p, (q) => { if (set[q] && (z[q]! < 0 || z[q]! <= lim)) { sum += data[q]!; n++; } });
        return n ? sum / n : 0;
      });
      ring.forEach((p, i) => { data[p] = vals[i]!; set[p] = 1; z[p] = -2; });
      left -= ring.length;
      const next: number[] = [];
      for (const p of ring) nb(p, (q) => { if (!set[q] && seen[q] === 1) { seen[q] = 2; next.push(q); } });
      ring = next;
    }
    // Anything the far side couldn't reach (cut off by the near side) stays dark.
    for (const p of comp) if (!set[p]) { data[p] = 0; set[p] = 1; }
  }
};

/**
 * The ink through a camera that moves each pixel by its depth (11-06), the
 * occlusion-safe way: every pixel is carried forward to where the camera
 * now sees it, and where two land on one spot the nearer wins (so a face
 * passes in front of the wall, never through it). Each landed spot is then
 * read back from the picture with the winner's own move, smoothly between
 * pixels. What the move uncovers (the wall that was behind the head) is
 * filled from the farther of its two neighbours along the row, so it
 * stretches the background instead of copying the face: the old backward
 * read put a second face there, a ghost. Holes reaching the picture's edge
 * stay dark. `at` gives the move for a depth as a scale and offset; it's
 * looked up from 256 levels (the depth maps are 8-bit).
 */
export const splatThrough = (ink: Ink, depth: Ink, at: (d: number) => { s: number; x: number; y: number }): Ink => {
  const { w, h } = ink;
  // Each pixel's move from its own (continuous) depth: a 256-step lookup moved neighbouring pixels on a slope up to a pixel apart at big moves, and the seams flickered (11-06).
  const S = new Float32Array(w * h), X = new Float32Array(w * h), Y = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) { const a = at(depth.data[p]!); S[p] = a.s; X[p] = a.x; Y[p] = a.y; }
  const z = new Float32Array(w * h).fill(-1), who = new Int32Array(w * h).fill(-1);
  const M = 0.3; // each pixel's footprint overlaps its neighbours' a little, so a gentle stretch never cracks
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    const p = sy * w + sx, d = depth.data[p]!, s = S[p]!;
    const tx = sx * s + X[p]!, ty = sy * s + Y[p]!;
    const x0 = Math.max(0, Math.ceil(tx - 0.5 - M)), x1 = Math.min(w, Math.ceil(tx + s - 0.5 + M));
    const y0 = Math.max(0, Math.ceil(ty - 0.5 - M)), y1 = Math.min(h, Math.ceil(ty + s - 0.5 + M));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (d > z[y * w + x]!) { z[y * w + x] = d; who[y * w + x] = p; }
  }
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = who[y * w + x]!;
    if (q >= 0) data[y * w + x] = readAt(ink, (x + 0.5 - X[q]!) / S[q]! - 0.5, (y + 0.5 - Y[q]!) / S[q]! - 0.5);
  }
  fillGaps(data, z, w, h);
  return { data, w, h };
};

/**
 * The depth map with crisp edges (11-06): the model blurs a depth step over
 * several pixels, and those in-between depths move by in-between amounts,
 * smearing a face's outline between it and the wall. Where the depth jumps
 * within a few percent of the width (an edge), each pixel snaps to the near
 * or far side, leaning near (`toNear`), so a figure moves as one piece with
 * its rim; gentle slopes (a floor going away) stay as they are.
 */
/** Each pixel's lowest and highest value within `r` (a square, done in two passes). */
const minMax = (m: Ink, r: number): { lo: Float32Array; hi: Float32Array } => {
  const { w, h, data } = m;
  const lo1 = new Float32Array(w * h), hi1 = new Float32Array(w * h), lo = new Float32Array(w * h), hi = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = Infinity, b = -Infinity;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { const v = data[y * w + k]!; if (v < a) a = v; if (v > b) b = v; }
    lo1[y * w + x] = a; hi1[y * w + x] = b;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = Infinity, b = -Infinity;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { const p = k * w + x; if (lo1[p]! < a) a = lo1[p]!; if (hi1[p]! > b) b = hi1[p]!; }
    lo[y * w + x] = a; hi[y * w + x] = b;
  }
  return { lo, hi };
};

export const crispDepth = (depth: Ink, jump = 0.25, toNear = 0.3): Ink => {
  const { w, h } = depth;
  const r = Math.max(2, Math.round(w / 45));
  let cur = depth;
  // Twice: one pass leaves a long blurred step as stairs; the second snaps the stairs.
  for (let pass = 0; pass < 2; pass++) {
    const { lo, hi } = minMax(cur, r);
    const out = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const d = cur.data[p]!, a = lo[p]!, b = hi[p]!;
      // Past `toNear` of the way up the step counts as the near side: the band round a figure (its lit rim) goes with the figure, never peels off as an outline.
      out[p] = b - a > jump ? (d - a > (b - a) * toNear ? b : a) : d;
    }
    cur = { data: out, w, h };
  }
  // Then near things grow a few pixels over what's behind them, so the drawing's halo on the wall right round a figure travels with it.
  const { hi } = minMax(cur, Math.max(1, Math.round(w / 120)));
  const out = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = hi[p]! - cur.data[p]! > jump ? hi[p]! : cur.data[p]!;
  return soften({ data: out, w, h }, Math.max(2, Math.round(w / 200)), 0.04);
};

/** Smooths a depth map within its surfaces (only neighbours within `tol` of a pixel count), across and then down: the 8-bit map's steps go, the edges stay sharp. */
const soften = (m: Ink, r: number, tol: number): Ink => {
  const { w, h } = m;
  const pass = (src: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = src[y * w + x]!;
      let sum = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k * dx, yy = y + k * dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const v = src[yy * w + xx]!;
        if (Math.abs(v - c) <= tol) { sum += v; n++; }
      }
      out[y * w + x] = sum / n;
    }
    return out;
  };
  return { data: pass(pass(m.data, 1, 0), 0, 1), w, h };
};

/** The most a deep move carries the nearest things, as a multiple of the subject's move (2 until 11-06). */
const NEAR_MOST = 2.5;

/**
 * A deep move (push, pull, pan, tilt, drift with a depth map, 11-06): the
 * camera travels through the scene instead of sliding a flat picture. The
 * subject (depth `pivot`) moves exactly as the flat move would; each
 * depth's share of the move is its nearness over the subject's (depth maps
 * are near = bright, roughly one over distance), so the far wall barely
 * moves and the near things up to NEAR_MOST times as far, blended with flat by the
 * move's `deep`. Only the change is deep: a pan's standing crop stays flat.
 */
const depthThrough = (ink: Ink, depth: Ink, m: CameraMove, f: Frame, pivot: number): Ink => {
  const { w, h } = ink;
  const ox = m.fx * w, oy = m.fy * h, tx = f.x * w, ty = f.y * h;
  const base = Math.min(m.from.s, m.to.s), p = Math.max(0.15, pivot), strength = m.deep ?? 0;
  return splatThrough(ink, depth, (d) => {
    const g = lerp(1, clamp(d / p, 0, NEAR_MOST), strength), s = base + (f.s - base) * g;
    return { s, x: ox - ox * s + tx * g, y: oy - oy * s + ty * g };
  });
};

/**
 * The ink through the warp camera: each pixel shifts by the parallax
 * offset times how near it is (near one way, far the other) and is scaled
 * more the nearer it is, so the scene opens up in depth under a still grid.
 */
const warpThrough = (ink: Ink, depth: Ink, f: Frame, fx: number, fy: number): Ink => {
  const { w, h } = ink;
  const data = new Float32Array(w * h);
  const ox = fx * w, oy = fy * h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = depth.data[y * w + x]!;
    const near = (d - 0.5) * 2;
    const se = 1 + (f.s - 1) * (0.4 + d * 1.2);
    const sx = Math.round(ox + (x - f.x * w * near - ox) / se), sy = Math.round(oy + (y - f.y * h * near - oy) / se);
    if (sx >= 0 && sx < w && sy >= 0 && sy < h) data[y * w + x] = ink.data[sy * w + sx]!;
  }
  return { data, w, h };
};

/**
 * The ink through the orbit camera at `e` (0..1, eased): the camera swings
 * along a shallow arc (sideways, dipping a little at the middle) about the
 * subject's depth `pivot`, so each pixel shifts by how far in front of or
 * behind the subject it is (carried forward, nearer winning: splatThrough).
 */
const orbitThrough = (ink: Ink, depth: Ink, e: number, m: CameraMove, pivot: number): Ink => {
  const { w, h } = ink;
  const a = lerp(-1, 1, e);
  const ox = m.to.x * a * w, oy = Math.abs(m.to.x) * 0.3 * (1 - a * a) * h;
  return splatThrough(ink, depth, (d) => ({ s: 1, x: ox * (d - pivot) * 2, y: oy * (d - pivot) * 2 }));
};

/** The subject's depth: where the light is, by the same weighting as the move's focus. */
const subjectDepth = (ink: Ink, depth: Ink): number => {
  let s = 0, n = 0;
  for (let p = 0; p < ink.data.length; p += 2) { const v = ink.data[p]! ** 2; s += v * depth.data[p]!; n += v; }
  return n ? s / n : 0.5;
};

const moveCss = (f: Frame, w: number, h: number): string =>
  `translate(${(f.x * w).toFixed(2)}px, ${(f.y * h).toFixed(2)}px) rotate(${f.r.toFixed(4)}deg) scale(${f.s.toFixed(5)})`;

/** The ink as the moved camera sees it (the glyph camera): every pixel read back through the frame's scale and slide about the subject. */
const inkThrough = (ink: Ink, f: Frame, fx: number, fy: number): Ink => {
  const { w, h } = ink;
  const data = new Float32Array(w * h);
  const ox = fx * w, oy = fy * h, tx = f.x * w, ty = f.y * h;
  for (let y = 0; y < h; y++) {
    const sy = oy + (y - ty - oy) / f.s;
    for (let x = 0; x < w; x++) data[y * w + x] = readAt(ink, ox + (x - tx - ox) / f.s, sy);
  }
  return { data, w, h };
};

/**
 * Each grid cell's landing time: the build's own cells, and every other
 * cell the time of its nearest landed one (a breadth-first spread over the
 * whole grid), so a cell only lit once the camera has moved arrives with
 * its neighbours. (11-06: the spread stopped after 8 rings and the rest
 * waited for the very last glyph, so patches sat empty then popped in.)
 */
const revealTimes = (b: Build): Float32Array => {
  const { cols, rows } = b;
  const at = new Float32Array(cols * rows).fill(Infinity);
  let ring: number[] = [];
  for (const c of b.cells) { const p = c.gy * cols + c.gx; at[p] = c.land; ring.push(p); }
  while (ring.length) {
    const next: number[] = [];
    for (const p of ring) {
      const x = p % cols;
      for (const q of [x > 0 ? p - 1 : -1, x < cols - 1 ? p + 1 : -1, p - cols, p + cols]) {
        if (q < 0 || q >= at.length || at[q] !== Infinity) continue;
        at[q] = at[p]!;
        next.push(q);
      }
    }
    ring = next;
  }
  for (let p = 0; p < at.length; p++) if (at[p] === Infinity) at[p] = 0;
  return at;
};

/**
 * A build drawn at `t` (its own seconds): the picture (or text) as glyphs,
 * plus any pulled words. `t` comes from the parent so set pieces can run
 * their own clocks.
 */
const BuildCanvas: React.FC<{
  ink: Ink | null;
  seed: number;
  look: Look;
  box: Rect;
  timing: BuildTiming;
  t: number;
  palette: Palette;
  family: string;
  glow?: number;
  ambient?: boolean;
  hidden?: boolean;
  arrival?: Arrival;
  order?: Order;
  burst?: { share: number; seconds: number };
  pulls?: { word: string; at: number }[];
  /** A camera move over the card, and how far through it (0..1) this frame is: the picture is clipped to `box` and moved inside it. */
  move?: CameraMove | null;
  moveAt?: number;
  /** The depth map at the ink's size (the warp camera). */
  depth?: Ink | null;
  /** Seconds the move runs (from frame 0): a glyph camera moves from the first glyph to the exit, as the CSS moves do. */
  moveFor?: number;
  /** A front layer's coverage: painted in the background colour under its glyphs, so the back layer doesn't show through. */
  backing?: Ink | null;
}> = ({ ink, seed, look, box, timing, t, palette, family, glow = 0, ambient = false, hidden = false, arrival, order, burst, pulls, move, moveAt: k = 0, depth, moveFor = 0, backing }) => {
  const { width, height } = useVideoConfig();
  const glyphCam = move?.kind === "glyph" || move?.kind === "warp" || move?.kind === "orbit" || (move?.deep && depth) ? move : null;
  const pivot = useMemo(() => (ink && depth ? subjectDepth(ink, depth) : 0.5), [ink, depth]);
  // The picture as the moving camera sees it, `kk` (0..1) through the move, `tt` its seconds (for a sway).
  const through = (from: Ink, kk: number, tt: number, m: CameraMove) =>
    m.kind === "orbit" ? (depth ? orbitThrough(from, depth, smooth(clamp(kk, 0, 1)), m, pivot) : from)
    : m.deep && depth ? depthThrough(from, depth, m, frameAt(m, kk, tt), pivot)
    : m.kind === "warp" && depth ? warpThrough(from, depth, frameAt(m, kk, tt), m.fx, m.fy)
    : inkThrough(from, frameAt(m, kk, tt), m.fx, m.fy);
  const plan = (from: Ink, extra: Partial<Parameters<typeof planBuild>[0]> = {}) => {
    const shuffled = lookFromSeed(seed);
    return planBuild({ ink: from, look, box, frame: { w: width, h: height }, start: timing.start, end: timing.end, seed, arrival: arrival ?? shuffled.arrival, order: order ?? shuffled.order, exit: timing.exit, ...(burst ? { burst } : {}), ...(glyphCam ? { smoothTone: true } : {}), ...extra });
  };
  // The picture a glyph camera moves, its grain softened by a pixel (11-06): grain finer than a glyph cell, sliding a pixel or more a frame, strobed cells on and off (a flat move at twice the speed flickered as much as the depth moves); softened, it flickers about 2.5× less.
  const camInk = useMemo(() => (ink && glyphCam ? boxBlur(ink, 1) : null), [ink, glyphCam]);
  const build = useMemo<Build | null>(() => {
    if (!ink) return null;
    // The glyph camera builds the picture as its first frame sees it.
    return plan(glyphCam && camInk ? through(camInk, 0, 0, glyphCam) : ink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ink, camInk, look, box.x, box.y, box.w, box.h, width, height, seed, timing.start, timing.end, timing.exit?.start, timing.exit?.end, arrival, order, burst?.share, burst?.seconds, glyphCam, depth, pivot]);
  // How far through the move the glyph camera is at `tt` seconds.
  const camK = (tt: number) => (moveFor > 0 ? clamp(tt / moveFor, 0, 1) : 0);
  const exitAt = timing.exit?.start ?? Infinity;
  // The glyph camera's frame as the exit starts, as a build whose glyphs rain away (before that it's sampled live).
  const leaving = useMemo<Build | null>(() => (camInk && glyphCam ? plan(through(camInk, Number.isFinite(exitAt) ? camK(exitAt) : 1, exitAt, glyphCam)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ink, camInk, glyphCam, depth, pivot, moveFor, look, box.x, box.y, box.w, box.h, width, height, seed, timing.start, timing.end, timing.exit?.start, timing.exit?.end]);
  // When each grid cell has landed (the glyph camera shows the live picture there from then on). A cell lit only once the camera has moved takes its nearest landed neighbour's time.
  const reveal = useMemo(() => (build && glyphCam ? revealTimes(build) : null), [build, glyphCam]);
  const pullPlans = useMemo(() => (build && pulls?.length ? pulls.map((p, i) => planPull(build, p.word, p.at, family, look, seed + i * 101, { w: width, h: height })) : []), [build, pulls, family, look, seed, width, height]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cache = useRef<BuildCache>(newCache());
  const backed = useRef<OffscreenCanvas | null>(null);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!build || hidden) return;
    if (glyphCam && ink && leaving && reveal) {
      // The glyph camera: the glyphs fly in as the build planned them, but every landed cell shows the scene as the camera sees it now, so it moves from the first glyph; then the exit frame rains away.
      if (t < exitAt) {
        const live = planBuild({ ink: through(camInk ?? ink, camK(t), t, glyphCam), look, box, frame: { w: width, h: height }, start: -10, end: -9.9, seed, arrival: "pop", order: "random", smoothTone: true });
        const fade = Number.isFinite(exitAt) ? 1 - clamp((t - (exitAt - GLOW_OUT)) / GLOW_OUT, 0, 1) : 1;
        drawBuild(ctx, build, t, { palette, family, ambient, glow: glow * fade * clamp((t - timing.end - 0.3) / 1.4, 0, 1), glowFrom: -100, landed: { build: live, at: reveal } });
      } else drawBuild(ctx, leaving, t, { palette, family, ambient, glow: 0 });
      return;
    }
    if (backing) {
      // The front layer's backing: in as its glyphs land, out as they rain away.
      const out = timing.exit ? 1 - clamp((t - timing.exit.start) / Math.max(0.1, timing.exit.end - timing.exit.start), 0, 1) : 1;
      backed.current ??= tintMask(backing, build.pic.w, build.pic.h, palette.bg);
      ctx.globalAlpha = clamp(progress(build, t) * 1.4, 0, 1) * out;
      ctx.drawImage(backed.current, build.pic.x, build.pic.y);
      ctx.globalAlpha = 1;
    }
    drawBuild(ctx, build, t, { palette, family, ambient, glow, glowFrom: timing.end + 0.3, cache: cache.current });
    for (const p of pullPlans) drawPull(ctx, build, p, t, palette, family);
  }, [build, leaving, reveal, glyphCam, backing, ink, look, box, seed, timing.exit?.start, t, width, height, palette, family, glow, ambient, timing.end, hidden, pullPlans]);
  if (!move || !build || glyphCam) return <canvas ref={canvas} width={width} height={height} style={{ position: "absolute", inset: 0 }} />;
  // Moving: clipped to the picture's box, scaled about the subject (a point in the fitted picture).
  const ox = build.pic.x - box.x + move.fx * build.pic.w, oy = build.pic.y - box.y + move.fy * build.pic.h;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, overflow: "hidden" }}>
      <canvas
        ref={canvas}
        width={width}
        height={height}
        style={{ position: "absolute", left: -box.x, top: -box.y, transformOrigin: `${ox + box.x}px ${oy + box.y}px`, transform: moveCss(frameAt(move, k, t), build.pic.w, build.pic.h), willChange: "transform" }}
      />
    </div>
  );
};

/** One build card, inside its own Sequence: frame 0 is its card's start. */
const OneBuild: React.FC<{ card: BuildShow; palette: Palette; family: string; look: Look; box: Rect; glow: number; motion: number; moves?: readonly MoveKind[]; parallax?: number; hiddenAt?: (seconds: number) => boolean }> = ({ card, palette, family, look, box, glow, motion, moves, parallax, hiddenAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = usePictureInk(card.src, family, look.cols);
  const depthMap = usePictureDepth(card.depth);
  const depth = useMemo(() => (ink && depthMap ? crispDepth(fitTo(depthMap, ink.w, ink.h)) : null), [ink, depthMap]);
  const move = useMemo(() => (ink ? cameraMove(ink, card.seed, motion, moves, Boolean(depth), parallax) : null), [ink, card.seed, motion, moves, depth, parallax]);
  // The parallax layers: front and back by depth, each its own build (no depth map: the move is a plain pan).
  const layers = useMemo(() => {
    if (!ink || !depth || move?.kind !== "layers") return null;
    const split = layersByDepth(ink, depth);
    const moved = layerMoves(move, split.length);
    return split.map((l, i) => ({ ...l, move: moved[i]! }));
  }, [ink, depth, move]);
  // A burst starts straight away: glyphs are already landing on the first frame.
  const timing = useMemo(() => (card.burst ? { ...buildTiming(card.seconds), start: 0.05 } : buildTiming(card.seconds)), [card.seconds, card.burst]);
  const t = frame / fps;
  const k = t / (card.seconds + BUILD_TAIL);
  const hidden = hiddenAt?.(card.at + t) ?? false;
  if (layers)
    return (
      <>
        {layers.map((l, i) => (
          // The back carries the rain and the pulled words; each nearer layer is backed so the ones behind don't show through it.
          <BuildCanvas key={i} ink={l.ink} seed={card.seed + i} look={look} box={box} timing={timing} t={t} palette={palette} family={family} glow={glow} ambient={i === 0} hidden={hidden} pulls={i === 0 ? card.pulls : undefined} burst={card.burst ? BURST : undefined} move={l.move} moveAt={k} backing={i ? l.mask : null} />
        ))}
      </>
    );
  // The move runs the whole card and its tail, so it's still drifting as the glyphs rain away.
  return <BuildCanvas ink={ink} seed={card.seed} look={look} box={box} timing={timing} t={t} palette={palette} family={family} glow={glow} ambient hidden={hidden} pulls={card.pulls} burst={card.burst ? BURST : undefined} move={move} moveAt={k} depth={depth} moveFor={card.seconds + BUILD_TAIL} />;
};

/**
 * Every build card of an edit, each in its own Sequence so it only exists
 * while it shows (plus its tail). `offset` = the edit's frame at this
 * layer's frame zero. `hiddenAt` (edit seconds) skips drawing, e.g. while
 * footage plays over it.
 */
export const BuildLayer: React.FC<{
  cards: BuildShow[];
  offset?: number;
  palette: Palette;
  family: string;
  look: Look;
  /** Where the pictures may go (fitted inside, keeping their shape). Default: the whole frame. */
  box?: Rect;
  /** The tinted picture glowing under the glyphs once built, 0..1. */
  glow?: number;
  /** The camera move's size (cameraMove `amount`; 0 = still, the default). */
  motion?: number;
  /** The kinds of move to pick from, per picture by its seed (default: push in, pull back, pan). */
  moves?: readonly MoveKind[];
  /** How much depth the push, pull and pan take when a picture has a depth map (DEPTH_PARALLAX by default; 0 = flat). */
  parallax?: number;
  hiddenAt?: (seconds: number) => boolean;
}> = ({ cards, offset = 0, palette, family, look, box, glow = 0.22, motion = 0, moves, parallax, hiddenAt }) => {
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const area = box ?? { x: 0, y: 0, w: width, h: height };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {[...cards]
        .sort((a, b) => a.at - b.at)
        .map((c) => {
          const from = Math.round(c.at * fps) - offset;
          const frames = Math.max(1, Math.round((c.seconds + BUILD_TAIL + 0.5) * fps));
          if (from + frames <= 0 || from >= durationInFrames) return null;
          return (
            <Sequence key={c.id} from={from} durationInFrames={frames} layout="none">
              <OneBuild card={c} palette={palette} family={family} look={look} box={area} glow={glow} motion={motion} moves={moves} parallax={parallax} hiddenAt={hiddenAt} />
            </Sequence>
          );
        })}
    </AbsoluteFill>
  );
};

// ── words built out of glyphs ──

/** Text as glyphs, on its own clock (frame 0 of where it's placed). `font` is the CSS font it's set in before it turns to glyphs. */
export const TextBuild: React.FC<{
  text: string;
  font: string;
  /** How wide the type may set before wrapping, px at the font's size. */
  maxWidth?: number;
  box: Rect;
  look: Look;
  cols: number;
  seed: number;
  timing: BuildTiming;
  palette: Palette;
  family: string;
  arrival?: Arrival;
  order?: Order;
  glow?: number;
}> = ({ text, font, maxWidth = 2600, box, look, cols, seed, timing, palette, family, arrival, order, glow = 0.18 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ready = useLoaded(`glyph text ${text}`, () => Promise.all([document.fonts.load(font), document.fonts.load(`700 20px ${family}`)]).then(() => true), [font, family]);
  const ink = useMemo(() => (ready && text.trim() ? inkFromText(text.trim(), font, maxWidth) : null), [ready, text, font, maxWidth]);
  const tl = useMemo(() => textLook(look, cols), [look, cols]);
  return <BuildCanvas ink={ink} seed={seed} look={tl} box={box} timing={timing} t={frame / fps} palette={palette} family={family} glow={glow} arrival={arrival} order={order} />;
};

/** Typed out at `cps` characters a second from `from`. */
const typed = (text: string, from: number, t: number, cps = 26) => text.slice(0, Math.max(0, Math.floor((t - from) * cps)));

/**
 * A chapter: the screen is clear, the name builds out of glyphs large in
 * the middle, holds, and rains away into the next picture. No "CHAPTER
 * TWO" above it: the opening chapter sits under the title, so the first
 * one anyone sees would say two. CHAPTER_CARD seconds; frame 0 is its start.
 */
export const ChapterCard: React.FC<{ name: string; palette: Palette; family: string; nameFont: string; look: Look; seed: number }> = ({ name, palette, family, nameFont, look, seed }) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <TextBuild
        text={name}
        font={nameFont}
        maxWidth={1800}
        box={{ x: width * 0.1, y: height * 0.33, w: width * 0.8, h: height * 0.34 }}
        look={look}
        cols={190}
        seed={seed}
        timing={{ start: 0.35, end: 0.8, exit: { start: CHAPTER_CARD - 0.65, end: CHAPTER_CARD + 0.4 } }}
        palette={palette}
        family={family}
        arrival="decode"
      />
    </AbsoluteFill>
  );
};

// ── the end card ──

/** The end card's phases, seconds from its start. */
const REEL = 6;
const MOSAIC = { from: REEL, to: REEL + 1.6 };
const NAME = { from: REEL + 2.1, to: REEL + 3.5 };

/** The reel: each picture's slot, faster and faster but never under 0.4s, so each one still reads (each cross-dissolves into the next, so it never strobes). */
const reelSlots = (n: number): { i: number; from: number; to: number }[] => {
  const out: { i: number; from: number; to: number }[] = [];
  let at = 0;
  for (let k = 0; at < REEL && n; k++) {
    const d = Math.max(0.4, 1.1 * 0.85 ** k);
    out.push({ i: k, from: at, to: Math.min(REEL, at + d) });
    at += d;
  }
  // Spread the pictures across the slots in the video's order.
  return out.map((s, k) => ({ ...s, i: Math.min(n - 1, Math.floor((k * n) / out.length)) }));
};

/** The mosaic's grid: as many columns as make the tiles biggest. */
const grid = (n: number, w: number, h: number, aspect: number) => {
  let best = { cols: 1, rows: n, tw: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tw = Math.min(w / cols, (h / rows) * aspect);
    if (tw > best.tw) best = { cols, rows, tw };
  }
  return best;
};

/**
 * The end: every picture of the video again, a short reel getting faster;
 * they land as a mosaic, every tile still glyphs; the tiles rain away and
 * the channel name builds out of the glyphs, the sign-off types under it;
 * then it holds to END_CARD with the lower part clear for YouTube's
 * end-screen elements (they cover the last 5–20 seconds). Frame 0 is its start.
 */
export const EndCard: React.FC<{ pictures: string[]; channel: string; line: string; palette: Palette; family: string; nameFont: string; look: Look; /** Glow under the reel's pictures (as the video's own); the small mosaic tiles keep theirs so their shapes read. */ glow?: number }> = ({ pictures, channel, line, palette, family, nameFont, look, glow = 0.22 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const inks = useLoaded(
    `end card pictures`,
    async () => {
      await document.fonts.load(`700 20px ${family}`).catch(() => []);
      return Promise.all(pictures.map((p) => loadImage(p).then((img) => inkFromImage(img, "light", 384, "auto")).catch(() => null)));
    },
    [pictures.join("|"), family],
  );
  const reel = useMemo(() => reelSlots(pictures.length), [pictures.length]);
  // The reel's pictures, built (finished) once each.
  const reelBuilds = useMemo(() => {
    if (!inks) return new Map<number, Build>();
    const m = new Map<number, Build>();
    for (const s of reel) {
      const ink = inks[s.i];
      if (ink && !m.has(s.i)) m.set(s.i, planBuild({ ink, look, box: { x: 0, y: height * 0.04, w: width, h: height * 0.92 }, frame: { w: width, h: height }, start: -2, end: -1.9, seed: 7 + s.i, arrival: "fade", order: "random" }));
    }
    return m;
  }, [inks, reel, look, width, height]);
  // The mosaic: every picture a tile, popping in, then raining away as the name comes.
  const tiles = useMemo(() => {
    if (!inks) return [] as Build[];
    const n = inks.length;
    const area = { x: width * 0.05, y: height * 0.06, w: width * 0.9, h: height * 0.86 };
    const g = grid(n, area.w, area.h, 1.5);
    const tw = g.tw;
    const th = tw / 1.5;
    const ox = area.x + (area.w - g.cols * tw) / 2;
    const oy = area.y + (area.h - g.rows * th) / 2;
    return inks.flatMap((ink, i) => {
      if (!ink) return [];
      const cx = i % g.cols;
      const cy = Math.floor(i / g.cols);
      const start = MOSAIC.from + hash(i * 3 + 1) * 0.7;
      const leave = NAME.from - 0.5 + hash(i * 5 + 2) * 0.4;
      // A glyph about every 2px, so a small tile still shows what it is.
      return [planBuild({ ink, look: { ...look, cols: Math.max(90, Math.round(tw / 2)) }, box: { x: ox + cx * tw + 3, y: oy + cy * th + 3, w: tw - 6, h: th - 6 }, frame: { w: width, h: height }, start, end: start + 0.45, seed: 11 + i, arrival: "pop", order: "random", exit: { start: leave, end: leave + 1.4 } })];
    });
  }, [inks, look, width, height]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const caches = useRef(new Map<Build, BuildCache>());
  const cacheOf = (b: Build) => {
    let c = caches.current.get(b);
    if (!c) caches.current.set(b, (c = newCache()));
    return c;
  };
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (t < REEL) {
      // Each slot's picture, dissolving into the next over the last part of its slot.
      const k = reel.findIndex((s) => t >= s.from && t < s.to);
      const slot = reel[Math.max(0, k)];
      if (slot) {
        const next = reel[k + 1];
        const fade = Math.min(0.2, (slot.to - slot.from) * 0.4);
        const mix = next ? smooth(clamp((t - (slot.to - fade)) / fade, 0, 1)) : 0;
        const a = reelBuilds.get(slot.i);
        const b = next ? reelBuilds.get(next.i) : undefined;
        if (a) {
          ctx.globalAlpha = 1 - mix;
          drawBuild(ctx, a, 10, { palette, family, glow, glowFrom: 0, cache: cacheOf(a) });
        }
        if (b && mix > 0) {
          ctx.globalAlpha = mix;
          drawBuild(ctx, b, 10, { palette, family, glow, glowFrom: 0, cache: cacheOf(b) });
        }
        ctx.globalAlpha = 1;
      }
    }
    // The tinted picture glows faintly under each tile, as in the reel, so the shapes read.
    if (t >= MOSAIC.from - 0.1 && t < NAME.to + 1.5) for (const b of tiles) drawBuild(ctx, b, t, { palette, family, glow: 0.22, glowFrom: MOSAIC.from, cache: cacheOf(b) });
  }, [t, width, height, reel, reelBuilds, tiles, palette, family, glow]);
  const lineFrom = NAME.to + 0.3;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, pointerEvents: "none" }}>
      <canvas ref={canvas} width={width} height={height} style={{ position: "absolute", inset: 0 }} />
      {t >= NAME.from - 0.2 ? (
        <Sequence from={Math.round((NAME.from - 0.2) * fps)} layout="none">
          <TextBuild
            text={channel}
            font={nameFont}
            maxWidth={2400}
            box={{ x: width * 0.1, y: height * 0.12, w: width * 0.8, h: height * 0.32 }}
            look={look}
            cols={190}
            seed={404}
            timing={{ start: 0.2, end: NAME.to - NAME.from }}
            palette={palette}
            family={family}
            arrival="converge"
            order="centre"
            glow={0.25}
          />
        </Sequence>
      ) : null}
      <div style={{ position: "absolute", top: height * 0.48, left: width * 0.1, right: width * 0.1, textAlign: "center", fontFamily: family, fontWeight: 700, fontSize: Math.round(height * 0.03), color: rgba(palette.ink, 0.78), whiteSpace: "pre-wrap" }}>
        {typed(line, lineFrom, t, 30)}
        {t >= lineFrom && Math.floor(t * 2.2) % 2 === 0 ? <span style={{ color: rgba(palette.ink, 0.9) }}>█</span> : null}
      </div>
    </AbsoluteFill>
  );
};

// ── terminal captions ──

export type SpokenWord = { text: string; start: number; end: number };
export type TerminalLine = { words: SpokenWord[]; start: number; end: number };

/** Seconds early a word starts decoding before it's said. */
const LEAD = 0.14;
/** Seconds a word takes to settle into its letters once it's said. */
const SETTLE = 0.16;
/** A pause this long starts a fresh line. */
const BREAK = 1.1;
/** A line left this long after its last word fades away (the cursor stays). */
const LINGER = 2.6;
const SCRAMBLE = "#%&@$*+=<>/\\|{}[]01";

/**
 * The words as terminal lines: a line takes words until the next would run
 * past `cols` characters or comes after a pause. Pure, for the tests.
 */
export const terminalLines = (words: SpokenWord[], cols: number): TerminalLine[] => {
  const lines: TerminalLine[] = [];
  let cur: TerminalLine | null = null;
  let chars = 0;
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const word = { ...w, text };
    const fits = cur && chars + 1 + text.length <= cols && word.start - cur.end < BREAK;
    if (cur && fits) {
      cur.words.push(word);
      cur.end = word.end;
      chars += 1 + text.length;
    } else {
      cur = { words: [word], start: word.start, end: word.end };
      chars = text.length;
      lines.push(cur);
    }
  }
  return lines;
};

/** The line on screen at `t`: the last one that has begun. */
const lineAt = (lines: TerminalLine[], t: number): number => {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (lines[m]!.start - LEAD <= t) lo = m + 1;
    else hi = m;
  }
  return lo - 1;
};

/** A word at `t`: scrambled glyphs before it's said, settling left to right as it is. */
const wordAt = (w: SpokenWord, t: number, salt: number): { text: string; settled: number } => {
  const k = clamp((t - w.start) / SETTLE, 0, 1);
  const n = Math.round(k * w.text.length);
  const tick = Math.floor(t * 18);
  let out = w.text.slice(0, n);
  for (let i = n; i < w.text.length; i++) out += /\s/.test(w.text[i]!) ? " " : SCRAMBLE[Math.floor(hash(salt * 31 + i * 7 + tick) * SCRAMBLE.length)];
  return { text: out, settled: k };
};

export const TerminalCaptions: React.FC<{
  /** Every word heard, in video seconds. */
  words: SpokenWord[];
  palette: Palette;
  family: string;
  /** Type size, px. */
  size: number;
  /** The block: its left edge, width and bottom edge (px from the bottom of the frame). */
  left: number;
  width: number;
  bottom: number;
  /** The prompt before each line. */
  prompt?: string;
  /** Times (video seconds) the line stays off, e.g. while a chapter card has the screen. */
  clearAt?: (seconds: number) => boolean;
}> = ({ words, palette, family, size, left, width, bottom, prompt = "> ", clearAt }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const clear = clearAt?.(t) ?? false;
  const cols = Math.max(12, Math.floor(width / (size * 0.6)) - prompt.length - 1);
  const lines = useMemo(() => terminalLines(words, cols), [words, cols]);
  const i = lineAt(lines, t);
  if (i < 0 || clear) return null;
  const line = lines[i]!;
  const prev = i > 0 && lines[i - 1]!.end > line.start - LINGER ? lines[i - 1] : undefined;
  // The new line pushes the last one up over a few frames.
  const lineH = size * 1.35;
  const scroll = 1 - clamp((t - (line.start - LEAD)) / 0.18, 0, 1);
  const idle = t - line.end;
  const fade = 1 - clamp((idle - LINGER) / 0.5, 0, 1);
  const shown = line.words.filter((w) => w.start - LEAD <= t);
  const lastSaid = shown.at(-1);
  const blink = !lastSaid || t > lastSaid.end + 0.35 ? Math.floor(t * 2.2) % 2 === 0 : true;
  const ink = (a: number) => rgba(palette.ink, a);
  const row = (y: number, children: React.ReactNode, opacity = 1): React.ReactNode => (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: y, whiteSpace: "pre", opacity }}>
      <span style={{ color: rgba(palette.trail, 0.8) }}>{prompt}</span>
      {children}
    </div>
  );
  const base = (i * 977) % 10000;
  return (
    <div style={{ position: "absolute", left, width, bottom, height: lineH * 2.2, fontFamily: family, fontWeight: 700, fontSize: size, lineHeight: `${lineH}px`, pointerEvents: "none", overflow: "hidden" }}>
      {prev && fade > 0 ? row(lineH * (1 - scroll), <span style={{ color: ink(0.38) }}>{prev.words.map((w) => w.text).join(" ")}</span>, fade) : null}
      {row(
        -lineH * scroll,
        <>
          {fade > 0
            ? shown.map((w, k) => {
                const { text, settled } = wordAt(w, t, base + k);
                const now = t >= w.start - LEAD && t <= w.end + 0.12;
                const colour = settled < 1 ? rgba(palette.trail, 0.9) : now ? palette.head : ink(0.82);
                return (
                  <span key={k} style={{ color: colour, opacity: fade }}>
                    {k ? " " : ""}
                    {text}
                  </span>
                );
              })
            : null}
          <span style={{ color: ink(0.9), opacity: blink ? 1 : 0 }}>{shown.length && fade > 0 ? " █" : "█"}</span>
        </>,
      )}
    </div>
  );
};
