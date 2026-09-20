/**
 * TALONS — a ROC takes the body (bits-cosmetics.md § Shelf row two): a
 * vulture the size of a cart. (v1 was a sea-eagle — Tom, 2026-09-20: "needs
 * to look more like a vulture or a roc". A carrion bird is the right bird for
 * a corpse, and a noble white-headed eagle wasn't frightening.)
 * The ACROSS finisher, and the only one where the corpse LEAVES: Carrion
 * (bird shadows circling for 2s, arena-wide) re-cut to the tempo rule.
 *
 *   0.00s  THE STOOP    wings folded back, it comes in fast along the kill
 *                       line — from the KILLER's side, so it reads as the
 *                       killer's bird. Bird and shadow start apart and
 *                       CONVERGE on the body: that closing gap is how a dive
 *                       reads from straight above.
 *   0.21s  THE FLARE    wings thrown wide and forward to brake…
 *   0.26s  THE STRIKE   …it hits. A punch of scale, a ring of dust, talon
 *                       rakes in the sand — and it holds DEAD STILL for a
 *                       beat (snaps and stillness, the Medusa lesson).
 *   0.37s  THE LIFT     one heavy downbeat and it climbs away along the same
 *                       line, accelerating (ease-in), growing toward the
 *                       camera with the body in its feet; the shadow peels
 *                       off again and thins. Gone by 1.1s.
 *
 * What it leaves: the rakes and three dark feathers that rock down and lie
 * where they land. The corpse is TAKEN at the strike (`hidesBodyFromMs`) —
 * from then on the show draws the body, clutched under the bird.
 *
 * What makes it a VULTURE from straight above: huge square plank wings ending
 * in long splayed fingers, a short dark wedge of a tail, hunched pale-dusted
 * shoulders — and a small BALD raw-red head on a bare neck, poking out of a
 * pale ruff. On the sand (#b39763) cold and dark reads: it's near-black
 * umber; the ruff is the one pale thing and sits on the dark body inside a
 * dark outline.
 *
 * PERF: the bird is ONE sprite from an atlas baked once (four wing poses —
 * from above a wingbeat is the span changing, the Butterflies trick — plus
 * their half-res silhouettes for the shadow). Per frame: one drawAtlas in
 * the air, one on the ground, a circle, ≤9 dust discs for 0.4s and three
 * feather paths. No blur, no saveLayer, nothing built per frame.
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
  type SkPaint,
  type SkPath,
  type SkRect,
  type SkRSXform,
} from "@shopify/react-native-skia";

const APPROACH_MS = 260;
const HOLD_MS = 110;
const LIFT_MS = 730;
const LIFT_AT_MS = APPROACH_MS + HOLD_MS;
export const TALONS_LIFE_MS = LIFT_AT_MS + LIFT_MS;

/** How far back up the kill line it appears, and how far on it gets. */
const APPROACH_DIST = 470;
const EXIT_DIST = 430;
/** The wings open this far through the stoop — just before the hit. */
const FLARE_FROM = 0.8;
const BODY_R = 19;
/** The bird lands with its feet on the body, not its chest: it sits this far
 *  AHEAD of the corpse, which then hangs behind the torso where it's seen. */
const CARRY_BACK = 56;
/** The sun sits up-left of the pit (the butterflies' shadows agree): a thing
 *  this high throws its shadow this far down-right. */
const SHADOW_DX = 74;
const SHADOW_DY = 102;
const DUST_MS = 400;
const DUST_COUNT = 9;
const FEATHER_FALL_MS = 640;
const FEATHER_LEN = 18; // half-length, world px

// ── The bird, baked once ────────────────────────────────────────────────────
/** World px per cell side; the art is centred in it, nose along +x. */
const CELL_W = 300;
/** Bird cells are baked above world scale — it grows 1.6× as it climbs. */
const BIRD_K = 1.25;
const SHADOW_K = 0.5;
const BIRD_PX = CELL_W * BIRD_K;
const SHADOW_PX = CELL_W * SHADOW_K;

