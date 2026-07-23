/**
 * The arena scene, recorded into ONE SkPicture per rendered frame with the
 * camera baked in (the gauntlet's single-picture rule — one update path, no
 * inter-layer jitter). Flat-shaded M1 art: sand floor, stone walls, team-
 * coloured discs, windup telegraph wedges, hp bars, and event-driven FX.
 */
import { Platform } from "react-native";
import {
  BlendMode,
  ClipOp,
  createPicture,
  FilterMode,
  matchFont,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  vec,
  type SkCanvas,
  type SkImage,
  type SkPicture,
  type SkSurface,
} from "@shopify/react-native-skia";
import { loadZone, tileSourceRect, TILESETS } from "@heroic/core";
import {
  ARENA_00,
  BLOOD_FONT,
  PLAYER_RADIUS as SIM_PLAYER_RADIUS,
  SANDSTORM,
  SANDTRAP,
  STRAW_MAN,
  TREMOR,
  WAR_DRUMS,
  WARDING_SHOUT,
  WEAPONS,
  type AbilityId,
  type ArenaClientConfig,
  type DeployableSnapshot,
  type InterpolatedView,
  type PlayerSnapshot,
  type ProjectileSnapshot,
} from "@heroic/blood-in-the-sand-sim";
import {
  BLOOD_DRY_MS,
  decalAlpha,
  POOL_MIN_R,
  poolGrowth,
  type BloodDecal,
  type BloodField,
  type FlyingDrop,
} from "./blood";
import {
  CRACK_SETTLE_ALPHA,
  crackAlpha,
  crackReveal,
  type CrackDecal,
  type CrackField,
} from "./cracks";
import { buildCrowd, CROWD_REVEAL } from "./crowd";
import type { StatusPulses } from "./statusRings";

// Zone geometry is static — derive once at module scope (loadZone is pure).
const ZONE = loadZone(ARENA_00);
const WORLD_W = ZONE.size.x;
const WORLD_H = ZONE.size.y;
const TILESET = TILESETS[ZONE.tileset];

// The animated pit crowd (crowd.ts) — a procedural amphitheatre drawn in the
// void beyond the sand, revealed by the relaxed camera clamp below.
const CROWD = buildCrowd(WORLD_W, WORLD_H);

// Props pre-resolved for the draw loop: cached src/dst rects + sprite bounds,
// sorted by baseline (feet y) once — the per-frame y-sort only interleaves
// players between them. `fade` is mutable per-frame state: the current alpha,
// eased toward FADE_ALPHA while someone stands behind the sprite.
const PROPS_SORTED = [...ZONE.props]
  .sort((a, b) => a.y - b.y)
  .map((p) => ({
    y: p.y,
    left: p.x - p.w / 2,
    top: p.y - p.h,
    w: p.w,
    h: p.h,
    src: Skia.XYWHRect(p.src.x, p.src.y, p.src.w, p.src.h),
    dst: Skia.XYWHRect(p.x - p.w / 2, p.y - p.h, p.w, p.h),
    fade: 1,
  }));

/**
 * PVP information beats the depth illusion: a prop with ANY living player
 * drawn behind it goes see-through (2026-07-13), so nobody hides in a cactus
 * canopy — the sim's targeting can already see them (only rocks occlude), the
 * pixels must agree. Alpha eases per frame so cover fades, never pops.
 */
const FADE_ALPHA = 0.7;
const FADE_RATE = 0.25;
const propPaint = Skia.Paint(); // dedicated: its alpha never leaks into shared paints

/** Does this player's disc overlap the prop sprite while being drawn UNDER it
 *  (feet above the prop's baseline)? Players in front cover the prop anyway. */
const hiddenBehind = (
  prop: { y: number; left: number; top: number; w: number; h: number },
  p: PlayerSnapshot,
  radius: number,
): boolean => {
  if (!p.alive || p.y + radius > prop.y) return false;
  const nx = Math.min(Math.max(p.x, prop.left), prop.left + prop.w);
  const ny = Math.min(Math.max(p.y, prop.top), prop.top + prop.h);
  return (p.x - nx) ** 2 + (p.y - ny) ** 2 <= radius * radius;
};

/** How much world fits on screen when following a player. Pulled back from
 * 0.85 (2026-07-12, tester feedback): the old zoom hid approaching enemies.
 * 0.71 → 0.64 (2026-07-23): a little more battlefield awareness again. */
const FOLLOW_ZOOM = 0.64;

// Palette parsed once (never re-string rgba per frame — floods the colour cache).
const C_VOID = Skia.Color("#141210");
const C_FLOOR = Skia.Color("#b39763");
const C_FLOOR_EDGE = Skia.Color("#8a744c");
const C_WALL = Skia.Color("#4a3b2b");
const C_WALL_TOP = Skia.Color("#5d4c38");
// Allegiance is RELATIVE (bits-bot-backfill.md § team identity): your side is
// always FRIEND blue, the enemy always FOE red — in the lobby and here. A
// seatless spectator has no side, so they fall back to absolute team 1 = red /
// team 2 = blue (see bodyColorFor).
const C_FOE = Skia.Color("#d94141");
const C_FRIEND = Skia.Color("#4d7fd9");
const C_DEAD = Skia.Color("rgba(90, 84, 76, 0.55)");
const C_FACING = Skia.Color("rgba(255, 255, 255, 0.9)");
const C_TELEGRAPH = Skia.Color("#ff4a3d");
const C_HP_BACK = Skia.Color("rgba(0, 0, 0, 0.55)");
const C_HP_FILL = Skia.Color("#5fc75f");
const C_HP_LOW = Skia.Color("#e0503c");
const C_DASH_RING = Skia.Color("rgba(255, 255, 255, 0.85)");
const C_BOLT = Skia.Color("#f0e8d8");
const C_STAFF_ORB = Skia.Color("#9b6dd9");
const C_STAFF_RING = Skia.Color("rgba(155, 109, 217, 0.45)");
const C_FX_BLEED = Skia.Color("#e0503c");
const C_RANGE_RING = Skia.Color("#f0e8d8");
// Status rings: pulse rate carries the "expiring soon" signal (statusRings.ts).
const C_RING_SLOW = Skia.Color("#4da3d9");
const C_RING_BLEED = Skia.Color("#e0503c");
// Straw Man's forced lock — straw yellow, so the aim-hijack reads as an effect.
const C_RING_TAUNT = Skia.Color("#d9b34d");
// Body-effect ring for Mirror Guard (Ironhide gets a full shield bubble).
const C_RING_MIRROR = Skia.Color("#cfe0ec");
// Ironhide's shield bubble: translucent iron dome + rotating plates.
const C_IRON_FILL = Skia.Color("#aeb6bd");
const C_IRON_RIM = Skia.Color("#d4dae0");
const C_NAME = Skia.Color("#f0e8d8");
// Deployables + zones (visible to everyone, always — the readability rule).
const C_FONT = Skia.Color("#c23636");
const C_STORM = Skia.Color("#d8b878");
const C_STORM_STREAK = Skia.Color("#efe0b8");
const C_DRUMS = Skia.Color("#f2c14e");
const C_MINE = Skia.Color("#3a332b");
const C_MINE_GLINT = Skia.Color("#d8b878");
// The quake reads EARTH, not sand-in-the-air: darker and redder than the storm.
const C_QUAKE = Skia.Color("#a8713f");
const C_DUMMY = Skia.Color("#c9a86a");
const C_DUMMY_DARK = Skia.Color("#6f5c3d");
const C_HARPOON = Skia.Color("#d9d2c6");
const C_CRACK = Skia.Color("#4f3f2a");
const C_FX_HEAL = Skia.Color("#5fc75f");
// Off-screen ally pointer: a team-coloured chevron pinned to the screen edge,
// dark-rimmed so it reads over any floor/crowd behind it.
const C_ARROW_EDGE = Skia.Color("rgba(0, 0, 0, 0.55)");

const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

// Dedicated blood paints — the premium decal renderer swaps shaders and stroke
// widths per decal; a dedicated pair keeps that churn out of the shared paints.
const bloodFill = Skia.Paint();
const bloodStroke = Skia.Paint();
bloodStroke.setStyle(PaintStyle.Stroke);
bloodStroke.setStrokeJoin(StrokeJoin.Round);
bloodStroke.setStrokeCap(StrokeCap.Round); // flying-droplet motion tails

// Dedicated paint so the dash effect never leaks into the shared stroke.
const rangeStroke = Skia.Paint();
rangeStroke.setStyle(PaintStyle.Stroke);
rangeStroke.setStrokeWidth(1.5);
rangeStroke.setColor(C_RANGE_RING);
rangeStroke.setPathEffect(Skia.PathEffect.MakeDash([10, 8], 0));

/** Your own range ring's alpha — information, not decoration. */
const RANGE_RING_ALPHA = 0.22;

