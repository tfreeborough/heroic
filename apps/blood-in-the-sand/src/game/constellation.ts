/**
 * The Constellation finisher — CATASTERISM (bits-cosmetics.md): the Greeks'
 * word for a fallen hero being set among the stars. The kill is written into
 * the sky, and then into the sand.
 *
 * The beats (a finisher is a little piece of theatre — Smite and
 * Butterflies taught that the ones that feel premium have a clear sequence):
 *
 *   0.00s  THE SKY OPENS  a disc of night blooms in the sand under the body
 *   0.06s  THE DRAWING    stars ignite one by one from the figure's heart
 *                         outward, each under a flare, and a line of light
 *                         runs from star to star just ahead of them —
 *                         connect-the-dots, drawn by an unseen hand
 *   0.50s  THE HOLD       the finished figure breathes
 *   0.80s  THE ASCENT     every star flares at once and the figure RISES
 *                         toward the camera, growing and fading, as the sky
 *                         closes behind it
 *   1.35s  THE ETCHING    what's left: the same figure, small and dark, cut
 *                         into the sand for the rest of the match (baked into
 *                         the splat map — the scorch-star handoff)
 *
 * Four figures, picked per kill: THE GLADIATOR (an Orion: shoulders, a belt
 * of three, a raised sword, a shield), THE GLADIUS, THE SCORPION (its tail
 * curls round to the stinger last) and THE EAGLE (the legion's standard —
 * both wings spread outward together).
 *
 * Built to the rules the blood prototypes paid for:
 *  - LIGHT NEEDS DARK. Pale stars vanish on this sand, so the night disc is
 *    the first thing on stage and everything bright sits over it. It draws in
 *    the GROUND pass — under the bodies — so a fight on top of it stays
 *    readable; only the stars and lines are in the air.
 *  - Motion is per-frame and closed-form (age in → picture out). Nothing
 *    random after spawn, nothing simulated.
 *  - PERF: one drawAtlas for every star, flare and pinprick; the night (a
 *    core + 9 lobes) and its two nebula clouds are unit radial gradients
 *    built once, ~10 scaled circles a frame; lines
 *    are ≤ ~12 drawLine pairs while drawing, then one prebuilt path. No blur,
 *    no saveLayer, no per-frame paths.
 */
import {
  BlendMode,
  PaintStyle,
  Skia,
  StrokeCap,
  TileMode,
  vec,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkPath,
  type SkRect,
  type SkRSXform,
} from "@shopify/react-native-skia";
import { starPath } from "./starArt";

// ── Timeline (ms) ───────────────────────────────────────────────────────────
// Tempo (Tom, 2026-09-20): the first cut ran 2.7s — "too slow… we don't want
// finishers distracting from the arena combat". Same beats at twice the pace:
// the figure is now drawn as one quick ripple (~0.45s), held for a breath,
// and gone by 1.35s.
const OPEN_MS = 170;
const DRAW_START_MS = 60;
const STAR_STEP_MS = 42;
const LINE_MS = 70;
const IGNITE_MS = 220;
/** A star pops to size over this long as it ignites. */
const STAR_POP_MS = 140;
const ASCEND_AT_MS = 800;
const ASCEND_MS = 550;
/** The shared flare as the ascent begins. */
const BURST_MS = 260;
export const CONSTELLATION_LIFE_MS = ASCEND_AT_MS + ASCEND_MS;

/** World px: the night disc, and the figure's unit scale inside it. */
const SKY_R = 128;
const FIGURE_R = 84;
/** The etching left behind is the figure again, this much smaller. */
const ETCH_SCALE = 0.4;
const ETCH_ALPHA = 0.6;

