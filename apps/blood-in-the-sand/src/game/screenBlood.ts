/**
 * PARKED 2026-08-29 — NOT WIRED IN. Blood on the glass (bits-blood.md §8b)
 * went through three cuts on device and Tom pulled it: "it just doesn't
 * look good enough to put out in the game". The module is kept, unwired
 * (nothing imports it), so a future attempt starts from the last shape
 * rather than nothing. Re-wiring is four hooks: `screenBlood` on
 * ArenaRenderInput drawn in recordArena's post-camera pass, a `hit()` from
 * GameScreen's lethal-hit drain, the `bits.screenBlood` settings toggle,
 * and the `bloodOnGlass` → `blood_glass` sound slot (catalogue + Forge).
 *
 * When YOU die, or you land a point-blank kill, blood hits the phone's
 * screen: a fine spray of small droplets across the WHOLE screen that snaps
 * on in a scatter over ~half a second, sits, and then the heavier drops
 * BREAK and run — a meandering, tapering trail with residue beads left
 * behind — as everything fades. Small drops, lots of them, running (Tom's
 * reads, 2026-08-29: big blobs looked like paint; a uniform linear slide
 * looked cheap). Any death within SPLAT_FAR of YOUR fighter sprays your
 * lens (that's what would happen), your own death most of all.
 *
 * Contract, same as the floor blood: client-derived, never networked, and
 * the scar cache never sees it — the layer draws per frame in the
 * screen-space pass of recordArena (after the camera pops, under the RN
 * HUD). Cost is a few dozen drawPath calls for ~3s after a qualifying kill.
 *
 * Hits arrive in WORLD coords (GameScreen doesn't know the camera) and are
 * materialised into screen-space blobs on the first frame that draws them,
 * through the camera that frame is using — at most one frame (~16ms) late,
 * which is inside the 80ms snap-on anyway.
 */
import { Skia, PaintStyle, StrokeCap, type SkCanvas, type SkPath } from "@shopify/react-native-skia";
import { blobPath } from "./blood";

// ── Tuning ─────────────────────────────────────────────────────────────────
/** Any death within this world distance of YOUR fighter sprays the lens at
 * full strength… */
export const SPLAT_NEAR = 50;
/** …tapering to nothing here ("within 100 range" — Tom). Blade reach is
 * 90: a melee exchange's kill qualifies whichever way it went; a bow kill
 * from range never does. */
export const SPLAT_FAR = 100;
/** Your own death: always the biggest spray in the game. */
export const OWN_DEATH_K = 1.25;
/** Drops per unit of k — own death ≈ 110 drops, a full-strength kill ≈ 90. */
const DROPS_PER_K = 88;
/** Drops land in a SCATTER over this window (pow-biased early, so the bulk
 * hits fast and stragglers keep arriving), never as one stamp. A late
 * second spatter (LATE_SHARE of drops) lands up to ARRIVE_LATE_MS out. */
const ARRIVE_SPREAD_MS = 420;
const ARRIVE_LATE_MS = 900;
const LATE_SHARE = 0.15;
/** Snap-on (scale 0.5 → 1), then the drop just sits until it fades. */
const SPLAT_HIT_MS = 70;
/** Alpha holds this long, then eases out — gone at SPLAT_TOTAL_MS. */
const SPLAT_HOLD_MS = 600;
const SPLAT_TOTAL_MS = 3400;
/** The run. A drop above RUN_MIN_R sits (surface tension) for a random
 * beat, then BREAKS and runs: slow start, quick middle, dying away as it
 * runs dry (smootherstep over its own RUN_MS), meandering sideways as it
 * goes, leaving a trail that's thin at the origin and widest at the head,
 * with a few residue beads stuck along it. Below RUN_MIN_R it stays put. */
