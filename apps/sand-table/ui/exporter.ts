/**
 * Replay → clip. Paints every frame of the replay into an offscreen canvas
 * at the chosen format, posts each to the server, and asks it to stitch
 * them. Deterministic: no screen recorder, no dropped frames.
 */
import { type Rect, bounds, union } from "../lib/geometry";
import { type Element, type FormatId, FORMATS, isContent, timeline } from "../lib/scene";
import { api } from "./api";
import { type Camera, preloadImages, render } from "./render";

/** The world rect a clip shows: the frame if there is one, else the drawing with air round it, squared up to the format. */
export const exportRect = (elements: Element[], format: FormatId): Rect => {
  const f = FORMATS[format];
  const aspect = f.w / f.h;
  const frame = elements.find((e) => e.type === "frame");
  let r: Rect = frame ? bounds(frame) : union(elements.filter(isContent).map(bounds)) ?? { x: 0, y: 0, w: f.w, h: f.h };
  if (!frame) {
    const pad = Math.max(r.w, r.h) * 0.1 + 40;
    r = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  }
  // Letterbox to the format's aspect, centred.
  if (r.w / r.h > aspect) {
    const h = r.w / aspect;
    r = { ...r, y: r.y + (r.h - h) / 2, h };
  } else {
    const w = r.h * aspect;
    r = { ...r, x: r.x + (r.w - w) / 2, w };
  }
  return r;
};

export const cameraForRect = (r: Rect, w: number, h: number): Camera => {
  const zoom = Math.min(w / r.w, h / r.h);
  return { zoom, x: r.x + r.w / 2 - w / zoom / 2, y: r.y + r.h / 2 - h / zoom / 2 };
};

export type ExportOptions = {
  game: string;
  name: string;
  elements: Element[];
  format: FormatId;
  fps: number;
  transparent: boolean;
  background: string;
  /** Replay speed: 2 = twice as fast as the timeline. */
  speed: number;
  onProgress: (done: number, total: number) => void;
  signal?: AbortSignal;
};

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no frame"))), type, quality));

export const exportClip = async (o: ExportOptions): Promise<string> => {
  const f = FORMATS[o.format];
  const tl = timeline(o.elements);
  const total = tl.total / o.speed;
  const frames = Math.max(1, Math.ceil((total / 1000) * o.fps));
  await preloadImages(o.elements);
  const c = document.createElement("canvas");
  c.width = f.w;
  c.height = f.h;
  const ctx = c.getContext("2d")!;
  const cam = cameraForRect(exportRect(o.elements, o.format), f.w, f.h);
  const job = await api.startExport(o.game, { name: o.name, width: f.w, height: f.h, fps: o.fps, transparent: o.transparent });
  try {
    for (let n = 0; n < frames; n++) {
      if (o.signal?.aborted) throw new Error("stopped");
      render(ctx, { w: f.w, h: f.h, dpr: 1 }, cam, o.elements, { time: (n / o.fps) * 1000 * o.speed, timeline: tl, hideFrame: true, background: o.transparent ? null : o.background });
      const blob = o.transparent ? await toBlob(c, "image/png") : await toBlob(c, "image/jpeg", 0.93);
      await api.frame(o.game, job.id, n, blob);
      o.onProgress(n + 1, frames);
    }
    const done = await api.finishExport(o.game, job.id);
    return done.file!;
  } catch (e) {
    await api.abandonExport(o.game, job.id).catch(() => {});
    throw e;
  }
};

/** One finished picture of the drawing at the format, as a PNG in out/. */
export const exportStill = async (o: Pick<ExportOptions, "game" | "name" | "elements" | "format" | "transparent" | "background">): Promise<string> => {
  const f = FORMATS[o.format];
  await preloadImages(o.elements);
  const c = document.createElement("canvas");
  c.width = f.w;
  c.height = f.h;
  const ctx = c.getContext("2d")!;
  render(ctx, { w: f.w, h: f.h, dpr: 1 }, cameraForRect(exportRect(o.elements, o.format), f.w, f.h), o.elements, { hideFrame: true, background: o.transparent ? null : o.background });
  const r = await api.still(o.game, o.name, await toBlob(c, "image/png"));
  return r.file;
};
