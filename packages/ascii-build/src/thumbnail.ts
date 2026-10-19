/**
 * A video's thumbnail (docs/design/desk-thumbnails.md): a picture as glyphs,
 * full bleed at 1280×720, with a few words built out of glyphs in an accent
 * colour on the picture's dark side. A still, so it's drawn once with every
 * glyph landed. The Desk draws it on a canvas and the download is that
 * canvas, so what Tom previews is the file he uploads.
 *
 * Brighter than the videos (gain and glow): at the Beats settings a
 * thumbnail was too dim to read in a feed. The words get three more passes
 * so they read at feed size (168 to 360px wide): the picture shaded behind
 * them, a thick black outline, and a solid body under the glyphs. Small,
 * the letters read as solid type; full size, you still see the glyphs.
 */
import { type BuildCache, drawBuild, newCache } from "./draw";
import type { Ink } from "./ink";
import { LOCKED_LOOK, type Look, PALETTES, type Palette, clamp, rgba } from "./look";
import { type Build, type Rect, lookFromSeed, planBuild } from "./plan";
import { inkFromText } from "./text";

/** YouTube's thumbnail size. */
export const THUMB = { w: 1280, h: 720 } as const;
/** 125 columns: chunky enough to see the glyphs, and the face still reads at 168px (280 stops looking like glyphs at feed size). */
export const THUMB_LOOK: Look = { ...LOCKED_LOOK, cols: 125, gain: 1.6 };
const PICTURE_GLOW = 0.45;
const WORDS_GLOW = 0.18;