// ── Figures: unit coords (y down, drawn upright), star = [x, y, magnitude].
// `order` is the ignition order; every edge lands on a star already lit or
// lighting, so the line always ARRIVES somewhere.
interface Figure {
  stars: readonly (readonly [number, number, number])[];
  order: readonly number[];
  edges: readonly (readonly [number, number])[];
}
const GLADIATOR: Figure = {
  stars: [
    [0.02, -0.86, 0.7], // 0 head
    [-0.4, -0.56, 1.0], // 1 left shoulder — the bright one
    [0.38, -0.52, 0.8], // 2 right shoulder
    [-0.15, -0.02, 0.7], // 3 belt
    [0.0, 0.02, 0.78], // 4 belt, the heart
    [0.15, 0.07, 0.7], // 5 belt
    [-0.34, 0.74, 0.8], // 6 left foot
    [0.42, 0.68, 1.0], // 7 right foot — the other bright one
    [0.7, -0.74, 0.62], // 8 sword hand, raised
    [0.84, -1.04, 0.55], // 9 sword tip
    [-0.8, -0.2, 0.62], // 10 shield
  ],
  order: [4, 3, 5, 1, 2, 0, 6, 7, 10, 8, 9],
  edges: [[4, 3], [4, 5], [3, 1], [5, 2], [1, 2], [1, 0], [2, 0], [3, 6], [5, 7], [1, 10], [2, 8], [8, 9]],
};
const GLADIUS: Figure = {
  stars: [
    [0, 1.0, 0.7], // 0 pommel
    [0, 0.72, 0.6], // 1 grip
    [0, 0.5, 0.85], // 2 guard, middle
    [-0.4, 0.52, 0.7], // 3 guard
    [0.4, 0.52, 0.7], // 4 guard
    [0, 0.05, 0.7], // 5 blade
    [0, -0.45, 0.75], // 6 blade
    [0, -1.0, 1.0], // 7 the point
    [-0.55, -0.5, 0.5], // 8 a loose star either side, for company
    [0.6, -0.15, 0.5], // 9
  ],
  order: [2, 3, 4, 1, 0, 5, 6, 7, 8, 9],
  edges: [[2, 3], [2, 4], [2, 1], [1, 0], [2, 5], [5, 6], [6, 7]],
};
// (A LAUREL wreath was the third figure in the first cut — Tom, on device:
// "a bit boring… it just looks like a circle". A figure needs a SILHOUETTE
// and a drawing that goes somewhere; a ring has neither.)
const SCORPION: Figure = {
  // Scorpius: claws up and to the right, the heart, then the long tail that
  // curls back round to the stinger — drawn LAST, so the figure ends on it.
  stars: [
    [0.34, -0.94, 0.6], // 0 claw
    [0.86, -0.6, 0.6], // 1 claw
    [0.46, -0.48, 0.8], // 2 head
    [0.2, -0.14, 1.0], // 3 the heart — Antares, the bright one
    [0.0, 0.16, 0.7], // 4 body
    [-0.15, 0.46, 0.7], // 5 body
    [-0.4, 0.72, 0.7], // 6 tail
    [-0.72, 0.76, 0.7], // 7 tail
    [-0.95, 0.5, 0.7], // 8 the curl
    [-0.9, 0.17, 0.65], // 9 the curl
    [-0.67, 0.03, 0.92], // 10 the stinger
  ],
  order: [3, 2, 0, 1, 4, 5, 6, 7, 8, 9, 10],
  edges: [[3, 2], [2, 0], [2, 1], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10]],
};
const EAGLE: Figure = {
  // Aquila, the legion's standard: the breast first, then both wings drawn
  // outward together — the figure SPREADS.
  stars: [
    [0, -0.78, 0.8], // 0 head
    [0, -0.3, 1.0], // 1 breast — the bright one
    [0, 0.5, 0.7], // 2 tail
    [-0.22, 0.86, 0.55], // 3 tail fan
    [0.22, 0.86, 0.55], // 4 tail fan
    [-0.4, -0.48, 0.7], // 5 left wing
    [-0.76, -0.34, 0.7], // 6
    [-1.0, 0.08, 0.85], // 7 left wingtip
    [0.4, -0.48, 0.7], // 8 right wing
    [0.76, -0.34, 0.7], // 9
    [1.0, 0.08, 0.85], // 10 right wingtip
  ],
  order: [1, 0, 5, 8, 6, 9, 7, 10, 2, 3, 4],
  edges: [[1, 0], [1, 5], [1, 8], [5, 6], [8, 9], [6, 7], [9, 10], [1, 2], [2, 3], [2, 4]],
};
const FIGURES = [GLADIATOR, GLADIUS, SCORPION, EAGLE];

