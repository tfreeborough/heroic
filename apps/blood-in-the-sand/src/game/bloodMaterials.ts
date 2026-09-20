/**
 * What blood is MADE of — the floor-decal renderer, one material per blood
 * cosmetic (bits-cosmetics.md). blood.ts decides where marks land, how big
 * they are and how long they live, identically for every material (a trail's
 * information never changes); this file only decides how a mark looks.
 *
 * ── Premium blood material ─────────────────────────────────────────────────
 * Blood reads as gore, not paint, from three things flat circles never had:
 * an irregular silhouette (no circular edge anywhere), tonal depth (near-black
 * core → oxblood → wet arterial edge), and AGE — a spill sets over ~16s then
 * holds, so a still-wet trail means someone bled here seconds ago (a readable
 * freshness signal in a one-life arena, not just eye-candy). All of it is a
 * pure function of data the decal already carries — position, radius, birth,
 * seed — so it costs nothing on the wire and rebuilds inside the same cached
 * scar picture; per-frame cost stays one drawPicture. Silhouette paths are
 * baked at birth in blood.ts (the cracks.ts lesson); a rebuild here only
 * re-samples colours and alphas.
 *
 * The cosmetic materials keep that contract: what they dry into is baked into
 * the splat map like any other mark — free for the rest of the match. The one
 * thing that may NOT ride the cached scar picture is animation: the cache
 * rebuilds at 5Hz at best, and anything moving on that beat reads as cheap
 * and low-frame-rate (Tom, on device, of the since-cut Ichor's twinkle). Motion gets
 * a per-frame pass over the few marks still moving (drawBloomingBlood), or
 * it doesn't happen.
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
  type SkRect,
  type SkRSXform,
  type SkShader,
} from "@shopify/react-native-skia";
import {
  BLOOD_DRY_MS,
  decalAlpha,
  POOL_MIN_R,
  poolGrowth,
  teardropPath,
  type BloodDecal,
  type FlyingDrop,
} from "./blood";
import type { BloodId } from "./cosmeticIds";
import { starPath } from "./starArt";

// Dedicated blood paints — the premium decal renderer swaps shaders and stroke
// widths per decal; a dedicated pair keeps that churn out of the shared paints.
const bloodFill = Skia.Paint();
const bloodStroke = Skia.Paint();
bloodStroke.setStyle(PaintStyle.Stroke);
bloodStroke.setStrokeJoin(StrokeJoin.Round);
bloodStroke.setStrokeCap(StrokeCap.Round); // flying-droplet motion tails

/** Premium marks sit a touch more solid than the old flat alpha (which was
 *  tuned for cheap overlapping circles). */
const BLOOD_ALPHA_BOOST = 1.5;

/** wetness 1 (fresh, bright + wet) → 0 (set, dark + matte). Smoothstep in so it
 *  looks wet a beat before it starts drying, then holds at 0. */
const bloodWetness = (ageMs: number): number => {
  const t = Math.min(1, Math.max(0, ageMs / BLOOD_DRY_MS));
  return 1 - t * t * (3 - 2 * t);
};

// Colour ramps baked once (fresh → dried), sampled by wetness — never restring
// rgba per decal (that floods Skia's colour cache; see the palette note in
// render.ts).
const RAMP_N = 10;
type Rgb = readonly [number, number, number];
const buildRamp = (fresh: Rgb, dried: Rgb): SkColor[] => {
  const out: SkColor[] = [];
  for (let i = 0; i < RAMP_N; i++) {
    const t = i / (RAMP_N - 1);
    const r = Math.round(fresh[0] + (dried[0] - fresh[0]) * t);
    const g = Math.round(fresh[1] + (dried[1] - fresh[1]) * t);
    const b = Math.round(fresh[2] + (dried[2] - fresh[2]) * t);
    out.push(Skia.Color(`rgb(${r}, ${g}, ${b})`));
  }
  return out;
};
/** dryness (1 - wetness) → ramp index. */
const rampIdx = (w: number): number =>
  Math.min(RAMP_N - 1, Math.max(0, Math.round((1 - w) * (RAMP_N - 1))));

/** A liquid material: the five ramps + the unit pool gradients built from
 * them. One pool gradient per ramp step, built once at UNIT radius — pools
 * draw their unit-baked path under translate+scale, so these fit every pool at
 * any size. A rebuild used to allocate a fresh native radial gradient PER POOL
 * (hundreds each pass): a big slice of the weak-device `rec` spike. */
interface LiquidMaterial {
  core: SkColor[];
  body: SkColor[];
  edge: SkColor[];
  rim: SkColor[];
  clot: SkColor[];
  gradients: SkShader[];
  sheen: SkColor;
  sheenAlpha: number;
  /** Optional hairline round the small drops + a rim on every pool, for a
   *  liquid whose body sits near the sand's own value (none today). */
  outline?: SkColor[];
}
const liquid = (
  m: Omit<LiquidMaterial, "gradients">,
): LiquidMaterial => ({
  ...m,
  gradients: Array.from({ length: RAMP_N }, (_, i) =>
    Skia.Shader.MakeRadialGradient(
      vec(-0.15, -0.15),
      1.1,
      [m.core[i]!, m.body[i]!, m.edge[i]!],
      [0, 0.55, 1],
      TileMode.Clamp,
    ),
  ),
});

