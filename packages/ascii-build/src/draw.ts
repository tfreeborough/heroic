/**
 * Draw a build at time `t`. Stateless apart from an optional cache that
 * keeps landed glyphs baked on a layer (scrubbing backwards rebakes), so a
 * live page is cheap and a Remotion frame rendered on its own is correct.
 */
import { glowAlpha } from "./ink";
import { type Palette, clamp, hash, lerp, rgba } from "./look";
import { type Build, LEAVE_FALL, NOISE } from "./plan";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type BuildCache = {
  build?: Build;
  baked?: OffscreenCanvas;
  bakedTo: number;
  bakedIdx: number;
  tinted?: OffscreenCanvas;
  tintedFor?: string;
};
export const newCache = (): BuildCache => ({ bakedTo: -1, bakedIdx: 0 });

export type DrawOptions = {
  palette: Palette;
  /** CSS font family; the glyphs are drawn bold. */
  family?: string;
  /** Faint Matrix columns over the whole frame. */
  ambient?: boolean;
  /** Strength (0..1) of the tinted picture glowing under the glyphs at the end. */
  glow?: number;
  /** When the glow starts fading up (usually when the build finishes). */
  glowFrom?: number;
  cache?: BuildCache;
};

export const FLASH = 0.35;
const DEFAULT_FAMILY = '"JetBrains Mono", ui-monospace, monospace';
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeOutBack = (k: number) => 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
const rest = (v: number) => 0.25 + 0.75 * v;

export const drawBuild = (ctx: Ctx, b: Build, t: number, o: DrawOptions) => {
  const pal = o.palette;
  const font = `700 ${b.fontPx}px ${o.family ?? DEFAULT_FAMILY}`;
  // A new build invalidates everything the cache holds.
  const cache = o.cache && (o.cache.build === b ? o.cache : Object.assign(o.cache, { build: b, baked: undefined, bakedTo: -1, bakedIdx: 0, tinted: undefined, tintedFor: undefined }));
  const tick = Math.floor(t * 16);
  const noise = (n: number) => NOISE[Math.floor(hash(n + tick) * NOISE.length)]!;
  const exiting = b.exit !== undefined && t >= b.exit.start;
  ctx.font = font;
  ctx.textBaseline = "top";

  if (o.ambient) {
    for (let k = 0; k < Math.round(b.frame.w / 42); k++) {
      const x = Math.floor(hash(k) * (b.frame.w / b.cw)) * b.cw;
      const sp = 140 + hash(k + 99) * 220;
      const y = ((t * sp + hash(k + 7) * 2000) % (b.frame.h + 600)) - 300;
      for (let j = 0; j < 10; j++) {
        ctx.fillStyle = rgba(pal.trail, 0.07 * (1 - j / 10));
        ctx.fillText(NOISE[Math.floor(hash(k * 31 + j + Math.floor(t * 8)) * NOISE.length)]!, x, y - j * b.ch);
      }
    }
  }

  drawGlow(ctx, b, t, o, cache);

  // Landed glyphs: baked while building, drawn one by one once they start leaving.
  if (!exiting && cache) {
    cache.baked ??= new OffscreenCanvas(b.frame.w, b.frame.h);
    const g = cache.baked.getContext("2d")!;
    if (t < cache.bakedTo) { g.clearRect(0, 0, b.frame.w, b.frame.h); cache.bakedIdx = 0; }
    g.font = font;
    g.textBaseline = "top";
    while (cache.bakedIdx < b.byLand.length && b.byLand[cache.bakedIdx]!.land + FLASH <= t) {
      const c = b.byLand[cache.bakedIdx++]!;
      g.fillStyle = rgba(pal.ink, rest(c.v));
      g.fillText(c.ch, c.x, c.y);
    }
    cache.bakedTo = t;
    ctx.drawImage(cache.baked, 0, 0);
  } else {
    for (const c of b.byLand) {
      if (c.land + FLASH > t) break;
      if (t >= c.leave) continue;
      ctx.fillStyle = rgba(pal.ink, rest(c.v));
      ctx.fillText(c.ch, c.x, c.y);
    }
  }

  for (const c of b.cells) {
    if (t >= c.leave) { drawLeaving(ctx, b, c, t, pal, noise); continue; }
    if (t < c.release || t >= c.land + FLASH) continue;
    if (t >= c.land) {
      const k = (t - c.land) / FLASH;
      ctx.fillStyle = b.arrival === "fade" ? rgba(pal.ink, rest(c.v))
        : k < 0.3 ? pal.head : rgba(pal.ink, lerp(1, rest(c.v), (k - 0.3) / 0.7)); // impact: white-hot, cooling
      ctx.fillText(c.ch, c.x, c.y);
      continue;
    }
    const k = (t - c.release) / (c.land - c.release);
    switch (b.arrival) {
      case "rain": {
        const y = lerp(c.y0, c.y, k);
        for (let j = 7; j >= 1; j--) {
          const ty = y - j * b.ch;
          if (ty < c.y0) continue;
          ctx.fillStyle = rgba(pal.trail, 0.55 * (1 - j / 8));
          ctx.fillText(noise(c.seed * 13 + j), c.x, ty);
        }
        ctx.fillStyle = pal.head;
        ctx.fillText(noise(c.seed), c.x, y);
        break;
      }
      case "converge":
      case "sides":
        // A comet: the glyph plus a few echoes back along its path.
        for (let j = 4; j >= 0; j--) {
          const kk = easeOut(Math.max(0, k - j * 0.035));
          ctx.fillStyle = j ? rgba(pal.trail, 0.5 * (1 - j / 5)) : pal.head;
          ctx.fillText(j ? noise(c.seed * 7 + j) : c.ch, lerp(c.x0, c.x, kk), lerp(c.y0, c.y, kk));
        }
        break;
      case "decode":
        ctx.fillStyle = rgba(pal.trail, 0.25 + 0.6 * k);
        ctx.fillText(noise(c.seed), c.x, c.y);
        break;
      case "fade":
        ctx.fillStyle = rgba(pal.ink, rest(c.v) * easeOut(k));
        ctx.fillText(c.ch, c.x, c.y);
        break;
      default: { // pop
        const s = Math.max(0.01, easeOutBack(k) * 1.15);
        ctx.save();
        ctx.translate(c.x + b.cw / 2, c.y + b.ch / 2);
        ctx.scale(s, s);
        ctx.fillStyle = pal.head;
        ctx.fillText(c.ch, -b.cw / 2, -b.ch / 2);
        ctx.restore();
      }
    }
  }
};

