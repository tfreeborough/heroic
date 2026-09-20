/**
 * Finishers — the killer's flourish over a kill (bits-cosmetics.md).
 * PROTOTYPES, worn from the dev menu: Butterflies and Smite live
 * here; the later ones are each their own file behind the FinisherShow
 * interface — constellation.ts, medusa.ts, snuffed.ts.
 *
 * The slot rule: AIR BELONGS TO THE KILLER, FLOOR BELONGS TO THE VICTIM. A
 * finisher plays in the air over the body; the victim's own blood still hits
 * the sand underneath it. The one thing a finisher may leave on the floor is
 * a small permanent MARK (Smite's scorch-star), which settles and is stamped
 * into the blood system's splat map — free for the rest of the match, the
 * same handoff settled quake webs use (bits-blood.md §7).
 *
 * Client-derived and never networked (the blood rule): every client spawns
 * the same finisher off the same lethal hit event.
 *
 * PERF — the budget this file is written to:
 *  - Motion is a pure function of age. Everything random is frozen at spawn;
 *    nothing is simulated per frame.
 *  - Butterflies are ONE drawAtlas call in the air plus ONE for their
 *    shadows (the crowd.ts technique: white sprites from a tiny atlas baked
 *    once, tinted by Modulate). ~70 RSXforms a frame for ~1.3s per kill —
 *    the same order as the crowd's wave crest.
 *  - The bolt, the scorch-star and its veins are paths built ONCE at spawn.
 *  - No blur filters, no saveLayer. Glow is a stack of wide faint strokes
 *    under a thin bright one; ground light and the burnt sand are unit
 *    radial gradients built once and scaled.
 *  - At most MAX_LIVE finishers play at once; the oldest is cut short (its
 *    mark stays).
 */
import {
  BlendMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  vec,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkPath,
  type SkRect,
  type SkRSXform,
} from "@shopify/react-native-skia";
import { Constellation, CONSTELLATION_LIFE_MS } from "./constellation";
import type { FinisherId } from "./cosmeticIds";
import { Medusa, MEDUSA_LIFE_MS } from "./medusa";
import { Snuffed, SNUFFED_LIFE_MS } from "./snuffed";

/** A finisher that lives in its own file: a closed-form little show, asked
 *  to draw itself at an age. A show that leaves a floor mark also says how
 *  far the mark has surfaced and how to stamp it. */
export interface FinisherShow {
  drawGround(canvas: SkCanvas, age: number): void;
  drawAir(canvas: SkCanvas, age: number): void;
  markAlpha?(age: number): number;
  stampMark?(canvas: SkCanvas, alpha: number): void;
}

const MAX_LIVE = 3;
const TAU = Math.PI * 2;

// ── Butterflies ─────────────────────────────────────────────────────────────
const FLY_COUNT = 36;
/** Tempo (Tom, 2026-09-20): a finisher must be OVER quickly — it plays in the
 *  middle of a fight, often with players bunched up. The swarm was 2.6s out
 *  to 430px; now it's a 1.3s burst that stays closer to the body. Flap and
 *  wobble rates are per SECOND, so the wings don't speed up with it. */
const FLY_LIFE_MS = 1300;
/** How far they get, world px: base + up to this much more. */
const FLY_DIST = 150;
const FLY_DIST_SPREAD = 210;
/** They start dissolving from this far through their life. */
const FLY_FADE_FROM = 0.5;
/** The burst pop under the swarm. */
const POP_MS = 180;
/** Wing tints — warm and pale on purpose: nothing near the friend blue or
 *  the foe red, so a swarm never reads as a team colour. */
const FLY_TINTS: readonly [number, number, number][] = [
  [1.0, 0.96, 0.86], // ivory
  [0.96, 0.66, 0.2], // amber
  [0.74, 0.58, 0.92], // lilac
  [0.98, 0.8, 0.36], // gold
];
const CELL = 32;
/** Flap frames: the wings' half-span as a fraction of full. */
const FLAP_SPANS = [1, 0.78, 0.5, 0.24];
const SRC_FLAP: SkRect[] = FLAP_SPANS.map((_, i) => Skia.XYWHRect(CELL * i, 0, CELL, CELL));
const SRC_SHADOW = Skia.XYWHRect(CELL * FLAP_SPANS.length, 0, CELL, CELL);