const DEFAULT = liquid({
  core: buildRamp([42, 6, 4], [24, 8, 5]), // near-black centre
  body: buildRamp([104, 18, 12], [52, 15, 9]), // oxblood
  edge: buildRamp([158, 32, 22], [74, 27, 19]), // wet arterial rim
  rim: buildRamp([24, 6, 5], [30, 10, 6]), // coagulated coffee-ring
  clot: buildRamp([30, 8, 6], [14, 5, 4]), // tacky centre clot
  sheen: Skia.Color("#ffb4aa"), // wet specular, fresh pools only
  sheenAlpha: 0.24,
});

// (Starblood lives below the roses — it shares their atlas + bloom machinery.)

/** Cheap stable hash → [0, 1), keyed on a decal's frozen seed. */
const hash01 = (a: number, b: number): number => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// ── Roses ───────────────────────────────────────────────────────────────────
// v2 (2026-09-19, after Tom's device pass: v1's petal-per-droplet "reads as a
// bunch of pink blood"). At the follow camera a droplet is ~2 points wide —
// no petal silhouette survives that, and a scatter of small reddish marks IS
// what blood looks like. What makes a flowerbed read at that size is
// FOLIAGE and FLOWER HEADS: green among the red, and blossoms big enough to
// show their rings. So every mark becomes a sprite from a small atlas baked
// once — a full rose, a bud, a leaf sprig, a loose petal — tinted by Modulate
// (the crowd.ts technique), and the whole material is two drawAtlas calls:
// greens under, reds over. Streaks grow as leafy sprigs along their line,
// some tipped with a bud; pools open as full roses over a collar of leaves.
// Deep reds only — v1's pink tone was half of the "pink blood" read.
//
// And it BLOOMS: a fresh mark grows from nothing with a little overshoot,
// staggered by seed so a kill's spray opens as a ripple. That animation is a
// per-frame pass over only the marks still opening (drawBloomingBlood);
// once open they belong to the cached scar picture like everything else.
// No poppies, ever (bits-cosmetics.md).
const ROSE_CELL = 64;
const ROSE_SPRITE_R = 30; // the art's radius inside its cell
const SRC_ROSE = Skia.XYWHRect(0, 0, ROSE_CELL, ROSE_CELL);
const SRC_BUD = Skia.XYWHRect(ROSE_CELL, 0, ROSE_CELL, ROSE_CELL);
const SRC_SPRIG = Skia.XYWHRect(ROSE_CELL * 2, 0, ROSE_CELL, ROSE_CELL);
const SRC_PETAL = Skia.XYWHRect(ROSE_CELL * 3, 0, ROSE_CELL, ROSE_CELL);
/** Petal tints, fresh → a day old (three reds so a bed isn't one flat colour).
 *  The wither is GENTLE on purpose: the dried state is what gets baked and
 *  seen for the rest of the match, and a bed that browns right down reads as
 *  old blood again. They deepen; they stay roses. */
const ROSE_REDS = [
  buildRamp([186, 16, 38], [134, 16, 34]),
  buildRamp([208, 30, 44], [150, 24, 38]),
  buildRamp([150, 10, 34], [112, 12, 30]),
];
const ROSE_GREEN = buildRamp([58, 112, 52], [58, 88, 44]);
/** How long a mark takes to open, and how far the stagger spreads a spray. */
const BLOOM_MS = 460;
const BLOOM_STAGGER_MS = 260;
export const BLOOM_TOTAL_MS = BLOOM_MS + BLOOM_STAGGER_MS;
/** Nothing smaller than this reads as a flower on a phone (world px). */
const BUD_MIN_R = 4.6;

let roseAtlas: SkImage | null = null;
let roseAtlasFailed = false;
/** White-to-grey art: Modulate multiplies it by the tint, so the greys become
 *  the petals' own shading — lit hearts, darker outer rings, dark creases. */