// ── Art ─────────────────────────────────────────────────────────────────────
const CELL = 64;
const ART_R = 28; // the star's reach inside its cell
const SRC_STAR = Skia.XYWHRect(0, 0, CELL, CELL);
const SRC_FLARE = Skia.XYWHRect(CELL, 0, CELL, CELL);
const SRC_PRICK = Skia.XYWHRect(CELL * 2, 0, CELL, CELL);

let atlas: SkImage | null = null;
let atlasFailed = false;
const ensureAtlas = (): SkImage | null => {
  if (atlas || atlasFailed) return atlas;
  const surface = Skia.Surface.Make(CELL * 3, CELL);
  if (!surface) {
    atlasFailed = true; // → the lines and the sky still draw; the stars don't
    return null;
  }
  const c = surface.getCanvas();
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const radial = (cx: number, r: number, stops: [string, number][]): void => {
    p.setShader(
      Skia.Shader.MakeRadialGradient(
        vec(cx, CELL / 2),
        r,
        stops.map(([col]) => Skia.Color(col)),
        stops.map(([, at]) => at),
        TileMode.Clamp,
      ),
    );
    c.drawCircle(cx, CELL / 2, r, p);
    p.setShader(null);
  };
  // A star: a violet-white halo under a hard white four-point.
  radial(CELL * 0.5, 24, [
    ["rgba(220, 204, 255, 0.9)", 0],
    ["rgba(170, 130, 255, 0.3)", 0.5],
    ["rgba(170, 130, 255, 0)", 1],
  ]);
  p.setColor(Skia.Color("#ffffff"));
  c.drawPath(starPath(CELL * 0.5, CELL / 2, ART_R), p);
  c.drawCircle(CELL * 0.5, CELL / 2, 5, p);
  // The flare: a bigger, softer burst.
  radial(CELL * 1.5, 30, [
    ["rgba(255, 255, 255, 0.95)", 0],
    ["rgba(210, 190, 255, 0.5)", 0.35],
    ["rgba(170, 130, 255, 0)", 1],
  ]);
  c.drawPath(starPath(CELL * 1.5, CELL / 2, 31), p);
  // A pinprick for the background field.
  radial(CELL * 2.5, 14, [
    ["rgba(255, 255, 255, 1)", 0],
    ["rgba(200, 184, 255, 0.35)", 0.45],
    ["rgba(200, 184, 255, 0)", 1],
  ]);
  atlas = surface.makeImageSnapshot();
  return atlas;
};

const unitGradient = (stops: [string, number][]) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(0, 0),
      1,
      stops.map(([col]) => Skia.Color(col)),
      stops.map(([, at]) => at),
      TileMode.Clamp,
    ),
  );
  return p;
};
/** The night is a CLOUD, not a disc (Tom, on device: the first cut's single
 *  radial "looks a bit too perfect… less circle-y"). It's a core plus a ring
 *  of LOBES, all the same soft unit gradient at different sizes — dark
 *  overlapping dark is seamless, so they melt into one ragged-edged patch of
 *  sky, different on every kill. Near-opaque at the heart so the stars have
 *  something to burn against; the violet lives only in the soft outer
 *  falloff, so where lobes overlap there are no rings, just deeper night. */
const skyPaint = unitGradient([
  ["rgba(5, 3, 22, 0.92)", 0],
  ["rgba(10, 7, 46, 0.88)", 0.5],
  ["rgba(34, 20, 116, 0.6)", 0.76],
  ["rgba(112, 74, 226, 0.22)", 0.9],
  ["rgba(140, 94, 250, 0)", 1],
]);
/** The lobes are smokier than the core — no solid heart of their own, so
 *  they read as the sky's ragged EDGE, not as a bunch of separate dark balls
 *  (which is what the first lobed cut looked like in the preview). */
