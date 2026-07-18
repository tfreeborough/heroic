/**
 * The arena scene, recorded into ONE SkPicture per rendered frame with the
 * camera baked in (the gauntlet's single-picture rule — one update path, no
 * inter-layer jitter). Flat-shaded M1 art: sand floor, stone walls, team-
 * coloured discs, windup telegraph wedges, hp bars, and event-driven FX.
 */
import { Platform } from "react-native";
import {
  createPicture,
  FilterMode,
  matchFont,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkImage,
  type SkPicture,
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
import { decalAlpha, type BloodDecal } from "./blood";
import { crackAlpha, type CrackDecal } from "./cracks";
import type { StatusPulses } from "./statusRings";

// Zone geometry is static — derive once at module scope (loadZone is pure).
const ZONE = loadZone(ARENA_00);
const WORLD_W = ZONE.size.x;
const WORLD_H = ZONE.size.y;
const TILESET = TILESETS[ZONE.tileset];

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
 * 0.85 (2026-07-12, tester feedback): the old zoom hid approaching enemies. */
const FOLLOW_ZOOM = 0.6;

// Palette parsed once (never re-string rgba per frame — floods the colour cache).
const C_VOID = Skia.Color("#141210");
const C_FLOOR = Skia.Color("#b39763");
const C_FLOOR_EDGE = Skia.Color("#8a744c");
const C_WALL = Skia.Color("#4a3b2b");
const C_WALL_TOP = Skia.Color("#5d4c38");
const C_TEAM1 = Skia.Color("#d94141");
const C_TEAM2 = Skia.Color("#4d7fd9");
const C_DEAD = Skia.Color("rgba(90, 84, 76, 0.55)");
const C_FACING = Skia.Color("rgba(255, 255, 255, 0.9)");
const C_TELEGRAPH = Skia.Color("#ff4a3d");
const C_HP_BACK = Skia.Color("rgba(0, 0, 0, 0.55)");
const C_HP_FILL = Skia.Color("#5fc75f");
const C_HP_LOW = Skia.Color("#e0503c");
const C_DASH_RING = Skia.Color("rgba(255, 255, 255, 0.85)");
const C_BLOOD = Skia.Color("#6e150e");
const C_BOLT = Skia.Color("#f0e8d8");
const C_STAFF_ORB = Skia.Color("#9b6dd9");
const C_STAFF_RING = Skia.Color("rgba(155, 109, 217, 0.45)");
const C_FX_BLEED = Skia.Color("#e0503c");
const C_RANGE_RING = Skia.Color("#f0e8d8");
// Status rings: pulse rate carries the "expiring soon" signal (statusRings.ts).
const C_RING_SLOW = Skia.Color("#4da3d9");
const C_RING_BLEED = Skia.Color("#e0503c");
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

const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

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
    const drawLayer = (layer: Uint16Array | null, floorFallback: boolean): void => {
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
  kind: "number" | "ring" | "line" | "castFlash" | "cone";
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
const FX_FONT_FAMILY = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const FX_FONT = matchFont({ fontFamily: FX_FONT_FAMILY, fontSize: 26, fontWeight: "bold" });
const FX_FONT_CRIT = matchFont({ fontFamily: FX_FONT_FAMILY, fontSize: 34, fontWeight: "bold" });
const NAME_FONT = matchFont({ fontFamily: FX_FONT_FAMILY, fontSize: 12, fontWeight: "600" });

export interface ArenaRenderInput {
  view: InterpolatedView;
  config: ArenaClientConfig;
  /** Our slot — the camera follows them; null = spectator (fit the arena). */
  myId: number | null;
  screenW: number;
  screenH: number;
  /** Safe-area padding: the OS notch (top) and home-indicator / system tray
   *  (bottom). The camera aims at the band between them so the followed player
   *  never sits under the tray; the canvas still fills edge to edge. */
  insetTop?: number;
  insetBottom?: number;
  fx: readonly FxItem[];
  /** Blood decals (birth-ordered), drawn via the ~5Hz cached scar layer. */
  blood: readonly BloodDecal[];
  /** Tremor's cracked-earth decals — same client-derived floor-layer rule. */
  cracks: readonly CrackDecal[];
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

/** Floor blood (translucent overlaps darken into pools). Round drops are
 * circles; smear decals (dx/dy set) are round-capped streaks. Recorded into
 * the cached scar picture, not per frame — no viewport cull here (the cache is
 * camera-independent; raster quick-rejects offscreen ops by bounds). */
const drawBlood = (canvas: SkCanvas, blood: readonly BloodDecal[], nowMs: number): void => {
  fill.setColor(C_BLOOD);
  stroke.setColor(C_BLOOD);
  stroke.setStrokeCap(StrokeCap.Round);
  for (const d of blood) {
    const a = decalAlpha(d, nowMs);
    if (a <= 0) continue;
    if (d.dx !== undefined && d.dy !== undefined) {
      stroke.setAlphaf(a);
      stroke.setStrokeWidth(d.r * 2);
      canvas.drawLine(d.x, d.y, d.x + d.dx, d.y + d.dy, stroke);
    } else {
      fill.setAlphaf(a);
      canvas.drawCircle(d.x, d.y, d.r, fill);
    }
  }
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

/**
 * A faint dashed circle at YOUR OWN strike range — get an enemy inside it and
 * your weapon can reach them. Only your own ring draws (2026-07-12, tester
 * feedback): enemy rings gave away their spacing for free; now reading an
 * opponent's reach is a skill. Pure client derivation from snapshot data.
 */
const drawMyRangeRing = (canvas: SkCanvas, me: PlayerSnapshot, playerRadius: number): void => {
  if (!me.alive) return;
  // reach is measured to the victim's rim, so the strike circle extends one
  // body radius past it (matching hitsInArc's rule).
  const ring = WEAPONS[me.weapon ?? "blade"].attack.reach + playerRadius;
  rangeStroke.setAlphaf(RANGE_RING_ALPHA);
  canvas.drawCircle(me.x, me.y, ring, rangeStroke);
};

const drawPlayer = (
  canvas: SkCanvas,
  p: PlayerSnapshot,
  config: ArenaClientConfig,
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

  // Body disc (grey ghost when down).
  fill.setColor(p.alive ? (p.team === 1 ? C_TEAM1 : C_TEAM2) : C_DEAD);
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
          Skia.XYWHRect(p.x - shieldR - 2, p.y - shieldR - 2, (shieldR + 2) * 2, (shieldR + 2) * 2),
          spin + i * 120,
          55,
        );
        canvas.drawPath(arc, stroke);
      }
      fill.setAlphaf(1);
      stroke.setAlphaf(1);
    }
  }

  // Status rings, concentric (inner → outer): slow · bleed · ability — the
  // pvp-abilities.md ring order, so stacked states stay legible. Brightness
  // pulses at the clock's rate — quickening toward expiry is the "about to
  // drop" tell (see statusRings.ts).
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
    // Body-effect ring: Mirror Guard, one radius step further out. (Ironhide
    // draws its shield dome above instead of a ring.)
    const mirror = pulses.strength(p.id, "mirror-guard");
    if (mirror > 0) {
      stroke.setColor(C_RING_MIRROR);
      stroke.setAlphaf(0.3 + 0.55 * mirror);
      stroke.setStrokeWidth(2.5);
      canvas.drawCircle(p.x, p.y, r + 14, stroke);
    }
    stroke.setAlphaf(1);
  }

  // Name tag, small under the body — who is who (dead stay labelled, dimmer).
  fill.setColor(C_NAME);
  fill.setAlphaf(p.alive ? 0.7 : 0.35);
  canvas.drawText(p.name, p.x - NAME_FONT.getTextWidth(p.name) / 2, p.y + r + 16, fill, NAME_FONT);
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
    } else if (f.kind === "cone" && f.angle !== undefined) {
      // Warding Shout: the bellow made visible — a wedge blasting out to the
      // shout's TRUE range (the honest-telegraph rule) then gone in a blink.
      const reach = 30 + (1 - f.life * f.life) * (WARDING_SHOUT.range - 30);
      const halfDeg = (WARDING_SHOUT.halfAngle * 180) / Math.PI;
      const startDeg = (f.angle * 180) / Math.PI - halfDeg;
      const wedge = Skia.Path.Make();
      wedge.moveTo(f.x, f.y);
      wedge.arcToOval(Skia.XYWHRect(f.x - reach, f.y - reach, reach * 2, reach * 2), startDeg, halfDeg * 2, false);
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
      fill.setColor(f.crit ? C_FX_CRIT : f.bleed ? C_FX_BLEED : f.heal ? C_FX_HEAL : C_FX_NUM);
      fill.setAlphaf(Math.min(1, f.life * 2));
      canvas.drawText(f.text, f.x - font.getTextWidth(f.text) / 2, f.y - 26 - rise, fill, font);
      fill.setAlphaf(1);
    }
  }
};