const ensureRoseAtlas = (): SkImage | null => {
  if (roseAtlas || roseAtlasFailed) return roseAtlas;
  const surface = Skia.Surface.Make(ROSE_CELL * 4, ROSE_CELL);
  if (!surface) {
    roseAtlasFailed = true; // → roses fall back to plain red marks
    return null;
  }
  const c = surface.getCanvas();
  const f = Skia.Paint();
  f.setAntiAlias(true);
  const line = Skia.Paint();
  line.setAntiAlias(true);
  line.setStyle(PaintStyle.Stroke);
  line.setStrokeCap(StrokeCap.Round);
  const grey = (v: number) => Skia.Color(`rgb(${v}, ${v}, ${v})`);
  const ring = (cx: number, n: number, dist: number, r: number, rot: number, lum: number, w: number): void => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * dist;
      const y = ROSE_CELL / 2 + Math.sin(a) * dist;
      f.setColor(grey(lum));
      c.drawCircle(x, y, r, f);
      line.setColor(grey(84));
      line.setStrokeWidth(w);
      c.drawCircle(x, y, r, line);
    }
  };
  const heart = (cx: number, turns: number, w: number): void => {
    const b = Skia.PathBuilder.Make();
    for (let i = 0; i <= turns; i++) {
      const a = i * 0.7;
      const rr = 1 + i * 0.62;
      const x = cx + Math.cos(a) * rr;
      const y = ROSE_CELL / 2 + Math.sin(a) * rr;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    line.setColor(grey(70));
    line.setStrokeWidth(w);
    c.drawPath(b.detach(), line);
  };
  // Cell 0 — the full rose: three rings, brightest at the heart.
  let cx = ROSE_CELL * 0.5;
  ring(cx, 6, 17, 12.5, 0, 176, 2.2);
  ring(cx, 5, 10, 10.5, 0.5, 218, 2);
  ring(cx, 3, 4.5, 7, 0.2, 255, 1.8);
  heart(cx, 9, 1.8);
  // Cell 1 — the bud: two rings, bolder lines (it's drawn small).
  cx = ROSE_CELL * 1.5;
  ring(cx, 5, 14, 14, 0.3, 190, 3);
  ring(cx, 3, 6, 10, 0.9, 250, 2.6);
  heart(cx, 6, 2.6);
  // Cell 2 — a leaf sprig: three leaves fanned off a stem, midribs dark.
  cx = ROSE_CELL * 2.5;
  const cy = ROSE_CELL / 2;
  line.setColor(grey(150));
  line.setStrokeWidth(3);
  c.drawLine(cx - 28, cy, cx + 8, cy, line);
  for (const [ox, ang, len] of [[-16, -0.75, 24], [-4, 0.7, 25], [6, -0.12, 24]] as const) {
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    f.setColor(grey(235));
    c.drawPath(teardropPath(cx + ox + ux * 5, cy + uy * 5, ux * len, uy * len, 8), f);
    line.setColor(grey(120));
    line.setStrokeWidth(1.6);
    c.drawLine(cx + ox, cy, cx + ox + ux * (len + 2), cy + uy * (len + 2), line);
  }
  // Cell 3 — one loose petal, creased.
  cx = ROSE_CELL * 3.5;
  f.setColor(grey(235));
  c.drawPath(teardropPath(cx - 12, cy, 38, 0, 17), f);
  line.setColor(grey(120));
  line.setStrokeWidth(2);
  c.drawLine(cx - 18, cy, cx + 12, cy, line);
  roseAtlas = surface.makeImageSnapshot();
  return roseAtlas;
};

const atlasPaint = Skia.Paint();
atlasPaint.setAntiAlias(true);
// Two persistent batches (greens draw under reds) — truncated per flush.
const greenSrcs: SkRect[] = [];
const greenDsts: SkRSXform[] = [];
const greenCols: SkColor[] = [];
const redSrcs: SkRect[] = [];
const redDsts: SkRSXform[] = [];
const redCols: SkColor[] = [];

const withAlpha = (c: SkColor, a: number): SkColor =>
  a >= 1 ? c : Float32Array.of(c[0]!, c[1]!, c[2]!, c[3]! * a);

/** How open a mark is, 0 → 1 with a little overshoot, after its stagger. */
const bloomScale = (d: BloodDecal, nowMs: number): number => {
  const t = (nowMs - d.bornMs - hash01(d.seed, 3) * BLOOM_STAGGER_MS) / BLOOM_MS;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = t - 1;
  return 1 + 2.4 * u * u * u + 1.4 * u * u; // ease-out-back
};

/** Queue one rose mark's sprites at openness `k`. Everything is derived from
 *  the decal's frozen seed, so a mark is the same flower on every rebuild. */
const emitRose = (d: BloodDecal, nowMs: number, idx: number, life: number, k: number): void => {
  if (k <= 0) return;
  const red = withAlpha(ROSE_REDS[Math.floor(d.seed) % ROSE_REDS.length]![idx]!, life);
  const green = withAlpha(ROSE_GREEN[idx]!, life);
  const spin = d.seed * 2.399;
  const put = (
    srcs: SkRect[],
    dsts: SkRSXform[],
    cols: SkColor[],
    src: SkRect,
    col: SkColor,
    x: number,
    y: number,
    radius: number,
    rad: number,
  ): void => {
    srcs.push(src);
    dsts.push(Skia.RSXformFromRadians((radius * k) / ROSE_SPRITE_R, rad, x, y, ROSE_CELL / 2, ROSE_CELL / 2));
    cols.push(col);
  };

  if (d.dx !== undefined && d.dy !== undefined) {
    // A flung streak → a leafy sprig lying along it, sometimes bud-tipped.
    const len = Math.hypot(d.dx, d.dy);
    const rad = Math.atan2(d.dy, d.dx);
    const size = Math.min(15, Math.max(6, len * 0.5 + 3));
    put(greenSrcs, greenDsts, greenCols, SRC_SPRIG, green, d.x + d.dx * 0.5, d.y + d.dy * 0.5, size, rad);
    if (hash01(d.seed, 1) < 0.55) {
      put(redSrcs, redDsts, redCols, SRC_BUD, red, d.x + d.dx, d.y + d.dy, Math.max(BUD_MIN_R, d.r * 1.9), spin);
    }
    return;
  }
  if (d.r >= POOL_MIN_R) {
    // A pool → a full rose on a collar of leaves, opening as the pool seeps.
    const r = d.r * poolGrowth(d, nowMs);
    if (d.r >= 8) {
      for (let i = 0; i < 3; i++) {
        const a = spin + i * 2.09;
        put(greenSrcs, greenDsts, greenCols, SRC_SPRIG, green, d.x + Math.cos(a) * r * 0.75, d.y + Math.sin(a) * r * 0.75, r * 0.95, a);
      }
    }
    put(redSrcs, redDsts, redCols, SRC_ROSE, red, d.x, d.y, r * 1.12, spin + (r / d.r - 1) * 1.4);
    return;
  }
  // A drop → a bud if it's big enough to be one, else foliage or a petal.
  const h = hash01(d.seed, 2);
  if (d.r >= 2.4 || h > 0.82) {
    put(redSrcs, redDsts, redCols, SRC_BUD, red, d.x, d.y, Math.max(BUD_MIN_R, d.r * 1.7), spin);
  } else if (h < 0.5) {
    put(greenSrcs, greenDsts, greenCols, SRC_SPRIG, green, d.x, d.y, 5.5, spin);
  } else {
    put(redSrcs, redDsts, redCols, SRC_PETAL, red, d.x, d.y, 3.6, spin);
  }
};

