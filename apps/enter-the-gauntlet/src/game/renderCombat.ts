import { Platform } from "react-native";
import {
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
  type SkPath,
  type SkPicture,
} from "@shopify/react-native-skia";
import { computeVisibility, markVisible, type FogGrid } from "@heroic/engine";
import {
  ARENA_SIZE,
  ARENA_TILES,
  COLORS,
  ENEMY_RADIUS,
  OCCLUDERS,
  PILLARS,
  PLAYER_RADIUS,
  TILE_SIZE,
  VISION,
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
  /** `hurt` runs 1 → 0 after a contact hit; `facing` rotates the notch. */
  player: { x: number; y: number; facing: number; hpFrac: number; hurt: number };
  weapon: WeaponDef;
  /** Present only while winding up. `progress` runs 0 → 1 toward the strike. */
  windup: { progress: number; facing: number; targetX: number; targetY: number } | null;
  targetId: number | null;
  enemies: { id: number; x: number; y: number; hpFrac: number; flash: number; color: string }[];
  /** Ranged enemies mid-windup (and chargers): the telegraph line + charge. */
  enemyCasts: { x: number; y: number; targetX: number; targetY: number; progress: number; color: string }[];
  /** Summoners mid-cast: an expanding ring at the summoner. */
  summonTelegraphs: { x: number; y: number; progress: number; color: string }[];
  projectiles: { x: number; y: number; dirX: number; dirY: number; radius: number; color: string }[];
  /** `fade` runs 1 → 0 over each effect's lifetime; `hostile` = damage taken. */
  numbers: { x: number; y: number; text: string; crit: boolean; hostile: boolean; fade: number }[];
  arcFlashes: { x: number; y: number; facing: number; fade: number }[];
  /** Persistent fog-of-war memory, swept by the sight polygon and mutated here. */
  fog: FogGrid;
  /** Seconds elapsed, fed to the drifting-mist shader as its animation clock. */
  time: number;
}

const fontFamily = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const damageFont = matchFont({ fontFamily, fontSize: 15, fontWeight: "bold" });
const critFont = matchFont({ fontFamily, fontSize: 19, fontWeight: "bold" });

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
 * Static checkerboard: the dark squares laid over the light arena floor, pre-baked
 * into one reusable path. The board never changes, so drawing a single path each
 * frame replaces ~300 per-tile drawRect calls — each its own JS→native hop, a
 * meaningful slice of the constant per-frame render cost.
 */
const DARK_TILES_PATH = (() => {
  const path = Skia.Path.Make();
  for (let row = 0; row < ARENA_TILES; row++) {
    for (let col = 0; col < ARENA_TILES; col++) {
      if ((row + col) % 2 === 1) {
        path.addRect(Skia.XYWHRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE));
      }
    }
  }
  return path;
})();

/**
 * Cached "never-discovered" fog geometry: a large backdrop rect with every
 * explored cell punched out (even-odd fill). Rebuilt only when the explored set
 * actually grows — markVisible reports that, and exploration plateaus once you've
 * toured the arena, so on the overwhelming majority of frames we redraw this one
 * cached path (clipped to the viewport) instead of re-adding a rect per visible
 * fog cell every frame. Assumes fog only grows; a resetFog would need to null it.
 */
let cachedFogPath: SkPath | null = null;
/** Reused buffer: flat indices of cells that became visible this frame (markVisible fills it). */
const newFogCells: number[] = [];

// Two blurs (respectCTM=true → world units, so they scale with camera zoom): a
// tight one for the current-sight edge, and a heavy one for the explored↔unseen
// frontier that melts the memory grid into mist.
const sightBlur =
  VISION.edgeFeather > 0 ? Skia.MaskFilter.MakeBlur(BlurStyle.Normal, VISION.edgeFeather, true) : null;
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