/**
 * Floor (+ decor) rasterized ONCE into a single world-resolution image when the
 * atlas decodes, then drawn as one quad per frame. Rasterizing (not recording a
 * picture) matters: replayed per-tile draws re-sample under the camera's
 * fractional zoom, and each tile edge rounds independently — hairline cracks +
 * atlas-neighbour bleed that read as a faint grid over the sand. Baking at
 * integer coordinates samples every tile exactly; the one resulting image has
 * no interior edges to crack. (~10MB for the 1600² arena — fine for one zone;
 * revisit per-chunk images if zones grow.) Keyed on the atlas so a (dev-time)
 * image swap rebakes. Ids the atlas doesn't cover fall back to the flat sand
 * fill, so a half-painted zone still reads.
 */
let bakedAtlas: SkImage | null = null;
let bakedFloor: SkImage | null = null;
const floorImage = (atlas: SkImage): SkImage | null => {
  if (bakedAtlas === atlas) return bakedFloor;
  const surface = Skia.Surface.Make(WORLD_W, WORLD_H);
  if (!surface) return null; // keep the flat fallback; retry next frame
  const canvas = surface.getCanvas();
  const t = ZONE.tileSize;
  const ct = ZONE.chunkTiles;
  const paint = Skia.Paint();
  for (const chunk of ZONE.chunks) {
    const drawLayer = (
      layer: Uint16Array | null,
      floorFallback: boolean,
    ): void => {
      if (!layer) return;
      for (let ly = 0; ly < ct; ly++) {
        for (let lx = 0; lx < ct; lx++) {
          const id = layer[ly * ct + lx]!;
          if (id === 0) continue;
          const wx = (chunk.cx * ct + lx) * t;
          const wy = (chunk.cy * ct + ly) * t;
          const src = TILESET ? tileSourceRect(TILESET, id) : null;
          if (src) {
            canvas.drawImageRectOptions(
              atlas,
              Skia.XYWHRect(src.x, src.y, src.w, src.h),
              Skia.XYWHRect(wx, wy, t, t),
              FilterMode.Nearest, // integer 4× upscale at bake: crisp, exact
              MipmapMode.None,
              paint,
            );
          } else if (floorFallback) {
            paint.setColor(C_FLOOR);
            canvas.drawRect(Skia.XYWHRect(wx, wy, t, t), paint);
          }
        }
      }
    };
    drawLayer(chunk.floor, true);
    drawLayer(chunk.decor, false);
  }
  bakedFloor = surface.makeImageSnapshot();
  bakedAtlas = atlas;
  return bakedFloor;
};
const FLOOR_RECT = Skia.XYWHRect(0, 0, WORLD_W, WORLD_H);

/** A transient visual: damage numbers, hit rings, the harpoon's chain flash,
 * the cast flash (an ability icon popping above its caster), the warding
 * shout's cone blast. */
export interface FxItem {
  kind: "number" | "ring" | "line" | "castFlash" | "cone" | "strawBurst";
  x: number;
  y: number;
  /** 1 → 0 over the effect's life. */
  life: number;
  text?: string;
  crit?: boolean;
  /** Bleed-tick numbers render red (and the caller skips the ring). */
  bleed?: boolean;
  /** Heal numbers render green. */
  heal?: boolean;
  /** A big ring (the sandtrap detonation) instead of the hit ping. */
  big?: boolean;
  /** Line endpoint (the harpoon chain: x/y = caster, x2/y2 = the hook). */
  x2?: number;
  y2?: number;
  /** castFlash: which icon pops. */
  ability?: AbilityId;
  /** cone: the shout's direction (the caster's facing at cast), radians. */
  angle?: number;
}

const C_FX_NUM = Skia.Color("#ffffff");
const C_FX_CRIT = Skia.Color("#f2c14e");
// matchFont NEEDS an explicit family: with none, Android resolves a null
// typeface and drawText silently draws nothing (iOS falls back to the system
// font, which is how this hid). Same fix as the gauntlet's renderCombat.
const FX_FONT_FAMILY = Platform.select({
  ios: "Helvetica",
  default: "sans-serif",
});
const FX_FONT = matchFont({
  fontFamily: FX_FONT_FAMILY,
  fontSize: 26,
  fontWeight: "bold",
});
const FX_FONT_CRIT = matchFont({
  fontFamily: FX_FONT_FAMILY,
  fontSize: 34,
  fontWeight: "bold",
});
const NAME_FONT = matchFont({
  fontFamily: FX_FONT_FAMILY,
  fontSize: 12,
  fontWeight: "600",
});

export interface ArenaRenderInput {
  view: InterpolatedView;
  config: ArenaClientConfig;
  /** Our slot — identifies the real self for range-ring / ally-pointer logic;
   *  null = pure spectator (fit the arena). The camera follows this player only
   *  while they're alive — once dead it follows `spectateId` instead. */
  myId: number | null;
  /** Death spectator: the ally the camera trails after we've died — kept even
   *  once THEY fall (the camera lingers on the last corpse rather than zoom
   *  out; the bowl fit is for pure spectators only). Null when we're alive or
   *  a pure spectator. Chosen client-side (GameScreen) — all players stay in
   *  every snapshot, corpses included. */
  spectateId?: number | null;
  screenW: number;
  screenH: number;
  /** Safe-area padding: the OS notch (top) and home-indicator / system tray
   *  (bottom). The camera aims at the band between them so the followed player
   *  never sits under the tray; the canvas still fills edge to edge. */
  insetTop?: number;
  insetBottom?: number;
  fx: readonly FxItem[];
  /** The blood field: live wet decals draw via the cached scar layer, dried
   *  ones are harvested into the persistent splat surface on its beat, and
   *  in-flight death-spray droplets draw per frame (bits-blood.md). */
  blood: BloodField;
  /** Tremor's crack field: live webs draw per frame OUTSIDE the scar cache
   *  (one prebuilt path each), settled ones are stamped into the splat
   *  surface — cracks never ride a scar rebuild (bits-blood.md §7). */
  cracks: CrackField;
  /** The blood field's epoch (total decals ever added) — the scar cache's
   *  dirty signal: unchanged → fades step at 1Hz; bumped → the new marks
   *  land within 200ms. */
  scarEpoch: number;
  /** Per-player status-ring pulse phases, advanced by the caller per frame. */
  pulses: StatusPulses;
  /** The clock the decals were aged against (performance.now). */
  nowMs: number;
  /** The zone's tileset atlas (useArenaAtlas). Null while decoding / for a
   *  tileset-less zone → flat pre-tileset floor, props invisible. */
  atlas: SkImage | null;
  /** Forge icon art keyed by ability — the cast flash draws from these
   *  (useAbilityIconImages; an icon still decoding just skips its flash). */
  abilityIcons: Partial<Record<AbilityId, SkImage>>;
}

// ── Premium blood material ──────────────────────────────────────────────────
// Blood reads as gore, not paint, from three things flat circles never had:
// an irregular silhouette (no circular edge anywhere), tonal depth (near-black
// core → oxblood → wet arterial edge), and AGE — a spill sets over ~16s then
// holds, so a still-wet trail means someone bled here seconds ago (a readable
// freshness signal in a one-life arena, not just eye-candy). All of it is a
// pure function of data the decal already carries — position, radius, birth,
// seed — so it costs nothing on the wire and rebuilds inside the same cached
// scar picture; per-frame cost stays one drawPicture. Silhouette paths are
// baked at birth in blood.ts (the cracks.ts lesson); a rebuild here only
// re-samples colours and alphas.
/** Premium marks sit a touch more solid than the old flat alpha (which was
 *  tuned for cheap overlapping circles). */
const BLOOD_ALPHA_BOOST = 1.5;
const C_SHEEN = Skia.Color("#ffb4aa"); // wet specular, fresh pools only

/** wetness 1 (fresh, bright + wet) → 0 (set, dark + matte). Smoothstep in so it
 *  looks wet a beat before it starts drying, then holds at 0. */
const bloodWetness = (ageMs: number): number => {
  const t = Math.min(1, Math.max(0, ageMs / BLOOD_DRY_MS));
  return 1 - t * t * (3 - 2 * t);
};

// Colour ramps baked once (fresh → dried), sampled by wetness — never restring
// rgba per decal (that floods Skia's colour cache; see the palette note above).
const RAMP_N = 10;
const buildRamp = (
  fresh: readonly [number, number, number],
  dried: readonly [number, number, number],
): Float32Array[] => {
  const out: Float32Array[] = [];
  for (let i = 0; i < RAMP_N; i++) {
    const t = i / (RAMP_N - 1);
    const r = Math.round(fresh[0] + (dried[0] - fresh[0]) * t);
    const g = Math.round(fresh[1] + (dried[1] - fresh[1]) * t);
    const b = Math.round(fresh[2] + (dried[2] - fresh[2]) * t);
    out.push(Skia.Color(`rgb(${r}, ${g}, ${b})`));
  }
  return out;
};
const RAMP_CORE = buildRamp([42, 6, 4], [24, 8, 5]); // near-black centre
const RAMP_BODY = buildRamp([104, 18, 12], [52, 15, 9]); // oxblood
const RAMP_EDGE = buildRamp([158, 32, 22], [74, 27, 19]); // wet arterial rim
const RAMP_RIM = buildRamp([24, 6, 5], [30, 10, 6]); // coagulated coffee-ring
const RAMP_CLOT = buildRamp([30, 8, 6], [14, 5, 4]); // tacky centre clot
/** dryness (1 - wetness) → ramp index. */
const rampIdx = (w: number): number =>
  Math.min(RAMP_N - 1, Math.max(0, Math.round((1 - w) * (RAMP_N - 1))));