interface Pose {
  /** Half-span, and how far the wingtip sits ahead (+) or behind (−) the shoulder. */
  span: number;
  sweep: number;
  /** Tail fan half-angle, degrees. */
  tail: number;
  /** Primaries: the first finger's angle off the nose, and the fan step, degrees. */
  finger0: number;
  fingerStep: number;
}
const POSES: readonly Pose[] = [
  { span: 100, sweep: -46, tail: 12, finger0: 104, fingerStep: 6 }, // STOOP — folded back
  { span: 138, sweep: 16, tail: 34, finger0: 50, fingerStep: 14 }, // FLARE — thrown wide
  { span: 124, sweep: -10, tail: 20, finger0: 62, fingerStep: 12 }, // MID
  { span: 88, sweep: -2, tail: 22, finger0: 72, fingerStep: 10 }, // DOWNBEAT — foreshortened
];
const POSE_STOOP = 0;
const POSE_FLARE = 1;
/** The climb's wingbeat: down, mid, wide, mid — under 3 beats a second. A
 *  thing this size rows the air; a quick beat makes it a pigeon. */
const BEAT: readonly number[] = [3, 2, 1, 2];
const BEAT_STEP_MS = 90;

const SRC_BIRD: SkRect[] = POSES.map((_, i) => Skia.XYWHRect(BIRD_PX * i, 0, BIRD_PX, BIRD_PX));
const SRC_SHADOW: SkRect[] = POSES.map((_, i) => Skia.XYWHRect(SHADOW_PX * i, BIRD_PX, SHADOW_PX, SHADOW_PX));

const C_EDGE = "#0a0705";
const C_WING = "#2a1f17";
const C_PRIMARY = "#15100b";
const C_COVERT = "#4d3a2a";
const C_TORSO = "#34271c";
const C_TAIL = "#1a130d";
const C_RUFF = "#e6decb";
/** Bare skin: a raw dusky red — says "carrion bird" at a glance, and it's
 *  the one warm colour that doesn't vanish here (blood proves it). */
const C_SKIN = "#b04a44";
const C_BEAK = "#d9cfb6";
const EDGE_W = 5;

const DEG = Math.PI / 180;

/** One wing's flight surface. `sd` is the side (±1 → ±y). */
const wingPath = (pose: Pose, sd: number): SkPath => {
  const { span: s, sweep: w } = pose;
  return Skia.PathBuilder.Make()
    .moveTo(26, sd * 9)
    .quadTo(34 + w * 0.3, sd * s * 0.44, 26 + w, sd * s * 0.74)
    .lineTo(-42 + w * 0.6, sd * s * 0.72)
    .quadTo(-50 + w * 0.2, sd * s * 0.36, -40, sd * 9)
    .close()
    .detach();
};
/** The paler band of coverts along the leading edge — what stops the wing
 *  being one flat dark shape. */
const covertPath = (pose: Pose, sd: number): SkPath => {
  const { span: s, sweep: w } = pose;
  return Skia.PathBuilder.Make()
    .moveTo(24, sd * 10)
    .quadTo(30 + w * 0.3, sd * s * 0.4, 20 + w * 0.8, sd * s * 0.6)
    .lineTo(-6 + w * 0.5, sd * s * 0.52)
    .quadTo(-12, sd * s * 0.28, -10, sd * 10)
    .close()
    .detach();
};
const tailPath = (pose: Pose): SkPath => {
  const b = Skia.PathBuilder.Make().moveTo(-30, -13);
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const a = (-pose.tail + (2 * pose.tail * i) / n) * DEG;
    // Scalloped: every other point pulled in a touch — feather ends.
    // Short and wedge-ended: longest in the middle.
    const r = (i % 2 === 0 ? 36 : 33) - Math.abs(i - n / 2) * 2.2;
    b.lineTo(-34 - Math.cos(a) * r, Math.sin(a) * r);
  }
  return b.lineTo(-30, 13).close().detach();
};
/** Heavy and hooked: a bone base, and the tip dipped in black. */
const BEAK = Skia.PathBuilder.Make().moveTo(60, -4.4).quadTo(71, -3.4, 76, 1.6).lineTo(60, 4.4).close().detach();
const BEAK_TIP = Skia.PathBuilder.Make().moveTo(68.5, -3.4).quadTo(73, -2.4, 76, 1.6).lineTo(68.5, 3.1).close().detach();

