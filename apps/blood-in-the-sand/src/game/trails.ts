/**
 * Trails — a short wake behind a moving fighter (bits-cosmetics.md).
 * PROTOTYPES: Your Colours (a three-band streamer) and Comet, worn from the
 * dev menu. Client-derived from snapshot positions, never networked.
 *
 * Readability rules these are built to: a trail is SHORT (under half a
 * second of movement), narrower than the body, drawn under it, and gone when
 * you stand still — it never says more about where someone is than their
 * body already does, and the team ring stays the team read.
 *
 * PERF — one drawVertices per trail per frame, nothing else:
 *  - Each fighter keeps a fixed ring buffer of recent positions (typed
 *    arrays, written in place — no per-frame allocation to track a trail).
 *  - The ribbon is a triangle mesh with PER-VERTEX COLOUR: the fade along
 *    its length, the taper, the hard band edges (Your Colours) and the soft
 *    glow falloff (Comet) are all just vertex colours the GPU interpolates.
 *    No gradient shader per frame, no blur, no path building.
 *  - Point and colour objects are preallocated per track and mutated; the
 *    only per-frame allocation is the SkVertices itself, disposed as soon as
 *    the picture has recorded it.
 */
import {
  BlendMode,
  Skia,
  TileMode,
  vec,
  VertexMode,
  type SkCanvas,
} from "@shopify/react-native-skia";
import type { PlayerSnapshot } from "@heroic/blood-in-the-sand-sim";
import { TRAIL_COLOUR_PRESETS, type TrailId } from "./cosmeticIds";

/** How long a sample lives — the trail's length in time. Per-wear (the dev
 *  menu's TRAIL LENGTH dial). 0.48s came back "too short" (Tom, pass 2);
 *  he settled on 1.3s with the dial: "it's what looks best" (2026-09-19). */
export const TRAIL_LENGTH_DEFAULT_MS = 1300;
/** A new sample every this many px of travel. */
const SAMPLE_PX = 8;
/** Ring capacity — the default (and longest) setting, 1.3s, at a 280px/s
 *  sprint is ~46 samples. A dash outruns that; the ring just forgets the oldest. */
const CAP = 48;
/** A jump this big between frames is a respawn / round reset, not a stride. */
const TELEPORT_PX = 140;
/** Sprint speed, px/s — the Comet's brightness and width ride speed / this. */
const SPRINT = 280;

/** Your Colours: total ribbon width (the body is 36 across). */
const COLOURS_W = 12;
/** Comet: core-to-edge half width at full speed. */
const COMET_W = 11;

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const PRESET_RGB = TRAIL_COLOUR_PRESETS.map((p) => p.colours.map(hexRgb));
/** Comet, core → mid → edge: white-hot, pink, violet. PLASMA, not fire — a
 *  gold/ember comet was the first cut and the headless preview showed it
 *  vanishing into the sand (warm glow on warm tan has nothing to push
 *  against). Violet is also clear of the friend blue and the foe red. */
const COMET_RGB: [number, number, number][] = [
  [1, 0.96, 1],
  [1, 0.42, 0.84],
  [0.5, 0.18, 0.92],
];

/** Vertices per row (a row = one cross-section of the ribbon). Your Colours
 *  duplicates the two inner edges so the bands stay HARD-edged; Comet's seven
 *  columns interpolate clear → edge → mid → core and back for the soft
 *  falloff. */
const COLS_COLOURS = 6;
const COLS_COMET = 7;
const MAX_ROWS = CAP + 1;
/** Your Colours: each column's offset across the ribbon, in widths. */
const BAND_EDGES = [-0.5, -1 / 6, -1 / 6, 1 / 6, 1 / 6, 0.5];
/** Comet: column offset (half-widths), colour stop and opacity — the outer
 *  columns are fully transparent, which IS the glow falloff. */
const COMET_OFFS = [-1, -0.62, -0.26, 0, 0.26, 0.62, 1];
const COMET_TONES = [2, 2, 1, 0, 1, 2, 2];
const COMET_ALPHAS = [0, 0.62, 0.92, 1, 0.92, 0.62, 0];