// One pool gradient per ramp step, built once at UNIT radius — pools draw
// their unit-baked path under translate+scale, so these fit every pool at any
// size. A rebuild used to allocate a fresh native radial gradient PER POOL
// (hundreds each pass): a big slice of the weak-device `rec` spike.
const POOL_GRADIENTS = Array.from({ length: RAMP_N }, (_, i) =>
  Skia.Shader.MakeRadialGradient(
    vec(-0.15, -0.15),
    1.1,
    [RAMP_CORE[i]!, RAMP_BODY[i]!, RAMP_EDGE[i]!],
    [0, 0.55, 1],
    TileMode.Clamp,
  ),
);

/**
 * Floor blood. Small drops and flung spray are cheap solid-colour shapes (the
 * bulk — a kill throws ~90); only the few big pools pay for a tonal radial
 * gradient, a coagulated rim, a drying clot and a wet sheen. Recorded into the
 * cached scar picture, not per frame — no viewport cull here (the cache is
 * camera-independent; raster quick-rejects offscreen ops by bounds).
 */
const drawBlood = (
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

    // Drops + flung spray → the world-coord baked path, single solid fill.
    if (d.r < POOL_MIN_R || d.dx !== undefined) {
      bloodFill.setColor(RAMP_BODY[idx]!);
      bloodFill.setAlphaf(alpha);
      canvas.drawPath(d.path, bloodFill);
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
    bloodFill.setShader(POOL_GRADIENTS[idx]!);
    bloodFill.setAlphaf(alpha);
    canvas.drawPath(d.path, bloodFill);
    bloodFill.setShader(null);

    // Tacky clot sets in the centre as it dries. It stays at BIRTH scale —
    // the thick core doesn't ride the thinning seep edge outward.
    if (dry > 0.05 && d.clotPath) {
      bloodFill.setColor(RAMP_CLOT[idx]!);
      bloodFill.setAlphaf(Math.min(1, 0.42 * dry) * life);
      canvas.save();
      canvas.scale(1 / g, 1 / g);
      canvas.drawPath(d.clotPath, bloodFill);
      canvas.restore();
    }

    // Coffee-ring rim thickens and darkens with age. Widths are in local
    // units (×d.r on screen): same numbers as the old world-space
    // max(1, r * (0.09 + 0.14 * dry)).
    if (d.r >= 8) {
      bloodStroke.setColor(RAMP_RIM[idx]!);
      bloodStroke.setAlphaf(Math.min(1, 0.45 + 0.4 * dry) * life);
      bloodStroke.setStrokeWidth(Math.max(1 / d.r, 0.09 + 0.14 * dry));
      canvas.drawPath(d.path, bloodStroke);
    }

    // Wet specular sheen — fresh pools only, dies as it sets.
    if (w > 0.3) {
      bloodFill.setColor(C_SHEEN);
      bloodFill.setAlphaf(0.24 * w * life);
      canvas.drawCircle(-0.34, -0.44, 0.6, bloodFill);
    }
    canvas.restore();
  }
  bloodFill.setShader(null);
  bloodFill.setAlphaf(1);
  bloodStroke.setAlphaf(1);
};

/**
 * A faint dashed circle at YOUR OWN strike range — get an enemy inside it and
 * your weapon can reach them. Only your own ring draws (2026-07-12, tester
 * feedback): enemy rings gave away their spacing for free; now reading an
 * opponent's reach is a skill. Pure client derivation from snapshot data.
 */
const drawMyRangeRing = (
  canvas: SkCanvas,
  me: PlayerSnapshot,
  playerRadius: number,
): void => {
  if (!me.alive) return;
  // reach is measured to the victim's rim, so the strike circle extends one
  // body radius past it (matching hitsInArc's rule).
  const ring = WEAPONS[me.weapon ?? "blade"].attack.reach + playerRadius;
  rangeStroke.setAlphaf(RANGE_RING_ALPHA);
  canvas.drawCircle(me.x, me.y, ring, rangeStroke);
};

/** A body's disc colour: dead → grey ghost; else friend blue / foe red
 * relative to the viewer's side. `friendTeam` 0 (a seatless spectator) has no
 * allegiance, so it reads absolute — team 1 red, team 2 blue. */
const bodyColorFor = (p: PlayerSnapshot, friendTeam: number) => {
  if (!p.alive) return C_DEAD;
  if (friendTeam === 0) return p.team === 1 ? C_FOE : C_FRIEND;
  return p.team === friendTeam ? C_FRIEND : C_FOE;
};

const drawPlayer = (
  canvas: SkCanvas,
  p: PlayerSnapshot,
  config: ArenaClientConfig,
  friendTeam: number,
  pulses: StatusPulses,
  nowMs: number,
): void => {
  const r = config.playerRadius;

  // Windup telegraph, from the striker's own weapon table: melee grows an arc
  // wedge; ranged draws an aim line toward the locked target. Both ramp opaque
  // as the strike approaches.
  if (p.alive && p.atk === "windup") {
    const weapon = WEAPONS[p.weapon ?? "blade"];
    const progress = 1 - p.atkLeft / weapon.attack.windup;
    if (weapon.attack.shape === "arc") {
      const halfDeg = ((weapon.attack.arcWidth ?? 0) / 2) * (180 / Math.PI);
      const facingDeg = p.lockedFacing * (180 / Math.PI);
      const reach = weapon.attack.reach + r;
      const wedge = Skia.Path.Make();
      wedge.moveTo(p.x, p.y);
      wedge.arcToOval(
        Skia.XYWHRect(p.x - reach, p.y - reach, reach * 2, reach * 2),
        facingDeg - halfDeg,
        halfDeg * 2,
        false,
      );
      wedge.close();
      fill.setColor(C_TELEGRAPH);
      fill.setAlphaf(0.12 + 0.28 * progress);
      canvas.drawPath(wedge, fill);
      fill.setAlphaf(1);
    } else {
      stroke.setColor(C_TELEGRAPH);
      stroke.setAlphaf(0.2 + 0.5 * progress);
      stroke.setStrokeWidth(2.5);
      stroke.setStrokeCap(StrokeCap.Round);
      const len = 140;
      canvas.drawLine(
        p.x + Math.cos(p.lockedFacing) * (r + 4),
        p.y + Math.sin(p.lockedFacing) * (r + 4),
        p.x + Math.cos(p.lockedFacing) * (r + len),
        p.y + Math.sin(p.lockedFacing) * (r + len),
        stroke,
      );
      stroke.setAlphaf(1);
    }
  }

  // Body disc (grey ghost when down; else friend blue / foe red).
  fill.setColor(bodyColorFor(p, friendTeam));
  canvas.drawCircle(p.x, p.y, r, fill);

  if (p.alive && p.dashing) {
    stroke.setColor(C_DASH_RING);
    stroke.setStrokeWidth(3);
    canvas.drawCircle(p.x, p.y, r + 4, stroke);
  }

  // Ironhide: a proper shield dome (Tom, 2026-07-15 — the old pulse ring
  // didn't read at all): translucent iron fill, a bold rim, and three plate
  // arcs slowly orbiting the body. Fades out over its last 0.4s.
  if (p.alive) {
    const iron = p.abilities.find((s) => s.id === "ironhide");
    if (iron && iron.active > 0) {
      const a = Math.min(1, iron.active / 0.4);
      const shieldR = r + 9;
      fill.setColor(C_IRON_FILL);
      fill.setAlphaf(0.2 * a);
      canvas.drawCircle(p.x, p.y, shieldR, fill);
      stroke.setColor(C_IRON_RIM);
      stroke.setAlphaf(0.7 * a);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(p.x, p.y, shieldR, stroke);
      // The orbiting plates.
      const spin = ((nowMs / 1000) * 65) % 360; // deg/s
      stroke.setStrokeWidth(3.5);
      stroke.setAlphaf(0.9 * a);
      stroke.setStrokeCap(StrokeCap.Round);
      for (let i = 0; i < 3; i++) {
        const arc = Skia.Path.Make();
        arc.addArc(
          Skia.XYWHRect(
            p.x - shieldR - 2,
            p.y - shieldR - 2,
            (shieldR + 2) * 2,
            (shieldR + 2) * 2,
          ),
          spin + i * 120,
          55,
        );
        canvas.drawPath(arc, stroke);
      }
      fill.setAlphaf(1);
      stroke.setAlphaf(1);
    }
  }

  // Status rings, concentric (inner → outer): slow · bleed · taunt · ability
  // — the pvp-abilities.md ring order, so stacked states stay legible.
  // Brightness pulses at the clock's rate — quickening toward expiry is the
  // "about to drop" tell (see statusRings.ts).
  if (p.alive) {
    const slow = pulses.strength(p.id, "slow");
    if (slow > 0) {
      stroke.setColor(C_RING_SLOW);
      stroke.setAlphaf(0.25 + 0.6 * slow);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(p.x, p.y, r + 6, stroke);
    }
    const bleed = pulses.strength(p.id, "bleed");
    if (bleed > 0) {
      stroke.setColor(C_RING_BLEED);
      stroke.setAlphaf(0.25 + 0.6 * bleed);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(p.x, p.y, r + 10, stroke);
    }
    const taunt = pulses.strength(p.id, "taunt");
    if (taunt > 0) {
      stroke.setColor(C_RING_TAUNT);
      stroke.setAlphaf(0.25 + 0.6 * taunt);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(p.x, p.y, r + 14, stroke);
    }
    // Body-effect ring: Mirror Guard, one radius step further out. (Ironhide
    // draws its shield dome above instead of a ring.)
    const mirror = pulses.strength(p.id, "mirror-guard");
    if (mirror > 0) {
      stroke.setColor(C_RING_MIRROR);
      stroke.setAlphaf(0.3 + 0.55 * mirror);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(p.x, p.y, r + 18, stroke);
    }
    stroke.setAlphaf(1);
  }

  // Name tag, small under the body — who is who (dead stay labelled, dimmer).
  fill.setColor(C_NAME);
  fill.setAlphaf(p.alive ? 0.7 : 0.35);
  canvas.drawText(
    p.name,
    p.x - NAME_FONT.getTextWidth(p.name) / 2,
    p.y + r + 16,
    fill,
    NAME_FONT,
  );
  fill.setAlphaf(1);

  if (p.alive) {
    // Facing notch.
    stroke.setColor(C_FACING);
    stroke.setStrokeWidth(3);
    stroke.setStrokeCap(StrokeCap.Round);
    canvas.drawLine(
      p.x + Math.cos(p.facing) * (r - 6),
      p.y + Math.sin(p.facing) * (r - 6),
      p.x + Math.cos(p.facing) * (r + 6),
      p.y + Math.sin(p.facing) * (r + 6),
      stroke,
    );

    // HP bar above the head.
    const w = 44;
    const hpFrac = Math.max(0, p.hp / p.maxHp);
    const bx = p.x - w / 2;
    const by = p.y - r - 14;
    fill.setColor(C_HP_BACK);
    canvas.drawRect(Skia.XYWHRect(bx - 1, by - 1, w + 2, 7), fill);
    fill.setColor(hpFrac > 0.35 ? C_HP_FILL : C_HP_LOW);
    canvas.drawRect(Skia.XYWHRect(bx, by, w * hpFrac, 5), fill);
  }
};