/** Fade a placed thing out over its last half-second. */
const deployAlpha = (d: DeployableSnapshot): number => Math.min(1, d.lifeLeft / 0.5);

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
      canvas.drawCircle(d.x, d.y, BLOOD_FONT.radius * (0.55 + 0.3 * beat), stroke);
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
      // the crack pops (GameScreen spawns them; they draw in the floor pass).
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
      canvas.drawCircle(d.x, d.y, TREMOR.radius * (0.6 + 0.02 * shudder), stroke);
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
      // Straw man: a body-coloured stand-in with its own little hp bar.
      fill.setColor(C_DUMMY);
      fill.setAlphaf(a);
      canvas.drawCircle(d.x, d.y, 18, fill);
      stroke.setColor(C_DUMMY_DARK);
      stroke.setAlphaf(a);
      stroke.setStrokeWidth(2.5);
      stroke.setStrokeCap(StrokeCap.Round);
      canvas.drawLine(d.x - 7, d.y - 7, d.x + 7, d.y + 7, stroke);
      canvas.drawLine(d.x + 7, d.y - 7, d.x - 7, d.y + 7, stroke);
      const w = 32;
      const frac = Math.max(0, d.hp / STRAW_MAN.hp);
      fill.setColor(C_HP_BACK);
      canvas.drawRect(Skia.XYWHRect(d.x - w / 2 - 1, d.y - 33, w + 2, 6), fill);
      fill.setColor(frac > 0.35 ? C_HP_FILL : C_HP_LOW);
      canvas.drawRect(Skia.XYWHRect(d.x - w / 2, d.y - 32, w * frac, 4), fill);
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
      arc.addArc(Skia.XYWHRect(d.x - radius, d.y - radius, radius * 2, radius * 2), start % 360, sweep);
      canvas.drawPath(arc, stroke);
    }
  }
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

