/**
 * A video's thumbnail (docs/design/desk-thumbnails.md): a picture as glyphs,
 * full bleed at 1280×720, with a few words built out of glyphs in an accent
 * colour on the picture's dark side. A still, so it's drawn once with every
 * glyph landed. The Desk draws it on a canvas and the download is that
 * canvas, so what Tom previews is the file he uploads.
 *
 * Brighter than the videos (gain and glow): at the Beats settings a
 * thumbnail was too dim to read in a feed.
 */
import { type BuildCache, drawBuild, newCache } from "./draw";
import type { Ink } from "./ink";
import { LOCKED_LOOK, type Look, PALETTES, type Palette, clamp } from "./look";
import { type Build, type Rect, lookFromSeed, planBuild } from "./plan";
import { inkFromText } from "./text";

/** YouTube's thumbnail size. */
export const THUMB = { w: 1280, h: 720 } as const;
/** 160 columns: 120 lost the face, 280 stops looking like glyphs at feed size. */
export const THUMB_LOOK: Look = { ...LOCKED_LOOK, cols: 160, gain: 1.6 };
const PICTURE_GLOW = 0.45;
const WORDS_GLOW = 0.18;

/** The words' colours. The picture stays the matrix green. */
export const THUMB_ACCENTS = {
  red: { bg: PALETTES.matrix.bg, ink: [255, 72, 58], trail: [230, 50, 40], head: "#ffd6d0" },
  white: { bg: PALETTES.matrix.bg, ink: [242, 233, 212], trail: [242, 233, 212], head: "#ffffff" },
} satisfies Record<string, Palette>;
export type ThumbAccent = keyof typeof THUMB_ACCENTS;

/** A chunky face for the words: thin serifs go soft at feed size. The page loads it (Anton). */
export const thumbWordsFont = (family: string) => `400 300px ${family}`;

export type ThumbSide = "left" | "right";

/** Which side of the picture is darker (the words go there). Compares the outer 40% either side. */
export const darkSide = (ink: Ink): ThumbSide => {
  const band = Math.floor(ink.w * 0.4);
  let left = 0;
  let right = 0;
  for (let y = 0; y < ink.h; y++)
    for (let x = 0; x < band; x++) {
      left += ink.data[y * ink.w + x]!;
      right += ink.data[y * ink.w + (ink.w - 1 - x)]!;
    }
  return left <= right ? "left" : "right";
};

/** Cover, not fit: the picture fills the frame and its overflow is cropped (a 3:2 picture loses some top and bottom). */
const coverBox = (ink: Ink, frame: { w: number; h: number }): Rect => {
  const aspect = ink.w / ink.h;
  const w = Math.max(frame.w, frame.h * aspect);
  const h = w / aspect;
  return { x: (frame.w - w) / 2, y: (frame.h - h) / 2, w, h };
};

/** How much of the frame's width, from `side`'s edge, is empty before the picture starts (0..1). */
export const freeWidth = (ink: Ink, side: ThumbSide): number => {
  const col = (x: number) => {
    let sum = 0;
    for (let y = 0; y < ink.h; y++) sum += ink.data[y * ink.w + x]!;
    return sum / ink.h;
  };
  for (let i = 0; i < ink.w; i++) if (col(side === "left" ? i : ink.w - 1 - i) > 0.06) return i / ink.w;
  return 1;
};

/**
 * Where the words may go: the dark side, only as wide as it's empty (22% to
 * 45% of the frame), kept clear of the bottom right (YouTube puts the length there).
 */
const wordsBox = (side: ThumbSide, free: number, frame: { w: number; h: number }): Rect => {
  const w = frame.w * clamp(free - 0.04, 0.22, 0.45);
  return side === "left" ? { x: frame.w * 0.03, y: frame.h * 0.08, w, h: frame.h * 0.78 } : { x: frame.w * 0.97 - w, y: frame.h * 0.06, w, h: frame.h * 0.7 };
};

/** Every way to break up to four words into one to three lines, in order. */
const lineSplits = (words: string[]): string[] => {
  if (words.length <= 1) return [words.join(" ")];
  const out: string[] = [];
  const walk = (from: number, lines: string[]) => {
    if (from === words.length) return void out.push(lines.join("\n"));
    if (lines.length === 3) return;
    for (let to = from + 1; to <= words.length; to++) walk(to, [...lines, words.slice(from, to).join(" ")]);
  };
  walk(0, []);
  return out;
};

export type ThumbPlan = { picture: Build; words: Build | null; side: ThumbSide };

/**
 * The thumbnail's builds. `words` are set upper case (blank = no words); a
 * new line Tom typed is kept, otherwise the words take whichever line
 * breaks set them biggest in the space. `side` defaults to the dark side.
 */
export const planThumbnail = (o: { picture: Ink; words: string; seed: number; side?: ThumbSide; family: string; frame?: { w: number; h: number } }): ThumbPlan => {
  const frame = o.frame ?? THUMB;
  const side = o.side ?? darkSide(o.picture);
  const { arrival, order } = lookFromSeed(o.seed);
  const picture = planBuild({ ink: o.picture, look: THUMB_LOOK, box: coverBox(o.picture, frame), frame, start: 0, end: 1, seed: o.seed, arrival, order });
  const text = o.words.trim().toUpperCase();
  if (!text) return { picture, words: null, side };
  const box = wordsBox(side, freeWidth(o.picture, side), frame);
  const font = thumbWordsFont(o.family);
  const tries = text.includes("\n") ? [text] : lineSplits(text.split(/\s+/).slice(0, 6));
  // The biggest fit: how far each set of lines scales to fill the box.
  const best = tries
    .map((t) => ({ t, ink: inkFromText(t, font, 4000) }))
    .reduce((a, b) => (Math.min(box.w / b.ink.w, box.h / b.ink.h) > Math.min(box.w / a.ink.w, box.h / a.ink.h) ? b : a));
  // Fewer letters a line, fewer columns: each letter keeps about ten glyphs across.
  const longest = Math.max(...best.t.split("\n").map((l) => l.trim().length));
  const cols = Math.round(clamp(longest * 10 + 20, 45, 75));
  const look: Look = { ...THUMB_LOOK, cols, edge: "hard", levels: Math.max(THUMB_LOOK.levels, 4) };
  const words = planBuild({ ink: best.ink, look, box, frame, start: 0, end: 1, seed: o.seed + 7, arrival: "pop", order: "random" });
  return { picture, words, side };
};

/** Every glyph landed and the glow full up (the builds run 0..1s, the glow takes 1.4s from 1.3s). */
const STILL = 3;

/** The thumbnail, drawn once. `family` is the glyphs' font (loaded). */
export const drawThumbnail = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, plan: ThumbPlan, o: { accent: ThumbAccent; family: string; caches?: { picture: BuildCache; words: BuildCache } }) => {
  const caches = o.caches ?? { picture: newCache(), words: newCache() };
  ctx.fillStyle = PALETTES.matrix.bg;
  ctx.fillRect(0, 0, plan.picture.frame.w, plan.picture.frame.h);
  drawBuild(ctx, plan.picture, STILL, { palette: PALETTES.matrix, family: o.family, ambient: true, glow: PICTURE_GLOW, glowFrom: 1.3, cache: caches.picture });
  if (plan.words) drawBuild(ctx, plan.words, STILL, { palette: THUMB_ACCENTS[o.accent], family: o.family, glow: WORDS_GLOW, glowFrom: 1.3, cache: caches.words });
};
