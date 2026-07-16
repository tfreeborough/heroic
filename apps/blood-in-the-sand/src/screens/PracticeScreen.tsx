import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_NAME = "bits.name";

export interface PracticeScreenProps {
  onBack: () => void;
  onStart: (playerName: string, teamSize: number) => void;
}

/**
 * The practice front door: pick a match size, press play, fight bots. No
 * picks here — practice runs the SAME arming wizard as real rooms, so the
 * loadout happens where it does in real matches. Above 1v1, bots fill BOTH
 * teams (you get bot allies). The name comes from the same stored "playing
 * as" the rooms screen uses.
 */
export const PracticeScreen = ({ onBack, onStart }: PracticeScreenProps) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("gladiator");
  const [teamSize, setTeamSize] = useState(1);

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
        an offline bout against bots — you'll arm your weapon and abilities, just like a real match
        (the bots arm too). above 1v1, bots fight beside you as well as against you
      </Text>

      <View style={styles.sizeRow}>
        {[1, 2, 3, 4].map((n) => (
          <Pressable
            key={n}
            onPress={() => setTeamSize(n)}
            style={[styles.sizeOption, teamSize === n && styles.sizeOptionOn]}
          >
            <Text style={[styles.sizeText, teamSize === n && styles.sizeTextOn]}>{`${n}v${n}`}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable onPress={() => onStart(name, teamSize)} style={styles.play}>
        <Text style={styles.playText}>ARM YOURSELF</Text>
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
  sizeRow: { flexDirection: "row", gap: 8, marginTop: 24 },
  sizeOption: {
    flex: 1,
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  sizeOptionOn: { backgroundColor: "#8c2f2f", borderColor: "#8c2f2f" },
  sizeText: { color: "#8a7f70", fontWeight: "800", fontSize: 13, letterSpacing: 1 },
  sizeTextOn: { color: "#f5ede0" },
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