/** Draw the bird in local coords. "edge" lays every part fat and near-black
 *  (the union is the outline — Medusa's serpents' trick), "fill" paints the
 *  parts over it, "shadow" is the bare white silhouette (tinted at draw). */
const drawBird = (c: SkCanvas, p: SkPaint, pose: Pose, mode: "edge" | "fill" | "shadow"): void => {
  const part = (hex: string, draw: () => void): void => {
    if (mode === "edge") {
      p.setColor(Skia.Color(C_EDGE));
      p.setStyle(PaintStyle.Fill);
      draw();
      p.setStyle(PaintStyle.Stroke);
      p.setStrokeWidth(EDGE_W);
      draw();
      p.setStyle(PaintStyle.Fill);
      return;
    }
    p.setColor(Skia.Color(mode === "shadow" ? "#ffffff" : hex));
    draw();
  };
  // Primaries first: the fingers fan out from under the wing's outer edge.
  for (const sd of [-1, 1]) {
    const { span: s, sweep: w } = pose;
    // SEVEN long slotted fingers — the vulture's signature from below or above.
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      // Rooted along the wing's outer edge, tip → trailing corner.
      const rx = 26 + w + (-68 + w * -0.4) * t - 6;
      const ry = sd * s * (0.74 - 0.02 * t) * 0.9;
      const ang = sd * (pose.finger0 + pose.fingerStep * i) + w * 0.3 * -sd;
      const len = s * (0.46 - 0.03 * Math.abs(i - 2));
      part(C_PRIMARY, () => {
        c.save();
        c.translate(rx, ry);
        c.rotate(ang, 0, 0);
        c.drawOval(Skia.XYWHRect(-4, -5.6, len + 4, 11.2), p);
        c.restore();
      });
    }
  }
  part(C_TAIL, () => c.drawPath(tailPath(pose), p));
  for (const sd of [-1, 1]) part(C_WING, () => c.drawPath(wingPath(pose, sd), p));
  if (mode === "fill") for (const sd of [-1, 1]) part(C_COVERT, () => c.drawPath(covertPath(pose, sd), p));
  // Hunched: a deep chest, heavy at the shoulders.
  part(C_TORSO, () => c.drawOval(Skia.XYWHRect(-44, -19, 78, 38), p));
  // The bare neck and the small bald head, out of…
  part(C_SKIN, () => c.drawOval(Skia.XYWHRect(30, -5.5, 26, 11), p));
  part(C_SKIN, () => c.drawCircle(56, 0, 8.2, p));
  // …the ruff: a scalloped pale collar. It's what says VULTURE, not crow.
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.42;
    part(C_RUFF, () => c.drawCircle(24 + Math.cos(a) * 7, Math.sin(a) * 15, 6.6, p));
  }
  part(C_RUFF, () => c.drawOval(Skia.XYWHRect(17, -12, 15, 24), p));
  part(C_BEAK, () => c.drawPath(BEAK, p));
  if (mode === "fill") {
    p.setColor(Skia.Color(C_EDGE));
    c.drawPath(BEAK_TIP, p);
    // A heavy brow over each eye — two dark slashes, angled in: a glare.
    for (const sd of [-1, 1]) {
      c.save();
      c.translate(58, sd * 4.6);
      c.rotate(sd * 30, 0, 0);
      c.drawOval(Skia.XYWHRect(-3.6, -1.5, 7.2, 3), p);
      c.restore();
    }
  }
};

let atlas: SkImage | null = null;
let atlasFailed = false;
const ensureAtlas = (): SkImage | null => {
  if (atlas || atlasFailed) return atlas;
  const surface = Skia.Surface.Make(BIRD_PX * POSES.length, BIRD_PX + SHADOW_PX);
  if (!surface) {
    atlasFailed = true; // no atlas → the finisher simply doesn't draw
    return null;
  }
  const c = surface.getCanvas();
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStrokeJoin(StrokeJoin.Round);
  POSES.forEach((pose, i) => {
    c.save();
    c.translate(BIRD_PX * (i + 0.5), BIRD_PX / 2);
    c.scale(BIRD_K, BIRD_K);
    drawBird(c, p, pose, "edge");
    drawBird(c, p, pose, "fill");
    c.restore();
    c.save();
    c.translate(SHADOW_PX * (i + 0.5), BIRD_PX + SHADOW_PX / 2);
    c.scale(SHADOW_K, SHADOW_K);
    drawBird(c, p, pose, "shadow");
    c.restore();
  });
  atlas = surface.makeImageSnapshot();
  return atlas;
};

