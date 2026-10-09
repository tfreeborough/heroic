/**
 * Drawing the board. One function, `render`, paints a list of elements into
 * a 2D context at a camera — the live board, the replay and the exporter all
 * go through it, so what you export is exactly what you saw.
 *
 * Shapes go through roughjs (the hand-drawn pen) as SVG paths, cached per
 * element with a fixed seed so nothing jitters frame to frame. A path knows
 * its length, which is how a replay "draws" a shape: a dash the length of
 * the progress so far.
 */
import rough from "roughjs";
import type { Drawable, Options } from "roughjs/bin/core";
import { type Rect, bounds, handlePoint, HANDLES, union } from "../lib/geometry";
import { glyphById } from "../lib/glyphs";
import { type Element, type FontFamily, type Point, type Timeline, isContent, progressAt } from "../lib/scene";

export type Camera = { x: number; y: number; zoom: number };
export type Size = { w: number; h: number; dpr: number };

export const toScreen = (cam: Camera, p: Point): Point => [(p[0] - cam.x) * cam.zoom, (p[1] - cam.y) * cam.zoom];
export const toWorld = (cam: Camera, p: Point): Point => [p[0] / cam.zoom + cam.x, p[1] / cam.zoom + cam.y];

export const FONT_CSS: Record<FontFamily, string> = {
  cinzel: '700 {size}px "SandTitle", Cinzel, Georgia, serif',
  hand: '500 {size}px Caveat, "Comic Sans MS", cursive',
  sans: '600 {size}px Inter, -apple-system, "Helvetica Neue", Arial, sans-serif',
};
export const fontFor = (font: FontFamily, size: number): string => FONT_CSS[font].replace("{size}", String(size));
export const LINE_HEIGHT = 1.25;

const gen = rough.generator();

type PathInfo = { path: Path2D; len: number; stroke: string; strokeWidth: number; fill: string | undefined };
/** The outline strokes, the hatching strokes (in the fill colour) and the solid fills of an element. */
type Cached = { key: string; outline: PathInfo[]; hatch: PathInfo[]; fills: PathInfo[] };

const fromDrawables = (key: string, ds: Drawable[]): Cached => {
  const c: Cached = { key, outline: [], hatch: [], fills: [] };
  for (const d of ds) {
    const o = d.options;
    for (const set of d.sets) {
      const path = gen.opsToPath(set);
      if (set.type === "path") c.outline.push({ path: new Path2D(path), len: pathLength(path), stroke: o.stroke, strokeWidth: o.strokeWidth, fill: undefined });
      else if (set.type === "fillPath") c.fills.push({ path: new Path2D(path), len: 1, stroke: "none", strokeWidth: 0, fill: o.fill ?? o.stroke });
      else c.hatch.push({ path: new Path2D(path), len: pathLength(path), stroke: o.fill ?? o.stroke, strokeWidth: o.fillWeight > 0 ? o.fillWeight : o.strokeWidth / 2, fill: undefined });
    }
  }
  return c;
};
const cache = new Map<string, Cached>();

/** SVG measures path lengths for us; a detached <path> is enough. */
const measurer = typeof document !== "undefined" ? document.createElementNS("http://www.w3.org/2000/svg", "path") : undefined;
const pathLength = (d: string): number => {
  if (!measurer) return 1;
  measurer.setAttribute("d", d);
  try {
    return measurer.getTotalLength() || 1;
  } catch {
    return 1;
  }
};

const roughOptions = (el: Element): Options => {
  const filled = el.fillStyle !== "none" && el.fill !== "transparent";
  return {
    seed: el.seed,
    roughness: el.roughness,
    bowing: el.roughness ? 1 : 0,
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    fill: filled ? el.fill : undefined,
    fillStyle: filled ? el.fillStyle : undefined,
    hachureGap: 4 + el.strokeWidth * 3,
    fillWeight: Math.max(0.6, el.strokeWidth / 2),
    disableMultiStroke: el.roughness === 0,
    disableMultiStrokeFill: el.roughness === 0,
    curveFitting: 0.95,
  };
};

const styleKey = (el: Element): string => `${el.seed}|${el.roughness}|${el.stroke}|${el.strokeWidth}|${el.fill}|${el.fillStyle}`;

const arrowHeadLines = (from: Point, to: Point, size: number): Point[][] => {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  return [
    [to, [to[0] - size * Math.cos(a - spread), to[1] - size * Math.sin(a - spread)]],
    [to, [to[0] - size * Math.cos(a + spread), to[1] - size * Math.sin(a + spread)]],
  ];
};

