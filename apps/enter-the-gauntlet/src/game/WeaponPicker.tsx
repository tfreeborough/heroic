import { StyleSheet, Text, View } from "react-native";
// RNGH's Pressable (not RN's): it lives in the gesture-handler touch system, so
// it still registers taps while the thumbstick's pan gesture is active. RN's
// Pressable rides the legacy JS responder, which is blocked from claiming a
// second touch mid-gesture — so weapons couldn't be switched without first
// lifting off the stick.
import { Pressable } from "react-native-gesture-handler";
import { WEAPONS, type WeaponId } from "./weapons";

export interface WeaponPickerProps {
  selected: WeaponId;
  onSelect: (id: WeaponId) => void;
}

/**
 * Dev-facing weapon switcher for feel-testing the attack archetypes; the real
 * game will swap weapons through equipment, not a button column.
 */
export const WeaponPicker = ({ selected, onSelect }: WeaponPickerProps) => (
  <View style={styles.column}>
    {WEAPONS.map((w) => {
      const active = w.id === selected;
      return (
        <Pressable
          key={w.id}
          onPress={() => onSelect(w.id)}
          style={[styles.button, active && styles.buttonActive]}
        >
          <View style={[styles.swatch, { backgroundColor: w.color }]} />
          <View>
            <Text style={[styles.label, active && styles.labelActive]}>{w.label}</Text>
            <Text style={styles.tag}>{w.tag}</Text>
          </View>
        </Pressable>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  column: {
    gap: 8,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 132,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.14)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  buttonActive: {
    borderColor: "#f2c14e",
    backgroundColor: "rgba(242, 193, 78, 0.12)",
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 15,
    fontWeight: "600",
  },
  labelActive: {
    color: "#f2c14e",
  },
  tag: {
    color: "rgba(255, 255, 255, 0.35)",
    fontSize: 11,
  },
});