const flushRoses = (canvas: SkCanvas): void => {
  const img = ensureRoseAtlas();
  if (img && greenDsts.length > 0) {
    canvas.drawAtlas(img, greenSrcs, greenDsts, atlasPaint, BlendMode.Modulate, greenCols);
  }
  if (img && redDsts.length > 0) {
    canvas.drawAtlas(img, redSrcs, redDsts, atlasPaint, BlendMode.Modulate, redCols);
  }
  greenSrcs.length = greenDsts.length = greenCols.length = 0;
  redSrcs.length = redDsts.length = redCols.length = 0;
};

// ── Starblood ───────────────────────────────────────────────────────────────
// Replaces ICHOR, cut after two device passes (2026-09-19): translucent gold
// liquid on tan sand "kinda just looks like piss" (Tom) — on this sand COLD
// and DARK reads, warm vanishes or worse.
//
// v2 (same day). v1 was the default liquid renderer with indigo ramps and
// white dots, and on device it "reads as just purple blood with specks of
// white in it" (Tom) — the first-roses mistake again: same marks, new colour.
// So the marks stop being liquid. The spill is a HOLE INTO THE NIGHT SKY,
// drawn in two layers. UNDER: every mark lays a soft-edged dark void with no
// rim of its own, so where marks crowd (round the body, along a jet) they
// melt into ONE irregular patch of night rather than a pile of rimmed beads
// — which is exactly what the first v2 cut looked like at phone scale. OVER:
// the lights. A minority of marks carry a four-point star, sizes spread wide
// (mostly small, a few big — uniform sizes were the other half of "beads");
// the smallest marks are just dark stardust. Pools add a NEBULA — magenta and
// teal cloud over a field of pinpricks; multi-hue is what says "galaxy"
// rather than "purple". Some longer streaks and some neighbouring stars are
// joined by thin CONSTELLATION LINES — sparingly: a jet's many parallel
// streaks all lined up read as hatching. Everything is sprites from one atlas
// baked once — which is also how it gets SOFT glowing edges for free (the
// gradients are paid for at bake time, never a blur at runtime): two
// drawAtlas calls + one drawPath for all the lines.
//
// And it IGNITES: each star pops out of nothing under a white flare that
// dies away, staggered by seed so a kill's spray comes out like stars at
// dusk. Per-frame, only for marks under ~0.7s old (drawBloomingBlood) — then
// static forever. No twinkle: Tom found ichor's "incredibly distracting".
const STAR_CELL = 64;
const NEBULA_CELL = 128;
const SRC_NEBULA = Skia.XYWHRect(0, 0, NEBULA_CELL, NEBULA_CELL);
const SRC_VOID = Skia.XYWHRect(NEBULA_CELL, 0, STAR_CELL, STAR_CELL);
const SRC_STAR = Skia.XYWHRect(NEBULA_CELL + STAR_CELL, 0, STAR_CELL, STAR_CELL);
const SRC_FLARE = Skia.XYWHRect(NEBULA_CELL, STAR_CELL, STAR_CELL, STAR_CELL);
const SRC_WISP = Skia.XYWHRect(NEBULA_CELL + STAR_CELL, STAR_CELL, STAR_CELL, STAR_CELL);
const SRC_CLOUD = Skia.XYWHRect(NEBULA_CELL + STAR_CELL * 2, 0, STAR_CELL, STAR_CELL);
/** The art's radius inside a cell, as a fraction of the cell. */
const STAR_ART = 30 / 64;
/** A small mark's smoke: at the follow camera (~0.5×) nothing under a few
 *  world px reads as anything but a speck, so the spray is drawn as SOFT,
 *  generous wisps that pile up into smoky arms — masses of colour are what a
 *  phone shows; beads and needles are what it doesn't. */