/** Triangle indices for a full-length mesh of `cols` columns; a shorter
 *  trail slices a prefix. `pairs`: which column pairs form a strip. */
const buildIndices = (cols: number, pairs: readonly [number, number][]): number[] => {
  const out: number[] = [];
  for (let r = 0; r < MAX_ROWS - 1; r++) {
    for (const [a, b] of pairs) {
      const a0 = r * cols + a;
      const b0 = r * cols + b;
      const a1 = a0 + cols;
      const b1 = b0 + cols;
      out.push(a0, b0, a1, b0, b1, a1);
    }
  }
  return out;
};
const PAIRS_COLOURS: [number, number][] = [[0, 1], [2, 3], [4, 5]];
const PAIRS_COMET: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]];
const IDX_COLOURS = buildIndices(COLS_COLOURS, PAIRS_COLOURS);
const IDX_COMET = buildIndices(COLS_COMET, PAIRS_COMET);

/** SUBTLETY (Tom's device pass, 2026-09-19: the first cut was "waayy too
 *  distracting in a fight"). A trail is a whisper behind the body, never a
 *  banner: mostly transparent, thin, and it barely LAYS at all until you're
 *  actually travelling — the short back-and-forth steps of a melee scrap
 *  stay under FADE_IN_SPEED and leave next to nothing behind them. */
export const TRAIL_OPACITY_DEFAULT = 0.4;
/** The Comet is soft-edged already, so it carries a little more than the
 *  hard-banded streamer at the same setting. */
const COMET_OPACITY_GAIN = 1.4;
/** px/s: a sample laid below the first is invisible, above the second full. */
const FADE_IN_SPEED: readonly [number, number] = [70, 190];

export interface TrailWear {
  id: Exclude<TrailId, "none">;
  /** Overall opacity, 0–1 (the dev menu's dial; TRAIL_OPACITY_DEFAULT). */
  opacity: number;
  /** How long the wake lingers, ms (the dial; TRAIL_LENGTH_DEFAULT_MS). */
  lengthMs: number;
  /** Index into TRAIL_COLOUR_PRESETS (Your Colours). */
  colours: number;
}

interface Track {
  xs: Float32Array;
  ys: Float32Array;
  ts: Float64Array;
  /** Per-sample strength (0–1) and energy, FROZEN when the sample was laid.
   *  Pass 1 scaled the whole ribbon by the fighter's CURRENT speed, so the
   *  moment you stopped the entire trail blinked out behind you (Tom, pass
   *  2). A stretch of wake now keeps the strength it was laid with and only
   *  ever fades by age — stop, and it lingers and dissolves. */
  ks: Float32Array;
  es: Float32Array;
  /** Index of the NEWEST sample; samples run backward from here. */
  head: number;
  count: number;
  /** Last rendered-frame position + time, for the teleport guard and speed. */
  px: number;
  py: number;
  pMs: number;
  /** Smoothed speed, px/s. */
  speed: number;
  /** Dash flare, 1 → 0 after a dash. */
  flare: number;
  wear: TrailWear;
  /** Mutable on purpose — SkPoint is readonly, these are rewritten in place. */
  points: { x: number; y: number }[];
  colors: Float32Array[];
}

/** WHITE, deliberately: drawVertices blends the vertex colours against the
 *  paint's colour, and a fresh paint is black — Modulate against black draws
 *  a black ribbon (caught in the headless preview). White × colour = colour. */
const paint = Skia.Paint();
paint.setAntiAlias(true);
paint.setColor(Skia.Color("#ffffff"));
/** The Comet's head: a small glow under the body, unit gradient built once. */
const headGlow = Skia.Paint();
headGlow.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(255, 150, 225, 0.8)"), Skia.Color("rgba(128, 46, 235, 0)")],
    [0, 1],
    TileMode.Clamp,
  ),
);

