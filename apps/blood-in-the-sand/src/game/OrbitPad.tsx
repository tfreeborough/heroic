import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import type { PadMode } from "./controls";

const BUTTON = 62;

export interface OrbitPadProps {
  /** The engaged intent (null = standing). Owned by GameScreen. */
  mode: PadMode | null;
  /** Tap semantics: tap engages (auto-run), tapping the active intent stops. */
  onMode: (mode: PadMode | null) => void;
}

/**
 * Target-relative movement buttons — the no-stick scheme. Four auto-run
 * intents arranged as a diamond: IN closes on the enemy, OUT retreats along
 * the same line, the arrows orbit at your engaged distance. The thumb taps to
 * change intent instead of holding a position, which is the entire point.
 * The actual steering happens in GameScreen's onStep via padInput().
 */
export const OrbitPad = ({ mode, onMode }: OrbitPadProps) => {
  const tap = (m: PadMode) => () => onMode(mode === m ? null : m);

  const button = (m: PadMode, label: string) => (
    <Pressable
      onPress={tap(m)}
      style={[styles.button, mode === m && styles.active]}
      hitSlop={6}
    >
      <Text style={[styles.label, mode === m && styles.labelActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.pad}>
      <View style={styles.row}>{button("in", "IN")}</View>
      <View style={[styles.row, styles.spread]}>
        {button("ccw", "⟲")}
        {button("cw", "⟳")}
      </View>
      <View style={styles.row}>{button("out", "OUT")}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  pad: { width: BUTTON * 3 + 24, gap: 10 },
  row: { flexDirection: "row", justifyContent: "center" },
  spread: { justifyContent: "space-between" },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.18)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  active: {
    backgroundColor: "rgba(217, 65, 65, 0.55)",
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  label: { color: "rgba(255, 255, 255, 0.55)", fontSize: 17, fontWeight: "800" },
  labelActive: { color: "#f5ede0" },
});
