import { Platform } from "react-native";
import {
  BlendMode,
  BlurStyle,
  ClipOp,
  createPicture,
  FillType,
  matchFont,
  PaintStyle,
  PointMode,
  Skia,
  StrokeCap,
  TileMode,
  type SkCanvas,
  type SkFont,
  type SkPicture,
} from "@shopify/react-native-skia";
import {
  extrudeRect,
  keyColorDef,
  voidRimBands,
  wallLeanVector,
  ZONE_DEPTH,
  type FogGrid,
  type KeyColor,
} from "@heroic/engine";
import {
  COLORS,
  ENEMY_RADIUS,
  LOW_HP_THRESHOLD,
  LOW_HP_VIGNETTE_MAX_ALPHA,
  LOW_HP_VIGNETTE_MIN_ALPHA,
  PILLARS,
  PLAYER_RADIUS,
  VISION,
  VOIDS,
  WALLS,
} from "./constants";
import type { WeaponDef } from "./weapons";

/**
 * The ENTIRE world is recorded into one SkPicture per rendered frame, in screen
 * space (the camera transform is baked in here, not applied by a Reanimated
 * Group). This is deliberate: mixing an imperatively-recorded picture with
 * Reanimated-driven transforms put world content on two update paths that
 * drifted a frame apart, so thin elements (the range ring, HP bars) shimmered
 * against the smoothly-transformed player/tiles. One picture = one path = no
 * inter-layer jitter. Everything below is interpolated by the caller.
 */
export interface CombatScene {
  /** World→screen: scale by `zoom` around `anchor`, centred on the camera. */
  camera: { x: number; y: number; zoom: number };
  anchor: { x: number; y: number };
  /**
   * Pixel HUD fonts for the floating damage numbers, at the scene's two sizes.
   * Either may be null while the font is still loading — the drawer falls back to
   * the built-in system font, so numbers always render.
   */
  fonts?: { damage: SkFont | null; crit: SkFont | null };
  /** Baked per-chunk floor pictures + grid geometry; only the in-view chunks are replayed. */
  floor: {
    chunks: SkPicture[];
    chunkCols: number;
    chunkRows: number;
    chunkSize: number;
  };
  /** `hurt` runs 1 → 0 after a contact hit; `facing` rotates the notch. */
  player: { x: number; y: number; facing: number; hpFrac: number; hurt: number };
  weapon: WeaponDef;
  /** Present only while winding up. `progress` runs 0 → 1 toward the strike. */
  windup: { progress: number; facing: number; targetX: number; targetY: number } | null;
  targetId: number | null;
  enemies: { id: number; x: number; y: number; hpFrac: number; flash: number; color: string; flying: boolean }[];
  /**
   * Destructible blockers in live state (alive ones only — a broken one just
   * isn't in the list). Centre + size, hp fraction (for a damage bar), `kind`
   * (→ colour) and `flash` (1 → 0 hit pulse).
   */
  breakables: { x: number; y: number; w: number; h: number; hpFrac: number; flash: number; kind: string; occludes: boolean; prime: number; targeted: boolean; lock: KeyColor | null }[];
  /** Uncollected key pickups, drawn with the remembered static world; `color` → its hue. */
  keys: { x: number; y: number; color: KeyColor }[];
  /** Ranged enemies mid-windup (and chargers): the telegraph line + charge. */
  enemyCasts: { x: number; y: number; targetX: number; targetY: number; progress: number; color: string }[];
  /** Summoners mid-cast: an expanding ring at the summoner. */
  summonTelegraphs: { x: number; y: number; progress: number; color: string }[];
  projectiles: { x: number; y: number; dirX: number; dirY: number; radius: number; color: string }[];
  /** `fade` runs 1 → 0 over each effect's lifetime; `hostile` = damage taken. */
  numbers: { x: number; y: number; text: string; crit: boolean; hostile: boolean; fade: number }[];
  arcFlashes: { x: number; y: number; facing: number; fade: number }[];
  /** Active explosion VFX. `progress` runs 0 → 1 over the blast's life; `radius` is the AoE. */
  explosions: { x: number; y: number; radius: number; progress: number; seed: number }[];
  /** Persistent fog-of-war memory (the explored/unexplored grid). Discovery is a
   *  proximity reveal done by the caller (markVisibleCircle); the renderer only reads
   *  `seen` to draw the unexplored fog. */
  fog: FogGrid;
  /** Seconds elapsed, fed to the drifting-mist shader as its animation clock. */
  time: number;
  /**
   * Low-health pulse phase in whole beats (accumulated in the sim so the beat
   * stays smooth as its rate ramps with danger). Only the fractional part
   * matters; the renderer draws the vignette when `player.hpFrac` is low.
   */
  lowHealthPhase: number;
}

// System-font fallbacks for the damage numbers, used until the pixel HUD font
// (scene.fonts, loaded async in GameScreen) is ready.
const fontFamily = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const fallbackDamageFont = matchFont({ fontFamily, fontSize: 15, fontWeight: "bold" });
const fallbackCritFont = matchFont({ fontFamily, fontSize: 19, fontWeight: "bold" });

// Paints are reused across recordings; each draw sets color/alpha before use.
const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

// Enemy bodies are drawn batched via drawPoints: a round-capped stroked "point"
// of width 2·radius is a filled circle of that radius. One drawPoints call per
// colour replaces one drawCircle per enemy, so a 150-strong horde of a few types
// is ~5 calls instead of 150 — the big lever for crowds.
const enemyBodyPaint = Skia.Paint();
enemyBodyPaint.setStyle(PaintStyle.Stroke);
enemyBodyPaint.setStrokeCap(StrokeCap.Round);
enemyBodyPaint.setStrokeWidth(ENEMY_RADIUS * 2);