const RUN_MIN_R = 2.6;
const RUN_BREAK_MIN_MS = 150;
const RUN_BREAK_MAX_MS = 1100;
const RUN_MS_MIN = 700;
const RUN_MS_MAX = 1700;
/** Drop radii (screen px) — small, always. Own death allows the top end. */
const DROP_R_MIN = 1.4;
const DROP_R_MAX = 6.5;
/** Live cap — a point-blank team-wipe can't stack forever. Oldest evicts. */
const SPLAT_MAX_DROPS = 220;
/** Share of drops thrown toward the side of the screen the spray points at
 * (the rest are uniform over the whole screen). */
const DIRECTIONAL_SHARE = 0.4;

// ── Colours — bright and wet; it's on glass, catching the light ────────────
const C_RIM = Skia.Color("#a1281c");
const C_BODY = Skia.Color("#5c0f0b");
const C_SHEEN = Skia.Color("#ffb4aa");

const fill = Skia.Paint();
fill.setAntiAlias(true);
const streak = Skia.Paint();
streak.setAntiAlias(true);
streak.setStyle(PaintStyle.Stroke);
streak.setStrokeCap(StrokeCap.Round);

export interface GlassHit {
  /** Intensity: 0..1 for a kill you landed (by distance), OWN_DEATH_K for
   * your own death. */
  k: number;
  /** Where the victim fell (world coords) — the directional share of the
   * spray fans out from its screen position. */
  wx: number;
  wy: number;
  /** Unit attacker→victim line: blood flew off the corpse's BACK toward
   * the lens, so the spray leans to that side of the screen. */
  dirX: number;
  dirY: number;
  bornMs: number;
}

interface GlassDrop {
  /** Where it struck the glass. */
  sx: number;
  sy: number;
  r: number;
  /** Unit-space silhouettes: the drop and its darker off-centre core. */
  path: SkPath;
  core: SkPath;
  coreDx: number;
  coreDy: number;
  peak: number;
  /** When it lands on the glass (hit time + its arrival stagger). */
  bornMs: number;
  /** The run (0 length = a drop that never breaks): when it breaks after
   * landing, how long it takes, how far it gets, how it meanders, and
   * where along it the residue beads sit (fractions of runLen). */
  runLen: number;
  breakMs: number;
  runMs: number;
  wobbleAmp: number;
  wobbleFreq: number;
  wobblePhase: number;
  beads: readonly number[];
}

/** The camera of the frame being recorded — world → screen. */
export interface GlassCamera {
  cx: number;
  cy: number;
  zoom: number;
  vcx: number;
  vcy: number;
  screenW: number;
  screenH: number;
  padTop: number;
  padBottom: number;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
/** Slow start, fast middle, dying away — the run's motion. */
const smootherstep = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Intensity of a kill you landed at world distance `d` from the victim. */
export const glassIntensity = (d: number): number => 1 - smoothstep(SPLAT_NEAR, SPLAT_FAR, d);

export class ScreenBloodField {
  private readonly pending: GlassHit[] = [];
  private readonly drops: GlassDrop[] = [];
  private nextSeed = Math.random() * 1000;

  get live(): number {
    return this.drops.length;
  }

  /** Queue a spray — materialised on the next drawn frame. `k ≤ 0` is a
   * no-op so callers can pass glassIntensity() straight through. */
  hit(k: number, wx: number, wy: number, dirX: number, dirY: number, nowMs: number): void {
    if (k <= 0) return;
    this.pending.push({ k, wx, wy, dirX, dirY, bornMs: nowMs });
  }

  /** Drop everything — the veil between rounds, a new match. */
  clear(): void {
    this.pending.length = 0;
    this.drops.length = 0;
  }