export const recordCombatScene = (scene: CombatScene): SkPicture =>
  createPicture((canvas) => {
    const { camera, anchor, player, weapon } = scene;
    const cfg = weapon.config;

    // Bake the camera into the picture: translate(anchor) ∘ scale(zoom) ∘
    // translate(-camera). Everything below is in world space.
    canvas.save();
    canvas.translate(anchor.x, anchor.y);
    canvas.scale(camera.zoom, camera.zoom);
    canvas.translate(-camera.x, -camera.y);

    // --- Arena: light floor, dark checkerboard, walls, pillars. Static geometry
    // is drawn UNCLIPPED — in explored-but-fogged areas the fog dims it but you
    // still read the layout you remember.
    fill.setColor(color(COLORS.tileLight));
    fill.setAlphaf(1);
    canvas.drawRect(Skia.XYWHRect(0, 0, ARENA_SIZE, ARENA_SIZE), fill);
    fill.setColor(color(COLORS.tileDark));
    canvas.drawPath(DARK_TILES_PATH, fill);
    fill.setColor(color(COLORS.wall));
    for (const w of WALLS) canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2, w.w, w.h), fill);
    fill.setColor(color(COLORS.pillar));
    for (const p of PILLARS) canvas.drawRect(Skia.XYWHRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h), fill);

    // An enemy is hittable when its *edge* is within reach, i.e. its centre is
    // within reach + ENEMY_RADIUS — draw rings/wedges at that radius so the
    // visuals match the actual gate.
    const hitRadius = cfg.reach + ENEMY_RADIUS;

    // The visibility polygon from the (interpolated) player: the area in direct
    // line of sight. Built into a path used both to clip the live world and to
    // cut the lit hole out of the fog.
    const litPoly = computeVisibility({ x: player.x, y: player.y }, OCCLUDERS);
    const hasSight = litPoly.length > 2;
    const litPath = Skia.Path.Make();
    if (hasSight) {
      litPath.moveTo(litPoly[0]!.x, litPoly[0]!.y);
      for (let i = 1; i < litPoly.length; i++) litPath.lineTo(litPoly[i]!.x, litPoly[i]!.y);
      litPath.close();
    }

    // --- Live world, clipped to current sight. Enemies, their telegraphs,
    // projectiles and damage numbers render only where the player can see RIGHT
    // NOW, so they never linger in remembered (fogged) areas — memory shows you
    // the room, not who's currently in it.
    canvas.save();
    if (hasSight) canvas.clipPath(litPath, ClipOp.Intersect, true);

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
      const font = n.crit ? critFont : damageFont;
      const width = font.measureText(n.text).width;
      fill.setColor(color(n.crit ? COLORS.critText : n.hostile ? COLORS.hurtText : COLORS.damageText));
      fill.setAlphaf(Math.max(0, n.fade));
      canvas.drawText(n.text, n.x - width / 2, n.y, fill, font);
    }

    canvas.restore(); // end the current-sight clip

    // --- Fog of war: dark layers over everything outside current sight. The
    // memory grid is rendered with a heavy blur (VISION.fogSoftness) so its
    // square cells melt into soft mist rather than reading as blocks.
    {
      const halfW = anchor.x / camera.zoom;
      const halfH = anchor.y / camera.zoom;
      // Overscan past the blur radius so the layers' own outer edges — which the
      // blur softens — stay safely off-screen instead of darkening the margins.
      const over = Math.ceil(VISION.fogSoftness) + 8;
      const vl = camera.x - halfW - over;
      const vt = camera.y - halfH - over;
      const vw = (halfW + over) * 2;
      const vh = (halfH + over) * 2;

      // Drifting mist drives the fog colour; the shader is shared by the dim and
      // dark layers (same noise + clock), so unexplored just reads as a denser
      // version of the same churn. Null if the effect failed to compile (the flat
      // shadowColor then stands in).
      const mistShader = fogEffect ? fogEffect.makeShader([scene.time]) : null;
      fill.setColor(color(VISION.shadowColor));

      // (1) Dim memory layer: line-of-sight-blocked area (behind pillars/walls),
      // dim regardless of distance. Drawn FLAT (no mist) — once you've discovered
      // somewhere it reads as a calm remembered dim; only the unknown drifts.
      // Even-odd punches the sight polygon out of the view rect; a tight blur
      // softens the shadow edge.
      fill.setShader(null);
      if (hasSight) {
        const dim = Skia.Path.Make();
        dim.setFillType(FillType.EvenOdd);
        dim.addRect(Skia.XYWHRect(vl, vt, vw, vh));
        dim.addPath(litPath);
        fill.setAlphaf(VISION.exploredAlpha);
        fill.setMaskFilter(sightBlur);
        canvas.drawPath(dim, fill);
      }

      // (2) Sight-range falloff: WITHIN the sightline, fade clear → dim with
      // distance so vision closes in at sightRadius even down an open corridor. A
      // radial gradient (clipped to the sightline) does it smoothly and meets the
      // dim layer at exploredAlpha, so the two are seamless.
      if (hasSight) {
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
        canvas.save();
        canvas.clipPath(litPath, ClipOp.Intersect, true);
        canvas.drawRect(Skia.XYWHRect(vl, vt, vw, vh), fill);
        canvas.restore();
      }

      // Discover what's in sight now (line-of-sight, within the discover radius),
      // then (3) lay extra dark over every cell never discovered (and the void).
      // Explored cells are holes, so they keep just the dim level; current sight
      // is a subset of explored, so it stays clear without an extra clip.
      // Discover newly-visible cells and keep the cached fog path up to date
      // *incrementally*: build the backdrop + already-seen cells once, then each
      // frame punch out only the cells that just became visible. This is the key
      // to staying cheap while MOVING — exploring used to rebuild all ~2500 cells
      // every frame (the render spike); now it's a handful of new cells per frame.
      const fog = scene.fog;
      const cs = fog.cellSize;
      const grew = markVisible(scene.fog, litPoly, { x: player.x, y: player.y }, VISION.discoverRadius, newFogCells);
      if (cachedFogPath === null) {
        cachedFogPath = Skia.Path.Make();
        cachedFogPath.setFillType(FillType.EvenOdd);
        // Backdrop large enough to cover any viewport (the visible slice is taken
        // by the clip at draw time); explored cells are punched out as holes.
        cachedFogPath.addRect(Skia.XYWHRect(-ARENA_SIZE * 2, -ARENA_SIZE * 2, ARENA_SIZE * 5, ARENA_SIZE * 5));
        for (let r = 0; r < fog.rows; r++) {
          for (let c = 0; c < fog.cols; c++) {
            if (fog.seen[r * fog.cols + c] === 1) {
              cachedFogPath.addRect(Skia.XYWHRect(c * cs, r * cs, cs, cs));
            }
          }
        }
      } else if (grew) {
        for (let k = 0; k < newFogCells.length; k++) {
          const idx = newFogCells[k]!;
          const r = Math.floor(idx / fog.cols);
          const c = idx - r * fog.cols;
          cachedFogPath.addRect(Skia.XYWHRect(c * cs, r * cs, cs, cs));
        }
      }
      fill.setShader(mistShader); // only the never-discovered layer drifts
      fill.setAlphaf(UNEXPLORED_EXTRA_ALPHA);
      fill.setMaskFilter(fogBlur);
      // Clip to the (overscanned) viewport: the overscan margin exceeds the blur
      // radius, so the on-screen result is identical to drawing only in-view cells,
      // but the backdrop's off-screen bulk and out-of-view holes cost nothing.
      canvas.save();
      canvas.clipRect(Skia.XYWHRect(vl, vt, vw, vh), ClipOp.Intersect, false);
      canvas.drawPath(cachedFogPath, fill);
      canvas.restore();

      fill.setMaskFilter(null); // shared paint — clear before player UI draws
      fill.setShader(null);
    }

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
  });
