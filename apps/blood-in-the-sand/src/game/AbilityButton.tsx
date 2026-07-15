import { StyleSheet } from "react-native";
// RNGH's Pressable (not RN's): lives in the gesture-handler touch system so it
// still fires while the thumbstick's pan gesture owns a touch — casts are
// right-thumb actions used *while* the left thumb holds the stick.
import { Pressable } from "react-native-gesture-handler";
import {
  Canvas,
  ClipOp,
  createPicture,
  Image as SkiaImage,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  useImage,
  type SkCanvas,
  type SkPicture,
} from "@shopify/react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import type { AbilityId } from "@heroic/blood-in-the-sand-sim";
import { ICON_SOURCES } from "../loadout/icons";

/** Square button edge, px. The Skia canvas is exactly this so picture coords are fixed. */
export const ABILITY_BUTTON_SIZE = 68;
const R = 16; // corner radius
const GLYPH = 46; // drawn size of the die-cut icon art

// Palette parsed once — drawButton runs every frame while a cooldown sweeps.
const C_BG = Skia.Color("rgba(255, 255, 255, 0.05)");
const C_DIM = Skia.Color("rgba(0, 0, 0, 0.4)"); // over the icon while cooling
const C_WEDGE = Skia.Color("rgba(0, 0, 0, 0.55)"); // the semi-transparent clock overlay
const C_BORDER_READY = Skia.Color("rgba(242, 193, 78, 0.6)"); // gold = ready (equipped-weapon accent)
const C_BORDER_COOL = Skia.Color("rgba(255, 255, 255, 0.14)");
const C_BORDER_ACTIVE = Skia.Color("rgba(255, 255, 255, 0.85)"); // effect window open
const C_SPENT = Skia.Color("rgba(0, 0, 0, 0.62)"); // out of round-budget: dead until next round
const C_PIP = Skia.Color("rgba(242, 193, 78, 0.9)"); // a charge in hand
const C_PIP_SPENT = Skia.Color("rgba(255, 255, 255, 0.22)"); // a charge burned

const fill = Skia.Paint();
const stroke = Skia.Paint();
stroke.setStyle(PaintStyle.Stroke);

/**
 * Draw an ability button face OVER the icon image (the icon is a Skia <Image>
 * layered beneath this picture in AbilityButton): rounded background, then —
 * while cooling — a dim layer plus a black pie wedge that unwinds clockwise
 * from 12 o'clock; a heavier flat dim when the round budget is spent; charge
 * pips along the bottom edge; and finally the border (gold when ready, bright
 * while the effect window is open, neutral while cooling or spent).
 * `frac`: cooldown fraction, 1 = just used → 0 = ready.
 */
const drawButton = (
  canvas: SkCanvas,
  frac: number,
  active: boolean,
  charges: number,
  maxCharges: number,
): void => {
  const s = ABILITY_BUTTON_SIZE;
  const cx = s / 2;
  const cy = s / 2;
  const spent = charges <= 0;
  // Inset by half the border width so the stroke sits inside the canvas bounds.
  const rrect = Skia.RRectXY(Skia.XYWHRect(0.75, 0.75, s - 1.5, s - 1.5), R, R);

  fill.setStyle(PaintStyle.Fill);
  fill.setColor(C_BG);
  canvas.drawRRect(rrect, fill);

  if (spent) {
    // Out of charges: dead until the next round — no clock, nothing coming.
    fill.setColor(C_SPENT);
    canvas.drawRRect(rrect, fill);
  } else if (frac > 0) {
    // Dim the icon underneath while it cools (was the glyph's dimmed stroke).
    fill.setColor(C_DIM);
    canvas.drawRRect(rrect, fill);
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

  // Charge pips: the round budget at a glance, gold in hand / faint burned.
  if (maxCharges > 1) {
    const gap = 9;
    const left = cx - ((maxCharges - 1) * gap) / 2;
    for (let i = 0; i < maxCharges; i++) {
      fill.setColor(i < charges ? C_PIP : C_PIP_SPENT);
      canvas.drawCircle(left + i * gap, s - 8, 2.4, fill);
    }
  }

  stroke.setColor(active ? C_BORDER_ACTIVE : spent || frac > 0 ? C_BORDER_COOL : C_BORDER_READY);
  stroke.setStrokeWidth(active ? 2 : 1.5);
  stroke.setStrokeCap(StrokeCap.Butt);
  stroke.setStrokeJoin(StrokeJoin.Miter);
  canvas.drawRRect(rrect, stroke);
};

/** Record a button face. `frac`: 1 = just used → 0 = ready. */
export const recordAbilityButton = (
  frac: number,
  active: boolean,
  charges: number,
  maxCharges: number,
): SkPicture => createPicture((canvas) => drawButton(canvas, frac, active, charges, maxCharges));

/** A blank face for slots the snapshot hasn't named yet (pre-first-sample). */
export const EMPTY_BUTTON_PICTURE: SkPicture = createPicture(() => {});

export interface AbilityButtonProps {
  /** Names the icon art. The face overlay carries everything else. */
  id: AbilityId;
  /** The button face: the game loop re-records this whenever it changes. */
  overlay: SharedValue<SkPicture>;
  /** Fired on tap. The sim decides whether the cast is actually off cooldown. */
  onPress: () => void;
}

/**
 * One ability action button (three of these stack in the button column, in
 * pick order). The icon is the forge art as a Skia image; the state chrome
 * (cooling dim + clock wedge + border) is a single picture driven by the game
 * loop, drawn over it. This component is just the touch target around both.
 */
export const AbilityButton = ({ id, overlay, onPress }: AbilityButtonProps) => {
  const icon = useImage(ICON_SOURCES[id]);
  const inset = (ABILITY_BUTTON_SIZE - GLYPH) / 2;
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Canvas style={styles.canvas}>
        {icon ? (
          <SkiaImage image={icon} x={inset} y={inset} width={GLYPH} height={GLYPH} fit="contain" />
        ) : null}
        <Picture picture={overlay} />
      </Canvas>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  canvas: {
    width: ABILITY_BUTTON_SIZE,
    height: ABILITY_BUTTON_SIZE,
  },
});
