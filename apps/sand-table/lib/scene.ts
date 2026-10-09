/**
 * The Sand Table's scene: what's on the board, and the order it was drawn
 * in. Pure types and functions only (the browser bundle imports this file;
 * nothing here may touch node:fs).
 *
 * Every element carries `t` (when it was drawn, epoch ms) and `dur` (how
 * long drawing it took). That is what makes a scene replayable: `timeline()`
 * turns the elements into beats, so a scene drawn slowly over an afternoon
 * plays back as one tidy clip.
 */
export type Point = [number, number];
export type FillStyle = "none" | "hachure" | "solid" | "cross-hatch";
export type FontFamily = "cinzel" | "hand" | "sans";
export type Arrowhead = "none" | "arrow" | "dot";
export type FormatId = "vertical" | "square" | "landscape";

export type Style = {
  stroke: string;
  strokeWidth: number;
  fill: string;
  fillStyle: FillStyle;
  /** 0 = ruler-straight, 1 = hand-drawn, 2 = scrawled. */
  roughness: number;
  opacity: number;
  font: FontFamily;
  fontSize: number;
  startHead: Arrowhead;
  endHead: Arrowhead;
};

type Base = Style & {
  id: string;
  x: number;
  y: number;
  /** Fixes the rough rendering so a shape never jitters between frames. */
  seed: number;
  /** Drawn at (epoch ms) — the replay order. */
  t: number;
  /** Drawing it took this long (ms): real for pen strokes, nominal otherwise. */
  dur: number;
};

export type BoxType = "rect" | "ellipse" | "diamond";
export type BoxEl = Base & { type: BoxType; w: number; h: number };
export type LineEl = Base & { type: "line" | "arrow"; points: Point[] };
export type PenEl = Base & { type: "pen"; points: Point[] };
export type TextEl = Base & { type: "text"; text: string; w: number; h: number };
export type ImageEl = Base & { type: "image"; src: string; w: number; h: number };
export type GlyphEl = Base & { type: "glyph"; glyph: string; w: number; h: number };
/** The export's picture area. One per scene at most; never drawn in a clip. */
export type FrameEl = Base & { type: "frame"; w: number; h: number; format: FormatId };

export type Element = BoxEl | LineEl | PenEl | TextEl | ImageEl | GlyphEl | FrameEl;
export type ElementType = Element["type"];

export type Scene = {
  version: 1;
  name: string;
  elements: Element[];
  /** Where the view was last time, so a scene opens where you left it. */
  camera: { x: number; y: number; zoom: number };
  updatedAt: string;
};

export const SCENE_VERSION = 1;

export const FORMATS: Record<FormatId, { label: string; w: number; h: number }> = {
  vertical: { label: "Vertical 9:16", w: 1080, h: 1920 },
  square: { label: "Square 1:1", w: 1080, h: 1080 },
  landscape: { label: "Landscape 16:9", w: 1920, h: 1080 },
};

export const DEFAULT_STYLE: Style = {
  stroke: "#f2e9d4",
  strokeWidth: 2,
  fill: "transparent",
  fillStyle: "hachure",
  roughness: 1,
  opacity: 1,
  font: "hand",
  fontSize: 28,
  startHead: "none",
  endHead: "arrow",
};

export const newScene = (name: string): Scene => ({ version: SCENE_VERSION, name, elements: [], camera: { x: 0, y: 0, zoom: 1 }, updatedAt: new Date().toISOString() });

export const uid = (): string => Math.random().toString(36).slice(2, 10);
export const seed = (): number => Math.floor(Math.random() * 2 ** 31);

/** Elements that take part in a replay / export (the frame is a guide, not content). */
export const isContent = (el: Element): boolean => el.type !== "frame";

/** True for the kinds that are a box: have w/h and resize from eight handles. */
export const isBox = (el: Element): el is BoxEl | TextEl | ImageEl | GlyphEl | FrameEl => "w" in el;
export const hasPoints = (el: Element): el is LineEl | PenEl => "points" in el;

// ---- replay timeline -------------------------------------------------------

export type Beat = { id: string; start: number; end: number };
export type Timeline = { beats: Beat[]; total: number };

export type TimelineOptions = {
  /** Silence between two elements is never longer than this (ms). */
  maxGap: number;
  /** Nor shorter — a breath between strokes. */
  minGap: number;
  /** Still frames before the first stroke / after the last (ms). */
  lead: number;
  tail: number;
};

export const TIMELINE_DEFAULTS: TimelineOptions = { maxGap: 450, minGap: 80, lead: 400, tail: 1200 };

/** How long an element takes to appear in the replay, regardless of how long it really took. */
export const nominalDuration = (el: Element): number => {
  switch (el.type) {
    case "pen":
      return Math.max(150, Math.min(el.dur || 0, 6000));
    case "text":
      return Math.max(300, Math.min(el.text.length * 45, 4000));
    case "image":
    case "glyph":
      return 350;
    case "line":
    case "arrow": {
      const len = pathLength(el.points);
      return Math.max(250, Math.min(250 + len * 1.2, 1500));
    }
    case "rect":
    case "ellipse":
    case "diamond": {
      const per = 2 * (Math.abs(el.w) + Math.abs(el.h));
      return Math.max(350, Math.min(300 + per * 0.8, 1800));
    }
    case "frame":
      return 0;
  }
};

const pathLength = (pts: Point[]): number => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    n += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return n;
};

/**
 * Lay the content out in time, in the order it was drawn. Real pauses are
 * kept but clamped into [minGap, maxGap], so the replay has the rhythm of
 * the drawing without the thinking time.
 */
export const timeline = (elements: Element[], opts: Partial<TimelineOptions> = {}): Timeline => {
  const o = { ...TIMELINE_DEFAULTS, ...opts };
  const els = elements.filter(isContent).slice().sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  const beats: Beat[] = [];
  let cursor = o.lead;
  let prevRealEnd: number | undefined;
  for (const el of els) {
    if (prevRealEnd !== undefined) {
      const realGap = el.t - prevRealEnd;
      cursor += Math.min(o.maxGap, Math.max(o.minGap, realGap));
    }
    const d = nominalDuration(el);
    beats.push({ id: el.id, start: cursor, end: cursor + d });
    cursor += d;
    prevRealEnd = el.t + (el.dur || 0);
  }
  return { beats, total: beats.length ? cursor + o.tail : 0 };
};

/** 0 before an element starts, 1 once it is finished, in between while it's being drawn. */
export const progressAt = (beat: Beat, time: number): number => {
  if (time <= beat.start) return 0;
  if (time >= beat.end) return 1;
  return (time - beat.start) / (beat.end - beat.start);
};
