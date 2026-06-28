import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { KEY_COLORS, keyCount, type KeyColor, type KeyInventory } from "@heroic/engine";

/**
 * The on-screen key strip (docs/design/doors-and-keys.md): one pip per color the
 * player is holding, in palette order, with a count when they hold more than one.
 * Screen-space and camera-independent — it overlays the play area, not the world.
 *
 * It also surfaces a **hint**: when the player is pressed against a door they
 * can't open, that door's color shows as a ghosted "?" pip, so a locked door
 * teaches you *which* key to go find rather than just saying "locked". The strip
 * hides entirely when there's nothing to show.
 */
interface KeyHudProps {
  inventory: KeyInventory;
  /** Color of a locked door currently being bumped without its key, or null. */
  need?: KeyColor | null;
  style?: StyleProp<ViewStyle>;
}

export const KeyHud = ({ inventory, need, style }: KeyHudProps) => {
  const held = KEY_COLORS.filter((c) => keyCount(inventory, c.id) > 0);
  // Only hint when the needed key isn't already held (otherwise it'd just have opened).
  const needDef = need && keyCount(inventory, need) === 0
    ? KEY_COLORS.find((c) => c.id === need) ?? null
    : null;

  if (held.length === 0 && !needDef) return null;

  return (
    <View style={[styles.strip, style]} pointerEvents="none">
      {held.map((c) => {
        const n = keyCount(inventory, c.id);
        return (
          <View key={c.id} style={[styles.pip, { backgroundColor: c.hex }]}>
            {/* A small ring echoes the key's bow on the floor glyph. */}
            <View style={styles.bow} />
            {n > 1 && <Text style={styles.count}>{n}</Text>}
          </View>
        );
      })}
      {needDef && (
        <View style={[styles.pip, styles.pipNeed, { borderColor: needDef.hex }]}>
          <Text style={[styles.need, { color: needDef.hex }]}>?</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  strip: {
    position: "absolute",
    flexDirection: "row",
    gap: 8,
  },
  pip: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  pipNeed: {
    backgroundColor: "rgba(14, 17, 22, 0.55)",
    borderWidth: 2,
    borderStyle: "dashed",
  },
  bow: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.7)",
  },
  count: {
    position: "absolute",
    right: 2,
    bottom: 0,
    fontSize: 11,
    fontWeight: "800",
    color: "#0c0e12",
  },
  need: {
    fontSize: 16,
    fontWeight: "800",
  },
});
