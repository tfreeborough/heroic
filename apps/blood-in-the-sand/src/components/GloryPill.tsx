/**
 * The purse: the server-authoritative Glory balance (net/api.ts) as a pill.
 * Owns its own fetch — drop it on any screen and pass positioning via
 * `style`. Renders NOTHING until a real number arrives: the wallet never
 * shows a loading or error state the player didn't ask for (the api.ts rule).
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useGlory } from "../net/api";

export const GloryPill = ({ style }: { style?: StyleProp<ViewStyle> }) => {
  const glory = useGlory();
  if (glory === null) return null;
  return (
    <View style={[styles.pill, style]} pointerEvents="none">
      <View style={styles.gem} />
      <Text style={styles.text}>{glory.toLocaleString()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderColor: "rgba(138,109,68,0.75)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,24,16,0.72)",
  },
  // The brand's rationed red, spent on one more small place.
  gem: { width: 6, height: 6, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  text: { color: "#e8c87a", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
});