/** The rough paths of an element (not pens, text, images, frames). */
const paths = (el: Element): Cached | undefined => {
  let key: string;
  let make: (() => Drawable[]) | undefined;
  const o = roughOptions(el);
  switch (el.type) {
    case "rect":
      key = `${styleKey(el)}|r|${el.x},${el.y},${el.w},${el.h}`;
      make = () => [gen.rectangle(el.x, el.y, el.w, el.h, o)];
      break;
    case "ellipse":
      key = `${styleKey(el)}|e|${el.x},${el.y},${el.w},${el.h}`;
      make = () => [gen.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w, el.h, o)];
      break;
    case "diamond":
      key = `${styleKey(el)}|d|${el.x},${el.y},${el.w},${el.h}`;
      make = () => {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        return [gen.polygon([[cx, el.y], [el.x + el.w, cy], [cx, el.y + el.h], [el.x, cy]], o)];
      };
      break;
    case "line":
    case "arrow": {
      key = `${styleKey(el)}|l|${el.x},${el.y}|${el.points.map((p) => p.join(",")).join(";")}|${el.startHead}|${el.endHead}`;
      make = () => {
        const pts = el.points.map(([x, y]) => [x + el.x, y + el.y] as Point);
        const out: Drawable[] = [pts.length === 2 ? gen.line(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1], o) : gen.linearPath(pts, o)];
        const size = 10 + el.strokeWidth * 4;
        const head = (which: "start" | "end") => {
          const kind = which === "start" ? el.startHead : el.endHead;
          if (kind === "none" || pts.length < 2) return;
          const tip = which === "end" ? pts[pts.length - 1]! : pts[0]!;
          const prev = which === "end" ? pts[pts.length - 2]! : pts[1]!;
          if (kind === "arrow") for (const [a, b] of arrowHeadLines(prev, tip, size)) out.push(gen.line(a![0], a![1], b![0], b![1], o));
          else out.push(gen.ellipse(tip[0], tip[1], size * 0.7, size * 0.7, { ...o, fill: el.stroke, fillStyle: "solid" }));
        };
        head("start");
        head("end");
        return out;
      };
      break;
    }
    case "glyph": {
      key = `${styleKey(el)}|g|${el.glyph}|${el.x},${el.y},${el.w},${el.h}`;
      make = () => {
        const g = glyphById(el.glyph);
        if (!g) return [gen.rectangle(el.x, el.y, el.w, el.h, o)];
        const sx = el.w / 100, sy = el.h / 100;
        const X = (v: number) => el.x + v * sx, Y = (v: number) => el.y + v * sy;
        const fillO: Options = { ...o, fill: el.stroke, fillStyle: el.fillStyle === "none" ? "hachure" : el.fillStyle };
        const out: Drawable[] = [];
        for (const p of g.prims) {
          const po = p.k !== "line" && p.fill ? fillO : { ...o, fill: undefined, fillStyle: undefined };
          if (p.k === "rect") out.push(gen.rectangle(X(p.x), Y(p.y), p.w * sx, p.h * sy, po));
          else if (p.k === "ellipse") out.push(gen.ellipse(X(p.cx), Y(p.cy), p.w * sx, p.h * sy, po));
          else if (p.k === "line") out.push(gen.linearPath(p.pts.map(([x, y]) => [X(x), Y(y)] as Point), po));
          else out.push(gen.polygon(p.pts.map(([x, y]) => [X(x), Y(y)] as Point), po));
        }
        return out;
      };
      break;
    }
    default:
      return undefined;
  }
  const hit = cache.get(el.id);
  if (hit && hit.key === key) return hit;
  const c = fromDrawables(key, make());
  cache.set(el.id, c);
  if (cache.size > 4000) cache.delete(cache.keys().next().value!);
  return c;
};

/** Stroke a run of paths up to `progress` of their total length. */
const strokeRevealed = (ctx: CanvasRenderingContext2D, infos: PathInfo[], progress: number) => {
  const total = infos.reduce((n, i) => n + i.len, 0);
  let budget = progress >= 1 ? Infinity : total * progress;
  for (const i of infos) {
    if (budget <= 0) break;
    ctx.strokeStyle = i.stroke;
    ctx.lineWidth = i.strokeWidth;
    if (budget < i.len) ctx.setLineDash([budget, i.len + 10]);
    ctx.stroke(i.path);
    ctx.setLineDash([]);
    budget -= i.len;
  }
};

// ---- text --------------------------------------------------------------------

const measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
export const measureText = (text: string, font: FontFamily, size: number): { w: number; h: number } => {
  const lines = text.split("\n");
  if (!measureCtx) return { w: size * 10, h: lines.length * size * LINE_HEIGHT };
  measureCtx.font = fontFor(font, size);
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l || " ").width);
  return { w: Math.ceil(w) + 2, h: Math.ceil(lines.length * size * LINE_HEIGHT) };
};

// ---- images ------------------------------------------------------------------

const images = new Map<string, HTMLImageElement>();
let onImage: (() => void) | undefined;
/** Whoever renders live registers here, to repaint when a stamp's image arrives. */
export const setImageListener = (fn: () => void) => { onImage = fn; };
const image = (src: string): HTMLImageElement | undefined => {
  let im = images.get(src);
  if (!im) {
    im = new Image();
    im.src = src;
    im.onload = () => onImage?.();
    images.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : undefined;
};
/** Resolve once every image in the list can draw (the exporter waits on this). */
export const preloadImages = async (elements: Element[]): Promise<void> => {
  await Promise.all(elements.filter((e) => e.type === "image").map((e) => new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { images.set((e as { src: string }).src, im); res(); };
    im.onerror = () => res();
    im.src = (e as { src: string }).src;
  })));
};

// ---- pen ---------------------------------------------------------------------

const penPath = (pts: Point[], ox: number, oy: number): Path2D => {
  const p = new Path2D();
  if (!pts.length) return p;
  const [x0, y0] = pts[0]!;
  p.moveTo(x0 + ox, y0 + oy);
  if (pts.length === 1) p.lineTo(x0 + ox + 0.01, y0 + oy);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    p.quadraticCurveTo(a[0] + ox, a[1] + oy, (a[0] + b[0]) / 2 + ox, (a[1] + b[1]) / 2 + oy);
  }
  if (pts.length > 1) {
    const l = pts[pts.length - 1]!;
    p.lineTo(l[0] + ox, l[1] + oy);
  }
  return p;
};

// ---- the render --------------------------------------------------------------

export type RenderOptions = {
  /** Replay time (ms). Undefined = everything finished. */
  time?: number;
  timeline?: Timeline;
  /** Elements not to paint (the one being edited as text). */
  skip?: ReadonlySet<string>;
  /** Extra elements painted after the scene (the shape being dragged out). */
  extra?: Element[];
  background?: string | null;
  grid?: boolean;
  selection?: ReadonlySet<string>;
  marquee?: Rect;
  /** Present mode: the frame fades to a hint, no handles. */
  present?: boolean;
  /** Export: the frame isn't painted at all. */
  hideFrame?: boolean;
  frameLabel?: string;
};

export const drawElement = (ctx: CanvasRenderingContext2D, el: Element, progress: number, opts: RenderOptions = {}) => {
  if (progress <= 0) return;
  ctx.save();
  ctx.globalAlpha = el.opacity;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (el.type) {
    case "pen": {
      const n = progress >= 1 ? el.points.length : Math.max(1, Math.ceil(el.points.length * progress));
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.strokeWidth + 1;
      ctx.stroke(penPath(el.points.slice(0, n), el.x, el.y));
      break;
    }
    case "text": {
      ctx.font = fontFor(el.font, el.fontSize);
      ctx.fillStyle = el.stroke;
      ctx.textBaseline = "top";
      const shown = progress >= 1 ? el.text : el.text.slice(0, Math.ceil(el.text.length * progress));
      shown.split("\n").forEach((line, i) => ctx.fillText(line, el.x, el.y + i * el.fontSize * LINE_HEIGHT));
      break;
    }
    case "image": {
      const im = image(el.src);
      const k = 0.85 + 0.15 * progress;
      ctx.globalAlpha = el.opacity * progress;
      const w = el.w * k, h = el.h * k;
      const x = el.x + (el.w - w) / 2, y = el.y + (el.h - h) / 2;
      ctx.imageSmoothingEnabled = false;
      if (im) ctx.drawImage(im, x, y, w, h);
      else {
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x, y, w, h);
      }
      break;
    }
    case "frame": {
      if (opts.hideFrame) break;
      ctx.globalAlpha = opts.present ? 0.12 : 0.6;
      ctx.strokeStyle = "#dcb96f";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      if (!opts.present) {
        ctx.setLineDash([]);
        ctx.font = fontFor("sans", 12);
        ctx.fillStyle = "#dcb96f";
        ctx.textBaseline = "bottom";
        ctx.fillText(opts.frameLabel ?? el.format, el.x, el.y - 4);
      }
      break;
    }
    default: {
      const c = paths(el);
      if (!c) break;
      // Outline first, then the fill (as a hand would: draw it, then shade it).
      const hasFill = c.fills.length > 0 || c.hatch.length > 0;
      const outlineP = hasFill ? Math.min(1, progress / 0.65) : progress;
      const fillP = hasFill ? Math.max(0, (progress - 0.65) / 0.35) : 0;
      if (fillP > 0) {
        for (const f of c.fills) {
          ctx.globalAlpha = el.opacity * Math.min(1, fillP);
          ctx.fillStyle = f.fill!;
          ctx.fill(f.path);
        }
        ctx.globalAlpha = el.opacity;
        strokeRevealed(ctx, c.hatch, fillP);
      }
      strokeRevealed(ctx, c.outline, outlineP);
    }
  }
  ctx.restore();
};