/** The cast flash's drawn size, world px. */
const CAST_FLASH_SIZE = 30;

const drawFx = (
  canvas: SkCanvas,
  fx: readonly FxItem[],
  abilityIcons: Partial<Record<AbilityId, SkImage>>,
): void => {
  for (const f of fx) {
    if (f.kind === "castFlash") {
      // "They just pressed this button": the ability's icon pops in above the
      // caster, drifts up, and fades — the only way enemy kits are ever shown
      // (pvp-loadout-flow.md). Snaps in fast, lingers, fades over the tail.
      const img = f.ability !== undefined ? abilityIcons[f.ability] : undefined;
      if (!img) continue;
      const born = 1 - f.life;
      const alpha = Math.min(1, born * 8) * Math.min(1, f.life / 0.35);
      const scale = 0.8 + Math.min(1, born * 6) * 0.2; // snap-in pop
      const size = CAST_FLASH_SIZE * scale;
      const rise = born * 16;
      const cx = f.x;
      const cy = f.y - 12 - rise;
      fill.setColor(Skia.Color("#ffffff"));
      fill.setAlphaf(alpha);
      canvas.drawImageRectOptions(
        img,
        Skia.XYWHRect(0, 0, img.width(), img.height()),
        Skia.XYWHRect(cx - size / 2, cy - size, size, size),
        FilterMode.Linear,
        MipmapMode.Linear,
        fill,
      );
      fill.setAlphaf(1);
    } else if (f.kind === "ring" && f.big) {
      // The sandtrap detonation: a bombastic powder blast sized to read its
      // full kill radius (the trigger ring is small; the blast is 2× wider, so
      // the boom has to SHOW that). Four layers, all fading with life so the
      // whole thing lingers then settles rather than snapping off:
      const edge = SANDTRAP.blastRadius;
      // 1) Settling dust — a dim warm disc out at the blast edge, the slow tail
      //    that hangs after the flash is gone.
      fill.setColor(C_MINE_GLINT);
      fill.setAlphaf(0.18 * f.life);
      canvas.drawCircle(f.x, f.y, 30 + (1 - f.life) * (edge - 30), fill);
      // 2) Core flash — a white bloom that pops big and dies in the first half.
      const flash = Math.max(0, (f.life - 0.5) / 0.5);
      fill.setColor(C_FX_NUM);
      fill.setAlphaf(0.55 * flash);
      canvas.drawCircle(f.x, f.y, 26 + (1 - flash) * 80, fill);
      // 3) Shockwave — a hard bright ring shoved out to the exact blast rim
      //    (ease-out so it snaps then settles on the edge).
      const wave = 1 - f.life * f.life * f.life;
      stroke.setColor(C_FX_NUM);
      stroke.setAlphaf(0.9 * f.life);
      stroke.setStrokeWidth(3 + 6 * f.life);
      canvas.drawCircle(f.x, f.y, 30 + wave * (edge - 30), stroke);
      // 4) Echo — a warmer second front chasing the shockwave out.
      const echo = 1 - f.life * f.life;
      stroke.setColor(C_MINE_GLINT);
      stroke.setAlphaf(0.7 * f.life);
      stroke.setStrokeWidth(2 + 4 * f.life);
      canvas.drawCircle(f.x, f.y, 20 + echo * (edge - 20), stroke);
      stroke.setAlphaf(1);
      fill.setAlphaf(1);
    } else if (f.kind === "ring") {
      stroke.setColor(C_DASH_RING);
      stroke.setStrokeWidth(2 + 2 * f.life);
      canvas.drawCircle(f.x, f.y, 20 + (1 - f.life) * 26, stroke);
    } else if (f.kind === "strawBurst") {
      // The dummy soaking a blow: a puff of straw flecks thrown out of the
      // impact — the "sword fell on straw" tell (Tom, 2026-07-20). Each fleck
      // is a short stalk flying outward on its own deterministic angle/speed
      // (hash01 keyed by index + position: per-burst variety, zero state),
      // easing out with a slight downward settle, fading with life.
      const out = 1 - f.life * f.life; // ease-out: pop fast, drift to rest
      stroke.setStrokeCap(StrokeCap.Round);
      for (let i = 0; i < 12; i++) {
        const h1 = hash01(i * 7.13 + f.x * 0.37 + f.y * 0.61);
        const h2 = hash01(i * 3.71 + f.x * 0.53 + f.y * 0.29);
        const ang = h1 * Math.PI * 2;
        const reach = (14 + h2 * 22) * out;
        const cx = f.x + Math.cos(ang) * reach;
        const cy = f.y + Math.sin(ang) * reach + (1 - f.life) * 6; // settle
        const stalk = 3 + h2 * 3;
        stroke.setColor(h1 > 0.5 ? C_DUMMY : C_DUMMY_DARK);
        stroke.setAlphaf(Math.min(1, f.life * 1.6));
        stroke.setStrokeWidth(2);
        canvas.drawLine(
          cx - Math.cos(ang) * stalk,
          cy - Math.sin(ang) * stalk,
          cx + Math.cos(ang) * stalk,
          cy + Math.sin(ang) * stalk,
          stroke,
        );
      }
      stroke.setAlphaf(1);
    } else if (f.kind === "cone" && f.angle !== undefined) {
      // Warding Shout: the bellow made visible — a wedge blasting out to the
      // shout's TRUE range (the honest-telegraph rule) then gone in a blink.
      const reach = 30 + (1 - f.life * f.life) * (WARDING_SHOUT.range - 30);
      const halfDeg = (WARDING_SHOUT.halfAngle * 180) / Math.PI;
      const startDeg = (f.angle * 180) / Math.PI - halfDeg;
      const wedge = Skia.Path.Make();
      wedge.moveTo(f.x, f.y);
      wedge.arcToOval(
        Skia.XYWHRect(f.x - reach, f.y - reach, reach * 2, reach * 2),
        startDeg,
        halfDeg * 2,
        false,
      );
      wedge.close();
      fill.setColor(C_FX_NUM);
      fill.setAlphaf(0.16 * f.life);
      canvas.drawPath(wedge, fill);
      stroke.setColor(C_FX_NUM);
      stroke.setAlphaf(0.7 * f.life);
      stroke.setStrokeWidth(2.5);
      canvas.drawPath(wedge, stroke);
      fill.setAlphaf(1);
      stroke.setAlphaf(1);
    } else if (f.kind === "line" && f.x2 !== undefined && f.y2 !== undefined) {
      // The harpoon chain flash: one taut line, a hook at the far end, chain
      // dots along it — gone in a blink, like the throw itself.
      stroke.setColor(C_HARPOON);
      stroke.setAlphaf(Math.min(1, f.life * 1.5));
      stroke.setStrokeWidth(3);
      stroke.setStrokeCap(StrokeCap.Round);
      canvas.drawLine(f.x, f.y, f.x2, f.y2, stroke);
      fill.setColor(C_HARPOON);
      fill.setAlphaf(Math.min(1, f.life * 1.5));
      canvas.drawCircle(f.x2, f.y2, 5, fill);
      const dx = f.x2 - f.x;
      const dy = f.y2 - f.y;
      for (let i = 1; i <= 4; i++) {
        canvas.drawCircle(f.x + (dx * i) / 5, f.y + (dy * i) / 5, 1.8, fill);
      }
      stroke.setAlphaf(1);
      fill.setAlphaf(1);
    } else if (f.text) {
      const font = f.crit ? FX_FONT_CRIT : FX_FONT;
      const rise = (1 - f.life) * 34;
      fill.setColor(
        f.crit
          ? C_FX_CRIT
          : f.bleed
            ? C_FX_BLEED
            : f.heal
              ? C_FX_HEAL
              : C_FX_NUM,
      );
      fill.setAlphaf(Math.min(1, f.life * 2));
      canvas.drawText(
        f.text,
        f.x - font.getTextWidth(f.text) / 2,
        f.y - 26 - rise,
        fill,
        font,
      );
      fill.setAlphaf(1);
    }
  }
};