// Skia.Color parses a colour string (a JSI hop) every call; the scene draws from
// a tiny fixed palette, so memoise it. At ~150 enemies this turns hundreds of
// parses per frame into a handful of map lookups. Alpha is always set separately
// via setAlphaf, so the cache key is just the (stable) colour string.
const colorCache = new Map<string, ReturnType<typeof Skia.Color>>();
const color = (hex: string): ReturnType<typeof Skia.Color> => {
  let c = colorCache.get(hex);
  if (c === undefined) {
    c = Skia.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
};

const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;

/**
 * Fill opacity for an *occluding* breakable (a destructible wall). Below 1 so the
 * floor bleeds through and it reads as "not solid" — a tell that there's something
 * to break here (often a secret passage), without giving away what's behind it (it
 * still fully blocks line of sight). Tune toward 1 for more solid, down for ghostlier.
 */
const BREAKABLE_WALL_ALPHA = 0.6;

// Flying-enemy drop shadow: a soft dark ellipse cast on the ground below the body, so
// a flyer reads as airborne (and as hovering, when it's out over a void). Offset south
// (light from the north) and flattened; the gap between body and shadow sells the lift.
const FLYER_SHADOW_DROP = ENEMY_RADIUS * 0.95; // how far south of the body the shadow sits
const FLYER_SHADOW_RADIUS = ENEMY_RADIUS * 1.1; // shadow size (slightly wider than the body)
const FLYER_SHADOW_SQUASH = 0.5; // vertical flatten (1 = round, 0 = a line)
const FLYER_SHADOW_ALPHA = 0.55;

/**
 * How strongly the drifting mist tints a void pit. The pit is a deep `void`-colour
 * base with this much of the fog-of-war mist laid over it, so it reads as a darker,
 * foggy chasm rather than the bright unexplored churn. Up → mistier, down → flatter.
 */
const VOID_MIST_ALPHA = 0.35;

/** Breakable fill colour by kind (placeholder art); unknown kinds read as a crate. */
const breakableColor = (kind: string): string => {
  switch (kind) {
    case "wood-wall":
      return COLORS.breakableWood;
    case "barrel":
      return COLORS.breakableBarrel;
    case "spawner":
      return COLORS.spawnerNest;
    default:
      return COLORS.breakableCrate;
  }
};

const KEY_ICON_LEN = 22; // key sprite length (world px)
const KEY_ICON_BOW_R = 6; // radius of the key's bow (the ring you hold)

/**
 * A locked door (docs/design/doors-and-keys.md): a wall-sized box in its key's
 * colour with a dark keyhole — the colour says *which* key opens it, the keyhole
 * says *locked*. No cracks or HP bar: a door yields to a key, never to damage.
 */
const drawLockedDoor = (
  canvas: SkCanvas,
  hex: string,
  bx: number,
  by: number,
  w: number,
  h: number,
) => {
  fill.setColor(color(hex));
  fill.setAlphaf(0.92);
  canvas.drawRect(Skia.XYWHRect(bx, by, w, h), fill);
  // Inset frame: reads as a built door panel rather than a painted-on tile.
  stroke.setColor(color("#0c0e12"));
  stroke.setAlphaf(0.5);
  stroke.setStrokeWidth(2);
  const inset = Math.min(w, h) * 0.14;
  canvas.drawRect(Skia.XYWHRect(bx + inset, by + inset, w - 2 * inset, h - 2 * inset), stroke);
  // Keyhole: a circle over a tapered slot, centred.
  const cx = bx + w / 2;
  const cy = by + h / 2;
  const r = Math.min(w, h) * 0.13;
  fill.setColor(color("#0c0e12"));
  fill.setAlphaf(0.72);
  canvas.drawCircle(cx, cy - r * 0.25, r, fill);
  const slot = Skia.Path.Make();
  slot.moveTo(cx - r * 0.5, cy);
  slot.lineTo(cx + r * 0.5, cy);
  slot.lineTo(cx + r * 0.95, cy + r * 1.5);
  slot.lineTo(cx - r * 0.95, cy + r * 1.5);
  slot.close();
  canvas.drawPath(slot, fill);
};

/**
 * A key pickup: a small key glyph in its colour, drawn twice — a fat dark
 * silhouette then the colour on top, so it reads on any floor — under a soft
 * pulsing halo to catch the eye. `t` is the scene clock (seconds).
 */
const drawKeyPickup = (canvas: SkCanvas, hex: string, x: number, y: number, t: number) => {
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  fill.setColor(color(hex));
  fill.setAlphaf(0.1 + 0.12 * pulse);
  canvas.drawCircle(x, y, KEY_ICON_LEN * 0.6, fill);

  const bowX = x - KEY_ICON_LEN * 0.32;
  const tipX = x + KEY_ICON_LEN * 0.46;
  const spine = Skia.Path.Make();
  spine.moveTo(bowX, y);
  spine.lineTo(tipX, y);
  const teeth = Skia.Path.Make();
  teeth.moveTo(tipX - 5, y);
  teeth.lineTo(tipX - 5, y + 5);
  teeth.moveTo(tipX, y);
  teeth.lineTo(tipX, y + 7);

  stroke.setStrokeCap(StrokeCap.Round);
  for (const pass of [
    { c: "#13151a", a: 0.9, ring: 5.5, line: 6 },
    { c: hex, a: 1, ring: 3, line: 3 },
  ]) {
    stroke.setColor(color(pass.c));
    stroke.setAlphaf(pass.a);
    stroke.setStrokeWidth(pass.line);
    canvas.drawPath(spine, stroke);
    canvas.drawPath(teeth, stroke);
    stroke.setStrokeWidth(pass.ring);
    canvas.drawCircle(bowX, y, KEY_ICON_BOW_R, stroke);
  }
  stroke.setStrokeCap(StrokeCap.Butt);
};

// Heavy blur (respectCTM=true → world units, so it scales with camera zoom) for the
// explored↔unseen frontier — melts the memory grid into soft mist rather than blocks.
const fogBlur =
  VISION.fogSoftness > 0 ? Skia.MaskFilter.MakeBlur(BlurStyle.Normal, VISION.fogSoftness, true) : null;

/** "#rrggbb" → "r, g, b" floats in 0..1, for inlining into SkSL source. */
const skslRgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(4)).join(", ");
};

/** "#rrggbb" + alpha → an "rgba(...)" string Skia.Color can parse. */
const rgbaCss = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Sight-range falloff gradient stops: the fog colour, transparent at the player
// and fully opaque by the sight radius (held past it by Clamp). Built once.
const FOG_CLEAR = color(rgbaCss(VISION.shadowColor, 0));
const FOG_OPAQUE = color(rgbaCss(VISION.shadowColor, 1));

