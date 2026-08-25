/**
 * A one-shot spark burst — the Signet Forge's strike spray, shared since the
 * Primer (bits-onboarding.md) throws the same sparks for kills and socket
 * landings. Keyed by `seed`: bump it and a fresh random spread fires; 0 is
 * dormant. Pure spectacle, native-driver, gone in half a second.
 *
 * Positioning: the stage is a 0×0 centred anchor — place the component
 * (absolutely) where the burst's origin should be.
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

export interface SparksProps {
  seed: number;
  /** Dart colours [round, long] — the forge's hot gold by default; the
   * Primer's kill burst runs crimson. */
  tint?: [string, string];
  /** Extra positioning for the anchor (e.g. absolute left/top). */
  style?: StyleProp<ViewStyle>;
}

const GOLD: [string, string] = ["#ffcf7a", "#ffe9b0"];

export const Sparks = ({ seed, tint = GOLD, style }: SparksProps) => {
  const t = useRef(new Animated.Value(0)).current;
  const darts = useMemo(
    () =>
      Array.from({ length: 12 }, () => {
        const angle = Math.random() * Math.PI * 2;
        const dist = 55 + Math.random() * 75;
        return {
          x: Math.cos(angle) * dist,
          // Sparks fly UP-and-out more than down — forge physics.
          y: Math.sin(angle) * dist * 0.8 - 24,
          spin: `${Math.round(Math.random() * 300 - 150)}deg`,
          long: Math.random() > 0.5,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new spread per strike
    [seed],
  );
  useEffect(() => {
    if (seed === 0) return;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 460, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [seed, t]);
  if (seed === 0) return null;
  return (
    <View pointerEvents="none" style={[styles.sparkStage, style]}>
      {darts.map((d, i) => (
        <Animated.View
          key={`${seed}-${i}`}
          style={[
            d.long ? styles.sparkLong : styles.spark,
            { backgroundColor: d.long ? tint[1] : tint[0] },
            {
              opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.9, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, d.x] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, d.y] }) },
                { rotate: d.spin },
                { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  sparkStage: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  spark: { position: "absolute", width: 5, height: 5, borderRadius: 2.5 },
  sparkLong: { position: "absolute", width: 11, height: 3, borderRadius: 1.5 },
});
