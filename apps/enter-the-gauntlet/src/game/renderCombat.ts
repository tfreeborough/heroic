import { Platform } from "react-native";
import { createPicture, matchFont, PaintStyle, Skia, type SkPicture } from "@shopify/react-native-skia";
import { COLORS, DUMMY_RADIUS, PLAYER_RADIUS } from "./constants";
import type { WeaponDef } from "./weapons";

/**
 * The dynamic combat layer — dummies, telegraphs, projectiles, damage
 * numbers — changes shape every frame (variable counts, transient effects),
 * so instead of declarative Skia elements it's recorded imperatively into an
 * SkPicture once per rendered frame and drawn through a single shared value.
 * All coordinates are world-space; the picture sits under the camera group.
 */
export interface CombatScene {
  player: { x: number; y: number };
  weapon: WeaponDef;
  /** Present only while winding up. `progress` runs 0 → 1 toward the strike. */
  windup: { progress: number; facing: number; targetX: number; targetY: number } | null;
  targetId: number | null;
  dummies: { id: number; x: number; y: number; hpFrac: number; flash: number }[];
  projectiles: { x: number; y: number; dirX: number; dirY: number; radius: number; color: string }[];
  /** `fade` runs 1 → 0 over each effect's lifetime. */
  numbers: { x: number; y: number; text: string; crit: boolean; fade: number }[];
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
    const { player, weapon } = scene;
    const cfg = weapon.config;
    // A dummy is hittable when its *edge* is within reach, i.e. its centre is
    // within reach + DUMMY_RADIUS — draw rings/wedges at that radius so the
    // visuals match the actual gate.
    const hitRadius = cfg.reach + DUMMY_RADIUS;

    // Attack-range ring — barely-there tuning aid.
    stroke.setColor(Skia.Color(COLORS.rangeRing));
    stroke.setAlphaf(0.07);
    stroke.setStrokeWidth(1);
    canvas.drawCircle(player.x, player.y, hitRadius, stroke);

    // Selection ring under the current target.
    const target = scene.dummies.find((d) => d.id === scene.targetId);
    if (target) {
      stroke.setColor(Skia.Color(COLORS.targetRing));
      stroke.setAlphaf(0.85);
      stroke.setStrokeWidth(2);
      canvas.drawCircle(target.x, target.y, DUMMY_RADIUS + 5, stroke);
    }

    // Dummies: body, hit flash, HP bar.
    for (const d of scene.dummies) {
      fill.setColor(Skia.Color(COLORS.dummy));
      fill.setAlphaf(1);
      canvas.drawCircle(d.x, d.y, DUMMY_RADIUS, fill);
      if (d.flash > 0) {
        fill.setColor(Skia.Color("#ffffff"));
        fill.setAlphaf(d.flash * 0.8);
        canvas.drawCircle(d.x, d.y, DUMMY_RADIUS, fill);
      }

      const barX = d.x - HP_BAR_WIDTH / 2;
      const barY = d.y - DUMMY_RADIUS - 10;
      fill.setColor(Skia.Color(COLORS.hpBarBack));
      fill.setAlphaf(0.9);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT), fill);
      fill.setColor(Skia.Color(COLORS.hpBarFill));
      fill.setAlphaf(1);
      canvas.drawRect(Skia.XYWHRect(barX, barY, HP_BAR_WIDTH * d.hpFrac, HP_BAR_HEIGHT), fill);
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

    // Projectiles with a short trail.
    for (const p of scene.projectiles) {
      fill.setColor(Skia.Color(p.color));
      fill.setAlphaf(0.35);
      canvas.drawCircle(p.x - p.dirX * 9, p.y - p.dirY * 9, p.radius * 0.6, fill);
      fill.setAlphaf(1);
      canvas.drawCircle(p.x, p.y, p.radius, fill);
    }

    // Floating damage numbers; crits are bigger and gold.
    for (const n of scene.numbers) {
      const font = n.crit ? critFont : damageFont;
      const width = font.measureText(n.text).width;
      fill.setColor(Skia.Color(n.crit ? COLORS.critText : COLORS.damageText));
      fill.setAlphaf(Math.max(0, n.fade));
      canvas.drawText(n.text, n.x - width / 2, n.y, fill, font);
    }
  });
