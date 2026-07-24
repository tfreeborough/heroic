/**
 * The High Sun title scene (docs/design/asset-forge.md sprite path; mock:
 * title-screen artifact round 3): high-noon colosseum interior — bleached sky,
 * sun glare, crowd band, arches, velarium masts + banners, raked sand with old
 * stains. Painted ONCE into a static SkPicture per screen size; every moving
 * thing on the title screen (figures, dust, glow, banners, entrance) lives in
 * HomeScreen on RN Animated or Reanimated UI-thread values, so no JS frame
 * loop runs outside a match.
 *
 * Red is rationed here on purpose: the banners and the PLAY button are the
 * only red on screen — in this game red means blood, not wallpaper.
 */
import {
  ClipOp,
  createPicture,
  Skia,
  StrokeCap,
  PaintStyle,
  TileMode,
  vec,
  type SkCanvas,
  type SkPicture,
} from "@shopify/react-native-skia";

export interface SceneAnchors {
  wallTop: number;
  wallBot: number;
  /** Figure feet line + rendered sprite box — HomeScreen places the images. */
  figureY: number;
  figureSize: number;
  leftX: number;
  rightX: number;
}

export const sceneAnchors = (w: number, h: number): SceneAnchors => ({
  wallTop: h * 0.42,
  wallBot: h * 0.55,
  figureY: h * 0.615,
  figureSize: h * 0.098,
  leftX: w * 0.33,
  rightX: w * 0.67,
});

/** Deterministic scene randomness — the crowd must not reshuffle on re-mount. */
const mulberry = (seed: number) => (): number => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export interface CrowdDot {
  x: number;
  y: number;
  light: boolean;
  a: number;
}

/** The stands, seeded — identical between the static painting and the life
 * layer, so the glint lands ON a painted spectator, not beside one. */
export const buildCrowd = (w: number, h: number): CrowdDot[] => {
  const { wallTop, wallBot } = sceneAnchors(w, h);
  const bandH = wallBot - wallTop;
  const rand = mulberry(7);
  return Array.from({ length: 300 }, () => {
    const x = rand() * w;
    const y = wallTop - 4 + rand() * bandH * 0.55;
    const light = rand() < 0.12;
    return { x, y, light, a: 0.2 + rand() * 0.5 };
  });
};

/** The rim's sagging top edge (the wall-top quadratic, evaluated at x). */
const rimYAt = (w: number, wallTop: number, x: number): number => {
  const u = x / w;
  return (1 - u) * (1 - u) * (wallTop + 7) + 2 * u * (1 - u) * (wallTop - 7) + u * u * (wallTop + 7);
};

export interface BannerAnchor {
  x: number;
  y: number;
  phase: number;
}

/** Masts lean away from centre; the middle one stands straight. */
const mastLean = (mx: number, w: number): number =>
  Math.abs(mx - w / 2) < 1 ? 0 : mx < w / 2 ? -3 : 3;

/** Mast-tops that fly cloth — HomeScreen's SceneLife flies the ribbons from
 * here (UI-thread Reanimated paths, so the cloth moves at refresh rate). */
export const bannerAnchors = (w: number, h: number): BannerAnchor[] => {
  const { wallTop } = sceneAnchors(w, h);
  return [1, 3].map((bi) => {
    const mx = w * (0.08 + bi * 0.21);
    return { x: mx + mastLean(mx, w), y: rimYAt(w, wallTop, mx) - 22, phase: bi * 2 };
  });
};

const fill = (color: string) => {
  const p = Skia.Paint();
  p.setColor(Skia.Color(color));
  return p;
};

const stroke = (color: string, width: number) => {
  const p = fill(color);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(StrokeCap.Round);
  return p;
};

const linear = (x0: number, y0: number, x1: number, y1: number, colors: string[], pos: number[] | null) => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(vec(x0, y0), vec(x1, y1), colors.map((c) => Skia.Color(c)), pos, TileMode.Clamp),
  );
  return p;
};

const radial = (cx: number, cy: number, r: number, colors: string[], pos: number[] | null) => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeRadialGradient(vec(cx, cy), r, colors.map((c) => Skia.Color(c)), pos, TileMode.Clamp),
  );
  return p;
};