const WISP_MIN_R = 5.5;
const WISP_SCALE = 3.2;
const WISP_ALPHA = 0.62;
/** What share of small marks carry a star at all / a cloud of colour. */
const STAR_SHARE = 0.3;
const CLOUD_SHARE = 0.24;
/** Cloud tints (Modulate over a white puff): nebula magenta and teal. */
const CLOUD_TINTS = [
  buildRamp([236, 84, 218], [170, 70, 170]),
  buildRamp([56, 220, 228], [60, 160, 176]),
];
const CLOUD_ALPHA = 0.42;
/** Full-colour sprites: the tint only DIMS them as they age (fresh → set). */
const STAR_DIM = buildRamp([255, 255, 255], [178, 172, 200]);
const C_LINE_DARK = Skia.Color("#120b40");
const C_LINE_LIGHT = Skia.Color("#d9ccff");
/** Drops this close (world px) may be joined into a constellation. */
const LINK_MIN = 12;
const LINK_MAX = 40;
const LINK_SHARE = 0.4;
/** Only streaks at least this long draw as a line, and only some of those. */
const LINE_MIN_LEN = 14;
const LINE_SHARE = 0.4;

let starAtlas: SkImage | null = null;
let starAtlasFailed = false;
const ensureStarAtlas = (): SkImage | null => {
  if (starAtlas || starAtlasFailed) return starAtlas;
  const surface = Skia.Surface.Make(NEBULA_CELL + STAR_CELL * 3, NEBULA_CELL);
  if (!surface) {
    starAtlasFailed = true; // → starblood marks simply don't draw
    return null;
  }
  const c = surface.getCanvas();
  const p = Skia.Paint();
  p.setAntiAlias(true);
  const radial = (cx: number, cy: number, r: number, stops: [string, number][]): void => {
    p.setShader(
      Skia.Shader.MakeRadialGradient(
        vec(cx, cy),
        r,
        stops.map(([col]) => Skia.Color(col)),
        stops.map(([, at]) => at),
        TileMode.Clamp,
      ),
    );
    c.drawCircle(cx, cy, r, p);
    p.setShader(null);
  };
  /** A light: a soft violet-white halo under a hard white four-point star. */
  const star = (cx: number, cy: number, r: number, halo: boolean): void => {
    if (halo) {
      radial(cx, cy, r * 0.8, [
        ["rgba(214, 196, 255, 0.85)", 0],
        ["rgba(170, 130, 255, 0)", 1],
      ]);
    }
    p.setColor(Skia.Color("#ffffff"));
    c.drawPath(starPath(cx, cy, r), p);
    c.drawCircle(cx, cy, Math.max(0.9, r * 0.2), p);
  };

  // The nebula (128px) — LIGHT ONLY, it sits over a void: two clouds of
  // colour, a field of pinpricks, three stars.
  const n = NEBULA_CELL / 2;
  radial(n - 15, n - 10, 34, [
    ["rgba(236, 84, 218, 0.7)", 0],
    ["rgba(236, 84, 218, 0)", 1],
  ]);
  radial(n + 17, n + 14, 30, [
    ["rgba(56, 220, 228, 0.6)", 0],
    ["rgba(56, 220, 228, 0)", 1],
  ]);
  p.setColor(Skia.Color("#ffffff"));
  for (let i = 0; i < 18; i++) {
    const a = hash01(i, 1) * Math.PI * 2;
    const rr = Math.sqrt(hash01(i, 2)) * 42;
    p.setAlphaf(0.55 + 0.45 * hash01(i, 3));
    c.drawCircle(n + Math.cos(a) * rr, n + Math.sin(a) * rr, 0.9 + hash01(i, 4) * 1.1, p);
  }
  p.setAlphaf(1);
  star(n + 8, n - 14, 14, true);
  star(n - 20, n + 17, 8.5, true);
  star(n + 27, n + 4, 5.5, false);

  // The void: night-black heart, indigo, a violet fringe that fades to clear.
  // No hard rim — overlapping voids must melt into one patch of sky.
  const v = NEBULA_CELL + STAR_CELL / 2;
  radial(v, STAR_CELL / 2, 30, [
    ["rgba(6, 4, 26, 1)", 0],
    ["rgba(14, 9, 58, 1)", 0.5],
    ["rgba(44, 26, 140, 0.92)", 0.72],
    ["rgba(128, 84, 240, 0.5)", 0.88],
    ["rgba(150, 100, 255, 0)", 1],
  ]);

  // A lone star.
  star(NEBULA_CELL + STAR_CELL * 1.5, STAR_CELL / 2, 28, true);

  // The ignition flare: a bigger, softer burst — it sits OVER a mark as it
  // lands and dies away.
  const fl = NEBULA_CELL + STAR_CELL / 2;
  const fy = STAR_CELL * 1.5;
  radial(fl, fy, 26, [
    ["rgba(255, 255, 255, 0.95)", 0],
    ["rgba(206, 184, 255, 0.5)", 0.35],
    ["rgba(170, 130, 255, 0)", 1],
  ]);
  p.setColor(Skia.Color("#ffffff"));
  c.drawPath(starPath(fl, fy, 30), p);

  // The wisp: smoke, not a disc — no solid heart, all falloff.
  radial(NEBULA_CELL + STAR_CELL * 1.5, fy, 30, [
    ["rgba(10, 6, 46, 0.95)", 0],
    ["rgba(26, 16, 104, 0.6)", 0.45],
    ["rgba(84, 52, 200, 0.22)", 0.78],
    ["rgba(120, 80, 240, 0)", 1],
  ]);
  // The cloud: a white puff, tinted magenta or teal at draw time.
  radial(NEBULA_CELL + STAR_CELL * 2.5, STAR_CELL / 2, 30, [
    ["rgba(255, 255, 255, 0.9)", 0],
    ["rgba(255, 255, 255, 0.35)", 0.5],
    ["rgba(255, 255, 255, 0)", 1],
  ]);
  starAtlas = surface.makeImageSnapshot();
  return starAtlas;
};

