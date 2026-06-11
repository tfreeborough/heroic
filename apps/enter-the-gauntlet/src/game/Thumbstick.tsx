import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { length, resolveStick, STICK_ZERO, type StickSample, vec2 } from "@heroic/core";

const PAD_SIZE = 220;
const KNOB_SIZE = 72;
/** Knob travel radius; also the input radius, so max speed lands exactly when the knob hits the rim. */
const TRAVEL = (PAD_SIZE - KNOB_SIZE) / 2;

export interface ThumbstickProps {
  /**
   * Fired on every touch change with the resolved stick sample. Called from
   * gesture callbacks (not React renders) — stash it in a ref, don't setState.
   */
  onChange: (sample: StickSample) => void;
}

/**
 * Fixed-centre virtual stick: thumb offset from the pad centre gives the
 * movement direction, distance gives the speed (deadzone → max at the rim).
 * The knob mirrors the (clamped) raw thumb position for honest feedback —
 * where the knob sits is where the input is.
 */
export const Thumbstick = ({ onChange }: ThumbstickProps) => {
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);

  const pan = useMemo(() => {
    const track = (x: number, y: number): void => {
      const offset = vec2(x - PAD_SIZE / 2, y - PAD_SIZE / 2);
      const len = length(offset);
      const clamp = len > TRAVEL ? TRAVEL / len : 1;
      knobX.value = offset.x * clamp;
      knobY.value = offset.y * clamp;
      onChange(resolveStick(offset, TRAVEL));
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
  }, [knobX, knobY, onChange]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.pad}>
        <View style={[styles.crosshair, styles.crosshairH]} />
        <View style={[styles.crosshair, styles.crosshairV]} />
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  pad: {
    width: PAD_SIZE,
    height: PAD_SIZE,
    borderRadius: 28,
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
    top: PAD_SIZE / 2 - 0.5,
    height: 1,
  },
  crosshairV: {
    top: 16,
    bottom: 16,
    left: PAD_SIZE / 2 - 0.5,
    width: 1,
  },
  knob: {
    position: "absolute",
    left: (PAD_SIZE - KNOB_SIZE) / 2,
    top: (PAD_SIZE - KNOB_SIZE) / 2,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.35)",
  },
});
