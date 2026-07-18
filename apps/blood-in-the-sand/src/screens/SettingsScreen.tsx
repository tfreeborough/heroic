import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadLefty, saveLefty } from "../settings";

export interface SettingsScreenProps {
  onBack: () => void;
  /** The stored gladiator name ("" if never claimed). */
  playerName: string;
  /** Commit a new non-empty name — persists and applies from the next match. */
  onRename: (name: string) => void;
}

/**
 * Device settings: Lefty mode (mirrors the in-match control band) and the
 * gladiator name (first claimed on the way into PLAY — this is the only place
 * to change it afterwards). Saved on toggle / end of editing.
 */
export const SettingsScreen = ({ onBack, playerName, onRename }: SettingsScreenProps) => {
  const insets = useSafeAreaInsets();
  const [lefty, setLefty] = useState(false);
  const [name, setName] = useState(playerName);

  useEffect(() => {
    void loadLefty().then(setLefty);
  }, []);

  const toggleLefty = (on: boolean): void => {
    setLefty(on);
    saveLefty(on);
  };

  // An emptied field reverts rather than erasing the name (which would
  // re-trigger the first-run prompt on PLAY).
  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== playerName) onRename(trimmed);
    else setName(playerName);
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
          <Text style={styles.rowTitle}>Gladiator name</Text>
          <Text style={styles.rowHint}>how other players see you</Text>
        </View>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          onEndEditing={commitName}
          placeholder="your name"
          placeholderTextColor="#6b6257"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16}
        />
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
  nameInput: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    color: "#f0e8d8",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 140,
    textAlign: "center",
  },
  rowTitle: { color: "#f0e8d8", fontSize: 16, fontWeight: "700" },
  rowHint: { color: "#8a7f70", fontSize: 12 },
});