// Two persistent batches: the voids draw UNDER every light.
const voidSrcs: SkRect[] = [];
const voidDsts: SkRSXform[] = [];
const voidCols: SkColor[] = [];
const starSrcs: SkRect[] = [];
const starDsts: SkRSXform[] = [];
const starCols: SkColor[] = [];
/** Every constellation line this pass, as ONE path (dark under, light over). */
let starLines = Skia.PathBuilder.Make();
let starLineCount = 0;
/** The previous STARRED drop this pass — the candidate to link to. */
let linkFrom: { x: number; y: number } | null = null;

const linePaint = Skia.Paint();
linePaint.setAntiAlias(true);
linePaint.setStyle(PaintStyle.Stroke);
linePaint.setStrokeCap(StrokeCap.Round);

const putSprite = (
  srcs: SkRect[],
  dsts: SkRSXform[],
  cols: SkColor[],
  src: SkRect,
  cell: number,
  col: SkColor,
  x: number,
  y: number,
  radius: number,
  rad: number,
): void => {
  srcs.push(src);
  dsts.push(Skia.RSXformFromRadians(radius / (cell * STAR_ART), rad, x, y, cell / 2, cell / 2));
  cols.push(col);
};

/** Queue one starblood mark at openness `k` (1 = settled). */
const emitStar = (d: BloodDecal, nowMs: number, idx: number, life: number, k: number): void => {
  if (k <= 0) return;
  const tint = withAlpha(STAR_DIM[idx]!, life);
  const spin = d.seed * 2.399;
  // The flare: bright as the light appears, gone by the time it has settled.
  const flare = k < 1 ? withAlpha(STAR_DIM[0]!, (1 - k) * (1 - k)) : null;

  if (d.r >= POOL_MIN_R && d.dx === undefined) {
    const r = d.r * poolGrowth(d, nowMs) * 1.35; // soft edges need the room
    putSprite(voidSrcs, voidDsts, voidCols, SRC_VOID, STAR_CELL, tint, d.x, d.y, r * k, spin);
    putSprite(starSrcs, starDsts, starCols, SRC_NEBULA, NEBULA_CELL, tint, d.x, d.y, r * 0.8 * k, spin);
    if (flare) putSprite(starSrcs, starDsts, starCols, SRC_FLARE, STAR_CELL, flare, d.x, d.y, r * 1.4, spin);
    return;
  }

  const streak = d.dx !== undefined && d.dy !== undefined;
  const tipX = streak ? d.x + d.dx! : d.x;
  const tipY = streak ? d.y + d.dy! : d.y;
  const vr = Math.max(WISP_MIN_R, d.r * WISP_SCALE);
  const smoke = withAlpha(STAR_DIM[idx]!, WISP_ALPHA * life);
  putSprite(voidSrcs, voidDsts, voidCols, SRC_WISP, STAR_CELL, smoke, tipX, tipY, vr * k, spin);
  if (streak) {
    // A streak smokes along its whole length, thinning toward the body.
    putSprite(voidSrcs, voidDsts, voidCols, SRC_WISP, STAR_CELL, smoke, d.x + d.dx! * 0.5, d.y + d.dy! * 0.5, vr * 0.85 * k, spin);
    putSprite(voidSrcs, voidDsts, voidCols, SRC_WISP, STAR_CELL, smoke, d.x, d.y, vr * 0.65 * k, spin);
  }
  // Some wisps carry a breath of nebula colour (it only shows over the dark).
  if (hash01(d.seed, 8) < CLOUD_SHARE) {
    const cloud = CLOUD_TINTS[hash01(d.seed, 9) < 0.5 ? 0 : 1]![idx]!;
    putSprite(starSrcs, starDsts, starCols, SRC_CLOUD, STAR_CELL, withAlpha(cloud, CLOUD_ALPHA * life), tipX, tipY, vr * 0.9 * k, spin);
  }

  // Most marks are smoke alone. The starred minority get a light that sits
  // INSIDE its smoke — mostly pinpricks, a rare big one.
  if (hash01(d.seed, 2) > STAR_SHARE) return;
  const big = hash01(d.seed, 6);
  const sr = vr * (0.28 + 0.62 * big * big * big);
  putSprite(starSrcs, starDsts, starCols, SRC_STAR, STAR_CELL, tint, tipX, tipY, sr * k, spin);
  if (flare) putSprite(starSrcs, starDsts, starCols, SRC_FLARE, STAR_CELL, flare, tipX, tipY, vr * 1.2, spin);
  if (k < 1) return;

  // Constellation lines, sparingly: a long streak back to where it left the
  // body's side, or a hop to the last starred neighbour.
  if (streak && Math.hypot(d.dx!, d.dy!) >= LINE_MIN_LEN && hash01(d.seed, 7) < LINE_SHARE) {
    starLines.moveTo(d.x, d.y).lineTo(tipX, tipY);
    starLineCount++;
  } else if (linkFrom) {
    const gap = Math.hypot(tipX - linkFrom.x, tipY - linkFrom.y);
    if (gap >= LINK_MIN && gap <= LINK_MAX && hash01(d.seed, 5) < LINK_SHARE) {
      starLines.moveTo(linkFrom.x, linkFrom.y).lineTo(tipX, tipY);
      starLineCount++;
    }
  }
  linkFrom = { x: tipX, y: tipY };
};