interface Butterfly {
  ang: number;
  dist: number;
  wobAmp: number;
  wobHz: number;
  phase: number;
  flapHz: number;
  size: number;
  delayMs: number;
  /** Mutated in place each frame (alpha only) — no per-frame colour allocs. */
  tint: Float32Array;
  shadow: Float32Array;
}

let flyAtlas: SkImage | null = null;
let flyAtlasFailed = false;
/** White wings with a grey margin and a dark body — Modulate tints the white
 *  to the butterfly's colour and leaves the darks dark (a monarch's edging). */
const ensureFlyAtlas = (): SkImage | null => {
  if (flyAtlas || flyAtlasFailed) return flyAtlas;
  const surface = Skia.Surface.Make(CELL * (FLAP_SPANS.length + 1), CELL);
  if (!surface) {
    flyAtlasFailed = true; // no atlas → the finisher simply doesn't draw
    return null;
  }
  const c = surface.getCanvas();
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const wing = (cx: number, span: number, inset: number): void => {
    for (const side of [-1, 1]) {
      // Upper wing, then the smaller lower wing.
      const uw = (13 - inset) * span;
      const uh = 12 - inset;
      c.drawOval(Skia.XYWHRect(cx + side * (1 + uw / 2) - uw / 2, 13 - 3 - uh / 2, uw, uh), p);
      const lw = (9.5 - inset) * span;
      const lh = 9 - inset;
      c.drawOval(Skia.XYWHRect(cx + side * (1 + lw / 2) - lw / 2, 13 + 6.5 - lh / 2, lw, lh), p);
    }
  };
  FLAP_SPANS.forEach((span, i) => {
    const cx = CELL * i + CELL / 2;
    p.setColor(Skia.Color("#4a4a4a"));
    wing(cx, span, 0);
    p.setColor(Skia.Color("#ffffff"));
    wing(cx, span, 2.6);
    p.setColor(Skia.Color("#2a2a2a"));
    c.drawOval(Skia.XYWHRect(cx - 1.3, 6, 2.6, 15), p);
  });
  // The shadow cell: a soft-ish dark lozenge (tinted to alpha at draw time).
  p.setColor(Skia.Color("#ffffff"));
  const sx = CELL * FLAP_SPANS.length + CELL / 2;
  c.drawOval(Skia.XYWHRect(sx - 9, 11, 18, 10), p);
  flyAtlas = surface.makeImageSnapshot();
  return flyAtlas;
};

const atlasPaint = Skia.Paint();
atlasPaint.setAntiAlias(true);
// drawAtlas scratch — persistent, truncated per call (the crowd.ts diet).
const flyDsts: SkRSXform[] = [];
const flySrcs: SkRect[] = [];
const flyCols: SkColor[] = [];

// ── Smite (Jove's Verdict until 2026-09-20 — "who the hell is Jove?") ────────
const BOLT_MS = 420;
const BOLT_HEIGHT = 1100;
const SPARK_MS = 480;
const SPARK_COUNT = 16;
/** The scorch glows this long, then settles and bakes into the splat map. */
const SCORCH_HOT_MS = 2600;
/** Without a splat surface marks can't bake — cap the live list instead. */
const MAX_MARKS = 10;

const C_BOLT_CORE = Skia.Color("#ffffff");
const C_BOLT_MID = Skia.Color("#dfe6ff");
const C_BOLT_GLOW = Skia.Color("#c4d2ff");
const C_CHAR = Skia.Color("#1d1713");
const C_GLASS = Skia.Color("#dbe7ee");
const C_EMBER = Skia.Color("#ff8a2a");
const C_SPARK = Skia.Color("#ffe9b0");
const C_POP = Skia.Color("#fff6e0");