const makeTrack = (p: PlayerSnapshot, wear: TrailWear, nowMs: number): Track => {
  const cols = Math.max(COLS_COLOURS, COLS_COMET);
  return {
    xs: new Float32Array(CAP),
    ys: new Float32Array(CAP),
    ts: new Float64Array(CAP),
    ks: new Float32Array(CAP),
    es: new Float32Array(CAP),
    head: 0,
    count: 0,
    px: p.x,
    py: p.y,
    pMs: nowMs,
    speed: 0,
    flare: 0,
    wear,
    points: Array.from({ length: MAX_ROWS * cols }, () => ({ x: 0, y: 0 })),
    colors: Array.from({ length: MAX_ROWS * cols }, () => new Float32Array(4)),
  };
};

export class TrailField {
  private readonly tracks = new Map<number, Track>();

  /** Once per rendered frame (the blood.update slot). `wearOf` says what
   *  each fighter has on — null for nothing. */
  update(
    players: readonly PlayerSnapshot[],
    nowMs: number,
    wearOf: (playerId: number) => TrailWear | null,
  ): void {
    for (const p of players) {
      const wear = p.alive ? wearOf(p.id) : null;
      if (!wear) {
        this.tracks.delete(p.id);
        continue;
      }
      let t = this.tracks.get(p.id);
      if (!t) {
        t = makeTrack(p, wear, nowMs);
        this.tracks.set(p.id, t);
      }
      t.wear = wear;
      const step = Math.hypot(p.x - t.px, p.y - t.py);
      const dt = Math.max(1, nowMs - t.pMs);
      if (step > TELEPORT_PX) t.count = 0;
      else t.speed += ((step / dt) * 1000 - t.speed) * 0.25;
      t.px = p.x;
      t.py = p.y;
      t.pMs = nowMs;
      t.flare = p.dashing ? 1 : Math.max(0, t.flare - dt / 260);

      // Old samples fall off the tail.
      while (t.count > 0) {
        const tail = (t.head - (t.count - 1) + CAP * 2) % CAP;
        if (nowMs - t.ts[tail]! < wear.lengthMs) break;
        t.count--;
      }
      // A fresh sample every SAMPLE_PX of travel.
      const moved =
        t.count === 0 ? Infinity : Math.hypot(p.x - t.xs[t.head]!, p.y - t.ys[t.head]!);
      if (moved >= SAMPLE_PX) {
        t.head = (t.head + 1) % CAP;
        t.xs[t.head] = p.x;
        t.ys[t.head] = p.y;
        t.ts[t.head] = nowMs;
        // Frozen with the sample: how hard you were travelling when you laid
        // it. The short steps of a melee scrap lay next to nothing.
        t.ks[t.head] = Math.min(
          1,
          Math.max(0, (t.speed - FADE_IN_SPEED[0]) / (FADE_IN_SPEED[1] - FADE_IN_SPEED[0])) + t.flare,
        );
        t.es[t.head] = Math.min(1.6, t.speed / SPRINT) + t.flare * 0.7;
        if (t.count < CAP) t.count++;
      }
    }
    // Fighters who left the snapshot entirely.
    if (this.tracks.size > players.length) {
      for (const id of this.tracks.keys()) {
        if (!players.some((p) => p.id === id)) this.tracks.delete(id);
      }
    }
  }

