import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, type SharedValue } from "react-native-reanimated";
import {
  BlurStyle,
  Canvas,
  ClipOp,
  createPicture,
  matchFont,
  PaintStyle,
  Picture,
  Skia,
  TileMode,
  vec,
  type SkCanvas,
  type SkFont,
  type SkPicture,
} from "@shopify/react-native-skia";
import { UI } from "../ui/theme";
import { LOW_HP_THRESHOLD } from "./constants";

/**
 * The player plate: an ornate level badge with the health and XP bars running
 * from it along the bottom edge of the play area. Drawn as a single Skia
 * picture re-recorded each frame by the game loop (the dash-button pattern) —
 * health moves every step now that regen ticks, so the bar is driven straight
 * from the sim instead of through React state. All glides/flourishes are
 * animated here from real frame time:
 *   - health: gradient fill whose hue slides green → amber → red as it empties,
 *     a pale "ghost" trail that lingers at the pre-hit value then drains, hp
 *     numbers, and a red pulse rim while under the low-health threshold;
 *   - XP: gold gradient with a travelling shimmer and a glowing tip; a level-up
 *     plays fill-to-full → snap-empty → glide so the wrap reads as a completed
 *     bar, while the badge pops and rings a shockwave.
 */

export const PLAYER_HUD_HEIGHT = 50;

/** How long the level-up banner holds before the talent pick opens, ms. */
export const LEVEL_UP_BANNER_MS = 900;

// --- Layout inside the canvas (y down; the canvas is PLAYER_HUD_HEIGHT tall).
// Deliberately tight: play-area pixels are premium on a phone, so the plate
// condenses to just what the bars + badge need.
const BADGE_CX = 26;
const BADGE_CY = 25;
const BADGE_R = 17; // half-size of the rotated square (the diamond)
const PLATE_X = 34; // the backing plate tucks under the badge
const BARS_X = 58; // both bars start here, right of the badge
const BARS_PAD_RIGHT = 8;
const HP_Y = 11.5;
const HP_H = 16;
const XP_Y = 31.5;
const XP_H = 7;
// One small corner radius for BOTH bars: a full-pill health bar visually
// tapers ~h/2 px at each end, which reads as the bars having different widths.
const BAR_R = 4;

// --- Animation tuning.
const XP_WRAP_RATE = 3.2; // fill/s while playing the level-up wrap
const XP_GLIDE_RATE = 8; // exp approach rate toward the live xp fraction
const GHOST_HOLD = 0.45; // seconds the damage ghost lingers before draining
const GHOST_DRAIN = 4; // exp approach rate of the ghost toward current hp
const POP_DUR = 0.9; // badge pop + shockwave ring lifetime
const SHIMMER_PERIOD = 2.8; // seconds per shimmer sweep across the XP bar
const SHIMMER_W = 36; // px width of the shimmer band

// --- Palette, parsed once (this runs every frame).
const C_PLATE = Skia.Color("rgba(10, 13, 18, 0.5)");
const C_PLATE_EDGE = Skia.Color("rgba(255, 255, 255, 0.08)");
const C_TRACK = Skia.Color("rgba(13, 16, 23, 0.92)");
const C_TRACK_EDGE = Skia.Color("rgba(255, 255, 255, 0.16)");
const C_TICK = Skia.Color("rgba(6, 8, 12, 0.55)");
const C_GHOST = Skia.Color("rgba(255, 157, 138, 0.45)");
const C_GLOSS = Skia.Color("rgba(255, 255, 255, 0.15)");
const C_GOLD = Skia.Color(UI.accent);
const C_BADGE_FILL = Skia.Color("rgba(10, 12, 17, 0.95)");
const C_BADGE_INNER = Skia.Color("rgba(242, 193, 78, 0.35)");
const C_LOW_PULSE = Skia.Color("#e8503a");
const C_TEXT = Skia.Color("rgba(255, 255, 255, 0.92)");
const C_TEXT_REGEN = Skia.Color("rgba(166, 232, 171, 0.85)");
const C_TEXT_SHADOW = Skia.Color("rgba(0, 0, 0, 0.65)");
const C_WRAP_FLASH = Skia.Color("rgba(255, 244, 214, 0.45)");
const C_XP_TIP = Skia.Color("#ffe9a8");
// XP fill gradient stops (dark → gold → pale gold, fixed in bar space).
const XP_STOPS = [Skia.Color("#8a6a1c"), Skia.Color("#f2c14e"), Skia.Color("#ffe08a")];
const SHIMMER_STOPS = [
  Skia.Color("rgba(255, 255, 255, 0)"),
  Skia.Color("rgba(255, 255, 255, 0.4)"),
  Skia.Color("rgba(255, 255, 255, 0)"),
];

