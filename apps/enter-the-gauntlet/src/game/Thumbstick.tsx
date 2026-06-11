import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { length, resolveStick, STICK_ZERO, type StickSample, vec2 } from "@heroic/core";

const DEFAULT_PAD_SIZE = 220;
/** Knob diameter as a fraction of the pad — keeps proportions at any size. */
const KNOB_RATIO = 72 / 220;

export interface ThumbstickProps {
  /**
   * Fired on every touch change with the resolved stick sample. Called from
   * gesture callbacks (not React renders) — stash it in a ref, don't setState.
   */
  onChange: (sample: StickSample) => void;
  /** Pad diameter in px. */
  size?: number;
}

/**
 * Fixed-centre virtual stick: thumb offset from the pad centre gives the
 * movement direction, distance gives the speed (deadzone → max at the rim).
 * The knob mirrors the (clamped) raw thumb position for honest feedback —
 * where the knob sits is where the input is.
 */
export const Thumbstick = ({ onChange, size = DEFAULT_PAD_SIZE }: ThumbstickProps) => {
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);

  const knobSize = Math.round(size * KNOB_RATIO);
  /** Knob travel radius; also the input radius, so max speed lands exactly when the knob hits the rim. */
  const travel = (size - knobSize) / 2;

  const pan = useMemo(() => {
    const track = (x: number, y: number): void => {
      const offset = vec2(x - size / 2, y - size / 2);
      const len = length(offset);
      const clamp = len > travel ? travel / len : 1;
      knobX.value = offset.x * clamp;
      knobY.value = offset.y * clamp;
      onChange(resolveStick(offset, travel));
    };
    const release = (): void => {
      knobX.value = withSpring(0, { damping: 20, stiffness: 400 });
      knobY.value = withSpring(0, { damping: 20, stiffness: 400 });
      onChange(STICK_ZERO);
    };
    return Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => track(e.x, e.y))
      .onUpdate((e) => track(e.x, e.y))
      .onFinalize(release);
  }, [knobX, knobY, onChange, size, travel]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));

  const sized = useMemo(
    () => ({
      pad: { width: size, height: size },
      crosshairH: { top: size / 2 - 0.5 },
      crosshairV: { left: size / 2 - 0.5 },
      knob: {
        left: (size - knobSize) / 2,
        top: (size - knobSize) / 2,
        width: knobSize,
        height: knobSize,
        borderRadius: knobSize / 2,
      },
    }),
    [size, knobSize],
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.pad, sized.pad]}>
        <View style={[styles.crosshair, styles.crosshairH, sized.crosshairH]} />
        <View style={[styles.crosshair, styles.crosshairV, sized.crosshairV]} />
        <Animated.View style={[styles.knob, sized.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  pad: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  crosshair: {
    position: "absolute",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  crosshairH: {
    left: 16,
    right: 16,
    height: 1,
  },
  crosshairV: {
    top: 16,
    bottom: 16,
    width: 1,
  },
  knob: {
    position: "absolute",
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
});
