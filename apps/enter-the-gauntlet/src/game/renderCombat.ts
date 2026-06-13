import { Platform } from "react-native";
import { createPicture, matchFont, PaintStyle, Skia, type SkPicture } from "@shopify/react-native-skia";
import {
  ARENA_SIZE,
  ARENA_TILES,
  COLORS,
  ENEMY_RADIUS,
  PLAYER_RADIUS,
  TILE_SIZE,
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
}

const fontFamily = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const damageFont = matchFont({ fontFamily, fontSize: 15, fontWeight: "bold" });
const critFont = matchFont({ fontFamily, fontSize: 19, fontWeight: "bold" });

// Paints are reused across recordings; each draw sets color/alpha before use.
const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;

/** Static checkerboard: the dark squares laid over the light arena floor. */
const DARK_TILES: { x: number; y: number }[] = (() => {
  const tiles: { x: number; y: number }[] = [];
  for (let row = 0; row < ARENA_TILES; row++) {
    for (let col = 0; col < ARENA_TILES; col++) {
      if ((row + col) % 2 === 1) tiles.push({ x: col * TILE_SIZE, y: row * TILE_SIZE });
    }
  }
  return tiles;
})();

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

    // --- Arena: light floor, dark checkerboard, walls.
    fill.setColor(Skia.Color(COLORS.tileLight));
    fill.setAlphaf(1);
    canvas.drawRect(Skia.XYWHRect(0, 0, ARENA_SIZE, ARENA_SIZE), fill);
    fill.setColor(Skia.Color(COLORS.tileDark));
    for (const t of DARK_TILES) canvas.drawRect(Skia.XYWHRect(t.x, t.y, TILE_SIZE, TILE_SIZE), fill);
    fill.setColor(Skia.Color(COLORS.wall));
    for (const w of WALLS) canvas.drawRect(Skia.XYWHRect(w.x - w.w / 2, w.y - w.h / 2, w.w, w.h), fill);

    // An enemy is hittable when its *edge* is within reach, i.e. its centre is
    // within reach + ENEMY_RADIUS — draw rings/wedges at that radius so the
    // visuals match the actual gate.
    const hitRadius = cfg.reach + ENEMY_RADIUS;

    // Attack-range ring — barely-there tuning aid.
    stroke.setColor(Skia.Color(COLORS.rangeRing));
    stroke.setAlphaf(0.07);
    stroke.setStrokeWidth(1);
    canvas.drawCircle(player.x, player.y, hitRadius, stroke);

    // Selection ring under the current target.
    const target = scene.enemies.find((d) => d.id === scene.targetId);
    if (target) {
      stroke.setColor(Skia.Color(COLORS.targetRing));
      stroke.setAlphaf(0.85);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(target.x, target.y, ENEMY_RADIUS + 5, stroke);
    }

    // Enemies: body (type-coloured), hit flash, HP bar.
    for (const d of scene.enemies) {
      fill.setColor(Skia.Color(d.color));
      fill.setAlphaf(1);
      canvas.drawCircle(d.x, d.y, ENEMY_RADIUS, fill);
      if (d.flash > 0) {
        fill.setColor(Skia.Color("#ffffff"));
        fill.setAlphaf(d.flash * 0.8);
        canvas.drawCircle(d.x, d.y, ENEMY_RADIUS, fill);
      }

      const barX = d.x - HP_BAR_WIDTH / 2;
      const barY = d.y - ENEMY_RADIUS - 10;
      fill.setColor(Skia.Color(COLORS.hpBarBack));
      fill.setAlphaf(0.9);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT), fill);
      fill.setColor(Skia.Color(COLORS.hpBarFill));
      fill.setAlphaf(1);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH * d.hpFrac, HP_BAR_HEIGHT), fill);
    }

    // Player HP bar + a red wash while the post-hit i-frames tick down.
    {
      const barX = player.x - HP_BAR_WIDTH / 2;
      const barY = player.y - PLAYER_RADIUS - 12;
      fill.setColor(Skia.Color(COLORS.hpBarBack));
      fill.setAlphaf(0.9);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT), fill);
      fill.setColor(Skia.Color(COLORS.hpBarFill));
      fill.setAlphaf(1);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH * scene.player.hpFrac, HP_BAR_HEIGHT), fill);
      if (scene.player.hurt > 0) {
        stroke.setColor(Skia.Color(COLORS.playerHurt));
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
        fill.setColor(Skia.Color(COLORS.windup));
        fill.setAlphaf(0.05 + 0.12 * w.progress);
        canvas.drawPath(wedge, fill);
        stroke.setColor(Skia.Color(COLORS.windup));
        stroke.setAlphaf(0.15 + 0.4 * w.progress);
        stroke.setStrokeWidth(1.5);
        canvas.drawPath(wedge, stroke);
      } else {
        stroke.setColor(Skia.Color(weapon.color));
        stroke.setAlphaf(0.1 + 0.3 * w.progress);
        stroke.setStrokeWidth(1.5);
        canvas.drawLine(player.x, player.y, w.targetX, w.targetY, stroke);
        // A charge dot growing at the player's edge along the aim line.
        const aim = Math.atan2(w.targetY - player.y, w.targetX - player.x);
        fill.setColor(Skia.Color(weapon.color));
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
        fill.setColor(Skia.Color(weapon.color));
        fill.setAlphaf(0.45 * f.fade);
        canvas.drawPath(wedgePath(f.x, f.y, hitRadius, f.facing, cfg.arcWidth), fill);
      }
    }

    // Enemy windup telegraphs: an aim line to the player + a charge dot growing
    // at the caster's edge. The whole point of a ranged enemy is that you can
    // see the shot coming and dodge it (combat.md: the windup IS the telegraph).
    for (const cast of scene.enemyCasts) {
      stroke.setColor(Skia.Color(cast.color));
      stroke.setAlphaf(0.12 + 0.4 * cast.progress);
      stroke.setStrokeWidth(1.5);
      canvas.drawLine(cast.x, cast.y, cast.targetX, cast.targetY, stroke);
      const aim = Math.atan2(cast.targetY - cast.y, cast.targetX - cast.x);
      fill.setColor(Skia.Color(cast.color));
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
      stroke.setColor(Skia.Color(s.color));
      stroke.setAlphaf(0.15 + 0.5 * s.progress);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(s.x, s.y, ENEMY_RADIUS + 4 + 34 * s.progress, stroke);
    }

    // Projectiles with a short trail (player shots and enemy shots alike).
    for (const p of scene.projectiles) {
      fill.setColor(Skia.Color(p.color));
      fill.setAlphaf(0.35);
      canvas.drawCircle(p.x - p.dirX * 9, p.y - p.dirY * 9, p.radius * 0.6, fill);
      fill.setAlphaf(1);
      canvas.drawCircle(p.x, p.y, p.radius, fill);
    }

    // Floating damage numbers; crits are bigger and gold, damage taken is red.
    for (const n of scene.numbers) {
      const font = n.crit ? critFont : damageFont;
      const width = font.measureText(n.text).width;
      fill.setColor(Skia.Color(n.crit ? COLORS.critText : n.hostile ? COLORS.hurtText : COLORS.damageText));
      fill.setAlphaf(Math.max(0, n.fade));
      canvas.drawText(n.text, n.x - width / 2, n.y, fill, font);
    }

    // Player body + facing notch, drawn last so it sits on top of the field.
    fill.setColor(Skia.Color(COLORS.player));
    fill.setAlphaf(1);
    canvas.drawCircle(player.x, player.y, PLAYER_RADIUS, fill);
    canvas.save();
    canvas.translate(player.x, player.y);
    canvas.rotate((player.facing * 180) / Math.PI, 0, 0);
    fill.setColor(Skia.Color(COLORS.playerNotch));
    canvas.drawPath(NOTCH, fill);
    canvas.restore();

    canvas.restore();
  });