const lobePaint = unitGradient([
  ["rgba(7, 4, 32, 0.86)", 0],
  ["rgba(18, 11, 78, 0.64)", 0.46],
  ["rgba(62, 38, 168, 0.28)", 0.78],
  ["rgba(126, 84, 240, 0)", 1],
]);
/** The core's share of SKY_R — the lobes make up (and break up) the rest. */
const SKY_CORE = 0.8;
const magentaPaint = unitGradient([
  ["rgba(232, 80, 214, 0.5)", 0],
  ["rgba(232, 80, 214, 0)", 1],
]);
const tealPaint = unitGradient([
  ["rgba(52, 214, 224, 0.42)", 0],
  ["rgba(52, 214, 224, 0)", 1],
]);

const linePaint = Skia.Paint();
linePaint.setAntiAlias(true);
linePaint.setStyle(PaintStyle.Stroke);
linePaint.setStrokeCap(StrokeCap.Round);
const etchFill = Skia.Paint();
etchFill.setAntiAlias(true);
const C_LINE_BACK = Skia.Color("#0c0738");
const C_LINE = Skia.Color("#e4d9ff");
const C_ETCH = Skia.Color("#1b1150");
const atlasPaint = Skia.Paint();
atlasPaint.setAntiAlias(true);

// drawAtlas scratch — persistent, truncated per call (the crowd.ts diet).
const srcs: SkRect[] = [];
const dsts: SkRSXform[] = [];
const cols: SkColor[] = [];
const white = (a: number): SkColor => Float32Array.of(1, 1, 1, Math.max(0, Math.min(1, a)));
const xform = (radius: number, x: number, y: number, rad = 0): SkRSXform =>
  Skia.RSXformFromRadians(radius / ART_R, rad, x, y, CELL / 2, CELL / 2);

const easeOutBack = (t: number): number => {
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u;
};

/** The etching a constellation leaves — render.ts bakes it once it's cold. */
export interface ConstellationEtch {
  x: number;
  y: number;
  lines: SkPath;
  dots: SkPath;
}
export const stampEtch = (canvas: SkCanvas, e: ConstellationEtch, alpha = 1): void => {
  if (alpha <= 0) return;
  linePaint.setColor(C_ETCH);
  linePaint.setAlphaf(ETCH_ALPHA * alpha);
  linePaint.setStrokeWidth(1.3);
  canvas.drawPath(e.lines, linePaint);
  etchFill.setColor(C_ETCH);
  etchFill.setAlphaf(Math.min(1, ETCH_ALPHA * 1.3 * alpha));
  canvas.drawPath(e.dots, etchFill);
};

