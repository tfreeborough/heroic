import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { TitleFlex } from "./TitleFlex";

// The round-1 entrance card (bits-title-moments.md § moment 1): the honour
// roll's treatment applied to the tale of the tape — a gilded dark plate
// under the countdown digit, both sides' names + worn titles landing as
// staggered facing pairs. Names + titles ONLY, never kit (secrecy holds
// until matchEnd). The panel earns its own scrim because the countdown has
// no backdrop and the sand ate the bare text (Tom's on-device verdict).

export interface EntranceSeat {
  id: number;
  name: string;
  /** Already-resolved display text — null = bare, the title line just skips. */
  title: string | null;
}

export interface EntranceCardProps {
  mine: EntranceSeat[];
  theirs: EntranceSeat[];
}

/** Panel fade, then pair i lands at PANEL_MS + i * PAIR_STAGGER_MS. */
const PANEL_MS = 240;
const PAIR_STAGGER_MS = 300;

const SeatView = ({ seat, foe, index }: { seat: EntranceSeat; foe: boolean; index: number }) => {
  const land = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(land, {
      toValue: 1,
      duration: 300,
      delay: PANEL_MS + index * PAIR_STAGGER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [land, index]);
  return (
    <Animated.View
      style={[
        styles.seat,
        {
          opacity: land,
          transform: [{ translateY: land.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      <Text style={[styles.name, foe ? styles.foe : styles.friend]} numberOfLines={1}>
        {seat.name}
      </Text>
      <TitleFlex title={seat.title} size={11} />
    </Animated.View>
  );
};

export const EntranceCard = ({ mine, theirs }: EntranceCardProps) => {
  const intro = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(intro, {
      toValue: 1,
      duration: PANEL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [intro]);
  return (
    <Animated.View style={[styles.panel, { opacity: intro }]}>
      <View style={styles.col}>
        {mine.map((s, i) => (
          <SeatView key={s.id} seat={s} foe={false} index={i} />
        ))}
      </View>
      <View style={styles.divider} />
      <View style={styles.col}>
        {theirs.map((s, i) => (
          <SeatView key={s.id} seat={s} foe index={i} />
        ))}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // The RoundBanner's match-end tones: dark scrim ground, gilded hairline.
  panel: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    maxWidth: "92%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(207,169,100,0.35)",
    backgroundColor: "rgba(8,6,4,0.62)",
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 18,
  },
  col: { flex: 1, gap: 10, minWidth: 120, maxWidth: 190 },
  divider: { alignSelf: "stretch", width: StyleSheet.hairlineWidth, backgroundColor: "rgba(207,169,100,0.35)" },
  seat: { alignItems: "center", gap: 1 },
  name: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.5,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Allegiance colours — the same cue the bodies and scoreboard wear.
  friend: { color: "#5aa9e0" },
  foe: { color: "#e07a6a" },
});
