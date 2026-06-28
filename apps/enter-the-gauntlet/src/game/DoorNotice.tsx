import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { keyColorDef, type KeyColor } from "@heroic/engine";

/**
 * The locked-door callout (docs/design/doors-and-keys.md): while the player is
 * pressed against a door they can't open, a flavor line names the color of key
 * they're missing — so a locked door teaches what to go find rather than just
 * stopping them. Driven by the same `lockedNeed` signal as the HUD's ghost pip;
 * fades in on contact and unmounts when they step away.
 */
interface Props {
  /** Color of the locked door currently being bumped without its key, or null. */
  need: KeyColor | null;
  style?: StyleProp<ViewStyle>;
}

export const DoorNotice = ({ need, style }: Props) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (need) {
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    }
  }, [need, opacity]);

  if (!need) return null;
  const def = keyColorDef(need);

  return (
    <Animated.View style={[styles.wrap, style, { opacity }]} pointerEvents="none">
      <View style={styles.bubble}>
        <Text style={styles.text}>
          It would appear this door is missing a{" "}
          <Text style={[styles.colorWord, { color: def.hex }]}>{def.label.toLowerCase()}</Text> key…
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // Full-width band so the bubble centres horizontally; the caller sets `bottom`.
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  bubble: {
    maxWidth: 360,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(14, 17, 22, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  text: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
  },
  colorWord: {
    fontStyle: "normal",
    fontWeight: "800",
  },
});