/** Tremor's cracked earth — floor-layer decals under the blood (fresh blood
 * pools over old fractures). One prebuilt SkPath per crack (built at spawn in
 * cracks.ts), one drawPath here — per-frame path construction was what made
 * a quake's 128 live cracks cost ~10ms of record time. */
const drawCracks = (canvas: SkCanvas, cracks: readonly CrackDecal[], nowMs: number): void => {
  stroke.setColor(C_CRACK);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  stroke.setStrokeWidth(2.5);
  for (const c of cracks) {
    const a = crackAlpha(c, nowMs);
    if (a <= 0) continue;
    stroke.setAlphaf(0.55 * a);
    canvas.drawPath(c.path, stroke);
  }
  stroke.setAlphaf(1);
};

/**
 * The floor-scar layer — cracks then blood (fresh pools cover old fractures)
 * — cached as ONE world-space SkPicture and rebuilt on a slow beat instead of
 * per rendered frame. The scars fade over 20–100 SECONDS, so re-recording
 * hundreds of decals at 60Hz bought nothing: stepping their alphas at ~5Hz is
 * imperceptible, and a new decal appearing ≤200ms late lands behind the cast
 * stomp / hit FX that mask it. Per-frame cost collapses to one drawPicture
 * call; the camera transform applies at replay, so the cache never invalidates
 * on camera movement.
 */
const SCAR_REBUILD_MS = 200;
let scarPicture: SkPicture | null = null;
let scarBuiltMs = -Infinity;
const scarLayer = (
  blood: readonly BloodDecal[],
  cracks: readonly CrackDecal[],
  nowMs: number,
): SkPicture => {
  if (scarPicture && nowMs - scarBuiltMs < SCAR_REBUILD_MS) return scarPicture;
  scarBuiltMs = nowMs;
  scarPicture = createPicture((canvas) => {
    drawCracks(canvas, cracks, nowMs);
    drawBlood(canvas, blood, nowMs);
  }, FLOOR_RECT);
  return scarPicture;
};

/** Live harpoon chains — taut from each rooted puller to whoever they're
 * hauling in, redrawn from lerped positions every frame so the drag reads as
 * one continuous "against their will" pull. */