// Health gradient stops (top/mid/bottom) at three anchor healths; the live
// palette lerps between them so the bar slides green → amber → red as it
// empties instead of staying cheerfully green at 5%.
type Rgb = readonly [number, number, number];
const HP_GREEN: readonly Rgb[] = [[0.65, 0.91, 0.67], [0.44, 0.82, 0.47], [0.25, 0.58, 0.31]];
const HP_AMBER: readonly Rgb[] = [[1.0, 0.85, 0.48], [0.91, 0.66, 0.24], [0.66, 0.45, 0.12]];
const HP_RED: readonly Rgb[] = [[1.0, 0.54, 0.46], [0.88, 0.29, 0.23], [0.56, 0.14, 0.09]];

const mixRgb = (a: Rgb, b: Rgb, t: number): Float32Array =>
  Float32Array.of(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    1,
  );

/** The three gradient stops for the current health fraction. */
const hpStops = (frac: number): Float32Array[] => {
  if (frac >= 0.7) return HP_GREEN.map((c) => Float32Array.of(c[0], c[1], c[2], 1));
  if (frac >= 0.35) {
    const t = (frac - 0.35) / 0.35;
    return HP_AMBER.map((c, i) => mixRgb(c, HP_GREEN[i]!, t));
  }
  const t = frac / 0.35;
  return HP_RED.map((c, i) => mixRgb(c, HP_AMBER[i]!, t));
};

// System-font stand-ins so the plate never renders empty while the Grenze
// Gotisch faces load (the renderCombat fallback idiom).
const fontFamily = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const fallbackBadgeFont = matchFont({ fontFamily, fontSize: 22, fontWeight: "bold" });
const fallbackLabelFont = matchFont({ fontFamily, fontSize: 12, fontWeight: "bold" });

const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Draw `text` (plus an optional differently-colored `suffix`, e.g. the regen
 * bracket) with the whole line's glyph bounds centred on (cx, cy), drop-shadowed.
 * Vertical centring keys off the main text so the digits sit steady whatever
 * the suffix's ascenders do.
 */
const drawCenteredText = (
  canvas: SkCanvas,
  text: string,
  cx: number,
  cy: number,
  font: SkFont,
  color: Float32Array,
  suffix?: string,
  suffixColor?: Float32Array,
): void => {
  const b = font.measureText(text);
  const s = suffix ? font.measureText(suffix) : null;
  const gap = s ? 4 : 0;
  const total = b.width + (s ? s.width + gap : 0);
  const x = cx - b.x - total / 2;
  const y = cy - b.y - b.height / 2;
  const sx = x + b.width + gap;
  fill.setColor(C_TEXT_SHADOW);
  canvas.drawText(text, x, y + 1, fill, font);
  if (suffix) canvas.drawText(suffix, sx, y + 1, fill, font);
  fill.setColor(color);
  canvas.drawText(text, x, y, fill, font);
  if (suffix) {
    fill.setColor(suffixColor ?? color);
    canvas.drawText(suffix, sx, y, fill, font);
  }
};

/**
 * Presentation state that persists across frames: the glides, the damage
 * ghost, and the level-up choreography clock. Owned by GameScreen in a ref and
 * advanced by each recordPlayerHud call with the real frame delta.
 */
export interface HudAnim {
  clock: number;
  /** Last seen character level; -1 = unseeded (first frame adopts values, no anims). */
  level: number;
  /** Displayed XP fill 0..1 (glides toward the live fraction). */
  shownXp: number;
  /** Mid level-up wrap: filling to 1 before snapping empty. */
  wrapping: boolean;
  /** Clock stamp of the last level-up (drives the badge pop + ring). */
  levelUpAt: number;
  /** Damage ghost: the pale trail's hp fraction (≥ the live one). */
  ghost: number;
  ghostHoldUntil: number;
  lastHp: number;
}

export const createHudAnim = (): HudAnim => ({
  clock: 0,
  level: -1,
  shownXp: 0,
  wrapping: false,
  levelUpAt: -99,
  ghost: 1,
  ghostHoldUntil: 0,
  lastHp: 1,
});