export class Constellation {
  readonly etch: ConstellationEtch;
  private readonly figure: Figure;
  /** Star → when it ignites (ms after spawn). */
  private readonly litAt: number[] = [];
  /** The finished figure's lines in LOCAL coords — one path once it's drawn. */
  private readonly lines: SkPath;
  /** Background pinpricks: [x, y, radius, alpha], local coords. */
  private readonly field: [number, number, number, number][] = [];
  /** The sky's lobes, unit-of-SKY_R: [x, y, radius, open-delay ms]. */
  private readonly lobes: [number, number, number, number][] = [];
  /** The whole cloud is a little squashed and turned — never a true round. */
  private readonly skew: [number, number, number];
  private readonly tilt: number;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {
    this.figure = FIGURES[Math.floor(Math.random() * FIGURES.length)]!;
    // A few degrees off true — a figure in the sky is never quite square.
    this.tilt = (Math.random() - 0.5) * 0.3;
    this.figure.order.forEach((star, i) => {
      this.litAt[star] = DRAW_START_MS + i * STAR_STEP_MS;
    });
    const lb = Skia.PathBuilder.Make();
    const eb = Skia.PathBuilder.Make();
    const db = Skia.PathBuilder.Make();
    for (const [a, b] of this.figure.edges) {
      const p = this.at(a);
      const q = this.at(b);
      lb.moveTo(p[0], p[1]).lineTo(q[0], q[1]);
      eb.moveTo(x + p[0] * ETCH_SCALE, y + p[1] * ETCH_SCALE).lineTo(x + q[0] * ETCH_SCALE, y + q[1] * ETCH_SCALE);
    }
    this.figure.stars.forEach((s, i) => {
      const p = this.at(i);
      db.addCircle(x + p[0] * ETCH_SCALE, y + p[1] * ETCH_SCALE, 1.4 + s[2] * 1.5);
    });
    this.lines = lb.detach();
    this.etch = { x, y, lines: eb.detach(), dots: db.detach() };
    // Lobes: stratified round the rim so no side is left bald, each its own
    // size and reach — a couple of big shoulders, some small wisps.
    const n = 9;
    const spin = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = spin + ((i + (Math.random() - 0.5) * 0.7) / n) * Math.PI * 2;
      const size = 0.4 + Math.random() * Math.random() * 0.34;
      const reach = 0.44 + Math.random() * 0.3;
      this.lobes.push([Math.cos(a) * reach, Math.sin(a) * reach, size, 25 + Math.random() * 90]);
    }
    this.skew = [1.06 + Math.random() * 0.16, 0.86 + Math.random() * 0.1, Math.random() * 180];
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SKY_R * 0.64;
      this.field.push([Math.cos(a) * r, Math.sin(a) * r, 2.2 + Math.random() * 3.2, 0.35 + Math.random() * 0.55]);
    }
  }

  /** Star i in local coords (figure scaled and tilted about the body). */
  private at(i: number): [number, number] {
    const s = this.figure.stars[i]!;
    const cos = Math.cos(this.tilt);
    const sin = Math.sin(this.tilt);
    return [(s[0] * cos - s[1] * sin) * FIGURE_R, (s[0] * sin + s[1] * cos) * FIGURE_R];
  }

  /** 0 → 1 over the ascent. */
  private rise(age: number): number {
    return Math.min(1, Math.max(0, (age - ASCEND_AT_MS) / ASCEND_MS));
  }

  /** How much of the etching shows yet (it surfaces as the figure leaves). */
  markAlpha(age: number): number {
    return this.rise(age);
  }

  /** The etching — FinisherField draws it live, render.ts bakes it cold. */
  stampMark(canvas: SkCanvas, alpha: number): void {
    stampEtch(canvas, this.etch, alpha);
  }

  /** Floor pass, under the bodies: the night itself. */
  drawGround(canvas: SkCanvas, age: number): void {
    const open = easeOutBack(age / OPEN_MS);
    const rise = this.rise(age);
    // The sky closes behind the rising figure: fading, drawing in a little.
    const alpha = 1 - rise * rise;
    if (alpha <= 0) return;
    const r = SKY_R * (1 - 0.18 * rise);
    canvas.save();
    canvas.translate(this.x, this.y);
    canvas.rotate(this.skew[2], 0, 0);
    canvas.scale(r * this.skew[0], r * this.skew[1]);
    skyPaint.setAlphaf(alpha);
    lobePaint.setAlphaf(alpha);
    // Lobes first, each billowing out a beat behind the core…
    for (const [lx, ly, lr, delay] of this.lobes) {
      const k = easeOutBack((age - delay) / OPEN_MS);
      if (k <= 0) continue;
      canvas.save();
      canvas.translate(lx * open, ly * open);
      canvas.scale(lr * k, lr * k);
      canvas.drawCircle(0, 0, 1, lobePaint);
      canvas.restore();
    }
    // …then the core over them.
    canvas.save();
    canvas.scale(SKY_CORE * open, SKY_CORE * open);
    canvas.drawCircle(0, 0, 1, skyPaint);
    canvas.restore();
    // Un-skew for the clouds: they were placed for a round sky.
    canvas.scale(open, open);
    // Two breaths of nebula, only ever over the dark. Each is the unit
    // gradient under its own translate+scale — drawn as a smaller circle of
    // the SAME gradient it would be cut off mid-falloff, a hard-edged disc.
    for (const [paint, cx, cy, cr] of [
      [magentaPaint, -0.3, -0.18, 0.56],
      [tealPaint, 0.34, 0.26, 0.5],
    ] as const) {
      canvas.save();
      canvas.translate(cx, cy);
      canvas.scale(cr, cr);
      paint.setAlphaf(alpha);
      canvas.drawCircle(0, 0, 1, paint);
      canvas.restore();
    }
    canvas.restore();
  }

  /** Air pass, over the bodies: the lines, then every light in one atlas. */
  drawAir(canvas: SkCanvas, age: number): void {
    const rise = this.rise(age);
    const ease = rise * rise * (3 - 2 * rise);
    const fade = 1 - ease;
    // Rising toward the camera: it grows, and lifts a little up-screen.
    const scale = 1 + 0.5 * ease;
    const lift = 60 * ease;
    const open = Math.min(1, age / OPEN_MS);

    canvas.save();
    canvas.translate(this.x, this.y - lift);
    canvas.scale(scale, scale);

    // ── lines
    const drawn = age >= this.litAt[this.figure.order[this.figure.order.length - 1]!]!;
    if (drawn) {
      this.strokeLines(canvas, () => canvas.drawPath(this.lines, linePaint), fade);
    } else {
      this.strokeLines(
        canvas,
        () => {
          for (const [a, b] of this.figure.edges) {
            // The line sets off from whichever end lit first and ARRIVES as
            // the other ignites.
            const from = this.litAt[a]! <= this.litAt[b]! ? a : b;
            const to = from === a ? b : a;
            const t = (age - (this.litAt[to]! - LINE_MS)) / LINE_MS;
            if (t <= 0) continue;
            const p = this.at(from);
            const q = this.at(to);
            const k = Math.min(1, t);
            canvas.drawLine(p[0], p[1], p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, linePaint);
          }
        },
        1,
      );
    }

    // ── lights
    const img = ensureAtlas();
    if (img) {
      srcs.length = dsts.length = cols.length = 0;
      for (const [fx, fy, fr, fa] of this.field) {
        srcs.push(SRC_PRICK);
        dsts.push(xform(fr, fx, fy));
        cols.push(white(fa * open * fade));
      }
      // One shared flare as the ascent begins — every star at once.
      const burst = age >= ASCEND_AT_MS ? Math.max(0, 1 - (age - ASCEND_AT_MS) / BURST_MS) : 0;
      this.figure.stars.forEach((s, i) => {
        const t = age - this.litAt[i]!;
        if (t <= 0) return;
        const p = this.at(i);
        const size = (9 + s[2] * 11) * easeOutBack(t / STAR_POP_MS);
        // The hold breathes — slow, slight, each star on its own phase.
        const breath = 1 + 0.08 * Math.sin(age * 0.006 + i * 1.7);
        srcs.push(SRC_STAR);
        dsts.push(xform(size * breath, p[0], p[1], this.tilt));
        cols.push(white(fade));
        const ignite = t < IGNITE_MS ? (1 - t / IGNITE_MS) ** 2 : 0;
        const flare = Math.max(ignite, burst * burst);
        if (flare > 0.01) {
          srcs.push(SRC_FLARE);
          dsts.push(xform(size * (1.6 + 1.6 * flare), p[0], p[1], this.tilt + 0.4));
          cols.push(white(flare * Math.max(fade, 0.4)));
        }
      });
      canvas.drawAtlas(img, srcs, dsts, atlasPaint, BlendMode.Modulate, cols);
    }
    canvas.restore();
  }

  /** Dark backing under a pale line — pale alone can't be trusted on sand. */
  private strokeLines(canvas: SkCanvas, draw: () => void, alpha: number): void {
    if (alpha <= 0) return;
    linePaint.setColor(C_LINE_BACK);
    linePaint.setAlphaf(0.75 * alpha);
    linePaint.setStrokeWidth(4);
    draw();
    linePaint.setColor(C_LINE);
    linePaint.setAlphaf(0.95 * alpha);
    linePaint.setStrokeWidth(1.8);
    draw();
  }
}