export const render = (ctx: CanvasRenderingContext2D, size: Size, cam: Camera, elements: Element[], opts: RenderOptions = {}) => {
  const { w, h, dpr } = size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w * dpr, h * dpr);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w * dpr, h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (opts.grid) drawGrid(ctx, size, cam);

  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
  const beats = opts.timeline ? new Map(opts.timeline.beats.map((b) => [b.id, b])) : undefined;
  for (const el of elements) {
    if (opts.skip?.has(el.id)) continue;
    let progress = 1;
    if (opts.time !== undefined && isContent(el)) {
      const b = beats?.get(el.id);
      progress = b ? progressAt(b, opts.time) : 1;
    }
    drawElement(ctx, el, progress, opts);
  }
  for (const el of opts.extra ?? []) drawElement(ctx, el, 1, opts);

  // Overlays, in screen pixels.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (opts.selection?.size && !opts.present) {
    const sel = elements.filter((e) => opts.selection!.has(e.id));
    const rects = sel.map(bounds);
    ctx.strokeStyle = "#dcb96f";
    ctx.lineWidth = 1;
    for (const r of rects) {
      if (sel.length === 1) break;
      const [x, y] = toScreen(cam, [r.x, r.y]);
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x - 3, y - 3, r.w * cam.zoom + 6, r.h * cam.zoom + 6);
    }
    const all = union(rects);
    if (all) {
      const only = sel.length === 1 ? sel[0]! : undefined;
      const [x, y] = toScreen(cam, [all.x, all.y]);
      const sw = all.w * cam.zoom, sh = all.h * cam.zoom;
      ctx.setLineDash([]);
      ctx.strokeRect(x - 4, y - 4, sw + 8, sh + 8);
      ctx.fillStyle = "#241708";
      if (only && (only.type === "line" || only.type === "arrow")) {
        for (const p of only.points) {
          const [px, py] = toScreen(cam, [p[0] + only.x, p[1] + only.y]);
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (!only || only.type !== "pen") {
        for (const hnd of HANDLES) {
          const [px, py] = toScreen(cam, handlePoint(all, hnd));
          ctx.fillRect(px - 4, py - 4, 8, 8);
          ctx.strokeRect(px - 4, py - 4, 8, 8);
        }
      }
    }
  }
  if (opts.marquee) {
    const [x, y] = toScreen(cam, [opts.marquee.x, opts.marquee.y]);
    ctx.fillStyle = "rgba(220,185,111,0.08)";
    ctx.strokeStyle = "rgba(220,185,111,0.6)";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, opts.marquee.w * cam.zoom, opts.marquee.h * cam.zoom);
    ctx.strokeRect(x, y, opts.marquee.w * cam.zoom, opts.marquee.h * cam.zoom);
  }
};

const drawGrid = (ctx: CanvasRenderingContext2D, size: Size, cam: Camera) => {
  let step = 40;
  while (step * cam.zoom < 18) step *= 2;
  const s = step * cam.zoom;
  const ox = ((-cam.x * cam.zoom) % s + s) % s;
  const oy = ((-cam.y * cam.zoom) % s + s) % s;
  ctx.fillStyle = "rgba(220,185,111,0.16)";
  for (let x = ox; x < size.w; x += s) for (let y = oy; y < size.h; y += s) ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
};

/** Camera that shows `rect` inside a `w`×`h` view with some air around it. */
export const cameraFor = (rect: Rect, w: number, h: number, pad = 0.08): Camera => {
  const zoom = Math.min(w / (rect.w * (1 + pad * 2) || 1), h / (rect.h * (1 + pad * 2) || 1), 4);
  return { zoom, x: rect.x + rect.w / 2 - w / zoom / 2, y: rect.y + rect.h / 2 - h / zoom / 2 };
};

export const dropCache = (id: string) => cache.delete(id);
