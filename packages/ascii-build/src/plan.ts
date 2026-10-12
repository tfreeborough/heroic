/**
 * The build schedule: which glyph goes where, when it sets off, when it
 * lands, and (for a loop) when it leaves again. Pure data from a seed, so
 * any frame can be drawn on its own and a render is repeatable.
 */
import { type Ink, sampleGrid } from "./ink";
import { type Look, mulberry } from "./look";

/** How a glyph gets to its cell. Each has the fill order it looks best with. */
export const ARRIVALS = {
  rain: { label: "Rain", order: "ground" },
  pop: { label: "Pop", order: "centre" },
  fade: { label: "Fade", order: "detail" },
  decode: { label: "Decode", order: "top" },
  converge: { label: "Converge", order: "random" },
  sides: { label: "From the sides", order: "edges" },
} as const satisfies Record<string, { label: string; order: string }>;
export type Arrival = keyof typeof ARRIVALS;

/** Which part of the picture fills in first. */
export const ORDERS = {
  ground: "Ground up",
  top: "Top down",
  random: "Random",
  centre: "Centre out",
  edges: "Edges in",
  sweep: "Left → right",
  detail: "Faint → bright",
} as const;
export type Order = keyof typeof ORDERS;

export const RAMP = " .:-=+*#%@";
export const NOISE = "01<>/\\|=+*#%&$@{}[]";

/** A look seed's shuffle: the arrival and fill order it picks. Same seed, same pair
 * (the same draw the Save template makes for "shuffle"). */