/** The exit: a glyph lets go, falls as rain and fades, so the end meets the start. */
const drawLeaving = (ctx: Ctx, b: Build, c: Build["cells"][number], t: number, pal: Palette, noise: (n: number) => string) => {
  const dt = t - c.leave;
  if (dt >= LEAVE_FALL || t < c.land) return;
  const k = dt / LEAVE_FALL;
  const y = c.y + dt * (500 + hash(c.seed) * 500) + dt * dt * 1400;
  const a = 1 - k;
  for (let j = 4; j >= 1; j--) {
    ctx.fillStyle = rgba(pal.trail, 0.45 * a * (1 - j / 5));
    ctx.fillText(noise(c.seed * 17 + j), c.x, y - j * b.ch);
  }
  ctx.fillStyle = rgba(pal.ink, a * (k < 0.15 ? 1 : rest(c.v)));
  ctx.fillText(k < 0.3 ? c.ch : noise(c.seed), c.x, y);
};

/** The finished picture as a soft wash in the palette's ink colour. */
const drawGlow = (ctx: Ctx, b: Build, t: number, o: DrawOptions, cache: BuildCache | undefined) => {
  const strength = o.glow ?? 0;
  const from = o.glowFrom ?? Infinity;
  if (strength <= 0 || t < from) return;
  const out = b.exit ? 1 - clamp((t - b.exit.start) / 0.8, 0, 1) : 1;
  const a = strength * clamp((t - from) / 1.4, 0, 1) * out;
  if (a <= 0) return;
  const key = rgba(o.palette.ink, 1);
  let tinted = cache?.tintedFor === key ? cache.tinted : undefined;
  if (!tinted) {
    const mask = new OffscreenCanvas(b.ink.w, b.ink.h);
    mask.getContext("2d")!.putImageData(new ImageData(glowAlpha(b.ink, b.look), b.ink.w, b.ink.h), 0, 0);
    tinted = new OffscreenCanvas(Math.ceil(b.pic.w), Math.ceil(b.pic.h));
    const g = tinted.getContext("2d")!;
    g.filter = "blur(1.5px)";
    g.drawImage(mask, 0, 0, b.pic.w, b.pic.h);
    g.filter = "none";
    g.globalCompositeOperation = "source-in";
    g.fillStyle = key;
    g.fillRect(0, 0, b.pic.w, b.pic.h);
    if (cache) { cache.tinted = tinted; cache.tintedFor = key; }
  }
  ctx.globalAlpha = a;
  ctx.drawImage(tinted, b.pic.x, b.pic.y);
  ctx.globalAlpha = 1;
};