  private spawn(sx: number, sy: number, r: number, bornMs: number): void {
    const seed = (this.nextSeed += 7.31);
    const ang = Math.random() * Math.PI * 2;
    // Heavier drops break sooner and run further; below RUN_MIN_R they
    // stick. Not every eligible drop runs either — some just sit.
    const runs = r >= RUN_MIN_R && Math.random() < 0.75;
    const mass = Math.min(2, r / 4);
    const runLen = runs ? r * (10 + Math.random() * 14) * (0.6 + 0.4 * mass) : 0;
    const beadCount = runs ? 1 + Math.floor(Math.random() * 3) : 0;
    const beads: number[] = [];
    for (let i = 0; i < beadCount; i++) beads.push(0.15 + Math.random() * 0.7);
    beads.sort();
    this.drops.push({
      sx,
      sy,
      r,
      path: blobPath(0, 0, 1, seed, r > 3.5 ? 0.3 : 0.18),
      core: blobPath(0, 0, 0.58, seed * 1.9 + 3, 0.28),
      coreDx: Math.cos(ang) * 0.14,
      coreDy: Math.sin(ang) * 0.14,
      peak: 0.55 + Math.random() * 0.3,
      bornMs,
      runLen,
      breakMs:
        RUN_BREAK_MIN_MS + Math.random() * (RUN_BREAK_MAX_MS - RUN_BREAK_MIN_MS) * (1.2 - 0.5 * mass),
      runMs: RUN_MS_MIN + Math.random() * (RUN_MS_MAX - RUN_MS_MIN),
      // A hint of drift, not a wriggle (Tom: the first cut meandered too
      // much) — a fraction of the drop's own width, one slow bend per run.
      wobbleAmp: r * (0.1 + Math.random() * 0.2),
      wobbleFreq: (0.015 + Math.random() * 0.02) / Math.max(1, mass),
      wobblePhase: Math.random() * Math.PI * 2,
      beads,
    });
    if (this.drops.length > SPLAT_MAX_DROPS) this.drops.shift();
  }

  private materialise(h: GlassHit, cam: GlassCamera): void {
    const k = h.k;
    const own = k >= OWN_DEATH_K - 1e-6;
    const top = cam.padTop;
    const bottom = cam.screenH - cam.padBottom;
    const viewH = Math.max(1, bottom - top);
    const sx0 = cam.vcx + (h.wx - cam.cx) * cam.zoom;
    const sy0 = cam.vcy + (h.wy - cam.cy) * cam.zoom;
    const base = Math.atan2(h.dirY, h.dirX);
    const rMax = own ? DROP_R_MAX : DROP_R_MAX * 0.8;

    const count = Math.round(k * DROPS_PER_K);
    for (let i = 0; i < count; i++) {
      // Size: pow-biased small — most drops are flecks, a few are beads.
      const r = DROP_R_MIN + Math.pow(Math.random(), 2.2) * (rMax - DROP_R_MIN);
      let sx: number;
      let sy: number;
      if (Math.random() < DIRECTIONAL_SHARE) {
        // Fanned out from the corpse's screen position along the spray line
        // — the lean that says which way the blood flew.
        const ang = base + (Math.random() - 0.5) * 2 * (60 * Math.PI) / 180;
        const dist = 30 + Math.sqrt(Math.random()) * Math.max(cam.screenW, viewH) * 0.7;
        sx = sx0 + Math.cos(ang) * dist;
        sy = sy0 + Math.sin(ang) * dist;
      } else {
        // Uniform over the whole safe screen.
        sx = Math.random() * cam.screenW;
        sy = top + Math.random() * viewH;
      }
      if (sx < -4 || sx > cam.screenW + 4 || sy < top - 4 || sy > bottom + 4) continue;
      // Arrival: a scatter in time, not a stamp. Bulk early (pow-biased),
      // stragglers across the window, a late second spatter behind them;
      // a mild distance term keeps the sweep reading outward from the corpse.
      const d = Math.hypot(sx - sx0, sy - sy0) / Math.max(cam.screenW, viewH);
      const arrive =
        Math.random() < LATE_SHARE
          ? ARRIVE_SPREAD_MS + Math.random() * (ARRIVE_LATE_MS - ARRIVE_SPREAD_MS)
          : Math.pow(Math.random(), 1.6) * ARRIVE_SPREAD_MS * (0.6 + 0.4 * d);
      this.spawn(sx, sy, r, h.bornMs + arrive);
    }
  }

