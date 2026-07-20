import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from "@heroic/blood-in-the-sand-sim";
import { loadBotDifficulty, saveBotDifficulty } from "../settings";

const KEY_NAME = "bits.name";

/** One line of expectation-setting per tier — the picker's caption. */
const TIER_HINTS: Record<DifficultyId, string> = {
  novice: "slow eyes, clumsy thumbs — a first fight",
  average: "still generous — punishes only the obvious",
  experienced: "keeps up when you play straight",
  skilled: "plays like a person",
  adept: "sharp — sloppy play gets bled",
  masterful: "near-perfect play; a real fight to win",
  inhuman: "faster than any human. bring a plan",
  godlike: "it is not fair. it is not meant to be",
};

export interface PracticeScreenProps {
  onBack: () => void;
  onStart: (playerName: string, teamSize: number, difficulty: DifficultyId) => void;
}

/**
 * The practice front door: pick a match size and how good the bots are,
 * press play, fight. No picks here — practice runs the SAME arming wizard as
 * real rooms, so the loadout happens where it does in real matches. Above
 * 1v1, bots fill BOTH teams (you get bot allies) — every bot, friend or foe,
 * fights at the picked tier. The tier persists between visits (climbing the
 * ladder shouldn't mean re-picking).
 */
export const PracticeScreen = ({ onBack, onStart }: PracticeScreenProps) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("gladiator");
  const [teamSize, setTeamSize] = useState(1);
  const [difficulty, setDifficulty] = useState<DifficultyId>("skilled");

  useEffect(() => {
    void AsyncStorage.getItem(KEY_NAME).then((v) => {
      if (v?.trim()) setName(v.trim());
    });
    void loadBotDifficulty().then(setDifficulty);
  }, []);

  const pickDifficulty = (d: DifficultyId): void => {
    setDifficulty(d);
    saveBotDifficulty(d);
  };

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

      <Text style={styles.sectionLabel}>BOT SKILL</Text>
      <View style={styles.tierGrid}>
        {DIFFICULTY_IDS.map((d) => (
          <Pressable
            key={d}
            onPress={() => pickDifficulty(d)}
            style={[styles.tierOption, difficulty === d && styles.tierOptionOn]}
          >
            <Text style={[styles.tierText, difficulty === d && styles.tierTextOn]}>
              {DIFFICULTIES[d].name.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.tierHint}>{TIER_HINTS[difficulty]}</Text>

      <Pressable onPress={() => onStart(name, teamSize, difficulty)} style={styles.play}>
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
  sectionLabel: {
    color: "#6b6257",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: 24,
    marginBottom: 8,
  },
  // 8 tiers as a 4×2 grid — same chip language as the size row, tighter type.
  tierGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tierOption: {
    flexBasis: "23%",
    flexGrow: 1,
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  tierOptionOn: { backgroundColor: "#8c2f2f", borderColor: "#8c2f2f" },
  tierText: { color: "#8a7f70", fontWeight: "800", fontSize: 10, letterSpacing: 0.5 },
  tierTextOn: { color: "#f5ede0" },
  tierHint: { color: "#6b6257", fontSize: 12, marginTop: 8, fontStyle: "italic" },
  play: {
    backgroundColor: "#3a5a3a",
    borderRadius: 8,
    marginTop: 24,
    paddingVertical: 14,
    alignItems: "center",
  },
  playText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 2, fontSize: 15 },
  playingAs: { color: "#6b6257", fontSize: 12, marginTop: 12, textAlign: "center" },
});
