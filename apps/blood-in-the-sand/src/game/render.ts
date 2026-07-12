/**
 * The arena scene, recorded into ONE SkPicture per rendered frame with the
 * camera baked in (the gauntlet's single-picture rule — one update path, no
 * inter-layer jitter). Flat-shaded M1 art: sand floor, stone walls, team-
 * coloured discs, windup telegraph wedges, hp bars, and event-driven FX.
 */
import { Platform } from "react-native";
import {
  createPicture,
  matchFont,
  PaintStyle,
  Skia,
  StrokeCap,
  type SkCanvas,
  type SkPicture,
} from "@shopify/react-native-skia";
import { loadZone } from "@heroic/core";
import {
  ARENA_00,
  WEAPONS,
  type ArenaClientConfig,
  type InterpolatedView,
  type PlayerSnapshot,
  type ProjectileSnapshot,
} from "@heroic/blood-in-the-sand-sim";
import { decalAlpha, type BloodDecal } from "./blood";

// Zone geometry is static — derive once at module scope (loadZone is pure).
const ZONE = loadZone(ARENA_00);
const WORLD_W = ZONE.size.x;
const WORLD_H = ZONE.size.y;

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
const C_SLOWED = Skia.Color("#e8c14e");

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

/** A transient visual: damage numbers and hit rings, aged by the caller. */
export interface FxItem {
  kind: "number" | "ring";
  x: number;
  y: number;
  /** 1 → 0 over the effect's life. */
  life: number;
  text?: string;
  crit?: boolean;
  /** Bleed-tick numbers render red (and the caller skips the ring). */
  bleed?: boolean;
}

const C_FX_NUM = Skia.Color("#ffffff");
const C_FX_CRIT = Skia.Color("#f2c14e");
// matchFont NEEDS an explicit family: with none, Android resolves a null
// typeface and drawText silently draws nothing (iOS falls back to the system
// font, which is how this hid). Same fix as the gauntlet's renderCombat.
const FX_FONT_FAMILY = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const FX_FONT = matchFont({ fontFamily: FX_FONT_FAMILY, fontSize: 26, fontWeight: "bold" });
const FX_FONT_CRIT = matchFont({ fontFamily: FX_FONT_FAMILY, fontSize: 34, fontWeight: "bold" });

export interface ArenaRenderInput {
  view: InterpolatedView;
  config: ArenaClientConfig;
  /** Our slot — the camera follows them; null = spectator (fit the arena). */
  myId: number | null;
  screenW: number;
  screenH: number;
  fx: readonly FxItem[];
  /** Blood decals (birth-ordered), faded per-frame via decalAlpha. */
  blood: readonly BloodDecal[];
  /** The clock the decals were aged against (performance.now). */
  nowMs: number;
}

/** Floor blood, culled to the camera rect (translucent overlaps darken into pools).
 * Round drops are circles; smear decals (dx/dy set) are round-capped streaks. */
const drawBlood = (
  canvas: SkCanvas,
  blood: readonly BloodDecal[],
  nowMs: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void => {
  fill.setColor(C_BLOOD);
  stroke.setColor(C_BLOOD);
  stroke.setStrokeCap(StrokeCap.Round);
  for (const d of blood) {
    const reach = d.r + Math.max(Math.abs(d.dx ?? 0), Math.abs(d.dy ?? 0));
    if (d.x + reach < left || d.x - reach > right || d.y + reach < top || d.y - reach > bottom) continue;
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

const drawPlayer = (canvas: SkCanvas, p: PlayerSnapshot, config: ArenaClientConfig): void => {
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

  // Hammer slow: a gold shackle ring so both sides can read the debuff.
  if (p.alive && p.slowed) {
    stroke.setColor(C_SLOWED);
    stroke.setStrokeWidth(3);
    canvas.drawCircle(p.x, p.y, r + 4, stroke);
  }

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

const drawFx = (canvas: SkCanvas, fx: readonly FxItem[]): void => {
  for (const f of fx) {
    if (f.kind === "ring") {
      stroke.setColor(C_DASH_RING);
      stroke.setStrokeWidth(2 + 2 * f.life);
      canvas.drawCircle(f.x, f.y, 20 + (1 - f.life) * 26, stroke);
    } else if (f.text) {
      const font = f.crit ? FX_FONT_CRIT : FX_FONT;
      const rise = (1 - f.life) * 34;
      fill.setColor(f.crit ? C_FX_CRIT : f.bleed ? C_FX_BLEED : C_FX_NUM);
      fill.setAlphaf(Math.min(1, f.life * 2));
      canvas.drawText(f.text, f.x - font.getTextWidth(f.text) / 2, f.y - 26 - rise, fill, font);
      fill.setAlphaf(1);
    }
  }
};

/** Live shots: bow = a short bolt along its travel line; staff = a seeking orb. */
const drawProjectiles = (canvas: SkCanvas, projectiles: readonly ProjectileSnapshot[]): void => {
  for (const p of projectiles) {
    if (p.weapon === "staff") {
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

    // Camera: follow our player; spectators get the whole arena fitted.
    let zoom: number;
    let cx: number;
    let cy: number;
    const me = myId === null ? undefined : view.players.find((p) => p.id === myId);
    if (me) {
      zoom = FOLLOW_ZOOM;
      const halfW = screenW / 2 / zoom;
      const halfH = screenH / 2 / zoom;
      cx = Math.min(Math.max(me.x, halfW), WORLD_W - halfW);
      cy = Math.min(Math.max(me.y, halfH), WORLD_H - halfH);
      // A viewport axis larger than the world: just centre it.
      if (halfW * 2 >= WORLD_W) cx = WORLD_W / 2;
      if (halfH * 2 >= WORLD_H) cy = WORLD_H / 2;
    } else {
      zoom = Math.min(screenW / WORLD_W, screenH / WORLD_H);
      cx = WORLD_W / 2;
      cy = WORLD_H / 2;
    }

    fill.setColor(C_VOID);
    canvas.drawRect(Skia.XYWHRect(0, 0, screenW, screenH), fill);

    canvas.save();
    canvas.translate(screenW / 2 - cx * zoom, screenH / 2 - cy * zoom);
    canvas.scale(zoom, zoom);

    // Floor with a darker rim so the arena edge reads.
    fill.setColor(C_FLOOR_EDGE);
    canvas.drawRect(Skia.XYWHRect(0, 0, WORLD_W, WORLD_H), fill);
    fill.setColor(C_FLOOR);
    canvas.drawRect(Skia.XYWHRect(12, 12, WORLD_W - 24, WORLD_H - 24), fill);

    // Blood sits on the floor, under walls and bodies.
    const halfW = screenW / 2 / zoom;
    const halfH = screenH / 2 / zoom;
    drawBlood(canvas, r.blood, r.nowMs, cx - halfW, cy - halfH, cx + halfW, cy + halfH);

    // Walls (Aabbs are centre + full size).
    for (const w of ZONE.collision) {
      fill.setColor(C_WALL);
      canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 + 6, w.w, w.h), fill);
      fill.setColor(C_WALL_TOP);
      canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2 - 6, w.w, w.h), fill);
    }

    if (me) drawMyRangeRing(canvas, me, config.playerRadius);
    for (const p of view.players) drawPlayer(canvas, p, config);
    drawProjectiles(canvas, view.projectiles);
    drawFx(canvas, r.fx);

    canvas.restore();
  });

export const EMPTY_ARENA_PICTURE: SkPicture = createPicture(() => {});
