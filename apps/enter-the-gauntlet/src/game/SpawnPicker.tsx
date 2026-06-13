import { Pressable, StyleSheet, Text, View } from "react-native";
import { CREATURES, type EnemyTypeId } from "./constants";

export interface SpawnPickerProps {
  onSpawn: (type: EnemyTypeId) => void;
  onClear: () => void;
}

const TYPES = Object.keys(CREATURES) as EnemyTypeId[];

/**
 * Dev-facing test HUD overlaid on the play space: tap a creature to spawn one
 * near the player (tap repeatedly to build up a group of one archetype),
 * Clear to wipe them. Not a shipping control — the real game spawns from
 * encounter data.
 */
export const SpawnPicker = ({ onSpawn, onClear }: SpawnPickerProps) => (
  <View style={styles.bar} pointerEvents="box-none">
    {TYPES.map((type) => {
      const def = CREATURES[type];
      return (
        <Pressable key={type} onPress={() => onSpawn(type)} style={styles.button}>
          <View style={[styles.swatch, { backgroundColor: def.color }]} />
          <Text style={styles.label}>{def.label}</Text>
        </Pressable>
      );
    })}
    <Pressable onPress={onClear} style={[styles.button, styles.clear]}>
      <Text style={styles.clearLabel}>Clear</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 8,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    backgroundColor: "rgba(14, 17, 22, 0.72)",
  },
  clear: {
    borderColor: "rgba(232, 80, 58, 0.5)",
  },
  swatch: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  label: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    fontWeight: "600",
  },
  clearLabel: {
    color: "#e8503a",
    fontSize: 12,
    fontWeight: "600",
  },
});