export interface PlayerHudInput {
  /** Canvas width in px (the play-area width minus the side margins). */
  width: number;
  level: number;
  /** Live progress into the current level, 0..1. */
  xpFrac: number;
  hp: number;
  maxHp: number;
  /** HP/s from renewal — shown bracketed after the hp readout when > 0. */
  hpRegen: number;
  /** Grenze Gotisch faces (null until loaded → system-font fallback). */
  fonts: { badge: SkFont | null; label: SkFont | null };
}

const stepAnim = (a: HudAnim, level: number, xpFrac: number, hpFrac: number, dt: number): void => {
  a.clock += dt;
  if (a.level === -1) {
    // First frame: adopt the loaded character's values without playing anything.
    a.level = level;
    a.shownXp = xpFrac;
    a.ghost = hpFrac;
    a.lastHp = hpFrac;
  }
  if (level > a.level) {
    a.wrapping = true;
    a.levelUpAt = a.clock;
  }
  a.level = level;
  if (a.wrapping) {
    a.shownXp = Math.min(1, a.shownXp + XP_WRAP_RATE * dt);
    if (a.shownXp >= 1) {
      a.shownXp = 0;
      a.wrapping = false;
    }
  } else {
    a.shownXp += (xpFrac - a.shownXp) * (1 - Math.exp(-XP_GLIDE_RATE * dt));
  }
  // Damage ghost: a drop pins the trail at the pre-hit value and holds it a
  // beat before draining; anything that raises hp (regen, max-hp shifts) just
  // snaps the trail to the live value.
  if (hpFrac < a.lastHp - 0.0005) {
    a.ghost = Math.max(a.ghost, a.lastHp);
    a.ghostHoldUntil = a.clock + GHOST_HOLD;
  }
  if (a.ghost > hpFrac) {
    if (a.clock >= a.ghostHoldUntil) {
      const eased = (a.ghost - hpFrac) * (1 - Math.exp(-GHOST_DRAIN * dt));
      a.ghost = Math.max(hpFrac, a.ghost - eased - 0.05 * dt);
    }
  } else {
    a.ghost = hpFrac;
  }
  a.lastHp = hpFrac;
};

