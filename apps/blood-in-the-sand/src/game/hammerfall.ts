/**
 * HAMMERFALL — the challenge capstone's finisher (bits-cosmetics.md
 * § Hammerfall): clear every challenge and a god's hammer falls on the
 * people you kill. Earned, never sold, like Snuffed, but Snuffed is the
 * quiet one and this is the loud one.
 *
 * Smite also comes from above, so this one is told apart by WEIGHT: Smite
 * is a 0.48s cold flash; the hammer is a thing you watch fall, feel land and
 * hear ring.
 *
 *   0.00s  THE SWING    raised overhead on the KILLER's side, the maul is
 *                       flung round in an arc about its grip (an unseen
 *                       smith's hand), accelerating hard — a steep ease-in —
 *                       a band of smear trailing the head, runes kindling;
 *                       its shadow runs in under it and darkens
 *   0.30s  THE BLOW     FACE first onto the body, like a hammer on an anvil:
 *                       a white flash, the runes blaze, low dust, spinning
 *                       chips. The camera kicks (the caller pushes a second
 *                       kill kick at HAMMERFALL_IMPACT_MS). The body is gone
 *                       (`hidesBodyFromMs`): crushed.
 *   0.30s  THE RING     dead still on the anvil but for a fine shiver
 *   0.45s  THE REBOUND  it bounces off fast and loses its momentum
 *                       (ease-out) back the way it came, fading. Gone 0.87s.
 *
 * What it leaves: a dent (the head's footprint, shaded like a hollow) with
 * tapering cracks running out of it.
 *
 * v2 (Tom, 2026-09-27: "quite cartoony… not the same premium feel"): v1 was
 * a sticker — a thick black outline, flat fills, squash-and-stretch, speed
 * lines, round dust puffs, and toy proportions (a stubby block on a short
 * stick with a knob). v2 is LIT, not outlined: gradient iron with a hard
 * specular edge, a long maul handle, an hourglass head with flared faces, and
 * the god-light lives in engraved runes that glow (the Smite glow stack:
 * wide faint strokes under a thin bright core). Motion is a silhouette smear,
 * dust is soft gradient cloud, debris is spinning shards, cracks taper.
 *
 * Drawn SIDE-ON (the 3/4 read, up-screen = height): from straight above a
 * hammer is a grey rectangle; side-on, swinging, it's unmistakable. v1/v2
 * DROPPED an upright ⊥ from the sky at 1.45× and filled the screen; v3
 * swings a 0.9× maul with a shorter handle. The shadow is the head's footprint, never
 * a circle, so it can't pass for an ability telegraph. The glow is warm but
 * sits on dark iron, never on bare sand (warm light vanishes on #b39763).
 *
 * PERF: every hammer path and shader is built once at module load in local
 * coords and drawn under a translate/scale; the dent, its shaders and the
 * cracks are built once at spawn. Per frame: ~16 path draws, ≤12 dust
 * clouds and ≤10 shards for 0.6s. No blur, no saveLayer.
 */
import {
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  vec,
  type SkCanvas,
  type SkPaint,
  type SkPath,
} from "@shopify/react-native-skia";

/** v3 (Tom, 2026-09-27): "like it's being flung down on an anvil, rather
 *  than dropped from above" + "smaller, it takes up A LOT of space". The
 *  maul now SWINGS: it pivots about its grip end, an invisible smith's hand
 *  on the killer's side, and comes over in an arc, FACE first. */
const SWING_MS = 300;
const RING_MS = 150;
const AWAY_AT_MS = SWING_MS + RING_MS;
const AWAY_MS = 420;
export const HAMMERFALL_IMPACT_MS = SWING_MS;
export const HAMMERFALL_LIFE_MS = AWAY_AT_MS + AWAY_MS;
/** How far back it's raised (degrees past the strike), and how far it
 *  rebounds off the anvil on the way out. */
const SWING_DEG = 115;
const AWAY_DEG = 95;
const DUST_MS = 650;
const DUST_COUNT = 12;
const SHARD_COUNT = 10;
const FLASH_MS = 110;
const TAU = Math.PI * 2;
/** The hammer is modelled at 1 and drawn this big. v2 was 1.45 with a
 *  longer handle and filled the screen. */
const HAMMER_SCALE = 0.9;