  /** Floor pass — under bodies, over the blood. */
  draw(canvas: SkCanvas, nowMs: number): void {
    for (const t of this.tracks.values()) {
      if (t.count < 2) continue;
      const comet = t.wear.id === "comet";
      const cols = comet ? COLS_COMET : COLS_COLOURS;
      const rows = t.count + 1; // row 0 is the body's live position
      const opacity = Math.min(1, t.wear.opacity * (comet ? COMET_OPACITY_GAIN : 1));
      if (comet) {
        // The head glow rides the NEWEST stretch of wake, fading with it.
        const k = t.ks[t.head]! * Math.max(0, 1 - (nowMs - t.ts[t.head]!) / t.wear.lengthMs);
        const r = (17 + 10 * t.flare) * Math.min(1, t.es[t.head]!);
        if (r > 2 && k > 0.02) {
          canvas.save();
          canvas.translate(t.px, t.py);
          canvas.scale(r, r);
          headGlow.setAlphaf(opacity * k);
          canvas.drawCircle(0, 0, 1, headGlow);
          canvas.restore();
        }
      }
      const rgb = comet ? COMET_RGB : PRESET_RGB[t.wear.colours % PRESET_RGB.length]!;

      // Row k ≥ 1 → its slot in the ring (row 1 is the newest sample).
      const at = (k: number): number => (t.head - (k - 1) + CAP * 2) % CAP;
      for (let r = 0; r < rows; r++) {
        // Row r's centre, and its neighbours for the tangent.
        const x = r === 0 ? t.px : t.xs[at(r)]!;
        const y = r === 0 ? t.py : t.ys[at(r)]!;
        // Row 0 (the body) borrows the newest sample's clock and strength, so
        // the wake stays attached to you and dissolves as ONE piece.
        const slot = at(Math.max(1, r));
        const a = Math.max(0, 1 - (nowMs - t.ts[slot]!) / t.wear.lengthMs);
        const k = t.ks[slot]!;
        const energy = t.es[slot]!;
        // Row 0 looks TWO rows back: on the frame a sample is taken, row 1
        // sits exactly on the body and a one-row tangent would be zero-length
        // (the ribbon's head would pinch to a point every few frames).
        const nr = Math.min(rows - 1, r === 0 ? 2 : r + 1);
        const pr = Math.max(0, r - 1);
        const ax = pr === 0 ? t.px : t.xs[at(pr)]!;
        const ay = pr === 0 ? t.py : t.ys[at(pr)]!;
        const bx = t.xs[at(nr)]!;
        const by = t.ys[at(nr)]!;
        const len = Math.hypot(ax - bx, ay - by) || 1;
        // Normal to the travel line.
        const nx = -(ay - by) / len;
        const ny = (ax - bx) / len;
        const base = r * cols;

        if (comet) {
          // Tapers to a point; wider and hotter the faster you move.
          const half = COMET_W * Math.min(1.5, 0.45 + energy * 0.7) * Math.pow(a, 0.7);
          for (let c = 0; c < cols; c++) {
            const pt = t.points[base + c]!;
            pt.x = x + nx * half * COMET_OFFS[c]!;
            pt.y = y + ny * half * COMET_OFFS[c]!;
            const col = t.colors[base + c]!;
            const tone = rgb[COMET_TONES[c]!]!;
            col[0] = tone[0]!;
            col[1] = tone[1]!;
            col[2] = tone[2]!;
            col[3] = COMET_ALPHAS[c]! * a * k * Math.min(1, 0.35 + energy) * opacity;
          }
        } else {
          // A streamer: holds its width, then flutters and fades at the tail.
          const flutter = Math.sin(r * 0.85 - nowMs * 0.009) * 1.4 * (1 - a);
          const w = COLOURS_W * (0.5 + 0.5 * a);
          for (let c = 0; c < cols; c++) {
            const pt = t.points[base + c]!;
            pt.x = x + nx * (w * BAND_EDGES[c]! + flutter);
            pt.y = y + ny * (w * BAND_EDGES[c]! + flutter);
            const col = t.colors[base + c]!;
            const tone = rgb[c >> 1]!;
            col[0] = tone[0]!;
            col[1] = tone[1]!;
            col[2] = tone[2]!;
            col[3] = opacity * k * Math.min(1, a * 1.3);
          }
        }
      }

      const n = rows * cols;
      const idx = comet ? IDX_COMET : IDX_COLOURS;
      const verts = Skia.MakeVertices(
        VertexMode.Triangles,
        t.points.slice(0, n),
        null,
        t.colors.slice(0, n),
        idx.slice(0, (rows - 1) * (comet ? PAIRS_COMET : PAIRS_COLOURS).length * 6),
      );
      // Modulate against the white paint = the vertex colours, untouched.
      canvas.drawVertices(verts, BlendMode.Modulate, paint);
      verts.dispose();
    }
  }
}