const paintScene = (c: SkCanvas, w: number, h: number): void => {
  const { wallTop, wallBot, figureY, figureSize, leftX, rightX } = sceneAnchors(w, h);
  const bandH = wallBot - wallTop;

  // sky + sun glare
  c.drawRect(
    Skia.XYWHRect(0, 0, w, wallTop + 8),
    linear(0, 0, 0, h * 0.5, ["#a9bdb4", "#d3cfa9", "#eee0b8"], [0, 0.55, 1]),
  );
  c.drawRect(
    Skia.XYWHRect(0, 0, w, h * 0.55),
    radial(w * 0.74, h * 0.08, w * 0.62, ["rgba(255,248,224,0.95)", "rgba(255,240,200,0.35)", "rgba(255,240,200,0)"], [0, 0.25, 1]),
  );

  // far wall, sagging slightly toward centre
  const rimY = (x: number): number => rimYAt(w, wallTop, x);
  const wall = Skia.PathBuilder.Make()
    .moveTo(0, wallTop + 7)
    .quadTo(w / 2, wallTop - 7, w, wallTop + 7)
    .lineTo(w, wallBot + 9)
    .quadTo(w / 2, wallBot - 5, 0, wallBot + 9)
    .close()
    .detach();
  c.drawPath(wall, fill("#c8ab7d"));

  // crowd band on the upper wall
  const band = Skia.PathBuilder.Make()
    .moveTo(0, wallTop + 7)
    .quadTo(w / 2, wallTop - 7, w, wallTop + 7)
    .lineTo(w, wallTop + bandH * 0.55)
    .quadTo(w / 2, wallTop + bandH * 0.55 - 6, 0, wallTop + bandH * 0.55)
    .close()
    .detach();
  c.save();
  c.clipPath(band, ClipOp.Intersect, true);
  c.drawRect(Skia.XYWHRect(0, wallTop - 10, w, bandH), fill("#8a6f47"));
  const dark = fill("#57422c");
  const light = fill("#e8dcc2");
  for (const dot of buildCrowd(w, h)) {
    const p = dot.light ? light : dark;
    p.setAlphaf(dot.a);
    c.drawRect(Skia.XYWHRect(dot.x, dot.y, 2.4, 2.4), p);
  }
  c.restore();

  // rim highlight
  const rim = Skia.PathBuilder.Make()
    .moveTo(0, wallTop + 7)
    .quadTo(w / 2, wallTop - 7, w, wallTop + 7)
    .detach();
  c.drawPath(rim, stroke("rgba(240,224,180,0.7)", 2));

  // shaded arches along the lower wall
  const archH = bandH * 0.36;
  const archPaint = fill("rgba(74,55,35,0.85)");
  for (let i = 0; i < 8; i++) {
    const ax = w * (0.06 + i * 0.126);
    const aw = 15;
    const arch = Skia.PathBuilder.Make()
      .moveTo(ax, wallBot + 4)
      .lineTo(ax, wallBot + 4 - archH + aw / 2)
      .arcToOval(Skia.XYWHRect(ax, wallBot + 4 - archH, aw, aw), 180, 180, false)
      .lineTo(ax + aw, wallBot + 4)
      .close()
      .detach();
    c.drawPath(arch, archPaint);
  }

  // velarium masts along the rim — their banners fly on the LIFE layer
  // (makeLifePicture), so the cloth can actually ripple.
  const mastPaint = stroke("#4a3a26", 1.8);
  const finial = fill("#4a3a26");
  for (let i = 0; i < 5; i++) {
    const mx = w * (0.08 + i * 0.21);
    const lean = mastLean(mx, w);
    const my = rimY(mx);
    c.drawLine(mx, my, mx + lean, my - 23, mastPaint);
    c.drawCircle(mx + lean, my - 24, 1.6, finial);
  }

  // sand floor + heat haze where wall meets sand
  c.drawRect(
    Skia.XYWHRect(0, wallBot, w, h - wallBot),
    linear(0, wallBot, 0, h, ["#e2c690", "#cfa96e", "#93703f"], [0, 0.45, 1]),
  );
  c.drawRect(
    Skia.XYWHRect(0, wallBot - 12, w, 34),
    linear(0, wallBot - 12, 0, wallBot + 22, ["rgba(255,245,220,0)", "rgba(255,245,220,0.22)", "rgba(255,245,220,0)"], [0, 0.5, 1]),
  );

  // raked sand arcs
  const rake = stroke("rgba(122,92,52,0.15)", 1.4);
  for (let i = 0; i < 4; i++) {
    c.drawArc(
      Skia.XYWHRect(w / 2 - w * (0.28 + i * 0.19), h * 0.86 - h * (0.05 + i * 0.035), w * (0.56 + i * 0.38), h * (0.1 + i * 0.07)),
      194,
      152,
      false,
      rake,
    );
  }

  // old stains under the rake marks — the arena remembers
  const stain = fill("rgba(112,32,26,0.1)");
  c.drawOval(Skia.XYWHRect(w * 0.28 - 30, h * 0.7 - 8, 60, 16), stain);
  c.drawOval(Skia.XYWHRect(w * 0.58 - 16, h * 0.8 - 5, 32, 10), stain);
  const faint = fill("rgba(112,32,26,0.07)");
  c.drawOval(Skia.XYWHRect(w * 0.74 - 12, h * 0.645 - 4, 24, 8), faint);

  // contact shadows under the duellists (the sprites arrive shadow-free)
  const shadow = fill("rgba(58,36,18,0.26)");
  const sw = figureSize * 0.42;
  c.drawOval(Skia.XYWHRect(leftX - sw, figureY - sw * 0.2, sw * 2, sw * 0.4), shadow);
  c.drawOval(Skia.XYWHRect(rightX - sw, figureY - sw * 0.2, sw * 2, sw * 0.4), shadow);

  // warm vignette + a darker grade under the menu
  c.drawRect(
    Skia.XYWHRect(0, 0, w, h),
    radial(w / 2, h * 0.5, h * 0.74, ["rgba(43,28,16,0)", "rgba(43,28,16,0)", "rgba(43,28,16,0.38)"], [0, 0.32, 1]),
  );
  c.drawRect(
    Skia.XYWHRect(0, h * 0.72, w, h * 0.28),
    linear(0, h * 0.72, 0, h, ["rgba(40,26,12,0)", "rgba(40,26,12,0.34)"], null),
  );
};

/** The whole backdrop as one cached picture — repainted only on resize. */
export const makeHighSunPicture = (w: number, h: number): SkPicture =>
  createPicture((c) => paintScene(c, w, h), { width: w, height: h });