const atlasPaint = Skia.Paint();
atlasPaint.setAntiAlias(true);
// drawAtlas scratch — one sprite a call, reused (the crowd.ts diet).
const dsts: SkRSXform[] = [];
const srcs: SkRect[] = [];
const cols: SkColor[] = [];
const birdTint = Float32Array.of(1, 1, 1, 1);
/** A cold blue-black, never flat black — that's the Tar Pit's. */
const shadowTint = Float32Array.of(0.05, 0.06, 0.13, 0);

const fill = Skia.Paint();
fill.setAntiAlias(true);
const stroke = Skia.Paint();
stroke.setAntiAlias(true);
stroke.setStyle(PaintStyle.Stroke);
stroke.setStrokeCap(StrokeCap.Round);
/** Kicked-up sand, DARK: pale dust is the sand's own value and vanishes. */
const dust = Skia.Paint();
dust.setAntiAlias(true);
dust.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(70, 56, 40, 0.62)"), Skia.Color("rgba(86, 70, 50, 0.3)"), Skia.Color("rgba(100, 82, 58, 0)")],
    [0, 0.55, 1],
    TileMode.Clamp,
  ),
);

const C_CARRIED = Skia.Color("#6a5d4d");
const C_CARRIED_RIM = Skia.Color("#1a130d");
const C_RAKE = Skia.Color("#33251a");
const C_FEATHER = Skia.Color("#1b140e");
const C_QUILL = Skia.Color("#b9ad98");
/** A flight feather, unit length along x: blunt at the quill, pointed tip. */
const FEATHER = Skia.PathBuilder.Make()
  .moveTo(-1, 0)
  .quadTo(-0.3, -0.44, 0.7, -0.17)
  .lineTo(1, 0)
  .lineTo(0.7, 0.17)
  .quadTo(-0.3, 0.44, -1, 0)
  .close()
  .detach();

interface Feather {
  /** Where it comes to rest, world px, and how it lies. */
  x: number;
  y: number;
  rot: number;
  /** Rock: phase and which way it swings. */
  phase: number;
  delayMs: number;
}

export class Talons {
  readonly hidesBodyFromMs = APPROACH_MS;
  /** Unit heading along the kill line (killer → victim). */
  private readonly hx: number;
  private readonly hy: number;
  private readonly heading: number;
  private readonly rakes: SkPath;
  private readonly feathers: Feather[] = [];
  private readonly dustAngs: number[] = [];

  constructor(
    readonly x: number,
    readonly y: number,
    dirX?: number,
    dirY?: number,
  ) {
    const len = dirX === undefined || dirY === undefined ? 0 : Math.hypot(dirX, dirY);
    if (len > 0.001) {
      this.hx = dirX! / len;
      this.hy = dirY! / len;
    } else {
      const a = Math.random() * Math.PI * 2;
      this.hx = Math.cos(a);
      this.hy = Math.sin(a);
    }
    this.heading = Math.atan2(this.hy, this.hx);
    const nx = -this.hy;
    const ny = this.hx;

    // The rakes: three short parallel gouges per foot, dragged along the
    // heading either side of where the body lay.
    const b = Skia.PathBuilder.Make();
    for (const side of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        const ox = x + nx * (side * 15 + k * 5.5) - this.hx * (8 - Math.abs(k) * 3);
        const oy = y + ny * (side * 15 + k * 5.5) - this.hy * (8 - Math.abs(k) * 3);
        const reach = 24 + Math.random() * 8 - Math.abs(k) * 4;
        b.moveTo(ox, oy).lineTo(ox + this.hx * reach, oy + this.hy * reach);
      }
    }
    this.rakes = b.detach();

