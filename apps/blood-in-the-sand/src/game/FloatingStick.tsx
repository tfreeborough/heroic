import { useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { length, resolveStick, STICK_ZERO, type StickSample, vec2 } from "@heroic/core";

const PAD_SIZE = 170;
const KNOB_SIZE = 56;
/** Knob travel radius (visual clamp). */
const TRAVEL = (PAD_SIZE - KNOB_SIZE) / 2;
/**
 * Full speed lands at this fraction of the travel — the anti-fatigue half of
 * the scheme: a small, comfortable deflection is already a sprint, so the
 * thumb never holds a max-extension stretch.
 */
const SATURATION = 0.55;

export interface FloatingStickProps {
  /** Same contract as the old Thumbstick.onChange — called from gesture callbacks. */
  onChange: (sample: StickSample) => void;
}

/**
 * Floating-origin virtual stick: the pad appears wherever the thumb lands in
 * the (invisible) touch region, and dragging past the rim LEASHES the origin
 * along behind the thumb — the thumb can wander and relax without the input
 * changing, because there is no fixed anchor to drift from. The other half of
 * the fatigue fix is SATURATION above.
 *
 * The region fills whatever space its parent gives it (flex: 1) and measures
 * itself — the button column on the other side simply shrinks it.
 */
export const FloatingStick = ({ onChange }: FloatingStickProps) => {
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  const active = useSharedValue(0);
  const size = useRef({ w: 0, h: 0 });

  const pan = useMemo(() => {
    const begin = (x: number, y: number): void => {
      // Keep the pad's visual fully inside the region.
      const { w, h } = size.current;
      originX.value = Math.min(Math.max(x, PAD_SIZE / 2), Math.max(PAD_SIZE / 2, w - PAD_SIZE / 2));
      originY.value = Math.min(Math.max(y, PAD_SIZE / 2), Math.max(PAD_SIZE / 2, h - PAD_SIZE / 2));
      knobX.value = 0;
      knobY.value = 0;
      active.value = withTiming(1, { duration: 80 });
      onChange(STICK_ZERO);
    };
    const track = (x: number, y: number): void => {
      let offset = vec2(x - originX.value, y - originY.value);
      const len = length(offset);
      if (len > TRAVEL) {
        // Leash: drag the origin along so the offset never exceeds the rim.
        const k = TRAVEL / len;
        originX.value = x - offset.x * k;
        originY.value = y - offset.y * k;
        offset = vec2(offset.x * k, offset.y * k);
      }
      knobX.value = offset.x;
      knobY.value = offset.y;
      onChange(resolveStick(offset, TRAVEL * SATURATION));
    };
    const release = (): void => {
      active.value = withTiming(0, { duration: 140 });
      onChange(STICK_ZERO);
    };
    return Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => begin(e.x, e.y))
      .onUpdate((e) => track(e.x, e.y))
      .onFinalize(release);
  }, [originX, originY, knobX, knobY, active, onChange]);

  const padStyle = useAnimatedStyle(() => ({
    opacity: active.value,
    transform: [
      { translateX: originX.value - PAD_SIZE / 2 },
      { translateY: originY.value - PAD_SIZE / 2 },
    ],
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.region}
        onLayout={(e) => {
          size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        }}
      >
        <Animated.View style={[styles.pad, padStyle]} pointerEvents="none">
          <Animated.View style={[styles.knob, knobStyle]} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  // Invisible, but faintly bordered so players can find the touch area.
  region: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  pad: {
    position: "absolute",
    width: PAD_SIZE,
    height: PAD_SIZE,
    borderRadius: PAD_SIZE / 2,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
});