// Pit inner-wall gradient: solid wall colour from the rim down through `voidWallSolid`
// of its depth, THEN dissolving into the fog — so the wall reads as a surface first,
// feather second. Colours/stops never change, so build once.
const VOID_WALL_STOPS = [
  color(rgbaCss(COLORS.voidWall, 1)),
  color(rgbaCss(COLORS.voidWall, 1)),
  color(rgbaCss(COLORS.voidWall, 0)),
];
const VOID_WALL_POS = [0, ZONE_DEPTH.voidWallSolid, 1];

// Low-health vignette gradient stops: clear at the play-area centre, full red at
// the rim. The per-frame alpha (pulse × severity) scales the whole thing.
const LOW_HP_CLEAR = color(rgbaCss(COLORS.playerHurt, 0));
const LOW_HP_OPAQUE = color(rgbaCss(COLORS.playerHurt, 1));

// Fireball radial-gradient stops, built once (the per-blast fade is applied via the
// paint's alpha, not by re-stringing colours — that would flood the colour cache).
// White-hot centre → orange mid → transparent edge.
const EXPLO_CORE = color(rgbaCss(COLORS.explosionCore, 1));
const EXPLO_MID = color(rgbaCss(COLORS.explosionMid, 0.7));
const EXPLO_EDGE = color(rgbaCss(COLORS.explosionMid, 0));

// Drifting-mist shader for the fogged area. Evaluated in WORLD space (the camera
// transform is baked into the canvas when we draw it), so the noise is anchored
// to the world and only the time-driven drift moves it — it doesn't swim when the
// camera pans. Returns opaque colour; the paint's alpha sets how much shows, and
// the fog paths/blur decide WHERE. Tunables are inlined as constants so the only
// per-frame uniform is the clock. Falls back to a flat fill if it fails to compile.
const fogEffect = Skia.RuntimeEffect.Make(`
uniform float u_time;

const float INV_SCALE = ${(1 / VISION.mistScale).toFixed(6)};
const float DRIFT = ${(VISION.mistSpeed / VISION.mistScale).toFixed(6)};
const half3 DARK = half3(${skslRgb(VISION.shadowColor)});
const half3 MIST = half3(${skslRgb(VISION.mistColor)});

// Per-octave rotation: keeps each octave's lattice from lining up with the
// axes (and with the others), which is what kills the straight-line/grid look.
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

// Random gradient vector per lattice point. Gradient (Perlin-style) noise is
// zero at the lattice points and interpolates *gradients*, so it has none of the
// blocky value-noise artefacts.
float2 grad(float2 ip) {
  float2 h = fract(sin(float2(dot(ip, float2(127.1, 311.7)), dot(ip, float2(269.5, 183.3)))) * 43758.5453);
  return h * 2.0 - 1.0;
}
float gnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(grad(i + float2(0.0, 0.0)), f - float2(0.0, 0.0));
  float b = dot(grad(i + float2(1.0, 0.0)), f - float2(1.0, 0.0));
  float c = dot(grad(i + float2(0.0, 1.0)), f - float2(0.0, 1.0));
  float d = dot(grad(i + float2(1.0, 1.0)), f - float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.0;
  float amp = 0.5;
  // 3 octaves, not 4: the 4th (amplitude 0.0625) is finer than the fog blur
  // removes anyway, so dropping it is invisible but cuts ~25% of the mist's
  // per-pixel cost (the mist is evaluated over the unexplored area every frame).
  for (int i = 0; i < 3; i++) {
    v += amp * gnoise(p);
    p = ROT * p * 2.0;
    amp *= 0.5;
  }
  return v;
}
half4 main(float2 coord) {
  float2 p = coord * INV_SCALE;
  // flow translates the whole field, so DRIFT (= mistSpeed) maps directly to
  // visible drift speed. Domain warp curls it like vapour on top of that travel.
  float2 flow = float2(u_time * DRIFT, u_time * DRIFT * 0.5);
  float2 q = float2(fbm(p + flow), fbm(p + float2(4.3, 1.7) + flow * 0.7));
  float n = fbm(p + 1.4 * q + flow);
  float wisp = smoothstep(0.35, 0.8, n * 0.5 + 0.5);
  return half4(mix(DARK, MIST, wisp), 1.0);
}
`);

// The never-seen fog is painted as a second dark layer *over* the dim explored
// layer, so this is the extra opacity that composites the two up to
// `unexploredAlpha`: 1 − (1 − unexplored)/(1 − explored).
const UNEXPLORED_EXTRA_ALPHA = Math.max(
  0,
  Math.min(1, 1 - (1 - VISION.unexploredAlpha) / (1 - VISION.exploredAlpha)),
);

/** Arrowhead inside the player circle pointing along +x (rotated by facing). */
const NOTCH = (() => {
  const r = PLAYER_RADIUS;
  return Skia.Path.MakeFromSVGString(
    `M ${r * 0.95} 0 L ${r * 0.15} ${-r * 0.5} L ${r * 0.15} ${r * 0.5} Z`,
  )!;
})();

const wedgePath = (cx: number, cy: number, radius: number, facing: number, arcWidth: number) => {
  const startDeg = ((facing - arcWidth / 2) * 180) / Math.PI;
  const sweepDeg = (arcWidth * 180) / Math.PI;
  const path = Skia.Path.Make();
  path.moveTo(cx, cy);
  path.arcToOval(Skia.XYWHRect(cx - radius, cy - radius, radius * 2, radius * 2), startDeg, sweepDeg, false);
  path.close();
  return path;
};

export const EMPTY_COMBAT_PICTURE: SkPicture = createPicture(() => {});

/**
 * Dev phase profiler: recordCombatScene adds the ms it spends in each major
 * section here, and GameScreen reads + resets these once per sampling interval to
 * show a per-frame breakdown. `world` = floor/voids/walls/breakables/keys; `live`
 * = the sight-clipped enemies/telegraphs/projectiles/numbers; `fog` = the
 * fog-of-war layers; `ui` = player + explosions + vignette. performance.now() is
 * cheap, so it's always written; the readout is dev-gated in GameScreen.
 */
export const RENDER_PHASES = { world: 0, live: 0, fog: 0, ui: 0 };

// Profiling gate. The phase timers below only fire when this is on — driven from the
// Settings "Performance overlay" toggle via setRenderProfiling. Off (the default),
// they cost nothing, which matters now the overlay can be enabled in release builds.
let PROFILING = false;
export const setRenderProfiling = (on: boolean): void => {
  PROFILING = on;
};

