/**
 * The ping pill (bits-regions.md § Stage 1): the player's round trip to the
 * game server, shown BEFORE a round — RankedScreen's header and the skirmish
 * lobby head — and never on the in-match HUD (the dev perf overlay is the
 * in-match read). Its whole job is to make "180ms" a fact the player saw
 * before the fight, so a soft thumb reads as distance, not a bug.
 *
 * Bands: green under 80ms (the Frankfurt floor for the UK/EU), amber to
 * 150 (playable, the windups carry it), red above (the other side of an
 * ocean). Hidden until the first pong lands — a dash flashing in while the
 * socket opens would be noise on every screen entry.
 *
 * `quiet` is the in-match dress (Tom, 2026-09-09: a live ping top-right so a
 * spike has a name): the same pill at reduced opacity, so it reads as an
 * instrument, not a HUD element competing with the score. GameScreen feeds
 * it the live INPUT round trip (GameClient.liveRttMs), not the lobby pong.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

export type PingBand = "good" | "fair" | "poor";

export const PING_GOOD_MAX_MS = 80;
export const PING_FAIR_MAX_MS = 150;

export const pingBand = (ms: number): PingBand => (ms < PING_GOOD_MAX_MS ? "good" : ms <= PING_FAIR_MAX_MS ? "fair" : "poor");

const BAND_COLOUR: Record<PingBand, string> = {
  good: "#6fae5c",
  fair: "#e0a23a",
  // The brand's rationed red — here it means exactly what it says.
  poor: "#c0392b",
};

export const PingPill = ({
  rtt,
  style,
  quiet = false,
}: {
  rtt: number | null | undefined;
  style?: StyleProp<ViewStyle>;
  quiet?: boolean;
}) => {
  if (rtt === null || rtt === undefined) return null;
  return (
    <View style={[styles.pill, quiet && styles.quiet, style]} pointerEvents="none">
      <View style={[styles.dot, { backgroundColor: BAND_COLOUR[pingBand(rtt)] }]} />
      <Text style={styles.text}>{`${Math.round(rtt)}ms`}</Text>
    </View>
  );
};

// The QueuePill's clothes — one header vocabulary (bits-screen-header.md).
const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderColor: "rgba(138,109,68,0.75)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,24,16,0.72)",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  quiet: { opacity: 0.72 },
  text: { color: "#e8c87a", fontSize: 10, fontWeight: "900", letterSpacing: 1.5, fontVariant: ["tabular-nums"] },
});