/** Fade a placed thing out over its last half-second. */
const deployAlpha = (d: DeployableSnapshot): number =>
  Math.min(1, d.lifeLeft / 0.5);

/** The enemy sandtrap's occasional tell: a brief glint every few seconds.
 * Returns the flash envelope 0..1 (0 almost always; a short sine bump when
 * the glint fires). Phase-offset by id so two mines never blink in sync. */
const MINE_FLASH_PERIOD_MS = 3000;
const MINE_FLASH_MS = 320;
const mineFlash = (d: DeployableSnapshot, nowMs: number): number => {
  const t = (nowMs + d.id * 811) % MINE_FLASH_PERIOD_MS;
  if (t >= MINE_FLASH_MS) return 0;
  return Math.sin((t / MINE_FLASH_MS) * Math.PI);
};

/**
 * Everything placed on the sand — zones under the bodies (the pvp-abilities
 * layer rule: ground ring + interior, under players, over blood decals), plus
 * the mine and the dummy, which stand ON the sand but read fine below the
 * discs at v1. Everything is uniformly visible to both teams EXCEPT the
 * sandtrap (Tom, 2026-07-14): your own team gets the clear marker; an enemy
 * mine is a faint thing — a very dim trigger ring and a 3-second glint —
 * hard to spot mid-fight, findable in the calm.
 */
const drawDeployables = (
  canvas: SkCanvas,
  deployables: readonly DeployableSnapshot[],
  myTeam: number,
  nowMs: number,
): void => {
  for (const d of deployables) {
    const a = deployAlpha(d);
    if (d.kind === "blood-font") {
      // The font BREATHES (Tom, 2026-07-15): the boundary stays honest and
      // fixed; the interior and an inner ring pulse on a slow heartbeat.
      const beat = 0.5 + 0.5 * Math.sin((nowMs / 1200) * Math.PI * 2 + d.id);
      fill.setColor(C_FONT);
      fill.setAlphaf((0.06 + 0.09 * beat) * a);
      canvas.drawCircle(d.x, d.y, BLOOD_FONT.radius, fill);
      stroke.setColor(C_FONT);
      stroke.setAlphaf(0.45 * a);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(d.x, d.y, BLOOD_FONT.radius, stroke);
      stroke.setAlphaf((0.2 + 0.4 * beat) * a);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(
        d.x,
        d.y,
        BLOOD_FONT.radius * (0.55 + 0.3 * beat),
        stroke,
      );
      fill.setAlphaf((0.35 + 0.3 * beat) * a);
      canvas.drawCircle(d.x, d.y, 6, fill); // the font itself
    } else if (d.kind === "sandstorm") {
      // Just the ground boundary here — the swirling body of the storm draws
      // OVER the players (drawSandstormOverlays), since it obscures them.
      stroke.setColor(C_STORM);
      stroke.setAlphaf(0.4 * a);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(d.x, d.y, SANDSTORM.radius, stroke);
    } else if (d.kind === "quake") {
      // The earthquake: an honest boundary ring over a dim SHUDDERING
      // interior — high-frequency, low-amplitude (the font breathes on a slow
      // heartbeat; the quake shakes). The ground-giving-way story is told by
      // the zone's expanding fracture web (cracks v2; drawLiveCracks).
      const shudder = 0.5 + 0.5 * Math.sin((nowMs / 90) * Math.PI * 2 + d.id);
      fill.setColor(C_QUAKE);
      fill.setAlphaf((0.05 + 0.04 * shudder) * a);
      canvas.drawCircle(d.x, d.y, TREMOR.radius, fill);
      stroke.setColor(C_QUAKE);
      stroke.setAlphaf(0.5 * a);
      stroke.setStrokeWidth(2 + shudder);
      canvas.drawCircle(d.x, d.y, TREMOR.radius, stroke);
      // A faint inner ring jittering against the rim sells motion cheaply.
      stroke.setAlphaf(0.22 * a);
      stroke.setStrokeWidth(1.5);
      canvas.drawCircle(
        d.x,
        d.y,
        TREMOR.radius * (0.6 + 0.02 * shudder),
        stroke,
      );
    } else if (d.kind === "sandtrap") {
      const arming = d.armLeft > 0;
      const mine = d.team === myTeam;
      if (mine) {
        // Your team's mine: a clear, steady marker — it's your resource.
        stroke.setColor(C_MINE_GLINT);
        stroke.setAlphaf((arming ? 0.15 : 0.3) * a);
        stroke.setStrokeWidth(1.5);
        canvas.drawCircle(d.x, d.y, SANDTRAP.triggerRadius, stroke);
        fill.setColor(C_MINE);
        fill.setAlphaf(0.9 * a);
        canvas.drawCircle(d.x, d.y, 8, fill);
        if (arming) {
          // Arming countdown: an arc that closes as the 2s run out.
          const sweep = 360 * (1 - d.armLeft / SANDTRAP.armSeconds);
          stroke.setColor(C_MINE_GLINT);
          stroke.setAlphaf(0.8 * a);
          stroke.setStrokeWidth(2.5);
          const arc = Skia.Path.Make();
          arc.addArc(Skia.XYWHRect(d.x - 13, d.y - 13, 26, 26), -90, sweep);
          canvas.drawPath(arc, stroke);
        } else {
          stroke.setColor(C_MINE_GLINT);
          stroke.setAlphaf(0.85 * a);
          stroke.setStrokeWidth(2);
          canvas.drawCircle(d.x, d.y, 12, stroke); // armed: a steady glint ring
        }
      } else {
        // An ENEMY mine: hard to spot mid-fight, findable in the calm. A very
        // dim trigger ring, a barely-there mound, and a brief glint every
        // MINE_FLASH_PERIOD. The plant itself still telegraphs: the arming
        // arc shows (dimmer than the owner's) for its two seconds.
        const flash = mineFlash(d, nowMs);
        stroke.setColor(C_MINE_GLINT);
        stroke.setAlphaf((0.06 + 0.14 * flash) * a);
        stroke.setStrokeWidth(1.5);
        canvas.drawCircle(d.x, d.y, SANDTRAP.triggerRadius, stroke);
        fill.setColor(C_MINE);
        fill.setAlphaf((0.1 + 0.4 * flash) * a);
        canvas.drawCircle(d.x, d.y, 8, fill);
        if (arming) {
          const sweep = 360 * (1 - d.armLeft / SANDTRAP.armSeconds);
          stroke.setColor(C_MINE_GLINT);
          stroke.setAlphaf(0.35 * a);
          stroke.setStrokeWidth(2);
          const arc = Skia.Path.Make();
          arc.addArc(Skia.XYWHRect(d.x - 13, d.y - 13, 26, 26), -90, sweep);
          canvas.drawPath(arc, stroke);
        } else if (flash > 0) {
          stroke.setColor(C_MINE_GLINT);
          stroke.setAlphaf(0.5 * flash * a);
          stroke.setStrokeWidth(2);
          canvas.drawCircle(d.x, d.y, 12, stroke); // the glint itself
        }
      }
    } else {
      // Straw man, sized UP and made unmissable (Tom, 2026-07-20 — it now
      // taunts, so it has to LOOK like the thing everyone's blades snapped
      // to): a fat straw body on a cross-frame with scarecrow arms poking
      // past the disc, a painted target on its chest (the icon, honoured),
      // a taunt-yellow rim tying it to the ring on its victims, and a lazy
      // creak-sway so the eye finds it. Hurtbox is unchanged (PLAYER_RADIUS
      // in the sim) — the decoy dresses bigger than it stands, which for a
      // thing that WANTS to be shot at is honest advertising.
      const sway = 0.09 * Math.sin(nowMs / 420 + d.id * 2.1);
      const armR = 34;
      stroke.setColor(C_DUMMY_DARK);
      stroke.setAlphaf(a);
      stroke.setStrokeWidth(4);
      stroke.setStrokeCap(StrokeCap.Round);
      canvas.drawLine(
        d.x - Math.cos(sway) * armR,
        d.y - Math.sin(sway) * armR,
        d.x + Math.cos(sway) * armR,
        d.y + Math.sin(sway) * armR,
        stroke,
      ); // the crossbar, swaying on its post
      fill.setColor(C_DUMMY);
      fill.setAlphaf(a);
      canvas.drawCircle(d.x, d.y, 24, fill); // the straw body
      stroke.setColor(C_RING_TAUNT);
      stroke.setAlphaf(0.85 * a);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(d.x, d.y, 24, stroke); // taunt-yellow rim
      // The painted target on its chest.
      stroke.setColor(C_DUMMY_DARK);
      stroke.setAlphaf(a);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(d.x, d.y, 13, stroke);
      canvas.drawCircle(d.x, d.y, 6.5, stroke);
      fill.setColor(C_DUMMY_DARK);
      canvas.drawCircle(d.x, d.y, 2.5, fill);
      const w = 40;
      const frac = Math.max(0, d.hp / STRAW_MAN.hp);
      fill.setColor(C_HP_BACK);
      canvas.drawRect(Skia.XYWHRect(d.x - w / 2 - 1, d.y - 40, w + 2, 6), fill);
      fill.setColor(frac > 0.35 ? C_HP_FILL : C_HP_LOW);
      canvas.drawRect(Skia.XYWHRect(d.x - w / 2, d.y - 39, w * frac, 4), fill);
    }
  }
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

/** Cheap deterministic 0..1 hash — per-streak variety with zero stored state. */
const hash01 = (n: number): number => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The sandstorm's body, drawn OVER players and shots (Tom, 2026-07-15: the
 * cloud should visibly obscure whoever stands in it): a dense sand fill plus
 * a dozen swirling streak arcs orbiting at mixed radii, speeds and
 * directions. Tier-1 canvas particles (the blood-decal pattern) — promote to
 * the flagged SkSL swirl only on profiler evidence.
 */