    for (let i = 0; i < 3; i++) {
      // Shed at the flare, so they land behind and beside the strike.
      const side = i === 1 ? (Math.random() < 0.5 ? -1 : 1) * 0.3 : i === 0 ? -1 : 1;
      const back = 12 + Math.random() * 46;
      const out = side * (34 + Math.random() * 38);
      this.feathers.push({
        x: x - this.hx * back + nx * out,
        y: y - this.hy * back + ny * out,
        rot: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        delayMs: i * 55,
      });
    }
    for (let i = 0; i < DUST_COUNT; i++) this.dustAngs.push(((i + Math.random()) / DUST_COUNT) * Math.PI * 2);
  }

  /** Where the bird is at `age`: along the heading (px from the body),
   *  height 0..1, scale, alpha and wing pose. */
  private flight(age: number): { along: number; height: number; scale: number; alpha: number; pose: number } {
    if (age < APPROACH_MS) {
      const u = age / APPROACH_MS;
      // Ease-OUT: flat out, then the flare brakes it onto the body.
      const e = 1 - (1 - u) * (1 - u);
      const height = Math.pow(1 - u, 1.4);
      return {
        along: CARRY_BACK - APPROACH_DIST * (1 - e),
        height,
        scale: 1 + 0.5 * height,
        alpha: Math.min(1, age / 70),
        pose: u < FLARE_FROM ? POSE_STOOP : POSE_FLARE,
      };
    }
    if (age < LIFT_AT_MS) {
      // The hit: a punch of scale that settles, and then nothing moves.
      const u = (age - APPROACH_MS) / HOLD_MS;
      return { along: CARRY_BACK, height: 0, scale: 1 + 0.09 * (1 - u) * (1 - u), alpha: 1, pose: POSE_FLARE };
    }
    const v = Math.min(1, (age - LIFT_AT_MS) / LIFT_MS);
    const beat = BEAT[Math.floor((age - LIFT_AT_MS) / BEAT_STEP_MS) % BEAT.length]!;
    return {
      // Ease-IN: heavy off the ground, then away.
      along: CARRY_BACK + EXIT_DIST * Math.pow(v, 1.9),
      height: Math.pow(v, 0.85),
      scale: 1 + 0.62 * Math.pow(v, 0.85),
      alpha: v < 0.5 ? 1 : 1 - (v - 0.5) / 0.5,
      pose: beat,
    };
  }

  /** Floor pass: dust, the rakes, the bird's shadow, the feathers. */
  drawGround(canvas: SkCanvas, age: number): void {
    const { x, y } = this;
    const since = age - APPROACH_MS;
    if (since >= 0) this.drawRakes(canvas, Math.min(1, since / 60));
    if (since >= 0 && since < DUST_MS) {
      const t = since / DUST_MS;
      const out = 1 - (1 - t) * (1 - t);
      dust.setAlphaf(1 - t);
      for (let i = 0; i < DUST_COUNT; i++) {
        const a = this.dustAngs[i]!;
        const reach = 26 + (44 + 26 * Math.sin(a * 3.7)) * out;
        const r = 13 + 20 * out;
        canvas.save();
        canvas.translate(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
        canvas.scale(r, r);
        canvas.drawCircle(0, 0, 1, dust);
        canvas.restore();
      }
    }

    const img = ensureAtlas();
    if (img && age < TALONS_LIFE_MS) {
      const f = this.flight(age);
      // High = far off and faint; on the body = right under it and dark.
      const s = (f.scale * (1 - 0.18 * f.height)) / SHADOW_K;
      shadowTint[3] = f.alpha * (0.42 - 0.26 * f.height);
      dsts.length = srcs.length = cols.length = 0;
      dsts.push(
        Skia.RSXformFromRadians(
          s,
          this.heading,
          x + this.hx * f.along + 5 + SHADOW_DX * f.height,
          y + this.hy * f.along + 7 + SHADOW_DY * f.height,
          SHADOW_PX / 2,
          SHADOW_PX / 2,
        ),
      );
      srcs.push(SRC_SHADOW[f.pose]!);
      cols.push(shadowTint);
      canvas.drawAtlas(img, srcs, dsts, atlasPaint, BlendMode.Modulate, cols);
    }

    this.drawFeathers(canvas, age);
  }

  /** Air pass: the body in its feet, then the bird over it. */
  drawAir(canvas: SkCanvas, age: number): void {
    const img = ensureAtlas();
    if (!img || age >= TALONS_LIFE_MS) return;
    const f = this.flight(age);
    // A slow bank as it climbs — a dead-straight exit reads as a sprite on rails.
    const bank = age < LIFT_AT_MS ? 0 : 0.07 * Math.sin((age - LIFT_AT_MS) / 170);
    const bx = this.x + this.hx * f.along;
    const by = this.y + this.hy * f.along;
    if (age >= APPROACH_MS) {
      // Slung under the tail, a dark rim round it: the tail is a short
      // wedge, so the body shows either side of it and out past its end.
      // (Under the eagle's long white fan it was all but hidden.)
      const hang = CARRY_BACK * f.scale;
      const r = BODY_R * (0.94 + 0.5 * (f.scale - 1));
      fill.setColor(C_CARRIED_RIM);
      fill.setAlphaf(f.alpha);
      canvas.drawCircle(bx - this.hx * hang, by - this.hy * hang, r + 2.2, fill);
      fill.setColor(C_CARRIED);
      canvas.drawCircle(bx - this.hx * hang, by - this.hy * hang, r, fill);
      fill.setAlphaf(1);
    }
    birdTint[3] = f.alpha;
    dsts.length = srcs.length = cols.length = 0;
    dsts.push(Skia.RSXformFromRadians(f.scale / BIRD_K, this.heading + bank, bx, by, BIRD_PX / 2, BIRD_PX / 2));
    srcs.push(SRC_BIRD[f.pose]!);
    cols.push(birdTint);
    canvas.drawAtlas(img, srcs, dsts, atlasPaint, BlendMode.Modulate, cols);
  }

  private drawRakes(canvas: SkCanvas, alpha: number): void {
    stroke.setColor(C_RAKE);
    stroke.setAlphaf(0.62 * alpha);
    stroke.setStrokeWidth(3.2);
    canvas.drawPath(this.rakes, stroke);
    stroke.setAlphaf(1);
  }

  /** Feathers: shed at the flare, rocking down to where they'll lie. With
   *  `age` past every fall this is their rest pose — the mark. */
  private drawFeathers(canvas: SkCanvas, age: number): void {
    for (const ft of this.feathers) {
      const since = age - (APPROACH_MS - 40) - ft.delayMs;
      if (since < 0) continue;
      const t = Math.min(1, since / FEATHER_FALL_MS);
      const settle = 1 - (1 - t) * (1 - t);
      const loose = 1 - settle;
      // Released over the body, drifting out to its rest as it rocks.
      const px = this.x + (ft.x - this.x) * settle + Math.cos(ft.rot + 1.57) * Math.sin(t * 9 + ft.phase) * 11 * loose;
      const py = this.y + (ft.y - this.y) * settle + Math.sin(ft.rot + 1.57) * Math.sin(t * 9 + ft.phase) * 11 * loose;
      const len = FEATHER_LEN * (1 + 0.55 * loose);
      canvas.save();
      canvas.translate(px, py);
      canvas.rotate(((ft.rot + Math.sin(t * 7 + ft.phase) * 0.7 * loose) * 180) / Math.PI, 0, 0);
      canvas.scale(len, len);
      fill.setColor(C_FEATHER);
      fill.setAlphaf(Math.min(1, since / 60) * 0.92);
      canvas.drawPath(FEATHER, fill);
      stroke.setColor(C_QUILL);
      stroke.setAlphaf(0.75);
      stroke.setStrokeWidth(1.3 / len);
      canvas.drawLine(-0.92, 0, 0.8, 0, stroke);
      canvas.restore();
    }
    fill.setAlphaf(1);
    stroke.setAlphaf(1);
  }

  /** The show draws its own rakes and feathers while it runs; the mark
   *  takes over, identical, when it's done (Medusa's rubble handoff). */
  markAlpha(): number {
    return 0;
  }

  stampMark(canvas: SkCanvas, alpha: number): void {
    if (alpha <= 0) return;
    this.drawRakes(canvas, 1);
    this.drawFeathers(canvas, TALONS_LIFE_MS * 10); // long landed (finite: the rock is a sine of it)
  }
}