const fill = Skia.Paint();
fill.setAntiAlias(true);
const stroke = Skia.Paint();
stroke.setAntiAlias(true);
stroke.setStyle(PaintStyle.Stroke);
stroke.setStrokeCap(StrokeCap.Round);
stroke.setStrokeJoin(StrokeJoin.Round);
/** The bolt's halo and the ground light are plain SrcOver in a COLD blue-
 *  white. Additive was the first cut: on warm sand it saturated to cream and
 *  the lightning read as a yellow tube (headless preview). A cold wash over
 *  warm ground is what makes it read electric. */
const light = Skia.Paint();
light.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [
      Skia.Color("rgba(232, 238, 255, 0.9)"),
      Skia.Color("rgba(196, 210, 255, 0.35)"),
      Skia.Color("rgba(170, 190, 255, 0)"),
    ],
    [0, 0.4, 1],
    TileMode.Clamp,
  ),
);
/** Burnt sand under the scorch-star — a unit gradient, built once. */
const burn = Skia.Paint();
burn.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(24, 18, 14, 0.62)"), Skia.Color("rgba(24, 18, 14, 0.3)"), Skia.Color("rgba(24, 18, 14, 0)")],
    [0, 0.5, 1],
    TileMode.Clamp,
  ),
);
const BURN_R = 40;
/** Halo layers, wide+faint → narrow+strong: a stepped falloff, no blur. */
const HALO: readonly [number, number][] = [
  [54, 0.06],
  [36, 0.1],
  [22, 0.18],
  [12, 0.32],
];

/** A permanent floor mark left by a finisher — live until it's cold (its
 *  look has stopped changing), then baked into the splat map. */
export type FinisherMark =
  | {
      kind: "scorch";
      x: number;
      y: number;
      bornMs: number;
      coldMs: number;
      char: SkPath;
      veins: SkPath;
      /** The ember core: the char star again, smaller. */
      ember: SkPath;
    }
  | {
      /** A show's own mark (the constellation's etching, Medusa's rubble). */
      kind: "show";
      x: number;
      y: number;
      bornMs: number;
      coldMs: number;
      show: FinisherShow;
    };

interface LiveFinisher {
  id: Exclude<FinisherId, "none">;
  x: number;
  y: number;
  bornMs: number;
  flies?: Butterfly[];
  bolt?: SkPath;
  sparks?: { ang: number; reach: number }[];
  show?: FinisherShow;
  lifeMs: number;
}

/** A jagged bolt: midpoint-displaced from far off the top of the view down
 *  to the body, with a couple of forks. Built once. */
const makeBolt = (x: number, y: number): SkPath => {
  const b = Skia.PathBuilder.Make();
  const lean = (Math.random() - 0.5) * 360;
  const segs = 16;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Jagged all the way down; only the last point is pinned to the body.
    const j = 18 + Math.sin(Math.PI * t) * 52;
    pts.push({
      x: i === segs ? x : x + lean * (1 - t) + (Math.random() - 0.5) * j * 2,
      y: y - BOLT_HEIGHT * (1 - t),
    });
  }
  b.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) b.lineTo(pts[i]!.x, pts[i]!.y);
  for (const at of [0.45, 0.68]) {
    const from = pts[Math.floor(at * segs)]!;
    const side = Math.random() < 0.5 ? -1 : 1;
    let fx = from.x;
    let fy = from.y;
    b.moveTo(fx, fy);
    for (let k = 0; k < 5; k++) {
      fx += side * (18 + Math.random() * 30);
      fy += 22 + Math.random() * 30;
      b.lineTo(fx, fy);
    }
  }
  return b.detach();
};

/** An uneven spiked star — the char silhouette. */
const makeStar = (x: number, y: number, scale: number, seed: number): SkPath => {
  const spikes = 9 + Math.floor(seed % 3);
  const b = Skia.PathBuilder.Make();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU + seed;
    const tip = i % 2 === 0;
    const wob = 0.5 + 0.5 * Math.sin(seed * 3.1 + i * 2.7);
    const r = (tip ? 26 + wob * 30 : 12 + wob * 7) * scale;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) b.moveTo(px, py);
    else b.lineTo(px, py);
  }
  return b.close().detach();
};

