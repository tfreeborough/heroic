import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_NAME = "bits.name";

export interface PracticeScreenProps {
  onBack: () => void;
  onStart: (playerName: string) => void;
}

/**
 * The practice front door: press play, fight a bot. No picks here — practice
 * runs the SAME 4-beat draft as real rooms (blind pick → reveal → counterpick),
 * so the loadout happens where it does in real matches. The name comes from
 * the same stored "playing as" the rooms screen uses.
 */
export const PracticeScreen = ({ onBack, onStart }: PracticeScreenProps) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("gladiator");

  useEffect(() => {
    void AsyncStorage.getItem(KEY_NAME).then((v) => {
      if (v?.trim()) setName(v.trim());
    });
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.back} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </Pressable>
        <Text style={styles.title}>PRACTICE</Text>
      </View>
      <Text style={styles.hint}>
        an offline bout against a bot — you'll draft your weapon and abilities, just like a real
        match (the bot drafts too)
      </Text>

      <Pressable onPress={() => onStart(name)} style={styles.play}>
        <Text style={styles.playText}>ENTER THE DRAFT</Text>
      </Pressable>
      <Text style={styles.playingAs}>{`playing as ${name}`}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 64, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 16 },
  back: { paddingVertical: 4 },
  backText: { color: "#8a7f70", fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  title: { color: "#d94141", fontSize: 28, fontWeight: "900", letterSpacing: 3 },
  hint: { color: "#8a7f70", fontSize: 13, marginTop: 10, lineHeight: 19 },
  play: {
    backgroundColor: "#3a5a3a",
    borderRadius: 8,
    marginTop: 28,
    paddingVertical: 14,
    alignItems: "center",
  },
  playText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 2, fontSize: 15 },
  playingAs: { color: "#6b6257", fontSize: 12, marginTop: 12, textAlign: "center" },
});