/** The words' colours. The picture stays the matrix green. The red is lighter than the videos' so it holds up small next to the green. */
export const THUMB_ACCENTS = {
  red: { bg: PALETTES.matrix.bg, ink: [255, 104, 84], trail: [230, 50, 40], head: "#ffd6d0" },
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

/** How big the picture is against a full-bleed cover (1). A little under, so the words have room beside it. */
export const THUMB_PICTURE_SCALE = 0.88;

/**
 * Cover, then `scale`: at 1 the picture fills the frame and its overflow is
 * cropped (a 3:2 picture loses some top and bottom). Smaller, it's pushed
 * away from the words' side; the pictures fade to black at their edges, so
 * the gap left behind is just more dark for the words.
 */
const pictureBox = (ink: Ink, frame: { w: number; h: number }, scale: number, side: ThumbSide): Rect => {
  const aspect = ink.w / ink.h;
  const w = Math.max(frame.w, frame.h * aspect) * scale;
  const h = w / aspect;
  const x = scale >= 1 ? (frame.w - w) / 2 : side === "left" ? frame.w - w : 0;
  return { x, y: (frame.h - h) / 2, w, h };
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
 * Where the words may go: the dark side, as wide as it's empty plus a
 * touch over the picture's edge (36% to 52% of the frame: the outline and
 * shade keep them apart, and bigger words read in a feed; any further
 * and they cover the face), kept clear of the bottom right (YouTube puts the length there).
 */
const wordsBox = (side: ThumbSide, free: number, frame: { w: number; h: number }): Rect => {
  const w = frame.w * clamp(free + 0.04, 0.36, 0.52);
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
export const planThumbnail = (o: { picture: Ink; words: string; seed: number; side?: ThumbSide; family: string; frame?: { w: number; h: number }; pictureScale?: number; pictureCols?: number }): ThumbPlan => {
  const frame = o.frame ?? THUMB;
  const side = o.side ?? darkSide(o.picture);
  const text = o.words.trim().toUpperCase();
  // No words, nothing to make room for: full bleed.
  const pic = pictureBox(o.picture, frame, text ? (o.pictureScale ?? THUMB_PICTURE_SCALE) : 1, side);
  const { arrival, order } = lookFromSeed(o.seed);
  const picture = planBuild({ ink: o.picture, look: o.pictureCols ? { ...THUMB_LOOK, cols: o.pictureCols } : THUMB_LOOK, box: pic, frame, start: 0, end: 1, seed: o.seed, arrival, order });
  if (!text) return { picture, words: null, side };
  // The empty width as a share of the frame: the gap beside a smaller picture plus the picture's own empty edge.
  const gap = side === "left" ? pic.x : frame.w - (pic.x + pic.w);
  const box = wordsBox(side, (Math.max(0, gap) + freeWidth(o.picture, side) * pic.w) / frame.w, frame);
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

/** The passes that make the words read small. All on by default; off is the 10-17 look. */
export type ThumbWordsStyle = { shade: boolean; outline: boolean; body: boolean };
export const THUMB_WORDS_STYLE: ThumbWordsStyle = { shade: true, outline: true, body: true };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The words' letter shapes as one colour, at their place in the frame. */
const wordsShape = (b: Build, colour: string) => {
  const { ink, pic } = b;
  const alpha = new Uint8ClampedArray(ink.w * ink.h * 4);
  for (let p = 0; p < ink.w * ink.h; p++) {
    alpha[p * 4] = alpha[p * 4 + 1] = alpha[p * 4 + 2] = 255;
    alpha[p * 4 + 3] = 255 * clamp(ink.data[p]!, 0, 1);
  }
  const mask = new OffscreenCanvas(ink.w, ink.h);
  mask.getContext("2d")!.putImageData(new ImageData(alpha, ink.w, ink.h), 0, 0);
  const out = new OffscreenCanvas(b.frame.w, b.frame.h);
  const g = out.getContext("2d")!;
  g.drawImage(mask, pic.x, pic.y, pic.w, pic.h);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = colour;
  g.fillRect(0, 0, b.frame.w, b.frame.h);
  return out;
};

/** Darkens the picture from the words' edge of the frame to a little past them. */
const drawShade = (ctx: Ctx, b: Build, side: ThumbSide) => {
  const { w, h } = b.frame;
  const reach = side === "left" ? b.pic.x + b.pic.w + w * 0.12 : w - b.pic.x + w * 0.12;
  const from = side === "left" ? 0 : w;
  const to = side === "left" ? reach : w - reach;
  const grad = ctx.createLinearGradient(from, 0, to, 0);
  grad.addColorStop(0, "rgba(0,0,0,0.78)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
};

/** A thick black outline round the letters (the shape stamped in a ring), with a soft drop of shadow. */
const drawOutline = (ctx: Ctx, b: Build) => {
  const black = wordsShape(b, "#000");
  const r = b.frame.h * 0.014;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = b.frame.h * 0.04;
  ctx.drawImage(black, 0, 0);
  ctx.restore();
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ctx.drawImage(black, Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.drawImage(black, 0, 0);
};

/** The thumbnail, drawn once. `family` is the glyphs' font (loaded). */
export const drawThumbnail = (ctx: Ctx, plan: ThumbPlan, o: { accent: ThumbAccent; family: string; style?: ThumbWordsStyle; caches?: { picture: BuildCache; words: BuildCache } }) => {
  const caches = o.caches ?? { picture: newCache(), words: newCache() };
  const style = o.style ?? THUMB_WORDS_STYLE;
  const accent = THUMB_ACCENTS[o.accent];
  ctx.fillStyle = PALETTES.matrix.bg;
  ctx.fillRect(0, 0, plan.picture.frame.w, plan.picture.frame.h);
  drawBuild(ctx, plan.picture, STILL, { palette: PALETTES.matrix, family: o.family, ambient: true, glow: PICTURE_GLOW, glowFrom: 1.3, cache: caches.picture });
  if (!plan.words) return;
  if (style.shade) drawShade(ctx, plan.words, plan.side);
  if (style.outline) drawOutline(ctx, plan.words);
  // The body: the letters filled solid in a dimmer accent, so the gaps between glyph rows don't thin them out small.
  if (style.body) {
    ctx.globalAlpha = 0.5;
    ctx.drawImage(wordsShape(plan.words, rgba(accent.ink, 1)), 0, 0);
    ctx.globalAlpha = 1;
  }
  drawBuild(ctx, plan.words, STILL, { palette: accent, family: o.family, glow: WORDS_GLOW, glowFrom: 1.3, cache: caches.words });
};