  /** Materialise queued hits through this frame's camera, age everything,
   * draw what's alive. Call in the screen-space pass (camera popped). */
  draw(canvas: SkCanvas, nowMs: number, cam: GlassCamera): void {
    if (this.pending.length > 0) {
      for (const h of this.pending) this.materialise(h, cam);
      this.pending.length = 0;
    }
    const drops = this.drops;
    if (drops.length === 0) return;

    // Age out. Arrival staggers keep the list only roughly birth-ordered,
    // so filter rather than pop from the front.
    let w = 0;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]!;
      if (nowMs - d.bornMs < SPLAT_TOTAL_MS) drops[w++] = d;
    }
    drops.length = w;

    for (const d of drops) {
      const age = nowMs - d.bornMs;
      if (age < 0) continue; // still in the air
      const snap = age < SPLAT_HIT_MS ? 0.5 + 0.5 * easeOut(age / SPLAT_HIT_MS) : 1;
      const fade =
        age < SPLAT_HOLD_MS
          ? 1
          : 1 - easeIn((age - SPLAT_HOLD_MS) / (SPLAT_TOTAL_MS - SPLAT_HOLD_MS));
      const alpha = d.peak * fade;
      if (alpha <= 0.01) continue;

      // The run: sits until it breaks, then smootherstep over runMs —
      // slow release, quick middle, dying away as it runs dry.
      const p = d.runLen > 0 ? Math.min(1, Math.max(0, (age - d.breakMs) / d.runMs)) : 0;
      const run = d.runLen * smootherstep(p);
      // Meander: lateral wobble as a function of distance run (not time),
      // so the trail is a fixed shape the head traces, never a wriggle.
      const wob = (dist: number): number =>
        d.wobbleAmp * Math.sin(dist * d.wobbleFreq + d.wobblePhase) * Math.min(1, dist / 12);
      const hx = d.sx + wob(run);
      const hy = d.sy + run;
      if (run > 0.8) {
        // Trail: a chain of short segments widening from a hairline at the
        // origin to ~0.6r at the head (blood left behind thins to a film),
        // following the meander.
        streak.setColor(C_RIM);
        const segs = Math.max(2, Math.ceil(run / 5));
        let px = d.sx;
        let py = d.sy;
        for (let i = 1; i <= segs; i++) {
          const f = i / segs;
          const dist = run * f;
          const nx = d.sx + wob(dist);
          const ny = d.sy + dist;
          streak.setStrokeWidth(Math.max(0.6, d.r * (0.18 + 0.45 * f)));
          streak.setAlphaf(alpha * (0.3 + 0.35 * f));
          canvas.drawLine(px, py, nx, ny, streak);
          px = nx;
          py = ny;
        }
        // Residue beads: blood the run left stuck along the way. They only
        // exist once the head has passed them.
        fill.setColor(C_BODY);
        fill.setAlphaf(alpha * 0.7);
        for (const b of d.beads) {
          const dist = d.runLen * b;
          if (dist > run) break;
          canvas.drawCircle(d.sx + wob(dist), d.sy + dist, d.r * 0.42, fill);
        }
      }

      // The head: swells a touch mid-run (it's collecting the film it slides
      // over), then thins as it dries at the end; stretched along the run.
      const swell = p > 0 ? 1 + 0.22 * Math.sin(Math.PI * p) - 0.12 * p : 1;
      const stretch = p > 0 && p < 1 ? 1 + 0.5 * Math.sin(Math.PI * p) : 1;
      const s = d.r * snap * swell;
      canvas.save();
      canvas.translate(hx, hy);
      canvas.scale(s, s * stretch);
      fill.setColor(C_RIM);
      fill.setAlphaf(alpha);
      canvas.drawPath(d.path, fill);
      fill.setColor(C_BODY);
      fill.setAlphaf(alpha * 0.8);
      canvas.save();
      canvas.translate(d.coreDx, d.coreDy);
      canvas.drawPath(d.core, fill);
      canvas.restore();
      if (d.r > 3.8) {
        // A wet glint on the bigger beads.
        fill.setColor(C_SHEEN);
        fill.setAlphaf(alpha * 0.4);
        canvas.drawCircle(-0.32, -0.34, 0.16, fill);
      }
      canvas.restore();
    }
    fill.setAlphaf(1);
  }
}