/** Fulgurite: pale glassy veins running out along some of the spikes. */
const makeVeins = (x: number, y: number, seed: number): SkPath => {
  const b = Skia.PathBuilder.Make();
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + seed + 0.2;
    let px = x + Math.cos(a) * 5;
    let py = y + Math.sin(a) * 5;
    b.moveTo(px, py);
    const len = 22 + (0.5 + 0.5 * Math.sin(seed * 5.3 + i * 1.9)) * 26;
    for (let k = 1; k <= 3; k++) {
      const bend = Math.sin(seed * 7.7 + i * 3.3 + k) * 0.35;
      px += Math.cos(a + bend) * (len / 3);
      py += Math.sin(a + bend) * (len / 3);
      b.lineTo(px, py);
    }
  }
  return b.detach();
};

/** A settled mark exactly as the live pass last drew it (ember at zero) —
 *  render.ts stamps this into the splat surface. */
export const stampFinisherMark = (canvas: SkCanvas, m: FinisherMark): void => {
  if (m.kind === "show") {
    m.show.stampMark?.(canvas, 1);
    return;
  }
  canvas.save();
  canvas.translate(m.x, m.y);
  canvas.scale(BURN_R, BURN_R);
  canvas.drawCircle(0, 0, 1, burn);
  canvas.restore();
  fill.setColor(C_CHAR);
  fill.setAlphaf(0.72);
  canvas.drawPath(m.char, fill);
  stroke.setColor(C_GLASS);
  stroke.setAlphaf(0.5);
  stroke.setStrokeWidth(1.4);
  canvas.drawPath(m.veins, stroke);
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

export class FinisherField {
  private readonly live: LiveFinisher[] = [];
  private readonly marks: FinisherMark[] = [];

  /** A kill landed and the KILLER wears `id`. (x, y) is the victim. */
  spawn(id: FinisherId, x: number, y: number, nowMs: number): void {
    if (id === "none") return;
    if (this.live.length >= MAX_LIVE) this.live.shift();
    const f: LiveFinisher = { id, x, y, bornMs: nowMs, lifeMs: 0 };
    if (id === "butterflies") {
      f.lifeMs = FLY_LIFE_MS + 80;
      f.flies = [];
      for (let i = 0; i < FLY_COUNT; i++) {
        const t = FLY_TINTS[i % FLY_TINTS.length]!;
        f.flies.push({
          // Stratified round the circle so the burst never clumps one way.
          ang: ((i + Math.random()) / FLY_COUNT) * TAU,
          dist: FLY_DIST + Math.random() * FLY_DIST_SPREAD,
          wobAmp: 10 + Math.random() * 18,
          wobHz: 5 + Math.random() * 4,
          phase: Math.random() * TAU,
          flapHz: 9 + Math.random() * 5,
          size: 0.75 + Math.random() * 0.5,
          delayMs: Math.random() * 80,
          tint: Float32Array.of(t[0], t[1], t[2], 1),
          shadow: Float32Array.of(0, 0, 0, 0),
        });
      }
    } else if (id !== "smite") {
      f.show =
        id === "constellation" ? new Constellation(x, y) : id === "medusa" ? new Medusa(x, y) : new Snuffed(x, y);
      f.lifeMs =
        id === "constellation" ? CONSTELLATION_LIFE_MS : id === "medusa" ? MEDUSA_LIFE_MS : SNUFFED_LIFE_MS;
      if (f.show.stampMark) {
        this.marks.push({ kind: "show", x, y, bornMs: nowMs, coldMs: f.lifeMs, show: f.show });
      }
    } else {
      f.lifeMs = Math.max(BOLT_MS, SPARK_MS);
      const seed = Math.random() * 100;
      f.bolt = makeBolt(x, y);
      f.sparks = [];
      for (let i = 0; i < SPARK_COUNT; i++) {
        f.sparks.push({ ang: ((i + Math.random()) / SPARK_COUNT) * TAU, reach: 50 + Math.random() * 80 });
      }
      this.marks.push({
        kind: "scorch",
        x,
        y,
        bornMs: nowMs,
        coldMs: SCORCH_HOT_MS,
        char: makeStar(x, y, 1, seed),
        veins: makeVeins(x, y, seed),
        ember: makeStar(x, y, 0.62, seed),
      });
    }
    if (this.marks.length > MAX_MARKS) this.marks.shift();
    this.live.push(f);
  }

  /** Once per rendered frame: retire finishers whose air show is over. */
  update(nowMs: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i]!;
      if (nowMs - f.bornMs >= f.lifeMs) this.live.splice(i, 1);
    }
  }

  /** Splice out marks that have gone cold, for the splat-map bake. Only
   *  called when the surface exists (render.ts scarLayer). */
  harvestMarks(nowMs: number): FinisherMark[] {
    // Marks go cold at different ages (a scorch outlasts nothing; an etching
    // waits for its show), so this is a filter, not a prefix — the list is
    // capped at MAX_MARKS, the walk is nothing.
    const m = this.marks;
    const out: FinisherMark[] = [];
    for (let i = m.length - 1; i >= 0; i--) {
      if (nowMs - m[i]!.bornMs >= m[i]!.coldMs) out.unshift(...m.splice(i, 1));
    }
    return out;
  }

  /** Floor pass — under bodies: live marks and the butterflies' shadows. */
  drawGround(canvas: SkCanvas, nowMs: number): void {
    for (const m of this.marks) {
      if (m.kind === "show") {
        // Surfaces on the show's own cue; a show that's over — or was cut
        // short (MAX_LIVE) — has nothing left to wait for: the mark is there.
        const showing = this.live.some((f) => f.show === m.show);
        m.show.stampMark?.(canvas, showing ? (m.show.markAlpha?.(nowMs - m.bornMs) ?? 1) : 1);
        continue;
      }
      stampFinisherMark(canvas, m);
      const hot = 1 - (nowMs - m.bornMs) / SCORCH_HOT_MS;
      if (hot > 0) {
        // Still glowing: a molten heart, and the glass veins run orange
        // before they cool to the pale fulgurite the stamp keeps.
        fill.setColor(C_EMBER);
        fill.setAlphaf(Math.min(1, 1.1 * hot));
        canvas.drawPath(m.ember, fill);
        fill.setAlphaf(1);
        stroke.setColor(C_EMBER);
        stroke.setAlphaf(hot);
        stroke.setStrokeWidth(2.2);
        canvas.drawPath(m.veins, stroke);
        stroke.setAlphaf(1);
      }
    }
    for (const f of this.live) {
      if (f.flies) this.drawFlies(canvas, f, nowMs, true);
      f.show?.drawGround(canvas, nowMs - f.bornMs);
    }
  }

  /** Air pass — over bodies. */
  drawAir(canvas: SkCanvas, nowMs: number): void {
    for (const f of this.live) {
      const age = nowMs - f.bornMs;
      if (f.flies) {
        if (age < POP_MS) {
          const t = age / POP_MS;
          fill.setColor(C_POP);
          fill.setAlphaf(0.7 * (1 - t) * (1 - t));
          canvas.drawCircle(f.x, f.y, 14 + 40 * t, fill);
          fill.setAlphaf(1);
        }
        this.drawFlies(canvas, f, nowMs, false);
        continue;
      }
      if (f.show) {
        f.show.drawAir(canvas, age);
        continue;
      }
      this.drawBolt(canvas, f, age);
    }
  }

  private drawFlies(canvas: SkCanvas, f: LiveFinisher, nowMs: number, shadows: boolean): void {
    const img = ensureFlyAtlas();
    if (!img) return;
    flyDsts.length = 0;
    flySrcs.length = 0;
    flyCols.length = 0;
    for (const b of f.flies!) {
      const age = nowMs - f.bornMs - b.delayMs;
      if (age <= 0 || age >= FLY_LIFE_MS) continue;
      const u = age / FLY_LIFE_MS;
      const sec = age / 1000;
      // Burst out fast, then a steady flutter away.
      const reach = b.dist * (0.42 * (1 - Math.exp(-7 * u)) + 0.58 * u);
      const wob = Math.sin(b.wobHz * sec + b.phase) * b.wobAmp * Math.min(1, u * 5);
      const cx = Math.cos(b.ang);
      const sy = Math.sin(b.ang);
      const x = f.x + cx * reach - sy * wob;
      const y = f.y + sy * reach + cx * wob;
      // They climb toward the camera: bigger, and the shadow slides away.
      const rise = 0.75 + 0.7 * u;
      const fade = Math.min(1, age / 60) * (u < FLY_FADE_FROM ? 1 : 1 - (u - FLY_FADE_FROM) / (1 - FLY_FADE_FROM));
      if (shadows) {
        const s = b.size * (0.8 + 0.5 * u);
        flyDsts.push(Skia.RSXform(s, 0, x + 5 + 22 * u - s * (CELL / 2), y + 8 + 34 * u - s * (CELL / 2)));
        flySrcs.push(SRC_SHADOW);
        b.shadow[3] = 0.26 * fade * (1 - 0.6 * u);
        flyCols.push(b.shadow);
        continue;
      }
      // Nose along the travel line, swinging with the wobble.
      const heading = b.ang + 0.55 * Math.cos(b.wobHz * sec + b.phase) + Math.PI / 2;
      const flap = Math.abs(Math.sin(b.flapHz * sec * Math.PI + b.phase));
      flyDsts.push(Skia.RSXformFromRadians(b.size * rise, heading, x, y, CELL / 2, 13));
      flySrcs.push(SRC_FLAP[Math.min(FLAP_SPANS.length - 1, Math.floor((1 - flap) * FLAP_SPANS.length))]!);
      b.tint[3] = fade;
      flyCols.push(b.tint);
    }
    if (flyDsts.length === 0) return;
    canvas.drawAtlas(img, flySrcs, flyDsts, atlasPaint, BlendMode.Modulate, flyCols);
  }

  private drawBolt(canvas: SkCanvas, f: LiveFinisher, age: number): void {
    // Strike, a dark beat, a thinner re-strike, then the afterglow dies.
    let k = 0;
    if (age < 80) k = 1;
    else if (age < 130) k = 0.12;
    else if (age < 210) k = 0.8;
    else if (age < BOLT_MS) k = 0.45 * (1 - (age - 210) / (BOLT_MS - 210));
    if (k > 0 && f.bolt) {
      // Ground light first: the sand round the strike lit cold for an instant.
      canvas.save();
      canvas.translate(f.x, f.y);
      canvas.scale(190, 190);
      light.setAlphaf(Math.min(1, 0.85 * k));
      canvas.drawCircle(0, 0, 1, light);
      canvas.restore();

      stroke.setColor(C_BOLT_GLOW);
      for (const [width, alpha] of HALO) {
        stroke.setAlphaf(alpha * k);
        stroke.setStrokeWidth(width);
        canvas.drawPath(f.bolt, stroke);
      }
      stroke.setColor(C_BOLT_MID);
      stroke.setAlphaf(Math.min(1, 0.9 * k));
      stroke.setStrokeWidth(5);
      canvas.drawPath(f.bolt, stroke);
      stroke.setColor(C_BOLT_CORE);
      stroke.setAlphaf(Math.min(1, k * 1.2));
      stroke.setStrokeWidth(age < 130 ? 2.4 : 1.4);
      canvas.drawPath(f.bolt, stroke);
    }
    if (age < 170) {
      const t = age / 170;
      fill.setColor(C_BOLT_CORE);
      fill.setAlphaf(0.95 * (1 - t));
      canvas.drawCircle(f.x, f.y, 26 + 24 * t, fill);
      fill.setAlphaf(1);
    }
    if (age < SPARK_MS && f.sparks) {
      const t = age / SPARK_MS;
      const out = 1 - (1 - t) * (1 - t);
      stroke.setColor(C_SPARK);
      stroke.setAlphaf(1 - t);
      stroke.setStrokeWidth(2);
      for (const s of f.sparks) {
        const r1 = 16 + s.reach * out;
        const r0 = r1 - 12 * (1 - t);
        const cx = Math.cos(s.ang);
        const sy = Math.sin(s.ang);
        canvas.drawLine(f.x + cx * r0, f.y + sy * r0, f.x + cx * r1, f.y + sy * r1, stroke);
      }
    }
    stroke.setAlphaf(1);
  }
}