const drawSandstormOverlays = (
  canvas: SkCanvas,
  deployables: readonly DeployableSnapshot[],
  nowMs: number,
): void => {
  for (const d of deployables) {
    if (d.kind !== "sandstorm") continue;
    const a = deployAlpha(d);
    fill.setColor(C_STORM);
    fill.setAlphaf(0.42 * a);
    canvas.drawCircle(d.x, d.y, SANDSTORM.radius, fill);
    fill.setAlphaf(0.22 * a);
    canvas.drawCircle(d.x, d.y, SANDSTORM.radius * 0.6, fill); // denser core

    stroke.setColor(C_STORM_STREAK);
    stroke.setStrokeCap(StrokeCap.Round);
    for (let i = 0; i < 12; i++) {
      const seed = d.id * 31 + i;
      const radius = SANDSTORM.radius * (0.25 + 0.68 * hash01(seed));
      const speed = (40 + 90 * hash01(seed + 1)) * (i % 2 === 0 ? 1 : -1); // deg/s, mixed directions
      const start = hash01(seed + 2) * 360 + (nowMs / 1000) * speed;
      const sweep = 45 + 55 * hash01(seed + 3);
      stroke.setAlphaf((0.22 + 0.3 * hash01(seed + 4)) * a);
      stroke.setStrokeWidth(2 + 2 * hash01(seed + 5));
      const arc = Skia.Path.Make();
      arc.addArc(
        Skia.XYWHRect(d.x - radius, d.y - radius, radius * 2, radius * 2),
        start % 360,
        sweep,
      );
      canvas.drawPath(arc, stroke);
    }
  }
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

/** One crack web, both stroke weights (primary skeleton over fine detail) —
 * shared by the live pass and the splat stamp so the settle→bake handoff
 * matches exactly. */
const drawWeb = (canvas: SkCanvas, c: CrackDecal, alpha: number): void => {
  stroke.setColor(C_CRACK);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  stroke.setAlphaf(alpha);
  stroke.setStrokeWidth(3);
  canvas.drawPath(c.path, stroke);
  stroke.setStrokeWidth(1.6);
  canvas.drawPath(c.finePath, stroke);
  stroke.setAlphaf(1);
};

/** drawWeb under the reveal clip while the fracture front is still short of
 * full radius. Also correct at STAMP time: crackReveal freezes at settleAtMs,
 * so a zone that died early bakes only what it actually cracked open. */
const drawWebRevealed = (
  canvas: SkCanvas,
  c: CrackDecal,
  alpha: number,
  nowMs: number,
): void => {
  const reveal = crackReveal(c, nowMs);
  if (reveal < 1) {
    canvas.save();
    const clip = Skia.Path.Make();
    clip.addCircle(c.x, c.y, Math.max(1, c.r * reveal));
    canvas.clipPath(clip, ClipOp.Intersect, true);
    drawWeb(canvas, c, alpha);
    canvas.restore();
  } else {
    drawWeb(canvas, c, alpha);
  }
};

/** Tremor's LIVE crack webs — drawn per frame, prebuilt paths only
 * (bits-blood.md §7): the expanding reveal needs per-frame stepping anyway,
 * and keeping live cracks out of the scar picture is the whole optimisation —
 * the old per-pop epoch bumps pinned the cache on its 200ms beat for every
 * quake's life. Layering trade-off, accepted: a live web draws OVER
 * this-second's wet blood; once baked it sits under everything later —
 * chronological, like the splat surface itself. */
const drawLiveCracks = (
  canvas: SkCanvas,
  cracks: readonly CrackDecal[],
  nowMs: number,
): void => {
  for (const c of cracks) {
    const a = crackAlpha(c, nowMs);
    if (a <= 0) continue;
    drawWebRevealed(canvas, c, a, nowMs);
  }
};

/**
 * The floor-scar layer — cracks then blood (fresh pools cover old fractures)
 * — cached as ONE world-space SkPicture and rebuilt on a slow beat instead of
 * per rendered frame. The scars fade over 20–100 SECONDS, so alphas only need
 * stepping at 1Hz — but FRESH marks must not wait for that beat (a splash
 * landing a second after its hit reads as detached), so a dirty epoch (new
 * decals since the last build) drops the wait to 200ms, behind the cast
 * stomp / hit FX that mask it. Per-frame cost collapses to one drawPicture
 * call; the camera transform applies at replay, so the cache never invalidates
 * on camera movement.
 */
const SCAR_FRESH_MS = 200;
const SCAR_FADE_MS = 1000;
let scarPicture: SkPicture | null = null;
let scarBuiltMs = -Infinity;
let scarBuiltEpoch = -1;

// ── The splat map (bits-blood.md §1) ────────────────────────────────────────
// Dried blood is stamped ONCE into a persistent world-resolution surface and
// spliced out of the live field, so the scar rebuild only re-records the last
// ~16s of wet blood no matter how long the massacre — MAX_DECALS stops
// erasing history and the floor keeps every kill site for the whole match
// (extending the "arena remembers" rule: the field already survives
// rematches). Same bake technique + memory budget as the floor image above.
// If the surface can't be made we simply never harvest and the field falls
// back to ttl fades + the FIFO cap — exactly the old behaviour.
let splatSurface: SkSurface | null = null;
let splatImage: SkImage | null = null;
/** The field the surface belongs to — a new room's field wipes the slate. */
let splatOwner: BloodField | null = null;
let splatWashMs = 0;
/** Anti-saturation: multiply the baked layer's alpha down a hair on a slow
 *  beat — invisible at match timescales (half-life ≈ 11½ min), but guards a
 *  marathon room from ending at a solid-red floor. */
const WASH_INTERVAL_MS = 10_000;
const WASH_KEEP = 0.99;
const washPaint = Skia.Paint();
washPaint.setBlendMode(BlendMode.DstIn);
washPaint.setColor(Skia.Color(`rgba(0, 0, 0, ${WASH_KEEP})`));

const scarLayer = (
  blood: BloodField,
  cracks: CrackField,
  epoch: number,
  nowMs: number,
): SkPicture => {
  if (scarPicture) {
    // Seeping death pools hold the fresh cadence — growth stepping at the
    // 1Hz fade beat would pop, not spread.
    const wait =
      epoch !== scarBuiltEpoch || blood.hasGrowingPool(nowMs)
        ? SCAR_FRESH_MS
        : SCAR_FADE_MS;
    if (nowMs - scarBuiltMs < wait) return scarPicture;
  }
  scarBuiltMs = nowMs;
  scarBuiltEpoch = epoch;

  // Bake newly-dried decals on the same beat, so a mark moves from the live
  // pass to the baked image inside ONE rebuild — never absent, never doubled.
  if (splatOwner !== blood) {
    splatOwner = blood;
    splatImage = null;
    splatSurface?.getCanvas().clear(Skia.Color("rgba(0, 0, 0, 0)"));
    splatWashMs = nowMs;
  }
  splatSurface ??= Skia.Surface.Make(WORLD_W, WORLD_H); // null → retry next beat
  if (splatSurface) {
    const canvas = splatSurface.getCanvas();
    let dirty = false;
    if (splatImage && nowMs - splatWashMs >= WASH_INTERVAL_MS) {
      splatWashMs = nowMs;
      canvas.drawRect(FLOOR_RECT, washPaint);
      dirty = true;
    }
    // Settled crack webs stamp at exactly the alpha (and frozen reveal) the
    // live pass last drew them with, then leave the live list — the handoff
    // is invisible (bits-blood.md §7). Stamped before this beat's blood, so
    // the surface stays chronological.
    for (const c of cracks.harvestSettled(nowMs)) {
      drawWebRevealed(canvas, c, CRACK_SETTLE_ALPHA, nowMs);
      dirty = true;
    }
    // Stamp each decal at the instant it finished drying — the exact
    // appearance the live pass last drew it with (wetness 0, fade not yet
    // started), so the handoff is invisible.
    for (const d of blood.harvestDried(nowMs)) {
      drawBlood(canvas, [d], d.bornMs + BLOOD_DRY_MS);
      dirty = true;
    }
    if (dirty) splatImage = splatSurface.makeImageSnapshot();
  }

  scarPicture = createPicture((canvas) => {
    // The baked splat surface (set blood + settled quake scars,
    // chronological) under this beat's live wet blood. Live cracks draw per
    // frame in recordArena, not here.
    if (splatImage) canvas.drawImage(splatImage, 0, 0);
    drawBlood(canvas, blood.decals, nowMs);
  }, FLOOR_RECT);
  return scarPicture;
};

/**
 * Death-spray droplets still in the air (bits-blood.md §2) — drawn per frame
 * OVER the bodies (they're flying, not floor), easing out from the corpse to
 * the landing point where BloodField.update will stamp the decal. Fresh
 * arterial bright with a short motion tail that shrinks as the drop
 * decelerates; ≤~100 tiny shapes for a quarter second per kill — per-frame
 * recording noise.
 */
const drawFlyingBlood = (
  canvas: SkCanvas,
  flying: readonly FlyingDrop[],
  nowMs: number,
): void => {
  for (const drop of flying) {
    const t = Math.min(1, (nowMs - drop.bornMs) / (drop.landMs - drop.bornMs));
    const ease = 1 - (1 - t) * (1 - t); // launched fast, settles in
    const px = drop.x0 + (drop.tx - drop.x0) * ease;
    const py = drop.y0 + (drop.ty - drop.y0) * ease;
    bloodFill.setColor(RAMP_EDGE[0]!); // airborne blood catches the light
    bloodFill.setAlphaf(0.85);
    canvas.drawCircle(px, py, Math.min(drop.r, 2.4) * 0.9, bloodFill);
    const tail = 9 * (1 - t);
    if (tail > 1.5) {
      const len = Math.hypot(drop.tx - drop.x0, drop.ty - drop.y0) || 1;
      bloodStroke.setColor(RAMP_EDGE[0]!);
      bloodStroke.setAlphaf(0.4);
      bloodStroke.setStrokeWidth(Math.min(drop.r, 2) * 0.8);
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

/** Live harpoon chains — taut from each rooted puller to whoever they're
 * hauling in, redrawn from lerped positions every frame so the drag reads as
 * one continuous "against their will" pull. */
const drawReelChains = (
  canvas: SkCanvas,
  players: readonly PlayerSnapshot[],
): void => {
  for (const p of players) {
    if (p.reeling === null) continue;
    const victim = players.find((v) => v.id === p.reeling);
    if (!victim) continue;
    stroke.setColor(C_HARPOON);
    stroke.setAlphaf(0.9);
    stroke.setStrokeWidth(3);
    stroke.setStrokeCap(StrokeCap.Round);
    canvas.drawLine(p.x, p.y, victim.x, victim.y, stroke);
    fill.setColor(C_HARPOON);
    canvas.drawCircle(victim.x, victim.y, 5, fill); // the barb, sunk in
    const dx = victim.x - p.x;
    const dy = victim.y - p.y;
    const links = Math.max(3, Math.floor(Math.hypot(dx, dy) / 34));
    for (let i = 1; i < links; i++) {
      canvas.drawCircle(
        p.x + (dx * i) / links,
        p.y + (dy * i) / links,
        1.8,
        fill,
      );
    }
    stroke.setAlphaf(1);
  }
};

/** The drums' tempo, beats per second — the rings ARE the rhythm (Tom,
 * 2026-07-15: the effect should mimic the drumming; real SFX will lock to
 * the same tempo when Asset Forge delivers it). */
const DRUM_BPS = 1.9;

/** War Drums' moving aura — drawn around every player whose drums are live:
 * the boundary circle, plus beat rings that pound outward from the drummer
 * to the aura's edge, two per cycle like alternating drum hands. */
const drawDrumAuras = (
  canvas: SkCanvas,
  players: readonly PlayerSnapshot[],
  nowMs: number,
): void => {
  for (const p of players) {
    if (!p.alive) continue;
    const drums = p.abilities.find((s) => s.id === "war-drums");
    if (!drums || drums.active <= 0) continue;
    const a = Math.min(1, drums.active / 0.4); // quick fade as the beat dies
    fill.setColor(C_DRUMS);
    fill.setAlphaf(0.05 * a);
    canvas.drawCircle(p.x, p.y, WAR_DRUMS.radius, fill);
    stroke.setColor(C_DRUMS);
    stroke.setAlphaf(0.35 * a);
    stroke.setStrokeWidth(2);
    canvas.drawCircle(p.x, p.y, WAR_DRUMS.radius, stroke);

    // The beats: rings born at the drummer's body, swelling to the boundary
    // and dying there — offset by half a cycle (left hand, right hand).
    for (const offset of [0, 0.5]) {
      const beat = ((nowMs / 1000) * DRUM_BPS + offset) % 1;
      stroke.setAlphaf(0.55 * (1 - beat) * a);
      stroke.setStrokeWidth(3 * (1 - beat) + 1);
      canvas.drawCircle(
        p.x,
        p.y,
        SIM_PLAYER_RADIUS + beat * (WAR_DRUMS.radius - SIM_PLAYER_RADIUS),
        stroke,
      );
    }
  }
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

/** Live shots: bow = a short bolt along its travel line; staff = a seeking
 * orb. (The harpoon is an instant chain — it draws as a line FX, not here.) */
const drawProjectiles = (
  canvas: SkCanvas,
  projectiles: readonly ProjectileSnapshot[],
): void => {
  for (const p of projectiles) {
    if (p.kind === "staff") {
      fill.setColor(C_STAFF_ORB);
      canvas.drawCircle(p.x, p.y, 10, fill);
      stroke.setColor(C_STAFF_RING);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(p.x, p.y, 14, stroke);
    } else {
      stroke.setColor(C_BOLT);
      stroke.setStrokeWidth(3);
      stroke.setStrokeCap(StrokeCap.Round);
      canvas.drawLine(
        p.x - Math.cos(p.angle) * 8,
        p.y - Math.sin(p.angle) * 8,
        p.x + Math.cos(p.angle) * 8,
        p.y + Math.sin(p.angle) * 8,
        stroke,
      );
    }
  }
};

/**
 * Off-screen ally pointers (Tom, 2026-07-18): a teammate who has wandered out
 * of frame gets a small team-coloured chevron pinned to the screen edge,
 * pointing the way to them — so you always know where your team is without
 * hunting the minimap you don't have. ONLY allies: an enemy pointer would hand
 * you their position for free, and reading where the other team is should be a
 * skill (same rule as the range ring and the enemy sandtrap). Drawn in SCREEN
 * space, so this runs after the camera transform is popped.
 */
const ARROW_MARGIN = 26; // px in from the safe-viewport edge — clear of notch/tray
const ARROW_LEN = 15; // chevron length, tip to base
const ARROW_HALF = 9; // chevron half-width at its base
const drawOffscreenAllies = (
  canvas: SkCanvas,
  players: readonly PlayerSnapshot[],
  me: PlayerSnapshot,
  cx: number,
  cy: number,
  zoom: number,
  vcx: number,
  vcy: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void => {
  const teamColor = C_FRIEND; // an ally pointer only ever marks your own side
  for (const p of players) {
    if (p.id === me.id || p.team !== me.team || !p.alive) continue;
    // Where the ally sits on screen (may be well outside the canvas).
    const sx = vcx + (p.x - cx) * zoom;
    const sy = vcy + (p.y - cy) * zoom;
    // On-screen inside the safe rect → they're visible, no pointer needed.
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) continue;
    // March along the ray from screen centre toward the ally to the first edge
    // of the inset rect — that hit point is where the chevron pins, aimed out.
    const dx = sx - vcx;
    const dy = sy - vcy;
    if (dx === 0 && dy === 0) continue;
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (right - vcx) / dx);
    else if (dx < 0) t = Math.min(t, (left - vcx) / dx);
    if (dy > 0) t = Math.min(t, (bottom - vcy) / dy);
    else if (dy < 0) t = Math.min(t, (top - vcy) / dy);
    if (!(t > 0) || !isFinite(t)) continue;
    const ex = vcx + dx * t;
    const ey = vcy + dy * t;
    // Chevron: tip at the edge point, base pulled back along the ray.
    const len = Math.hypot(dx, dy);
    const ax = dx / len;
    const ay = dy / len;
    const px = -ay; // unit perpendicular
    const py = ax;
    const bcx = ex - ax * ARROW_LEN;
    const bcy = ey - ay * ARROW_LEN;
    const arrow = Skia.Path.Make();
    arrow.moveTo(ex, ey);
    arrow.lineTo(bcx + px * ARROW_HALF, bcy + py * ARROW_HALF);
    arrow.lineTo(bcx - px * ARROW_HALF, bcy - py * ARROW_HALF);
    arrow.close();
    fill.setColor(teamColor);
    canvas.drawPath(arrow, fill);
    stroke.setColor(C_ARROW_EDGE);
    stroke.setStrokeWidth(1.5);
    stroke.setStrokeJoin(StrokeJoin.Round);
    canvas.drawPath(arrow, stroke);
  }
};

export const recordArena = (r: ArenaRenderInput): SkPicture =>
  createPicture((canvas) => {
    const { view, config, myId, spectateId, screenW, screenH } = r;

    // The camera aims at the SAFE viewport — the band between the top notch and
    // the bottom system tray — not the raw canvas. Baking against this rect
    // keeps the followed player in the visible middle and stops the world's
    // bottom edge at the tray, never under it (2026-07-16). The canvas still
    // fills edge to edge; the strip behind the tray is just C_VOID (= the app
    // background), so no seam shows.
    const padTop = r.insetTop ?? 0;
    const padBottom = r.insetBottom ?? 0;
    const viewW = screenW;
    const viewH = Math.max(1, screenH - padTop - padBottom);
    const vcx = viewW / 2;
    const vcy = padTop + viewH / 2;

    // Camera: follow yourself while alive, the spectated ally (or lingered-on
    // corpse) once you're down; the whole-bowl fit is the pure-spectator view.
    let zoom: number;
    let cx: number;
    let cy: number;
    const me =
      myId === null ? undefined : view.players.find((p) => p.id === myId);
    const follow =
      me && me.alive
        ? me
        : me && spectateId != null
          ? view.players.find((p) => p.id === spectateId)
          : undefined;
    if (follow) {
      zoom = FOLLOW_ZOOM;
      const halfW = viewW / 2 / zoom;
      const halfH = viewH / 2 / zoom;
      // Clamp is relaxed by CROWD_REVEAL past the sand edge, so fighting near a
      // wall slides a band of the pit crowd into frame instead of hard void.
      cx = Math.min(
        Math.max(follow.x, halfW - CROWD_REVEAL),
        WORLD_W - halfW + CROWD_REVEAL,
      );
      cy = Math.min(
        Math.max(follow.y, halfH - CROWD_REVEAL),
        WORLD_H - halfH + CROWD_REVEAL,
      );
      // A viewport axis larger than the world: just centre it.
      if (halfW * 2 >= WORLD_W) cx = WORLD_W / 2;
      if (halfH * 2 >= WORLD_H) cy = WORLD_H / 2;
    } else {
      // Spectators fit the whole bowl — sand PLUS the revealed crowd band.
      zoom = Math.min(
        viewW / (WORLD_W + CROWD_REVEAL * 2),
        viewH / (WORLD_H + CROWD_REVEAL * 2),
      );
      cx = WORLD_W / 2;
      cy = WORLD_H / 2;
    }

    fill.setColor(C_VOID);
    canvas.drawRect(Skia.XYWHRect(0, 0, screenW, screenH), fill);

    canvas.save();
    canvas.translate(vcx - cx * zoom, vcy - cy * zoom);
    canvas.scale(zoom, zoom);

    // Floor: the baked world image when the atlas is ready, else the flat sand
    // with a darker rim (the pre-tileset look, kept as the loading/fallback).
    // Linear filtering — the bake is already at world resolution, so this is a
    // smooth downscale under the camera zoom, no nearest-neighbour shimmer.
    const floor = r.atlas ? floorImage(r.atlas) : null;
    if (floor) {
      canvas.drawImageRectOptions(
        floor,
        FLOOR_RECT,
        FLOOR_RECT,
        FilterMode.Linear,
        MipmapMode.None,
        fill,
      );
    } else {
      fill.setColor(C_FLOOR_EDGE);
      canvas.drawRect(Skia.XYWHRect(0, 0, WORLD_W, WORLD_H), fill);
      fill.setColor(C_FLOOR);
      canvas.drawRect(Skia.XYWHRect(12, 12, WORLD_W - 24, WORLD_H - 24), fill);
    }

    // The pit crowd, in the void beyond the sand. LOD is picked from the zoom
    // inside CROWD.draw: the live culled mob down in the pit, a single baked
    // still when a spectator fits the whole bowl. The mob does NOT react to
    // kills — the crowd-roar SFX carries that (a bodily lurch read badly).
    CROWD.draw(
      canvas,
      cx - vcx / zoom,
      cy - vcy / zoom,
      cx + (screenW - vcx) / zoom,
      cy + (screenH - vcy) / zoom,
      r.nowMs,
      zoom,
    );

    // Ground scars: the cached world-space picture (splat bake under live wet
    // blood), rebuilt on scarLayer's slow beat — one replayed op per frame.
    canvas.drawPicture(scarLayer(r.blood, r.cracks, r.scarEpoch, r.nowMs));
    // Live quake webs ride per frame (expanding reveal), outside the cache.
    drawLiveCracks(canvas, r.cracks.decals, r.nowMs);

    // Walls (Aabbs are centre + full size). ZONE.walls, not .collision — the
    // collision list also folds in prop footprints, which are hidden geometry:
    // the prop sprite is their visual (docs/design/tilesets.md).
    for (const w of ZONE.walls) {
      fill.setColor(C_WALL);
      canvas.drawRect(
        Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 + 6, w.w, w.h),
        fill,
      );
      fill.setColor(C_WALL_TOP);
      canvas.drawRect(
        Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 - 6, w.w, w.h),
        fill,
      );
    }

    if (me) drawMyRangeRing(canvas, me, config.playerRadius);

    // Placed things + moving auras: zones under bodies, over blood decals.
    // Spectators (no seat) get the enemy-faint sandtrap view of BOTH teams.
    drawDeployables(canvas, view.deployables, me?.team ?? 0, r.nowMs);
    drawDrumAuras(canvas, view.players, r.nowMs);

    // Bodies and props in one painter's pass, ordered by baseline (feet) y — a
    // player north of a cactus draws under it (walks behind); south, over it.
    // PROPS_SORTED is static so only the handful of players sort per frame.
    const byFeet = [...view.players].sort((a, b) => a.y - b.y);
    let pi = 0;
    for (const prop of PROPS_SORTED) {
      while (
        pi < byFeet.length &&
        byFeet[pi]!.y + config.playerRadius <= prop.y
      ) {
        drawPlayer(canvas, byFeet[pi]!, config, me?.team ?? 0, r.pulses, r.nowMs);
        pi++;
      }
      if (r.atlas) {
        // Anyone drawn behind this sprite → ease toward see-through; else back
        // to solid. Eased per rendered frame (~60Hz), so ~0.25 reaches the
        // target in a few frames without popping.
        const covered = view.players.some((p) =>
          hiddenBehind(prop, p, config.playerRadius),
        );
        const target = covered ? FADE_ALPHA : 1;
        prop.fade += (target - prop.fade) * FADE_RATE;
        if (Math.abs(prop.fade - target) < 0.01) prop.fade = target;
        propPaint.setAlphaf(prop.fade);
        canvas.drawImageRectOptions(
          r.atlas,
          prop.src,
          prop.dst,
          FilterMode.Nearest,
          MipmapMode.None,
          propPaint,
        );
      }
    }
    for (; pi < byFeet.length; pi++)
      drawPlayer(canvas, byFeet[pi]!, config, me?.team ?? 0, r.pulses, r.nowMs);

    drawProjectiles(canvas, view.projectiles);
    drawReelChains(canvas, view.players);
    drawFlyingBlood(canvas, r.blood.flying, r.nowMs);
    // The storm's swirling body sits OVER bodies and shots — it obscures.
    drawSandstormOverlays(canvas, view.deployables, r.nowMs);
    drawFx(canvas, r.fx, r.abilityIcons);

    canvas.restore();

    // Screen-space overlay (camera popped): pointers to off-screen allies,
    // pinned to the safe-viewport edge. Only when following a player — a
    // spectator fitting the whole bowl has everyone in frame already.
    if (me) {
      drawOffscreenAllies(
        canvas,
        view.players,
        me,
        cx,
        cy,
        zoom,
        vcx,
        vcy,
        ARROW_MARGIN,
        screenW - ARROW_MARGIN,
        padTop + ARROW_MARGIN,
        screenH - padBottom - ARROW_MARGIN,
      );
    }
  });

export const EMPTY_ARENA_PICTURE: SkPicture = createPicture(() => {});
