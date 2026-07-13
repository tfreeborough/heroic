import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadLefty, saveLefty } from "../settings";

export interface SettingsScreenProps {
  onBack: () => void;
}

/**
 * Device settings, reached from the rooms screen's ⚙. One entry so far:
 * Lefty mode (mirrors the in-match control band). Saved on toggle — applies
 * from the next match.
 */
export const SettingsScreen = ({ onBack }: SettingsScreenProps) => {
  const insets = useSafeAreaInsets();
  const [lefty, setLefty] = useState(false);

  useEffect(() => {
    void loadLefty().then(setLefty);
  }, []);

  const toggleLefty = (on: boolean): void => {
    setLefty(on);
    saveLefty(on);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </Pressable>
        <Text style={styles.title}>SETTINGS</Text>
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Lefty mode</Text>
          <Text style={styles.rowHint}>movement on the left, buttons on the right</Text>
        </View>
        <Switch
          value={lefty}
          onValueChange={toggleLefty}
          trackColor={{ false: "#3a332a", true: "#8c2f2f" }}
          thumbColor="#f0e8d8"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 64, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 16 },
  back: { paddingVertical: 4 },
  backText: { color: "#8a7f70", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  title: { color: "#d94141", fontSize: 28, fontWeight: "900", letterSpacing: 3 },
  row: {
    backgroundColor: "#1d1915",
    borderRadius: 8,
    marginTop: 24,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowText: { gap: 3, flexShrink: 1 },
  rowTitle: { color: "#f0e8d8", fontSize: 16, fontWeight: "700" },
  rowHint: { color: "#8a7f70", fontSize: 12 },
});
