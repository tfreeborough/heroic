// A draggable 0..1 slider built on the gesture-handler + reanimated stack the
// game already uses (no extra native dependency, and it matches the thumbstick's
// touch feel). Controlled: report drags via `onChange`; the parent owns the value.

import { useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { UI } from "./theme";

const HITBOX_HEIGHT = 40;
const TRACK_HEIGHT = 10;
const KNOB_SIZE = 26;

export interface SliderProps {
  /** Current value, 0..1. */
  value: number;
  /** Fired continuously while dragging, with the new 0..1 value. */
  onChange: (value: number) => void;
}

export const Slider = ({ value, onChange }: SliderProps) => {
  // Track width: a ref for the JS-side gesture math, a shared value for the
  // worklet-side fill/knob styles. Both set together on layout.
  const widthRef = useRef(0);
  const trackW = useSharedValue(0);
  const frac = useSharedValue(value);

  const pan = useMemo(() => {
    const track = (x: number): void => {
      const w = widthRef.current;
      if (w <= 0) return;
      const f = Math.min(1, Math.max(0, x / w));
      frac.value = f;
      onChange(f);
    };
    return Gesture.Pan()
      .minDistance(0)
      .maxPointers(1)
      .runOnJS(true)
      .onBegin((e) => track(e.x))
      .onUpdate((e) => track(e.x));
  }, [frac, onChange]);

  const fillStyle = useAnimatedStyle(() => ({ width: frac.value * trackW.value }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: frac.value * trackW.value - KNOB_SIZE / 2 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.hitbox}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          widthRef.current = w;
          trackW.value = w;
        }}
      >
        <View style={styles.track}>
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  hitbox: {
    height: HITBOX_HEIGHT,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: UI.track,
    overflow: "hidden",
  },
  fill: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: UI.trackFill,
  },
  knob: {
    position: "absolute",
    left: 0,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: UI.knob,
    borderWidth: 2,
    borderColor: "rgba(0, 0, 0, 0.25)",
  },
});