/** Advance the plate's animation by `dt` (real frame seconds) and record it. */
export const recordPlayerHud = (a: HudAnim, input: PlayerHudInput, dt: number): SkPicture => {
  const hpFrac = clamp01(input.maxHp > 0 ? input.hp / input.maxHp : 0);
  stepAnim(a, input.level, clamp01(input.xpFrac), hpFrac, dt);
  const W = input.width;
  return createPicture((canvas) => {
    if (W <= BARS_X + BARS_PAD_RIGHT + 20) return;
    const barW = W - BARS_X - BARS_PAD_RIGHT;
    const badgeFont = input.fonts.badge ?? fallbackBadgeFont;
    const labelFont = input.fonts.label ?? fallbackLabelFont;
    const sinceLevelUp = a.clock - a.levelUpAt;

    // --- Backing plate: one quiet panel behind both bars, tucked under the badge.
    const plate = Skia.RRectXY(Skia.XYWHRect(PLATE_X, 6.5, W - PLATE_X, 37), 11, 11);
    fill.setColor(C_PLATE);
    canvas.drawRRect(plate, fill);
    stroke.setColor(C_PLATE_EDGE);
    stroke.setStrokeWidth(1);
    canvas.drawRRect(plate, stroke);

    // --- Health bar.
    {
      const track = Skia.RRectXY(Skia.XYWHRect(BARS_X, HP_Y, barW, HP_H), BAR_R, BAR_R);
      fill.setColor(C_TRACK);
      canvas.drawRRect(track, fill);
      const inX = BARS_X + 1.5;
      const inY = HP_Y + 1.5;
      const inW = barW - 3;
      const inH = HP_H - 3;
      const inner = Skia.RRectXY(Skia.XYWHRect(inX, inY, inW, inH), BAR_R - 1.5, BAR_R - 1.5);
      canvas.save();
      canvas.clipRRect(inner, ClipOp.Intersect, true);
      // Ghost trail first, so the live fill draws over its leading edge.
      if (a.ghost > hpFrac + 0.002) {
        fill.setColor(C_GHOST);
        canvas.drawRect(Skia.XYWHRect(inX, inY, inW * a.ghost, inH), fill);
      }
      const stops = hpStops(hpFrac);
      fill.setShader(
        Skia.Shader.MakeLinearGradient(
          vec(0, inY),
          vec(0, inY + inH),
          stops,
          [0, 0.55, 1],
          TileMode.Clamp,
        ),
      );
      canvas.drawRect(Skia.XYWHRect(inX, inY, inW * hpFrac, inH), fill);
      fill.setShader(null);
      // Glossy top edge over the fill.
      fill.setColor(C_GLOSS);
      canvas.drawRect(Skia.XYWHRect(inX, inY, inW * hpFrac, inH * 0.45), fill);
      canvas.restore();
      stroke.setColor(C_TRACK_EDGE);
      stroke.setStrokeWidth(1);
      canvas.drawRRect(track, stroke);
      // Low-health warning: a soft red rim that beats faster-feeling by alpha.
      if (hpFrac < LOW_HP_THRESHOLD) {
        const beat = 0.5 + 0.5 * Math.sin(a.clock * Math.PI * 2 * 1.8);
        stroke.setColor(C_LOW_PULSE);
        stroke.setAlphaf(0.25 + 0.45 * beat);
        stroke.setStrokeWidth(2.5);
        stroke.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 4, true));
        canvas.drawRRect(track, stroke);
        stroke.setMaskFilter(null);
        stroke.setAlphaf(1);
      }
      // One decimal of regen, trailing zero dropped (1 → "+1/s", 0.5 → "+0.5/s").
      const regen = Math.round(input.hpRegen * 10) / 10;
      drawCenteredText(
        canvas,
        `${Math.ceil(input.hp)} / ${Math.round(input.maxHp)}`,
        BARS_X + barW / 2,
        HP_Y + HP_H / 2,
        labelFont,
        C_TEXT,
        regen > 0 ? `(+${regen}/s)` : undefined,
        C_TEXT_REGEN,
      );
    }

    // --- XP bar.
    {
      const track = Skia.RRectXY(Skia.XYWHRect(BARS_X, XP_Y, barW, XP_H), BAR_R - 0.5, BAR_R - 0.5);
      fill.setColor(C_TRACK);
      canvas.drawRRect(track, fill);
      const inX = BARS_X + 1;
      const inY = XP_Y + 1;
      const inW = barW - 2;
      const inH = XP_H - 2;
      const inner = Skia.RRectXY(Skia.XYWHRect(inX, inY, inW, inH), BAR_R - 1.5, BAR_R - 1.5);
      const fillW = inW * a.shownXp;
      canvas.save();
      canvas.clipRRect(inner, ClipOp.Intersect, true);
      if (fillW > 0.5) {
        // Gold gradient fixed in bar space (the fill reveals it as it grows).
        fill.setShader(
          Skia.Shader.MakeLinearGradient(
            vec(inX, 0),
            vec(inX + inW, 0),
            XP_STOPS,
            [0, 0.7, 1],
            TileMode.Clamp,
          ),
        );
        canvas.drawRect(Skia.XYWHRect(inX, inY, fillW, inH), fill);
        fill.setShader(null);
        // Travelling shimmer, clipped to the filled region.
        canvas.save();
        canvas.clipRect(Skia.XYWHRect(inX, inY, fillW, inH), ClipOp.Intersect, false);
        const sweep = (a.clock % SHIMMER_PERIOD) / SHIMMER_PERIOD;
        const sx = inX - SHIMMER_W + sweep * (inW + SHIMMER_W * 2);
        fill.setShader(
          Skia.Shader.MakeLinearGradient(
            vec(sx, 0),
            vec(sx + SHIMMER_W, 0),
            SHIMMER_STOPS,
            null,
            TileMode.Clamp,
          ),
        );
        canvas.drawRect(Skia.XYWHRect(sx, inY, SHIMMER_W, inH), fill);
        fill.setShader(null);
        canvas.restore();
        // Level-up wrap: the completing bar flashes bright as it fills.
        if (a.wrapping) {
          fill.setColor(C_WRAP_FLASH);
          canvas.drawRect(Skia.XYWHRect(inX, inY, fillW, inH), fill);
        }
      }
      // Quarter ticks over track and fill alike, for progress read-at-a-glance.
      fill.setColor(C_TICK);
      for (const q of [0.25, 0.5, 0.75]) {
        canvas.drawRect(Skia.XYWHRect(inX + inW * q - 0.5, inY, 1, inH), fill);
      }
      canvas.restore();
      stroke.setColor(C_TRACK_EDGE);
      stroke.setAlphaf(0.75);
      stroke.setStrokeWidth(1);
      canvas.drawRRect(track, stroke);
      stroke.setAlphaf(1);
      // Glowing tip riding the fill's leading edge.
      if (a.shownXp > 0.02) {
        const tipX = inX + fillW;
        const tipY = XP_Y + XP_H / 2;
        fill.setColor(C_GOLD);
        fill.setAlphaf(0.6);
        fill.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 5, true));
        canvas.drawCircle(tipX, tipY, 6, fill);
        fill.setMaskFilter(null);
        fill.setAlphaf(1);
        fill.setColor(C_XP_TIP);
        canvas.drawCircle(tipX, tipY, 2, fill);
      }
    }

    // --- Level badge (last: it overlaps the plate's left edge).
    {
      // Level-up shockwave ring, expanding and fading over POP_DUR.
      if (sinceLevelUp < POP_DUR && sinceLevelUp >= 0) {
        const t = sinceLevelUp / POP_DUR;
        stroke.setColor(C_GOLD);
        stroke.setAlphaf(0.8 * (1 - t));
        stroke.setStrokeWidth(3 - 2 * t);
        canvas.drawCircle(BADGE_CX, BADGE_CY, BADGE_R + 5 + t * 30, stroke);
        stroke.setAlphaf(1);
      }
      // Breathing gold aura, surging on level-up.
      const surge = sinceLevelUp < POP_DUR && sinceLevelUp >= 0 ? 0.5 * (1 - sinceLevelUp / POP_DUR) : 0;
      fill.setColor(C_GOLD);
      fill.setAlphaf(0.16 + 0.06 * Math.sin(a.clock * 2.1) + surge);
      fill.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true));
      canvas.drawCircle(BADGE_CX, BADGE_CY, BADGE_R + 4, fill);
      fill.setMaskFilter(null);
      fill.setAlphaf(1);
      // Body: a gold-rimmed diamond that pops (a quick springy scale) on level-up.
      const pop =
        sinceLevelUp < POP_DUR && sinceLevelUp >= 0
          ? 1 + 0.35 * Math.exp(-4.5 * sinceLevelUp) * Math.sin(13 * sinceLevelUp)
          : 1;
      canvas.save();
      canvas.translate(BADGE_CX, BADGE_CY);
      canvas.scale(pop, pop);
      canvas.save();
      canvas.rotate(45, 0, 0);
      const body = Skia.RRectXY(Skia.XYWHRect(-BADGE_R, -BADGE_R, BADGE_R * 2, BADGE_R * 2), 5, 5);
      fill.setColor(C_BADGE_FILL);
      canvas.drawRRect(body, fill);
      stroke.setColor(C_GOLD);
      stroke.setStrokeWidth(2);
      canvas.drawRRect(body, stroke);
      const rim = BADGE_R - 3.5;
      stroke.setColor(C_BADGE_INNER);
      stroke.setStrokeWidth(1);
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-rim, -rim, rim * 2, rim * 2), 3, 3), stroke);
      canvas.restore();
      // Numeral drawn unrotated (but sharing the pop scale).
      drawCenteredText(canvas, String(input.level), 0, 0, badgeFont, C_GOLD);
      canvas.restore();
    }
  });
};

