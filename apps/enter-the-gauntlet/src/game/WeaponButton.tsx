import { StyleSheet, Text, View } from "react-native";
// RNGH's Pressable (not RN's): it still registers taps while the thumbstick's
// pan gesture is active, so you can swap weapons without lifting off the stick.
import { Pressable } from "react-native-gesture-handler";
import { WEAPONS, type WeaponId } from "./weapons";

export interface WeaponButtonProps {
  /** The currently equipped weapon. */
  selected: WeaponId;
  /** Advance to the next weapon in WEAPONS, wrapping at the end. */
  onCycle: () => void;
}

/**
 * Single-button weapon switcher: shows what's equipped (swatch + name) and, on
 * tap, cycles to the next weapon in the list (wrapping around). Replaces the old
 * column of buttons now that the bottom-right is shared with the dash action.
 * Still a dev affordance — the real game swaps weapons through equipment.
 */
export const WeaponButton = ({ selected, onCycle }: WeaponButtonProps) => {
  const weapon = WEAPONS.find((w) => w.id === selected) ?? WEAPONS[0]!;
  return (
    <Pressable onPress={onCycle} style={styles.button} hitSlop={6}>
      <View style={[styles.swatch, { backgroundColor: weapon.color }]} />
      <View style={styles.labels}>
        <Text style={styles.label}>{weapon.label}</Text>
        <Text style={styles.tag}>{weapon.tag}</Text>
      </View>
      <Text style={styles.cycle}>↻</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 140,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#f2c14e",
    backgroundColor: "rgba(242, 193, 78, 0.12)",
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  labels: {
    flex: 1,
  },
  label: {
    color: "#f2c14e",
    fontSize: 15,
    fontWeight: "600",
  },
  tag: {
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 11,
  },
  cycle: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 18,
    fontWeight: "600",
  },
});
