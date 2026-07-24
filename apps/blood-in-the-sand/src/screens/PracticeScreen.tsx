import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DIFFICULTIES, DIFFICULTY_IDS, type DifficultyId } from "@heroic/blood-in-the-sand-sim";
import { loadBotDifficulty, saveBotDifficulty } from "../settings";
import type { PracticeMode } from "../net/practice";

const KEY_NAME = "bits.name";

/** One line of expectation-setting per opponent — swaps with the picker. */
const OPPONENT_HINTS: Record<PracticeMode, string> = {
  bot: "an offline bout against bots — you'll arm your weapon and abilities, just like a real match (the bots arm too). above 1v1, bots fight beside you as well as against you",
  dummies:
    "the firing range — a line of respawning dummies that never fight back. arm any loadout and learn how every weapon and ability feels",
};

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
  onStart: (playerName: string, teamSize: number, difficulty: DifficultyId, opponent: PracticeMode) => void;
}

/**
 * The practice front door: pick your opponents (bots, or the target-dummy
 * firing range — dev-menu-only until the mode select made it a real feature),
 * and for bots a match size and skill tier. No loadout picks here — practice
 * runs the SAME arming wizard as real rooms, so arming happens where it does
 * in real matches. Above 1v1, bots fill BOTH teams (you get bot allies) —
 * every bot, friend or foe, fights at the picked tier. The tier persists
 * between visits (climbing the ladder shouldn't mean re-picking); the range
 * ignores size and tier entirely (a fixed line of dummies).
 */
export const PracticeScreen = ({ onBack, onStart }: PracticeScreenProps) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("gladiator");
  const [opponent, setOpponent] = useState<PracticeMode>("bot");
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
      <Text style={styles.hint}>{OPPONENT_HINTS[opponent]}</Text>

      <Text style={styles.sectionLabel}>OPPONENTS</Text>
      <View style={styles.sizeRow}>
        {(["bot", "dummies"] as const).map((o) => (
          <Pressable key={o} onPress={() => setOpponent(o)} style={[styles.sizeOption, opponent === o && styles.sizeOptionOn]}>
            <Text style={[styles.sizeText, opponent === o && styles.sizeTextOn]}>
              {o === "bot" ? "BOTS" : "TARGET DUMMIES"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* The range has no knobs — a fixed line of dummies, no size, no tier. */}
      {opponent === "bot" && (
        <>
          <Text style={styles.sectionLabel}>MATCH SIZE</Text>
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
        </>
      )}

      <Pressable onPress={() => onStart(name, teamSize, difficulty, opponent)} style={styles.play}>
        <Text style={styles.playText}>{opponent === "bot" ? "ARM YOURSELF" : "ENTER THE RANGE"}</Text>
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
  // Every chip row sits under a sectionLabel now — the label owns the gap.
  sizeRow: { flexDirection: "row", gap: 8 },
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