const flushStars = (canvas: SkCanvas): void => {
  const img = ensureStarAtlas();
  if (img && voidDsts.length > 0) {
    canvas.drawAtlas(img, voidSrcs, voidDsts, atlasPaint, BlendMode.Modulate, voidCols);
  }
  if (starLineCount > 0) {
    const path = starLines.detach();
    linePaint.setColor(C_LINE_DARK);
    linePaint.setAlphaf(0.7);
    linePaint.setStrokeWidth(2);
    canvas.drawPath(path, linePaint);
    linePaint.setColor(C_LINE_LIGHT);
    linePaint.setAlphaf(0.85);
    linePaint.setStrokeWidth(0.8);
    canvas.drawPath(path, linePaint);
    starLines = Skia.PathBuilder.Make();
    starLineCount = 0;
  }
  if (img && starDsts.length > 0) {
    canvas.drawAtlas(img, starSrcs, starDsts, atlasPaint, BlendMode.Modulate, starCols);
  }
  voidSrcs.length = voidDsts.length = voidCols.length = 0;
  starSrcs.length = starDsts.length = starCols.length = 0;
  linkFrom = null;
};

/**
 * The per-frame pass for marks still ANIMATING — roses opening, stars
 * igniting. Walks
 * only the young tail of the (birth-ordered) field, so it costs nothing when
 * nobody is bleeding flowers. `cacheBuiltMs` is when the scar picture was
 * last recorded: a mark the cache already drew fully open is skipped here, so
 * the handoff is seamless — never absent, never doubled.
 */
export const drawBloomingBlood = (
  canvas: SkCanvas,
  blood: readonly BloodDecal[],
  nowMs: number,
  cacheBuiltMs: number,
): void => {
  for (let i = blood.length - 1; i >= 0; i--) {
    const d = blood[i]!;
    if (cacheBuiltMs - d.bornMs >= BLOOM_TOTAL_MS) break;
    if (d.mat === "roses") emitRose(d, nowMs, 0, 1, bloomScale(d, nowMs));
    else if (d.mat === "starblood") emitStar(d, nowMs, 0, 1, bloomScale(d, nowMs));
  }
  flushRoses(canvas);
  flushStars(canvas);
};

/**
 * Floor blood. Small drops and flung spray are cheap solid-colour shapes (the
 * bulk — a kill throws ~90); only the few big pools pay for a tonal radial
 * gradient, a coagulated rim, a drying clot and a wet sheen. Recorded into the
 * cached scar picture, not per frame — no viewport cull here (the cache is
 * camera-independent; raster quick-rejects offscreen ops by bounds).
 */