// ── The maul, local coords: origin = middle of the head's bottom edge (the
//    point that lands on the body), up-screen is -y. Light from up-left. ────
const HEAD_W = 136;
const HEAD_H = 80;
/** Half-width of the waist, where the collar grips the handle. */
const WAIST = 24;
/** How far the head's top and bottom edges pinch in at the waist. */
const PINCH = 9;
const FACE_W = 10;
const HANDLE_W = 19;
const HANDLE_LEN = 190;
const CAP_W = 26;
const CAP_H = 20;

/** The dent (and the shadow): a striking FACE's footprint from above. */
const DENT_W = HEAD_H * HAMMER_SCALE * 1.05;
const DENT_H = 40;
/** The face lands on the dent's FRONT lip (3/4 view). */
const LAND_DY = DENT_H / 2 - 6;

const rrect = (x: number, y: number, w: number, h: number, r: number): SkPath => {
  const b = Skia.PathBuilder.Make();
  b.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r));
  return b.detach();
};

/** The head: an hourglass block — full height at the faces, pinched at the
 *  waist, the corners chamfered. */
const HEAD = (() => {
  const b = Skia.PathBuilder.Make();
  const hw = HEAD_W / 2 - FACE_W;
  const c = 6; // chamfer
  b.moveTo(-hw, -HEAD_H + c);
  b.lineTo(-hw + c, -HEAD_H);
  b.quadTo(-WAIST - 14, -HEAD_H + PINCH, -WAIST, -HEAD_H + PINCH);
  b.lineTo(WAIST, -HEAD_H + PINCH);
  b.quadTo(WAIST + 14, -HEAD_H + PINCH, hw - c, -HEAD_H);
  b.lineTo(hw, -HEAD_H + c);
  b.lineTo(hw, -c);
  b.lineTo(hw - c, 0);
  b.quadTo(WAIST + 14, -PINCH, WAIST, -PINCH);
  b.lineTo(-WAIST, -PINCH);
  b.quadTo(-WAIST - 14, -PINCH, -hw + c, 0);
  b.lineTo(-hw, -c);
  b.close();
  return b.detach();
})();
/** The striking faces: flared plates proud of each end. */
const FACES = (() => {
  const b = Skia.PathBuilder.Make();
  for (const side of [-1, 1]) {
    const x = side < 0 ? -HEAD_W / 2 : HEAD_W / 2 - FACE_W;
    b.addRRect(Skia.RRectXY(Skia.XYWHRect(x, -HEAD_H - 5, FACE_W, HEAD_H + 10), 3, 3));
  }
  return b.detach();
})();
/** The hard specular edge along the head's top: light catching the chamfer. */
const SPECULAR = (() => {
  const b = Skia.PathBuilder.Make();
  const hw = HEAD_W / 2 - FACE_W;
  b.moveTo(-hw + 7, -HEAD_H + 2);
  b.quadTo(-WAIST - 14, -HEAD_H + PINCH + 2, -WAIST, -HEAD_H + PINCH + 2);
  b.moveTo(WAIST, -HEAD_H + PINCH + 2);
  b.quadTo(WAIST + 14, -HEAD_H + PINCH + 2, hw - 7, -HEAD_H + 2);
  for (const side of [-1, 1]) {
    const x = side < 0 ? -HEAD_W / 2 + 2.5 : HEAD_W / 2 - FACE_W + 2.5;
    b.moveTo(x, -HEAD_H - 2);
    b.lineTo(x, 2);
  }
  return b.detach();
})();
/** The collar at the waist, where the handle goes in: a blackened plate
 *  (the rune needs dark ground to glow on — on bright gold it vanished) with
 *  gilded bands top and bottom. */
const COLLAR = rrect(-WAIST, -HEAD_H + PINCH - 4, WAIST * 2, HEAD_H - 2 * PINCH + 8, 3);
const COLLAR_BANDS = (() => {
  const b = Skia.PathBuilder.Make();
  b.addRRect(Skia.RRectXY(Skia.XYWHRect(-WAIST - 2, -HEAD_H + PINCH - 6, WAIST * 2 + 4, 9), 2, 2));
  b.addRRect(Skia.RRectXY(Skia.XYWHRect(-WAIST - 2, -PINCH - 3, WAIST * 2 + 4, 9), 2, 2));
  return b.detach();
})();
/** Engraved channels: a groove along each cheek, and one rune on the collar
 *  (a stave with a fork at the top) — bold straight strokes, legible at
 *  phone size. These are what glow. */
