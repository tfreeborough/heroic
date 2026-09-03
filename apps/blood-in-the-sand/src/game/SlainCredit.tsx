import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { TitleFlex } from "./TitleFlex";

// The slain-by credit (bits-title-moments.md § moment 3), plate edition: the
// bare two-liner was invisible against the sand (Tom's on-device verdict), so
// it now springs in as a dark gilded pill — small SLAIN BY eyebrow, the
// killer's name big in foe-red, their title beneath. Remount per death (key
// it) so the spring replays.

export interface SlainCreditProps {
  name: string;
  /** Already-resolved display text — null = bare, the line skips. */
  title: string | null;
}

export const SlainCredit = ({ name, title }: SlainCreditProps) => {
  const intro = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(intro, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.back(1.7)),
      useNativeDriver: true,
    }).start();
  }, [intro]);
  return (
    <Animated.View
      style={[
        styles.pill,
        {
          opacity: intro,
          transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
        },
      ]}
    >
      <Text style={styles.eyebrow}>SLAIN BY</Text>
      <Text style={styles.name} numberOfLines={1}>
        {name.toUpperCase()}
      </Text>
      <TitleFlex title={title} size={14} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  pill: {
    alignItems: "center",
    gap: 2,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(224,122,106,0.4)",
    backgroundColor: "rgba(8,6,4,0.6)",
    paddingVertical: 10,
    paddingHorizontal: 24,
    maxWidth: "86%",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "#b0a595",
    letterSpacing: 3,
  },
  name: {
    fontSize: 22,
    fontWeight: "900",
    color: "#e07a6a",
    letterSpacing: 1,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