// Render debug switches (driven from Settings → Diagnostics). These let you bisect
// the *GPU/raster* cost — which the JS profiler can't see — by turning off the most
// expensive layers and watching the frame rate: `disableFog` skips the fog-of-war
// blur/mist/overdraw layers, `disableMist` drops the per-pixel drifting-mist shader
// (flat fog + flat void instead). Both ship off; they're diagnostic, not gameplay.
const DEBUG = { disableFog: false, disableMist: false };
// The baked world picture (below). Module-level so setRenderDebug can invalidate it
// when `disableMist` flips (the mist is baked into it).
let worldPic: SkPicture | null = null;
export const setRenderDebug = (d: { disableFog: boolean; disableMist: boolean }): void => {
  DEBUG.disableFog = d.disableFog;
  if (DEBUG.disableMist !== d.disableMist) worldPic = null; // baked in → re-bake on change
  DEBUG.disableMist = d.disableMist;
};

/**
 * The static world geometry — floor chunks, void pits (+ static mist), boundary walls,
 * and interior pillars — recorded ONCE into a WORLD-SPACE picture (no camera transform)
 * and then replayed under the camera transform every frame by recordCombatScene.
 *
 * The depth is **fixed** (`leanScale: 0` → no camera parallax), which is the whole
 * point: with no camera dependence the picture is identical forever, so it's baked a
 * single time instead of re-recorded every frame. That collapses the per-frame `world`
 * cost from "hundreds of draws + a linear gradient per void rim band" (the dominant
 * combat cost we measured, ~16-20ms) down to one `drawPicture`.
 *
 * The whole map is baked (no per-frame view cull); Skia quick-rejects the off-screen
 * geometry at replay time, so replaying a map-sized picture stays cheap. The void mist
 * is baked in, so it's a static texture rather than drifting — the fog-of-war mist
 * (drawn live in recordCombatScene) still drifts.
 */
const recordWorldPicture = (scene: CombatScene): SkPicture =>
  createPicture((canvas) => {
    const mistShader = !DEBUG.disableMist && fogEffect ? fogEffect.makeShader([scene.time]) : null;

    // Arena floor: every baked chunk (Skia quick-rejects the off-screen ones on replay).
    for (let k = 0; k < scene.floor.chunks.length; k++) canvas.drawPicture(scene.floor.chunks[k]!);

    // Void pits: deep fill (hiding the floor), static mist, then the FIXED-depth cliff
    // (leanScale 0 → camera-independent). The full set; voidRimBands still gets it all
    // for the abutment test.
    if (VOIDS.length > 0) {
      fill.setShader(null);
      fill.setColor(color(COLORS.void));
      fill.setAlphaf(1);
      for (const v of VOIDS) canvas.drawRect(Skia.XYWHRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h), fill);
      if (mistShader) {
        fill.setShader(mistShader);
        fill.setAlphaf(VOID_MIST_ALPHA);
        for (const v of VOIDS) canvas.drawRect(Skia.XYWHRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h), fill);
        fill.setShader(null);
        fill.setAlphaf(1);
      }
      // Pit depth: a lit ground lip + a wall descending into the fog, clipped to the
      // void so cliffs never spill. Fixed tilt only (no camera-relative parallax).
      canvas.save();
      const voidClip = Skia.Path.Make();
      for (const v of VOIDS) voidClip.addRect(Skia.XYWHRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h));
      canvas.clipPath(voidClip, ClipOp.Intersect, true);
      for (const v of VOIDS) {
        for (const b of voidRimBands(v, VOIDS, 0, 0, 0)) {
          if (b.intensity > 0.01) {
            fill.setShader(
              Skia.Shader.MakeLinearGradient(
                { x: b.x0, y: b.y0 },
                { x: b.x1, y: b.y1 },
                VOID_WALL_STOPS,
                VOID_WALL_POS,
                TileMode.Clamp,
              ),
            );
            fill.setAlphaf(b.intensity * ZONE_DEPTH.voidWallAlpha);
            canvas.drawRect(Skia.XYWHRect(b.x, b.y, b.w, b.h), fill);
            fill.setShader(null);
          }
          fill.setColor(color(COLORS.voidLip));
          fill.setAlphaf(ZONE_DEPTH.lipAlpha);
          canvas.drawRect(Skia.XYWHRect(b.lipX, b.lipY, b.lipW, b.lipH), fill);
        }
      }
      fill.setAlphaf(1);
      canvas.restore();
    }

    // Boundary walls, then interior pillars with a FIXED south skirt (leanScale 0).
    fill.setColor(color(COLORS.wall));
    fill.setAlphaf(1);
    for (const w of WALLS) canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2, w.w, w.h), fill);
    if (PILLARS.length > 0) {
      const skirt = Skia.Path.Make();
      for (const p of PILLARS) {
        const lean = wallLeanVector(p, 0, 0, 0);
        for (const q of extrudeRect(p, lean.x, lean.y)) {
          skirt.moveTo(q[0]!, q[1]!);
          skirt.lineTo(q[2]!, q[3]!);
          skirt.lineTo(q[4]!, q[5]!);
          skirt.lineTo(q[6]!, q[7]!);
          skirt.close();
        }
      }
      fill.setColor(color(COLORS.pillarShadow));
      canvas.drawPath(skirt, fill);
    }
    fill.setColor(color(COLORS.pillar));
    for (const p of PILLARS) canvas.drawRect(Skia.XYWHRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h), fill);
  });

// Fixed depth makes the world picture camera-independent, so it's baked exactly ONCE
// (lazily, on first use — it needs the loaded floor chunks from `scene`) and reused
// forever. `worldPic` is reset by setRenderDebug when the mist toggle flips.
const getWorldPicture = (scene: CombatScene): SkPicture => {
  if (!worldPic) worldPic = recordWorldPicture(scene);
  return worldPic;
};