/** A blank plate for the shared value's initial frame. */
export const EMPTY_HUD_PICTURE: SkPicture = createPicture(() => {});

export interface PlayerHudProps {
  /** The recorded plate; the game loop re-records this each frame. */
  picture: SharedValue<SkPicture>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Screen-space host for the plate: an absolutely-positioned strip (the caller
 * sets `bottom`) holding the Skia canvas the recorded picture blits into.
 */
export const PlayerHud = ({ picture, style }: PlayerHudProps) => (
  <View style={[styles.root, style]} pointerEvents="none">
    <Canvas style={styles.canvas}>
      <Picture picture={picture} />
    </Canvas>
  </View>
);

/**
 * The level-up moment: a short, celebratory flash over the still-running scene
 * — LEVEL_UP_BANNER_MS of glory before GameScreen opens the talent pick.
 * Conditionally mounted by GameScreen; enter/exit fades come with the mount.
 */
export const LevelUpBanner = ({ level }: { level: number }) => (
  <Animated.View
    style={styles.banner}
    entering={FadeIn.duration(150)}
    exiting={FadeOut.duration(300)}
    pointerEvents="none"
  >
    <Text style={styles.bannerText}>Level {level}!</Text>
  </Animated.View>
);

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    left: 8,
    right: 8,
    height: PLAYER_HUD_HEIGHT,
  },
  canvas: {
    flex: 1,
  },
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "30%",
    alignItems: "center",
  },
  bannerText: {
    fontFamily: UI.font,
    color: UI.accent,
    fontSize: 40,
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