const RUNES = (() => {
  const b = Skia.PathBuilder.Make();
  const mid = -HEAD_H / 2;
  for (const side of [-1, 1]) {
    b.moveTo(side * (WAIST + 8), mid);
    b.lineTo(side * (HEAD_W / 2 - FACE_W - 9), mid);
  }
  b.moveTo(0, mid + 20);
  b.lineTo(0, mid - 20);
  b.moveTo(-11, mid - 20);
  b.lineTo(0, mid - 6);
  b.lineTo(11, mid - 20);
  return b.detach();
})();
const HANDLE_TOP = -HEAD_H - HANDLE_LEN;
const HANDLE = rrect(-HANDLE_W / 2, HANDLE_TOP, HANDLE_W, HANDLE_LEN + 4, 3);
/** The grip: leather bands up the top third of the handle. */
const GRIP = (() => {
  const b = Skia.PathBuilder.Make();
  for (let i = 0; i < 7; i++) {
    const y = HANDLE_TOP + CAP_H + 8 + i * 13;
    b.addRRect(Skia.RRectXY(Skia.XYWHRect(-HANDLE_W / 2 - 1.5, y, HANDLE_W + 3, 9), 2, 2));
  }
  return b.detach();
})();
const CAP = rrect(-CAP_W / 2, HANDLE_TOP - 4, CAP_W, CAP_H, 3);
/** The pivot: the grip end, model coords. */
const GRIP_Y = HANDLE_TOP - 4;
/** Grip → head centre, model px (straight down the handle). */
const ARM = -HEAD_H / 2 - GRIP_Y;

// Shaders in LOCAL coords, built once: the transform carries them.
const vGrad = (y0: number, y1: number, colours: string[], stops: number[]): SkPaint => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setShader(Skia.Shader.MakeLinearGradient(vec(0, y0), vec(0, y1), colours.map((c) => Skia.Color(c)), stops, TileMode.Clamp));
  return p;
};
const hGrad = (x0: number, x1: number, colours: string[], stops: number[]): SkPaint => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setShader(Skia.Shader.MakeLinearGradient(vec(x0, 0), vec(x1, 0), colours.map((c) => Skia.Color(c)), stops, TileMode.Clamp));
  return p;
};
/** Forged iron, lit from above: a bright top plane, dark belly. */
const ironPaint = vGrad(-HEAD_H, 0, ["#8c96a3", "#4a515b", "#2a2e34", "#131518"], [0, 0.18, 0.62, 1]);
const facePaint = vGrad(-HEAD_H - 5, 5, ["#a9b3bf", "#5a626d", "#1c1f23"], [0, 0.35, 1]);
const collarPaint = vGrad(-HEAD_H, 0, ["#3b3530", "#1d1a17", "#0e0c0a"], [0, 0.4, 1]);
/** Old gold: pale where the light hits, deep bronze in the shade. */
const goldPaint = vGrad(-HEAD_H, 0, ["#ffe6a3", "#d4a241", "#8a5f1c", "#4d330d"], [0, 0.3, 0.72, 1]);
/** The handle as a cylinder: dark at both edges, lit a little left of centre. */
const woodPaint = hGrad(-HANDLE_W / 2, HANDLE_W / 2, ["#20130a", "#6b4527", "#4a2e18", "#1a0f07"], [0, 0.35, 0.65, 1]);
const gripPaint = hGrad(-HANDLE_W / 2, HANDLE_W / 2, ["#120b06", "#3d2a1c", "#1c120a"], [0, 0.4, 1]);
const capPaint = hGrad(-CAP_W / 2, CAP_W / 2, ["#20242a", "#8c96a3", "#3a4048", "#15171a"], [0, 0.3, 0.6, 1]);