export const drawBlood = (
  canvas: SkCanvas,
  blood: readonly BloodDecal[],
  nowMs: number,
): void => {
  for (const d of blood) {
    const life = decalAlpha(d, nowMs) / d.alpha; // fade curve, 1 → 0 at ttl
    if (life <= 0) continue;
    const w = bloodWetness(nowMs - d.bornMs);
    const idx = rampIdx(w);
    const alpha = Math.min(1, d.alpha * BLOOD_ALPHA_BOOST) * life;
    const small = d.r < POOL_MIN_R || d.dx !== undefined;

    if (d.mat === "roses") {
      // Still opening → the per-frame pass owns it (drawBloomingBlood).
      if (nowMs - d.bornMs >= BLOOM_TOTAL_MS) emitRose(d, nowMs, idx, life, 1);
      continue;
    }

    if (d.mat === "starblood") {
      if (nowMs - d.bornMs >= BLOOM_TOTAL_MS) emitStar(d, nowMs, idx, life, 1);
      continue;
    }

    const m = DEFAULT;

    // Drops + flung spray → the world-coord baked path, single solid fill.
    if (small) {
      bloodFill.setColor(m.body[idx]!);
      bloodFill.setAlphaf(alpha);
      canvas.drawPath(d.path, bloodFill);
      if (m.outline) {
        bloodStroke.setColor(m.outline[idx]!);
        bloodStroke.setAlphaf(Math.min(1, alpha * 1.4));
        bloodStroke.setStrokeWidth(0.8);
        canvas.drawPath(d.path, bloodStroke);
      }
      continue;
    }

    // Pools → the full treatment. The path is baked at unit radius, so draw
    // in decal-local space: translate+scale places it AND makes the cached
    // unit gradient land exactly where the per-pool one used to. Death pools
    // additionally SEEP — the scale rides poolGrowth, spreading the stain to
    // POOL_GROWTH× over POOL_GROW_MS (bits-blood.md §5).
    const dry = 1 - w;
    const g = poolGrowth(d, nowMs);
    canvas.save();
    canvas.translate(d.x, d.y);
    canvas.scale(d.r * g, d.r * g);
    bloodFill.setShader(m.gradients[idx]!);
    bloodFill.setAlphaf(alpha);
    canvas.drawPath(d.path, bloodFill);
    bloodFill.setShader(null);

    // Tacky clot sets in the centre as it dries. It stays at BIRTH scale —
    // the thick core doesn't ride the thinning seep edge outward.
    if (dry > 0.05 && d.clotPath) {
      bloodFill.setColor(m.clot[idx]!);
      bloodFill.setAlphaf(Math.min(1, 0.42 * dry) * life);
      canvas.save();
      canvas.scale(1 / g, 1 / g);
      canvas.drawPath(d.clotPath, bloodFill);
      canvas.restore();
    }

    // Coffee-ring rim thickens and darkens with age. Widths are in local
    // units (×d.r on screen): same numbers as the old world-space
    // max(1, r * (0.09 + 0.14 * dry)).
    if (d.r >= 8 || m.outline) {
      bloodStroke.setColor(m.rim[idx]!);
      bloodStroke.setAlphaf(Math.min(1, 0.45 + 0.4 * dry) * life);
      bloodStroke.setStrokeWidth(Math.max(1 / d.r, 0.09 + 0.14 * dry));
      canvas.drawPath(d.path, bloodStroke);
    }

    // Wet specular sheen — fresh pools only, dies as it sets.
    if (w > 0.3) {
      bloodFill.setColor(m.sheen);
      bloodFill.setAlphaf(m.sheenAlpha * w * life);
      canvas.drawCircle(-0.34, -0.44, 0.6, bloodFill);
    }
    canvas.restore();
  }
  flushRoses(canvas);
  flushStars(canvas);
  bloodFill.setShader(null);
  bloodFill.setAlphaf(1);
  bloodStroke.setAlphaf(1);
};

/** Airborne colour per material — flying blood catches the light. */
const AIR: Record<BloodId, SkColor> = {
  default: DEFAULT.edge[0]!,
  starblood: Skia.Color("#c9b4ff"),
  roses: ROSE_REDS[1]![0]!,
};

/**
 * Death-spray droplets still in the air (bits-blood.md §2) — drawn per frame
 * OVER the bodies (they're flying, not floor), easing out from the corpse to
 * the landing point where BloodField.update will stamp the decal. Fresh
 * arterial bright with a short motion tail that shrinks as the drop
 * decelerates; ≤~100 tiny shapes for a quarter second per kill — per-frame
 * recording noise.
 */
export const drawFlyingBlood = (
  canvas: SkCanvas,
  flying: readonly FlyingDrop[],
  nowMs: number,
): void => {
  for (const drop of flying) {
    const t = Math.min(1, (nowMs - drop.bornMs) / (drop.landMs - drop.bornMs));
    const ease = 1 - (1 - t) * (1 - t); // launched fast, settles in
    const px = drop.x0 + (drop.tx - drop.x0) * ease;
    const py = drop.y0 + (drop.ty - drop.y0) * ease;
    // v3 (bits-blood.md §8a): airborne drops draw BIGGER than they land —
    // the old ≤2.4px clamp made the flight beat invisible on a phone. The
    // floor decal is still the small droplet it always was.
    const air = Math.min(drop.r * 1.6, 5.5) * (1 - 0.25 * t);
    // A rose kill throws petals AND leaves — all-red specks in the air was
    // the last place the old "pink blood" read could sneak back in.
    const colour =
      drop.mat === "roses" && hash01(drop.tx, drop.ty) < 0.4 ? ROSE_GREEN[0]! : AIR[drop.mat];
    bloodFill.setColor(colour);
    bloodFill.setAlphaf(0.9);
    canvas.drawCircle(px, py, air, bloodFill);
    const tail = 14 * (1 - t);
    if (tail > 1.5) {
      const len = Math.hypot(drop.tx - drop.x0, drop.ty - drop.y0) || 1;
      bloodStroke.setColor(colour);
      bloodStroke.setAlphaf(0.45);
      bloodStroke.setStrokeWidth(Math.min(air, 3) * 0.8);
      canvas.drawLine(
        px,
        py,
        px - ((drop.tx - drop.x0) / len) * tail,
        py - ((drop.ty - drop.y0) / len) * tail,
        bloodStroke,
      );
    }
  }
  bloodFill.setAlphaf(1);
  bloodStroke.setAlphaf(1);
};
