import { StyleSheet } from "react-native";
// RNGH's Pressable (not RN's): lives in the gesture-handler touch system so it
// still fires while the thumbstick's pan gesture owns a touch — the dash is a
// right-thumb action used *while* the left thumb holds the stick. See WeaponButton.
import { Pressable } from "react-native-gesture-handler";
import {
  Canvas,
  ClipOp,
  createPicture,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkPicture,
} from "@shopify/react-native-skia";
import type { SharedValue } from "react-native-reanimated";

/** Square button edge, px. The Skia canvas is exactly this so picture coords are fixed. */
export const DASH_BUTTON_SIZE = 68;
const R = 16; // corner radius

// Palette parsed once — drawButton runs every frame while the cooldown sweeps.
const C_BG = Skia.Color("rgba(255, 255, 255, 0.05)");
const C_ICON_READY = Skia.Color("rgba(255, 255, 255, 0.9)");
const C_ICON_COOL = Skia.Color("rgba(255, 255, 255, 0.45)");
const C_WEDGE = Skia.Color("rgba(0, 0, 0, 0.55)"); // the semi-transparent clock overlay
const C_BORDER_READY = Skia.Color("rgba(242, 193, 78, 0.6)"); // gold = ready (matches equipped-weapon accent)
const C_BORDER_COOL = Skia.Color("rgba(255, 255, 255, 0.14)");

const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

/**
 * Draw the dash button face into `canvas` for a given cooldown fraction
 * (`frac`: 1 = just used, 0 = ready). Layers: rounded background, a double
 * fast-forward chevron (dimmed while cooling), then — while cooling — a black
 * pie wedge that unwinds clockwise from 12 o'clock like an ability cooldown,
 * and finally the border (gold when ready, neutral while cooling).
 */
const drawButton = (canvas: SkCanvas, frac: number): void => {
  const s = DASH_BUTTON_SIZE;
  const cx = s / 2;
  const cy = s / 2;
  // Inset by half the border width so the stroke sits inside the canvas bounds.
  const rrect = Skia.RRectXY(Skia.XYWHRect(0.75, 0.75, s - 1.5, s - 1.5), R, R);

  fill.setStyle(PaintStyle.Fill);
  fill.setColor(C_BG);
  canvas.drawRRect(rrect, fill);

  // Double chevron »: two ">" strokes, round-jointed.
  stroke.setColor(frac > 0 ? C_ICON_COOL : C_ICON_READY);
  stroke.setStrokeWidth(4);
  stroke.setStrokeCap(StrokeCap.Round);
  stroke.setStrokeJoin(StrokeJoin.Round);
  const cw = 9;
  const ch = 11;
  for (let i = 0; i < 2; i++) {
    const ax = cx - 4 + i * 12;
    const p = Skia.Path.Make();
    p.moveTo(ax - cw, cy - ch);
    p.lineTo(ax, cy);
    p.lineTo(ax - cw, cy + ch);
    canvas.drawPath(p, stroke);
  }

  if (frac > 0) {
    // Clip to the rounded square so the wedge's corners stay inside the button.
    canvas.save();
    const clip = Skia.Path.Make();
    clip.addRRect(rrect);
    canvas.clipPath(clip, ClipOp.Intersect, true);
    // Pie from 12 o'clock (-90°), sweeping clockwise by frac of the circle.
    // Radius reaches past the corners (clip trims it back to the rounded square).
    const r = s;
    const wedge = Skia.Path.Make();
    wedge.moveTo(cx, cy);
    wedge.arcToOval(Skia.XYWHRect(cx - r, cy - r, r * 2, r * 2), -90, frac * 360, false);
    wedge.close();
    fill.setColor(C_WEDGE);
    canvas.drawPath(wedge, fill);
    canvas.restore();
  }

  stroke.setColor(frac > 0 ? C_BORDER_COOL : C_BORDER_READY);
  stroke.setStrokeWidth(1.5);
  stroke.setStrokeCap(StrokeCap.Butt);
  stroke.setStrokeJoin(StrokeJoin.Miter);
  canvas.drawRRect(rrect, stroke);
};

/** Record the button face for a cooldown fraction (1 = just used → 0 = ready). */
export const recordDashButton = (frac: number): SkPicture =>
  createPicture((canvas) => drawButton(canvas, frac));

/** The ready (off-cooldown) face, recorded once — pushed when the cooldown ends. */
export const DASH_READY_PICTURE = recordDashButton(0);

export interface DashButtonProps {
  /** The button face: the game loop re-records this each frame while cooling. */
  overlay: SharedValue<SkPicture>;
  /** Fired on tap. The sim decides whether the roll is actually off cooldown. */
  onPress: () => void;
}

/**
 * The dash/roll action button. The visual (icon + clock cooldown) is a single
 * Skia picture driven by the game loop; this component is just the touch target
 * around it.
 */
export const DashButton = ({ overlay, onPress }: DashButtonProps) => (
  <Pressable onPress={onPress} hitSlop={8}>
    <Canvas style={styles.canvas}>
      <Picture picture={overlay} />
    </Canvas>
  </Pressable>
);

const styles = StyleSheet.create({
  canvas: {
    width: DASH_BUTTON_SIZE,
    height: DASH_BUTTON_SIZE,
  },
});