/** A soft cloud of dust, unit radius — scaled per puff. */
const dustPaint = Skia.Paint();
dustPaint.setAntiAlias(true);
dustPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(112, 88, 56, 0.85)"), Skia.Color("rgba(132, 106, 70, 0.5)"), Skia.Color("rgba(150, 124, 84, 0)")],
    [0, 0.5, 1],
    TileMode.Clamp,
  ),
);
/** The impact flash under the head, unit radius. */
const flashPaint = Skia.Paint();
flashPaint.setAntiAlias(true);
flashPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(255, 252, 240, 1)"), Skia.Color("rgba(255, 240, 200, 0.55)"), Skia.Color("rgba(255, 230, 180, 0)")],
    [0, 0.4, 1],
    TileMode.Clamp,
  ),
);
/** The falling shadow, unit radius: dark core, soft edge. */
const shadowPaint = Skia.Paint();
shadowPaint.setAntiAlias(true);
shadowPaint.setShader(
  Skia.Shader.MakeRadialGradient(
    vec(0, 0),
    1,
    [Skia.Color("rgba(10, 7, 4, 0.8)"), Skia.Color("rgba(10, 7, 4, 0.55)"), Skia.Color("rgba(10, 7, 4, 0)")],
    [0, 0.6, 1],
    TileMode.Clamp,
  ),
);
/** A shard: a sliver of packed sand, unit-ish. */
const SHARD = (() => {
  const b = Skia.PathBuilder.Make();
  b.moveTo(-1, -0.55);
  b.lineTo(0.3, -0.8);
  b.lineTo(1.05, 0.1);
  b.lineTo(0.1, 0.75);
  b.lineTo(-0.8, 0.4);
  b.close();
  return b.detach();
})();

/** The rune glow: wide faint strokes under a thin bright core. */
const GLOW: readonly [number, number, string][] = [
  [20, 0.16, "#ff9f2e"],
  [12, 0.32, "#ffbb4a"],
  [6.5, 0.7, "#ffd97a"],
  [2.6, 1, "#fffaea"],
];
/** Unlit, a rune is a dark engraving. */
const C_ENGRAVE = Skia.Color("#15100a");
const C_SMEAR_ON = Skia.Color("rgba(28, 30, 34, 0.22)");
const C_SMEAR_OFF = Skia.Color("rgba(28, 30, 34, 0)");
const smearPaint = Skia.Paint();
smearPaint.setAntiAlias(true);
const C_SHARD = Skia.Color("#5e4829");
const C_CRACK = Skia.Color("#1a130c");
const C_LIP = Skia.Color("#e2cfa4");

const fill = Skia.Paint();
fill.setAntiAlias(true);
const line = Skia.Paint();
line.setAntiAlias(true);
line.setStyle(PaintStyle.Stroke);
line.setStrokeCap(StrokeCap.Round);
line.setStrokeJoin(StrokeJoin.Round);
const glowPaint = Skia.Paint();
glowPaint.setAntiAlias(true);
glowPaint.setStyle(PaintStyle.Stroke);
glowPaint.setStrokeCap(StrokeCap.Round);
glowPaint.setStrokeJoin(StrokeJoin.Round);
const GLOW_COLOURS = GLOW.map(([, , c]) => Skia.Color(c));

interface Mote {
  ang: number;
  reach: number;
  size: number;
  spin: number;
  delay: number;
}

export class Hammerfall {
  readonly hidesBodyFromMs = SWING_MS;
  private readonly dust: Mote[] = [];
  private readonly shards: Mote[] = [];
  private readonly dent: SkPath;
  private readonly dentPaint: SkPaint;
  private readonly hollowPaint: SkPaint;
  private readonly lip: SkPath;
  private readonly cracks: SkPath;

  /** +1: the smith stands LEFT of the body (swings in left→right); -1 right. */
  private readonly side: number;
  /** The grip, world px — fixed for the whole show. */
  private readonly px: number;
  private readonly py: number;