const drawReelChains = (canvas: SkCanvas, players: readonly PlayerSnapshot[]): void => {
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
      canvas.drawCircle(p.x + (dx * i) / links, p.y + (dy * i) / links, 1.8, fill);
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
const drawDrumAuras = (canvas: SkCanvas, players: readonly PlayerSnapshot[], nowMs: number): void => {
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
      canvas.drawCircle(p.x, p.y, SIM_PLAYER_RADIUS + beat * (WAR_DRUMS.radius - SIM_PLAYER_RADIUS), stroke);
    }
  }
  fill.setAlphaf(1);
  stroke.setAlphaf(1);
};

/** Live shots: bow = a short bolt along its travel line; staff = a seeking
 * orb. (The harpoon is an instant chain — it draws as a line FX, not here.) */
const drawProjectiles = (canvas: SkCanvas, projectiles: readonly ProjectileSnapshot[]): void => {
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

export const recordArena = (r: ArenaRenderInput): SkPicture =>
  createPicture((canvas) => {
    const { view, config, myId, screenW, screenH } = r;

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

    // Camera: follow our player; spectators get the whole arena fitted.
    let zoom: number;
    let cx: number;
    let cy: number;
    const me = myId === null ? undefined : view.players.find((p) => p.id === myId);
    if (me) {
      zoom = FOLLOW_ZOOM;
      const halfW = viewW / 2 / zoom;
      const halfH = viewH / 2 / zoom;
      cx = Math.min(Math.max(me.x, halfW), WORLD_W - halfW);
      cy = Math.min(Math.max(me.y, halfH), WORLD_H - halfH);
      // A viewport axis larger than the world: just centre it.
      if (halfW * 2 >= WORLD_W) cx = WORLD_W / 2;
      if (halfH * 2 >= WORLD_H) cy = WORLD_H / 2;
    } else {
      zoom = Math.min(viewW / WORLD_W, viewH / WORLD_H);
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
      canvas.drawImageRectOptions(floor, FLOOR_RECT, FLOOR_RECT, FilterMode.Linear, MipmapMode.None, fill);
    } else {
      fill.setColor(C_FLOOR_EDGE);
      canvas.drawRect(Skia.XYWHRect(0, 0, WORLD_W, WORLD_H), fill);
      fill.setColor(C_FLOOR);
      canvas.drawRect(Skia.XYWHRect(12, 12, WORLD_W - 24, WORLD_H - 24), fill);
    }

    // Ground scars: the cached world-space picture (cracks under blood),
    // rebuilt at ~5Hz inside scarLayer — one replayed op per frame here.
    canvas.drawPicture(scarLayer(r.blood, r.cracks, r.nowMs));

    // Walls (Aabbs are centre + full size). ZONE.walls, not .collision — the
    // collision list also folds in prop footprints, which are hidden geometry:
    // the prop sprite is their visual (docs/design/tilesets.md).
    for (const w of ZONE.walls) {
      fill.setColor(C_WALL);
      canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 + 6, w.w, w.h), fill);
      fill.setColor(C_WALL_TOP);
      canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 - 6, w.w, w.h), fill);
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
      while (pi < byFeet.length && byFeet[pi]!.y + config.playerRadius <= prop.y) {
        drawPlayer(canvas, byFeet[pi]!, config, r.pulses, r.nowMs);
        pi++;
      }
      if (r.atlas) {
        // Anyone drawn behind this sprite → ease toward see-through; else back
        // to solid. Eased per rendered frame (~60Hz), so ~0.25 reaches the
        // target in a few frames without popping.
        const covered = view.players.some((p) => hiddenBehind(prop, p, config.playerRadius));
        const target = covered ? FADE_ALPHA : 1;
        prop.fade += (target - prop.fade) * FADE_RATE;
        if (Math.abs(prop.fade - target) < 0.01) prop.fade = target;
        propPaint.setAlphaf(prop.fade);
        canvas.drawImageRectOptions(r.atlas, prop.src, prop.dst, FilterMode.Nearest, MipmapMode.None, propPaint);
      }
    }
    for (; pi < byFeet.length; pi++) drawPlayer(canvas, byFeet[pi]!, config, r.pulses, r.nowMs);

    drawProjectiles(canvas, view.projectiles);
    drawReelChains(canvas, view.players);
    // The storm's swirling body sits OVER bodies and shots — it obscures.
    drawSandstormOverlays(canvas, view.deployables, r.nowMs);
    drawFx(canvas, r.fx, r.abilityIcons);

    canvas.restore();
  });

export const EMPTY_ARENA_PICTURE: SkPicture = createPicture(() => {});