export const recordCombatScene = (scene: CombatScene): SkPicture => {
  // World geometry: refresh the cached, camera-keyed sub-picture OUTSIDE the main
  // recorder (so there's no nested PictureRecorder). Baked ONCE now (fixed depth →
  // camera-independent), so after the first frame this is a free cache hit.
  const _tw = PROFILING ? performance.now() : 0;
  const worldPic = getWorldPicture(scene);
  if (PROFILING) RENDER_PHASES.world += performance.now() - _tw;

  return createPicture((canvas) => {
    let _t = PROFILING ? performance.now() : 0;
    const { camera, anchor, player, weapon } = scene;
    const cfg = weapon.config;

    // The drifting-mist shader for the FOG layers (the void mist lives in the baked
    // world picture). makeShader is a JSI allocation, so build it once per frame.
    const mistShader = !DEBUG.disableMist && fogEffect ? fogEffect.makeShader([scene.time]) : null;

    // Camera transform: translate(anchor) ∘ scale(zoom) ∘ translate(-camera). The
    // world picture is in WORLD space now, so it's drawn UNDER this transform along
    // with the dynamic content (breakables, the sight-clipped live world, player UI) —
    // one transform, everything lines up.
    canvas.save();
    canvas.translate(anchor.x, anchor.y);
    canvas.scale(camera.zoom, camera.zoom);
    canvas.translate(-camera.x, -camera.y);

    // Static world (floor / pits / cliffs / walls / pillars), baked once, replayed here.
    canvas.drawPicture(worldPic);

    const vMinX = camera.x - anchor.x / camera.zoom;
    const vMaxX = camera.x + anchor.x / camera.zoom;
    const vMinY = camera.y - anchor.y / camera.zoom;
    const vMaxY = camera.y + anchor.y / camera.zoom;

    // Breakables: dynamic destructible blockers, drawn with the static geometry
    // (unclipped — a wall you remember still reads in the fog) but from live
    // state, so a broken one simply vanishes and opens the path. Body by kind,
    // then a white hit-flash, then a damage bar once chipped — the same feedback
    // an enemy gives, so "I'm breaking this" reads the same as "I'm hurting that".
    for (const b of scene.breakables) {
      // View-cull: skip breakables fully outside the viewport (box is exact — no margin).
      if (
        b.x - b.w / 2 > vMaxX ||
        b.x + b.w / 2 < vMinX ||
        b.y - b.h / 2 > vMaxY ||
        b.y + b.h / 2 < vMinY
      )
        continue;
      const bx = b.x - b.w / 2;
      const by = b.y - b.h / 2;
      if (b.lock) {
        // A locked door: its key's colour + a keyhole (see drawLockedDoor). No
        // crack/translucent treatment — a door isn't broken, it's unlocked.
        drawLockedDoor(canvas, keyColorDef(b.lock).hex, bx, by, b.w, b.h);
      } else {
        // A destructible *wall* (occludes) renders translucent + cracked so it reads
        // as breakable, not as permanent bedrock; barrels/crates stay solid.
        fill.setColor(color(breakableColor(b.kind)));
        fill.setAlphaf(b.occludes ? BREAKABLE_WALL_ALPHA : 1);
        canvas.drawRect(Skia.XYWHRect(bx, by, b.w, b.h), fill);
        if (b.occludes) {
          // Fracture lines: a zig-zag down the box plus two short branches, sized in
          // fractions of the box so it works for a tall thin wall or a square block.
          // Drawn in the bright accent (not dark-on-dark) so they actually read.
          const cracks = Skia.Path.Make();
          cracks.moveTo(bx + 0.5 * b.w, by);
          cracks.lineTo(bx + 0.35 * b.w, by + 0.28 * b.h);
          cracks.lineTo(bx + 0.6 * b.w, by + 0.52 * b.h);
          cracks.lineTo(bx + 0.42 * b.w, by + 0.76 * b.h);
          cracks.lineTo(bx + 0.55 * b.w, by + b.h);
          cracks.moveTo(bx + 0.35 * b.w, by + 0.28 * b.h);
          cracks.lineTo(bx + 0.12 * b.w, by + 0.36 * b.h);
          cracks.moveTo(bx + 0.6 * b.w, by + 0.52 * b.h);
          cracks.lineTo(bx + 0.86 * b.w, by + 0.6 * b.h);
          stroke.setColor(color(COLORS.breakableEdge));
          stroke.setAlphaf(0.85);
          stroke.setStrokeWidth(2);
          canvas.drawPath(cracks, stroke);
        }
      }
      if (b.flash > 0) {
        fill.setColor(color("#ffffff"));
        fill.setAlphaf(b.flash * 0.8);
        canvas.drawRect(Skia.XYWHRect(bx, by, b.w, b.h), fill);
      }
      if (b.prime > 0) {
        // Primed: a hot orange glow that ramps in (ease-in) as the fuse burns
        // down, so a barrel about to blow telegraphs the next link in the chain.
        fill.setColor(color(COLORS.explosionMid));
        fill.setBlendMode(BlendMode.Plus);
        fill.setAlphaf(0.85 * b.prime * b.prime);
        canvas.drawRect(Skia.XYWHRect(bx, by, b.w, b.h), fill);
        fill.setBlendMode(BlendMode.SrcOver);
      }
      if (b.hpFrac < 1 && b.prime === 0) {
        const barX = b.x - HP_BAR_WIDTH / 2;
        const barY = by - 10;
        fill.setColor(color(COLORS.hpBarBack));
        fill.setAlphaf(0.9);
        canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT), fill);
        fill.setColor(color(COLORS.hpBarFill));
        fill.setAlphaf(1);
        canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH * b.hpFrac, HP_BAR_HEIGHT), fill);
      }
      if (b.targeted) {
        // Auto-attack selection: the same accent the enemy target ring uses, as an
        // outline 3px proud of the footprint so it reads as "this is what I'm hitting".
        stroke.setColor(color(COLORS.targetRing));
        stroke.setAlphaf(0.85);
        stroke.setStrokeWidth(2);
        canvas.drawRect(Skia.XYWHRect(bx - 3, by - 3, b.w + 6, b.h + 6), stroke);
      }
    }

    // Key pickups — drawn with the static world (unclipped), so a key you've seen
    // stays remembered in the fog like a wall rather than vanishing the instant you
    // look away. The fog overlay still hides any key in unexplored territory.
    for (const k of scene.keys) {
      if (k.x > vMaxX + 32 || k.x < vMinX - 32 || k.y > vMaxY + 32 || k.y < vMinY - 32) continue;
      drawKeyPickup(canvas, keyColorDef(k.color).hex, k.x, k.y, scene.time);
    }

    // An enemy is hittable when its *edge* is within reach, i.e. its centre is
    // within reach + ENEMY_RADIUS — draw rings/wedges at that radius so the
    // visuals match the actual gate.
    const hitRadius = cfg.reach + ENEMY_RADIUS;
    if (PROFILING) { const n = performance.now(); RENDER_PHASES.world += n - _t; _t = n; }

    // --- Live world: enemies, their telegraphs, projectiles and damage numbers.
    // Drawn UNCLIPPED now (the player line-of-sight polygon is gone) — the fog overlay
    // below dims distant entities toward the lit-radius edge and the unexplored mask
    // hides anything in undiscovered territory, so "you see what's near you" falls out
    // of the fog rather than an expensive per-frame sight solve.
    canvas.save();

    // Drop shadows for flying enemies, beneath everything else: a flattened dark
    // ellipse on the ground south of the body, so a flyer reads as above the floor
    // (and as hovering when it's out over a void). Drawn from a unit circle via a
    // squash transform; only flyers have them, so grounded hordes pay nothing.
    if (scene.enemies.some((d) => d.flying)) {
      fill.setShader(null);
      fill.setColor(color("#000000"));
      fill.setAlphaf(FLYER_SHADOW_ALPHA);
      for (const d of scene.enemies) {
        if (!d.flying) continue;
        canvas.save();
        canvas.translate(d.x, d.y + FLYER_SHADOW_DROP);
        canvas.scale(1, FLYER_SHADOW_SQUASH);
        canvas.drawCircle(0, 0, FLYER_SHADOW_RADIUS, fill);
        canvas.restore();
      }
      fill.setAlphaf(1);
    }

    // Selection ring under the current target.
    const target = scene.enemies.find((d) => d.id === scene.targetId);
    if (target) {
      stroke.setColor(color(COLORS.targetRing));
      stroke.setAlphaf(0.85);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(target.x, target.y, ENEMY_RADIUS + 5, stroke);
    }

    // Enemies, drawn in batches to keep the call count flat as the horde grows:
    //   1. bodies — one drawPoints per colour (round caps → filled circles)
    //   2. hit flashes — only the few enemies struck this moment (per-enemy alpha)
    //   3. HP bars — damaged enemies only, backs + fills batched into one path each
    const bodiesByColor = new Map<string, { x: number; y: number }[]>();
    let anyFlash = false;
    let anyBar = false;
    for (const d of scene.enemies) {
      let pts = bodiesByColor.get(d.color);
      if (pts === undefined) {
        pts = [];
        bodiesByColor.set(d.color, pts);
      }
      pts.push({ x: d.x, y: d.y });
      if (d.flash > 0) anyFlash = true;
      if (d.hpFrac < 1) anyBar = true;
    }
    enemyBodyPaint.setAlphaf(1);
    for (const [c, pts] of bodiesByColor) {
      enemyBodyPaint.setColor(color(c));
      canvas.drawPoints(PointMode.Points, pts, enemyBodyPaint);
    }
    if (anyFlash) {
      fill.setColor(color("#ffffff"));
      for (const d of scene.enemies) {
        if (d.flash <= 0) continue;
        fill.setAlphaf(d.flash * 0.8);
        canvas.drawCircle(d.x, d.y, ENEMY_RADIUS, fill);
      }
    }
    if (anyBar) {
      const barBacks = Skia.Path.Make();
      const barFills = Skia.Path.Make();
      for (const d of scene.enemies) {
        if (d.hpFrac >= 1) continue;
        const barX = d.x - HP_BAR_WIDTH / 2;
        const barY = d.y - ENEMY_RADIUS - 10;
        barBacks.addRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT));
        barFills.addRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH * d.hpFrac, HP_BAR_HEIGHT));
      }
      fill.setColor(color(COLORS.hpBarBack));
      fill.setAlphaf(0.9);
      canvas.drawPath(barBacks, fill);
      fill.setColor(color(COLORS.hpBarFill));
      fill.setAlphaf(1);
      canvas.drawPath(barFills, fill);
    }

    // Enemy windup telegraphs: an aim line to the player + a charge dot growing
    // at the caster's edge. The whole point of a ranged enemy is that you can
    // see the shot coming and dodge it (combat.md: the windup IS the telegraph).
    for (const cast of scene.enemyCasts) {
      stroke.setColor(color(cast.color));
      stroke.setAlphaf(0.12 + 0.4 * cast.progress);
      stroke.setStrokeWidth(1.5);
      canvas.drawLine(cast.x, cast.y, cast.targetX, cast.targetY, stroke);
      const aim = Math.atan2(cast.targetY - cast.y, cast.targetX - cast.x);
      fill.setColor(color(cast.color));
      fill.setAlphaf(0.35 + 0.5 * cast.progress);
      canvas.drawCircle(
        cast.x + Math.cos(aim) * (ENEMY_RADIUS + 5),
        cast.y + Math.sin(aim) * (ENEMY_RADIUS + 5),
        1.5 + 3.5 * cast.progress,
        fill,
      );
    }

    // Summon telegraphs: a ring that grows as the cast charges, then pops.
    for (const s of scene.summonTelegraphs) {
      stroke.setColor(color(s.color));
      stroke.setAlphaf(0.15 + 0.5 * s.progress);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(s.x, s.y, ENEMY_RADIUS + 4 + 34 * s.progress, stroke);
    }

    // Projectiles with a short trail (player shots and enemy shots alike).
    for (const p of scene.projectiles) {
      fill.setColor(color(p.color));
      fill.setAlphaf(0.35);
      canvas.drawCircle(p.x - p.dirX * 9, p.y - p.dirY * 9, p.radius * 0.6, fill);
      fill.setAlphaf(1);
      canvas.drawCircle(p.x, p.y, p.radius, fill);
    }

    // Floating damage numbers; crits are bigger and gold, damage taken is red.
    for (const n of scene.numbers) {
      const font = n.crit
        ? (scene.fonts?.crit ?? fallbackCritFont)
        : (scene.fonts?.damage ?? fallbackDamageFont);
      const width = font.measureText(n.text).width;
      fill.setColor(color(n.crit ? COLORS.critText : n.hostile ? COLORS.hurtText : COLORS.damageText));
      fill.setAlphaf(Math.max(0, n.fade));
      canvas.drawText(n.text, n.x - width / 2, n.y, fill, font);
    }

    canvas.restore(); // end the current-sight clip
    if (PROFILING) { const n = performance.now(); RENDER_PHASES.live += n - _t; _t = n; }

    // --- Fog of war (simplified — no player line-of-sight). Two layers: a soft lit
    // radius around the player (clear near you, fading to remembered-dim with
    // distance), then the unexplored mask over cells you've never reached. No
    // shadow-casting, no sight polygon. `disableFog` skips it (diagnostic).
    if (!DEBUG.disableFog) {
      const halfW = anchor.x / camera.zoom;
      const halfH = anchor.y / camera.zoom;
      // Overscan past the blur radius so the mask's own outer edge — which the blur
      // softens — stays off-screen instead of darkening the margins.
      const over = Math.ceil(VISION.fogSoftness) + 8;
      const vl = camera.x - halfW - over;
      const vt = camera.y - halfH - over;
      const vw = (halfW + over) * 2;
      const vh = (halfH + over) * 2;

      // (1) Lit radius + base dim: a single radial gradient around the player — clear
      // out to `sightFalloff`, fading to the explored-dim level (`exploredAlpha`) by
      // `sightRadius` and held there (Clamp). Drawn UNCLIPPED over the whole view, so
      // everything beyond the bubble reads as remembered/dim and nearby entities stay
      // clear — that's how "you see what's near you" works now without a sight solve.
      fill.setColor(color(VISION.shadowColor));
      fill.setShader(
        Skia.Shader.MakeRadialGradient(
          { x: player.x, y: player.y },
          VISION.sightRadius,
          [FOG_CLEAR, FOG_OPAQUE],
          [VISION.sightFalloff, 1],
          TileMode.Clamp,
        ),
      );
      fill.setAlphaf(VISION.exploredAlpha);
      fill.setMaskFilter(null);
      canvas.drawRect(Skia.XYWHRect(vl, vt, vw, vh), fill);
      fill.setShader(null);

      // (2) Unexplored mask: the extra-dark drifting layer over every never-discovered
      // cell in view (explored cells — those within the proximity reveal — are punched
      // out as holes). The base dim is already laid by the radial above, so this only
      // composites the unexplored extra (UNEXPLORED_EXTRA_ALPHA) on top.
      //
      // The mask is rebuilt **every frame but only over the viewport** — an
      // overscanned cell window — so its cost is bounded by screen size, NOT by how
      // much of the map you've explored. (The old approach accumulated one rect per
      // explored cell into a single path and redrew the whole thing blurred each
      // frame, so it grew without bound on a large zone — the slow-creep we saw.)
      // Cells are greedy-meshed into one rect per horizontal run, so a swept-clear
      // region costs a few addRects per row, not one per cell.
      const fog = scene.fog;
      const cs = fog.cellSize;

      const cMin = Math.max(0, Math.floor(vl / cs));
      const cMax = Math.min(fog.cols - 1, Math.floor((vl + vw) / cs));
      const rMin = Math.max(0, Math.floor(vt / cs));
      const rMax = Math.min(fog.rows - 1, Math.floor((vt + vh) / cs));
      const fogPath = Skia.Path.Make();
      fogPath.setFillType(FillType.EvenOdd);
      fogPath.addRect(Skia.XYWHRect(vl, vt, vw, vh)); // viewport backdrop; explored = holes
      for (let r = rMin; r <= rMax; r++) {
        const base = r * fog.cols;
        let c = cMin;
        while (c <= cMax) {
          if (fog.seen[base + c] === 0) {
            c++;
            continue;
          }
          const runStart = c;
          while (c <= cMax && fog.seen[base + c] === 1) c++;
          fogPath.addRect(Skia.XYWHRect(runStart * cs, r * cs, (c - runStart) * cs, cs));
        }
      }
      fill.setShader(mistShader); // only the never-discovered layer drifts
      fill.setAlphaf(UNEXPLORED_EXTRA_ALPHA);
      fill.setMaskFilter(fogBlur);
      // Clip to the (overscanned) viewport: the overscan margin exceeds the blur
      // radius, so the on-screen result is identical to drawing only in-view cells.
      canvas.save();
      canvas.clipRect(Skia.XYWHRect(vl, vt, vw, vh), ClipOp.Intersect, false);
      canvas.drawPath(fogPath, fill);
      canvas.restore();

      fill.setMaskFilter(null); // shared paint — clear before player UI draws
      fill.setShader(null);
    }
    if (PROFILING) { const n = performance.now(); RENDER_PHASES.fog += n - _t; _t = n; }

    // --- Player and player-only UI, always drawn on top of the fog: the player,
    // their attack-range ring, HP, and action telegraphs are never obscured.

    // Attack-range ring — barely-there tuning aid.
    stroke.setColor(color(COLORS.rangeRing));
    stroke.setAlphaf(0.07);
    stroke.setStrokeWidth(1);
    canvas.drawCircle(player.x, player.y, hitRadius, stroke);

    // Player HP bar + a red wash while the post-hit i-frames tick down.
    {
      const barX = player.x - HP_BAR_WIDTH / 2;
      const barY = player.y - PLAYER_RADIUS - 12;
      fill.setColor(color(COLORS.hpBarBack));
      fill.setAlphaf(0.9);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT), fill);
      fill.setColor(color(COLORS.hpBarFill));
      fill.setAlphaf(1);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH * scene.player.hpFrac, HP_BAR_HEIGHT), fill);
      if (scene.player.hurt > 0) {
        stroke.setColor(color(COLORS.playerHurt));
        stroke.setAlphaf(0.7 * scene.player.hurt);
        stroke.setStrokeWidth(3);
        canvas.drawCircle(player.x, player.y, PLAYER_RADIUS + 4, stroke);
      }
    }

    // Windup telegraph: the committed wind-up made visible.
    if (scene.windup) {
      const w = scene.windup;
      if (cfg.shape === "arc" && cfg.arcWidth) {
        const wedge = wedgePath(player.x, player.y, hitRadius, w.facing, cfg.arcWidth);
        fill.setColor(color(COLORS.windup));
        fill.setAlphaf(0.05 + 0.12 * w.progress);
        canvas.drawPath(wedge, fill);
        stroke.setColor(color(COLORS.windup));
        stroke.setAlphaf(0.15 + 0.4 * w.progress);
        stroke.setStrokeWidth(1.5);
        canvas.drawPath(wedge, stroke);
      } else {
        stroke.setColor(color(weapon.color));
        stroke.setAlphaf(0.1 + 0.3 * w.progress);
        stroke.setStrokeWidth(1.5);
        canvas.drawLine(player.x, player.y, w.targetX, w.targetY, stroke);
        // A charge dot growing at the player's edge along the aim line.
        const aim = Math.atan2(w.targetY - player.y, w.targetX - player.x);
        fill.setColor(color(weapon.color));
        fill.setAlphaf(0.4 + 0.5 * w.progress);
        canvas.drawCircle(
          player.x + Math.cos(aim) * (PLAYER_RADIUS + 7),
          player.y + Math.sin(aim) * (PLAYER_RADIUS + 7),
          1.5 + 3 * w.progress,
          fill,
        );
      }
    }

    // Melee swing flash on strike.
    for (const f of scene.arcFlashes) {
      if (cfg.arcWidth) {
        fill.setColor(color(weapon.color));
        fill.setAlphaf(0.45 * f.fade);
        canvas.drawPath(wedgePath(f.x, f.y, hitRadius, f.facing, cfg.arcWidth), fill);
      }
    }

    // Explosions: a multi-part blast drawn on top (over fog, under the player) so
    // it always reads. Four layers — an additive fireball + white flash (light),
    // then a normal-blend shockwave ring (sized to the AoE) + debris sparks.
    for (const ex of scene.explosions) {
      const p = ex.progress; // 0 → 1 over the blast's life
      const fade = 1 - p;
      const eo = 1 - fade * fade; // ease-out: shoots out fast, then settles
      const R = ex.radius;

      // Fireball: a radial gradient that grows then fades. Additive so it glows;
      // the fade rides the paint alpha (stops are fixed → no colour-cache churn).
      const coreR = R * (0.18 + 0.5 * eo);
      if (coreR > 0.5) {
        fill.setBlendMode(BlendMode.Plus);
        fill.setShader(
          Skia.Shader.MakeRadialGradient(
            { x: ex.x, y: ex.y },
            coreR,
            [EXPLO_CORE, EXPLO_MID, EXPLO_EDGE],
            [0, 0.55, 1],
            TileMode.Clamp,
          ),
        );
        fill.setAlphaf(fade);
        canvas.drawCircle(ex.x, ex.y, coreR, fill);
        fill.setShader(null);
        // White detonation flash — punchy, gone by ~30% of the life.
        const flash = Math.max(0, 1 - p / 0.3);
        if (flash > 0) {
          fill.setColor(color("#ffffff"));
          fill.setAlphaf(0.85 * flash);
          canvas.drawCircle(ex.x, ex.y, R * 0.32, fill);
        }
        fill.setBlendMode(BlendMode.SrcOver);
      }

      // Shockwave ring (normal blend): expands to the AoE radius, thinning + fading.
      stroke.setColor(color(COLORS.explosionRing));
      stroke.setAlphaf(0.85 * fade);
      stroke.setStrokeWidth(2 + 5 * fade);
      canvas.drawCircle(ex.x, ex.y, R * eo, stroke);

      // Debris sparks: evenly-spaced + per-blast offset (no RNG here), flung out and
      // shrinking. A few drawCircles per blast, only while alive — negligible cost.
      if (fade > 0.05) {
        const dist = R * (0.35 + 0.85 * eo);
        const sparkR = 3 * fade;
        fill.setColor(color(COLORS.explosionSpark));
        fill.setAlphaf(0.9 * fade);
        for (let k = 0; k < 9; k++) {
          const a = ex.seed + (k / 9) * Math.PI * 2;
          canvas.drawCircle(ex.x + Math.cos(a) * dist, ex.y + Math.sin(a) * dist, sparkR, fill);
        }
      }
    }

    // Player body + facing notch, drawn last so it sits on top of everything.
    fill.setColor(color(COLORS.player));
    fill.setAlphaf(1);
    canvas.drawCircle(player.x, player.y, PLAYER_RADIUS, fill);
    canvas.save();
    canvas.translate(player.x, player.y);
    canvas.rotate((player.facing * 180) / Math.PI, 0, 0);
    fill.setColor(color(COLORS.playerNotch));
    canvas.drawPath(NOTCH, fill);
    canvas.restore();

    canvas.restore(); // end the camera transform

    // --- Low-health vignette (screen space, outside the camera transform so it's
    // pinned to the play area, not the world). A red inset glow that pulses when
    // the player drops below LOW_HP_THRESHOLD — brighter and beating faster the
    // closer to death (the beat rate is baked into lowHealthPhase by the sim).
    if (player.hpFrac < LOW_HP_THRESHOLD) {
      // 0 at the threshold → 1 at empty: drives both brightness and (via the
      // sim's phase rate) the beat speed.
      const severity = Math.min(1, (LOW_HP_THRESHOLD - player.hpFrac) / LOW_HP_THRESHOLD);
      // Soft swell, not a hard blink: 0.5 − 0.5·cos over the beat. A floor keeps
      // some glow between beats so the danger never fully reads as "clear".
      const pulse = 0.5 - 0.5 * Math.cos(scene.lowHealthPhase * Math.PI * 2);
      const peak =
        LOW_HP_VIGNETTE_MIN_ALPHA + (LOW_HP_VIGNETTE_MAX_ALPHA - LOW_HP_VIGNETTE_MIN_ALPHA) * severity;
      const alpha = peak * (0.35 + 0.65 * pulse);

      // The play area is the picture's whole surface: anchor is its centre
      // (anchorX = width/2, anchorY = playHeight/2 in GameScreen), so ×2 is its
      // size. A radial gradient reaching the corners rims the frame in red.
      const w = anchor.x * 2;
      const h = anchor.y * 2;
      fill.setShader(
        Skia.Shader.MakeRadialGradient(
          { x: anchor.x, y: anchor.y },
          Math.hypot(w, h) / 2,
          [LOW_HP_CLEAR, LOW_HP_OPAQUE],
          [0.45, 1],
          TileMode.Clamp,
        ),
      );
      fill.setAlphaf(alpha);
      fill.setMaskFilter(null);
      canvas.drawRect(Skia.XYWHRect(0, 0, w, h), fill);
      fill.setShader(null);
    }
    if (PROFILING) RENDER_PHASES.ui += performance.now() - _t;
  });
};