  /** (dirX) is the killer → victim line: the swing comes in from the
   *  killer's side, so it reads as the killer's blow. */
  constructor(
    readonly x: number,
    readonly y: number,
    dirX?: number,
  ) {
    this.side = dirX === undefined || dirX === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dirX);
    this.px = x - this.side * ARM * HAMMER_SCALE;
    this.py = y + LAND_DY - (HEAD_W / 2) * HAMMER_SCALE;
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dust.push({
        ang: ((i + Math.random() * 0.8) / DUST_COUNT) * TAU,
        reach: 60 + Math.random() * 60,
        size: 22 + Math.random() * 18,
        spin: 0,
        delay: Math.random() * 60,
      });
    }
    for (let i = 0; i < SHARD_COUNT; i++) {
      this.shards.push({
        ang: ((i + Math.random()) / SHARD_COUNT) * TAU,
        reach: 60 + Math.random() * 80,
        size: 7 + Math.random() * 6,
        spin: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 10),
        delay: 0,
      });
    }
    // The dent: the head's footprint seen from above, shaded like a hollow —
    // the far (top) wall in shadow, the floor catching light toward the near
    // lip, a pale rim where the sand was pushed up at the front.
    const dw = DENT_W;
    const dh = DENT_H;
    this.dent = rrect(x - dw / 2, y - dh / 2, dw, dh, 8);
    this.dentPaint = Skia.Paint();
    this.dentPaint.setAntiAlias(true);
    this.dentPaint.setShader(
      Skia.Shader.MakeLinearGradient(
        vec(x, y - dh / 2),
        vec(x, y + dh / 2),
        [Skia.Color("rgba(22, 15, 8, 0.85)"), Skia.Color("rgba(60, 44, 26, 0.6)"), Skia.Color("rgba(110, 88, 56, 0.35)")],
        [0, 0.5, 1],
        TileMode.Clamp,
      ),
    );
    this.hollowPaint = Skia.Paint();
    this.hollowPaint.setAntiAlias(true);
    this.hollowPaint.setShader(
      Skia.Shader.MakeRadialGradient(
        vec(x, y),
        dw * 0.72,
        [Skia.Color("rgba(30, 20, 10, 0.35)"), Skia.Color("rgba(30, 20, 10, 0)")],
        [0.55, 1],
        TileMode.Clamp,
      ),
    );
    {
      const b = Skia.PathBuilder.Make();
      b.moveTo(x - dw / 2 + 6, y + dh / 2 + 1.5);
      b.lineTo(x + dw / 2 - 6, y + dh / 2 + 1.5);
      this.lip = b.detach();
    }
    // Cracks: tapering wedges out of the rim, longest off the ends. Filled,
    // never stroked — a stroke is a string, a wedge is a split.
    const b = Skia.PathBuilder.Make();
    const runs = 7;
    for (let i = 0; i < runs; i++) {
      const ang = ((i + 0.2 + Math.random() * 0.6) / runs) * TAU;
      const cx = Math.cos(ang);
      const sy = Math.sin(ang);
      const t = Math.min(dw / 2 / Math.max(1e-3, Math.abs(cx)), dh / 2 / Math.max(1e-3, Math.abs(sy)));
      const x0 = x + cx * t;
      const y0 = y + sy * t;
      const len = 28 + Math.random() * 28 + 18 * Math.abs(cx);
      const bend = (Math.random() - 0.5) * 0.5;
      const kx = x0 + (cx * Math.cos(bend) - sy * Math.sin(bend)) * len * 0.55;
      const ky = y0 + (sy * Math.cos(bend) + cx * Math.sin(bend)) * len * 0.55;
      const ex = x0 + cx * len;
      const ey = y0 + sy * len;
      const w0 = 3.5;
      const w1 = 1.5;
      // Left edge out, right edge back: a wedge from w0 at the rim to a point.
      b.moveTo(x0 - sy * w0, y0 + cx * w0);
      b.lineTo(kx - sy * w1, ky + cx * w1);
      b.lineTo(ex, ey);
      b.lineTo(kx + sy * w1, ky - cx * w1);
      b.lineTo(x0 + sy * w0, y0 - cx * w0);
      b.close();
    }
    this.cracks = b.detach();
  }

  /** The swing at an age: [hammer rotation (degrees, the model's handle
   *  axis), alpha]. The strike is -side·90° (handle level, face down). */
  private pose(age: number): [number, number] {
    const hit = -this.side * 90;
    if (age < SWING_MS) {
      // Flung: it accelerates hard all the way in (a steep ease-in).
      const u = Math.max(0, age) / SWING_MS;
      const e = Math.pow(u, 2.4);
      return [hit - this.side * SWING_DEG * (1 - e), Math.min(1, Math.max(0, age) / 70)];
    }
    if (age < AWAY_AT_MS) {
      // The ring: dead still on the anvil but for a fine shiver.
      const t = (age - SWING_MS) / RING_MS;
      return [hit - this.side * 0.9 * (1 - t) * (1 - t) * Math.sin(((age - SWING_MS) / 1000) * TAU * 40), 1];
    }
    // The rebound: it bounces off fast and loses its momentum (ease-out),
    // fading as it goes.
    const u = Math.min(1, (age - AWAY_AT_MS) / AWAY_MS);
    const e = 1 - (1 - u) * (1 - u);
    return [hit - this.side * AWAY_DEG * e, u < 0.4 ? 1 : 1 - (u - 0.4) / 0.6];
  }

  /** The head's centre in world px at a rotation. */
  private head(deg: number): [number, number] {
    const r = (deg * Math.PI) / 180;
    return [this.px - ARM * HAMMER_SCALE * Math.sin(r), this.py + ARM * HAMMER_SCALE * Math.cos(r)];
  }

  /** How lit the runes are: kindling on the way down, blazing at the
   *  impact, cooling through the ring to an ember glow for the lift. */
  private glow(age: number): number {
    if (age < SWING_MS) return 0.25 + 0.35 * (age / SWING_MS);
    const since = age - SWING_MS;
    return 0.4 + 0.6 * Math.exp(-since / 170);
  }

  drawGround(canvas: SkCanvas, age: number): void {
    const { x, y } = this;
    // The shadow: under the head wherever the swing has it, wide and faint
    // while it's high, closing and darkening as it comes down.
    const [deg, alpha] = this.pose(age);
    const [hx, hy] = this.head(deg);
    const h = Math.min(1, Math.max(0, (this.head(-this.side * 90)[1] - hy) / (ARM * HAMMER_SCALE)));
    if (alpha > 0 && (age < SWING_MS || age >= AWAY_AT_MS)) {
      canvas.save();
      canvas.translate(hx, y);
      canvas.scale((DENT_W / 2) * (1.1 + 1.2 * h), (DENT_H / 2) * (1.2 + 0.9 * h));
      shadowPaint.setAlphaf(Math.min(1, 0.15 + 0.85 * (1 - h) * (1 - h)) * alpha);
      canvas.drawCircle(0, 0, 1, shadowPaint);
      canvas.restore();
    }

    const since = age - SWING_MS;
    if (since < 0) return;
    // The flash: the instant of contact lights the sand under the head.
    if (since < FLASH_MS) {
      const t = since / FLASH_MS;
      canvas.save();
      canvas.translate(x, y);
      canvas.scale(DENT_W * (0.55 + 0.35 * t), DENT_H * (0.9 + 0.6 * t));
      flashPaint.setAlphaf(0.9 * (1 - t) * (1 - t));
      canvas.drawCircle(0, 0, 1, flashPaint);
      canvas.restore();
    }
    // The dust: soft clouds rolling out low along the ground, quick then
    // slowing (ease-out), swelling as they thin.
    for (const m of this.dust) {
      const s = since - m.delay;
      if (s <= 0 || s >= DUST_MS) continue;
      const t = s / DUST_MS;
      const out = 1 - (1 - t) * (1 - t) * (1 - t);
      const r = DENT_W * 0.35 + m.reach * out;
      canvas.save();
      canvas.translate(x + Math.cos(m.ang) * r, y + Math.sin(m.ang) * r * 0.5);
      const size = m.size * (0.7 + 0.9 * t);
      canvas.scale(size, size * 0.62);
      dustPaint.setAlphaf(Math.min(1, s / 50) * (1 - t) * (1 - t) * 0.95);
      canvas.drawCircle(0, 0, 1, dustPaint);
      canvas.restore();
    }
    // Shards of packed sand: thrown up and out, spinning, landing.
    if (since < DUST_MS) {
      const t = since / DUST_MS;
      const out = 1 - (1 - t) * (1 - t);
      for (const c of this.shards) {
        const r = DENT_W * 0.3 + c.reach * out;
        const hop = 40 * Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.25)));
        canvas.save();
        canvas.translate(x + Math.cos(c.ang) * r, y + Math.sin(c.ang) * r * 0.55 - hop);
        canvas.rotate(c.spin * t * 57.3 * 0.6, 0, 0);
        canvas.scale(c.size, c.size);
        const a = t < 0.75 ? 1 : (1 - t) / 0.25;
        // Solid chips, no inner highlight: a lit centre inside a dark edge
        // read as an outline (the cartoon v1 was cut for).
        fill.setColor(C_SHARD);
        fill.setAlphaf(a);
        canvas.drawPath(SHARD, fill);
        canvas.restore();
      }
    }
    fill.setAlphaf(1);
  }

  drawAir(canvas: SkCanvas, age: number): void {
    const [deg, alpha] = this.pose(age);
    if (alpha <= 0) return;
    const swinging = age < SWING_MS;
    const away = age >= AWAY_AT_MS;

    // The smear: a band along the head's own arc, from where it was 45ms ago
    // to where it is, in three touching segments that thin back along the
    // path (touching, so it can't strobe the way v2's ghost copies did).
    if ((swinging && age > 45) || away) {
      const r = ARM * HAMMER_SCALE;
      const oval = Skia.XYWHRect(this.px - r, this.py - r, r * 2, r * 2);
      // The head's screen angle about the grip, degrees (Skia arcs: 0 = +x, clockwise).
      const at = (d: number): number => {
        const [hx, hy] = this.head(d);
        return (Math.atan2(hy - this.py, hx - this.px) * 180) / Math.PI;
      };
      smearPaint.setShader(null);
      smearPaint.setStyle(PaintStyle.Stroke);
      smearPaint.setStrokeWidth(HEAD_W * HAMMER_SCALE * 0.7);
      smearPaint.setColor(C_SMEAR_ON);
      for (const [from, to, a] of [[45, 30, 0.3], [30, 15, 0.6], [15, 0, 1]] as const) {
        const a0 = at(this.pose(age - from)[0]);
        const a1 = at(this.pose(age - to)[0]);
        let sweep = a1 - a0;
        if (sweep > 180) sweep -= 360;
        if (sweep < -180) sweep += 360;
        if (Math.abs(sweep) < 0.5) continue;
        smearPaint.setAlphaf(a * alpha);
        canvas.drawArc(oval, a0, sweep, false, smearPaint);
      }
    }

    canvas.save();
    canvas.translate(this.px, this.py);
    canvas.rotate(deg, 0, 0);
    canvas.scale(HAMMER_SCALE, HAMMER_SCALE);
    canvas.translate(0, -GRIP_Y);
    const paint = (p: SkPaint, path: SkPath): void => {
      p.setAlphaf(alpha);
      canvas.drawPath(path, p);
    };
    paint(woodPaint, HANDLE);
    paint(gripPaint, GRIP);
    paint(capPaint, CAP);
    paint(ironPaint, HEAD);
    paint(facePaint, FACES);
    paint(collarPaint, COLLAR);
    paint(goldPaint, COLLAR_BANDS);

    // The specular: a hard thin edge of light along the top planes.
    line.setColor(Skia.Color("#e8eef6"));
    line.setAlphaf(0.75 * alpha);
    line.setStrokeWidth(1.6);
    canvas.drawPath(SPECULAR, line);

    // The runes: a dark engraving, lit from within.
    line.setColor(C_ENGRAVE);
    line.setAlphaf(0.9 * alpha);
    line.setStrokeWidth(4.5);
    canvas.drawPath(RUNES, line);
    const g = this.glow(age) * alpha;
    for (let i = 0; i < GLOW.length; i++) {
      const [width, a] = GLOW[i]!;
      glowPaint.setColor(GLOW_COLOURS[i]!);
      glowPaint.setAlphaf(Math.min(1, a * g * (i === GLOW.length - 1 ? 1 : 1.15)));
      glowPaint.setStrokeWidth(width);
      canvas.drawPath(RUNES, glowPaint);
    }
    canvas.restore();
    line.setAlphaf(1);
    fill.setAlphaf(1);
  }

  /** The dent is there the instant the hammer lands. */
  markAlpha(age: number): number {
    return age < SWING_MS ? 0 : 1;
  }

  stampMark(canvas: SkCanvas, alpha: number): void {
    if (alpha <= 0) return;
    this.hollowPaint.setAlphaf(alpha);
    canvas.drawCircle(this.x, this.y, DENT_W * 0.72, this.hollowPaint);
    fill.setColor(C_CRACK);
    fill.setAlphaf(0.8 * alpha);
    canvas.drawPath(this.cracks, fill);
    this.dentPaint.setAlphaf(alpha);
    canvas.drawPath(this.dent, this.dentPaint);
    line.setColor(C_LIP);
    line.setAlphaf(0.55 * alpha);
    line.setStrokeWidth(3);
    canvas.drawPath(this.lip, line);
    fill.setAlphaf(1);
    line.setAlphaf(1);
  }
}