export const lookFromSeed = (seed: number): { arrival: Arrival; order: Order } => {
  const r = mulberry(seed * 31 + 5);
  const arrivals = Object.keys(ARRIVALS) as Arrival[];
  const orders = Object.keys(ORDERS) as Order[];
  const arrival = arrivals[Math.floor(r() * arrivals.length)]!;
  return { arrival, order: orders[Math.floor(r() * orders.length)]! };
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Cell = {
  gx: number;
  gy: number;
  /** Resting brightness 0..1. */
  v: number;
  ch: string;
  /** Resting top-left. */
  x: number;
  y: number;
  /** Where it sets off from (rain, converge, sides). */
  x0: number;
  y0: number;
  release: number;
  land: number;
  /** When it drops away in the exit (Infinity without one). */
  leave: number;
  seed: number;
};

export type Build = {
  cells: Cell[];
  /** Cells sorted by landing time, for baking. */
  byLand: Cell[];
  /** Sorted landing times, for progress and ticks. */
  landTimes: Float64Array;
  /** The picture's rectangle (the image fitted inside the box). */
  pic: Rect;
  frame: { w: number; h: number };
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  fontPx: number;
  arrival: Arrival;
  exit?: { start: number; end: number };
  ink: Ink;
  look: Look;
};

export type PlanOptions = {
  ink: Ink;
  look: Look;
  /** Where the picture may go; it's fitted inside, keeping its shape. */
  box: Rect;
  /** The whole canvas (glyphs fly in from beyond the picture). */
  frame: { w: number; h: number };
  /** Seconds: the first glyph sets off at `start`, the last about at `end`. */
  start: number;
  end: number;
  seed: number;
  arrival: Arrival;
  order: Order;
  /** For a loop: everything drops away between these times. */
  exit?: { start: number; end: number };
  /** A fast start: `share` of the glyphs set off in the first `seconds`, then
   * the rest at the steady pace (a hook for the first second of a feed). */
  burst?: { share: number; seconds: number };
};

/** How long a fallen glyph takes to fade out of the exit. */
export const LEAVE_FALL = 0.9;

export const planBuild = (o: PlanOptions): Build => {
  const { ink, look, box, frame } = o;
  const aspect = ink.w / ink.h;
  const pw = Math.min(box.w, box.h * aspect), ph = pw / aspect;
  const pic = { x: box.x + (box.w - pw) / 2, y: box.y + (box.h - ph) / 2, w: pw, h: ph };
  const cols = look.cols;
  const cw = pic.w / cols, ch = cw / 0.6;
  const rows = Math.floor(pic.h / ch);
  const grid = sampleGrid(ink, cols, rows, look);
  const rnd = mulberry(o.seed);
  const cx = cols / 2, cy = rows / 2, rMax = Math.hypot(cx, cy * 1.66);

  const cells: (Cell & { key: number })[] = [];
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    const v = grid[gy * cols + gx]!;
    if (v <= 0) continue;
    const r = Math.hypot(gx - cx, (gy - cy) * 1.66) / rMax;
    const j = rnd();
    // Every key is roughly 0..1 plus a ragged edge so fronts never look ruled.
    const key = {
      ground: (rows - gy) / rows + j * 0.06,
      top: gy / rows + j * 0.06,
      random: j,
      centre: r + j * 0.08,
      edges: 1 - r + j * 0.08,
      sweep: gx / cols + j * 0.06,
      detail: v + j * 0.35,
    }[o.order];
    const x = pic.x + gx * cw, y = pic.y + gy * ch;
    cells.push({ gx, gy, v, ch: RAMP[Math.max(1, Math.round(v * (RAMP.length - 1)))]!, x, y, x0: x, y0: y, release: 0, land: 0, leave: Infinity, seed: 0, key });
  }
  cells.sort((a, b) => a.key - b.key);

  const span = (o.end - o.start) * 0.97;
  const burst = o.burst && o.burst.share > 0 && o.burst.share < 1 && o.burst.seconds < span ? o.burst : null;
  const releaseAt = (q: number) =>
    !burst ? q * span
    : q < burst.share ? (q / burst.share) * burst.seconds
    : burst.seconds + ((q - burst.share) / (1 - burst.share)) * (span - burst.seconds);
  cells.forEach((c, i) => {
    c.release = o.start + releaseAt(i / cells.length);
    c.seed = i + o.seed * 7919;
    let dur: number;
    switch (o.arrival) {
      case "rain":
        c.y0 = -40 - rnd() * 260;
        dur = (c.y - c.y0) / (1300 + rnd() * 900);
        break;
      case "converge": {
        const a = rnd() * Math.PI * 2, reach = Math.hypot(frame.w, frame.h) * 0.6;
        c.x0 = frame.w / 2 + Math.cos(a) * reach;
        c.y0 = frame.h / 2 + Math.sin(a) * reach;
        dur = 0.55 + rnd() * 0.45;
        break;
      }
      case "sides":
        c.x0 = c.gx < cols / 2 ? -60 - rnd() * 200 : frame.w + 60 + rnd() * 200;
        dur = 0.45 + rnd() * 0.35;
        break;
      case "decode": dur = 0.35 + rnd() * 0.7; break;
      case "fade": dur = 0.5 + rnd() * 0.4; break;
      default: dur = 0.28 + rnd() * 0.12; // pop
    }
    c.land = c.release + dur;
  });

  if (o.exit) {
    // Leave in a loose random order, all gone (fallen and faded) by exit.end.
    const window = Math.max(0.1, o.exit.end - o.exit.start - LEAVE_FALL);
    for (const c of cells) c.leave = o.exit.start + Math.pow(rnd(), 0.8) * window;
  }

  const byLand = [...cells].sort((a, b) => a.land - b.land);
  return {
    cells, byLand, landTimes: Float64Array.from(byLand, (c) => c.land),
    pic, frame, cols, rows, cw, ch, fontPx: ch * 0.92, arrival: o.arrival, exit: o.exit, ink, look,
  };
};

/** How many glyphs have landed by `t`. */
export const landedCount = (b: Build, t: number) => {
  let lo = 0, hi = b.landTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b.landTimes[mid]! <= t) lo = mid + 1; else hi = mid;
  }
  return lo;
};

/** 0..1: how much of the picture is in place (the save bar). */
export const progress = (b: Build, t: number) => (b.landTimes.length ? landedCount(b, t) / b.landTimes.length : 1);
