/**
 * The result card after a challenge round (bits-challenges.md § screen):
 * cleared (attempt number, the Glory, the deeds ceremony, BACK TO CHALLENGES
 * lit to send you on to the next one) or lost (attempt +1, AGAIN one tap
 * away). Loss reads differently when it was the ward who fell. The lobby
 * BEFORE the round is RoomScreen in challenge dress.
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChallengeDef } from "@heroic/blood-in-the-sand-sim";
import { DISPLAY_FONT } from "../typography";
import { playSound, unlockAudio } from "../audio";
import { DeedReplayOverlay } from "./DeedCards";
import { loadCelebratedDeeds } from "../deeds/celebrated";
import type { ChallengeResult as ResultInfo } from "../net/practice";
import { peekChallengeProgress, progressOf } from "../challenges/progress";

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export const ChallengeResult = ({
  def,
  result,
  unlocks,
  onAgain,
  onBack,
}: {
  def: ChallengeDef;
  result: ResultInfo;
  /** Deeds the report unlocked — celebrated here once, DeedReplayOverlay-style. */
  unlocks: string[];
  onAgain: () => void;
  onBack: () => void;
}) => {
  const insets = useSafeAreaInsets();
  const [replay, setReplay] = useState<string[] | null>(null);
  const progress = progressOf(peekChallengeProgress(), def.id);
  const firstClear = result.cleared && progress.clears <= 1;

  // The ceremony rides in from the report (async — may land after mount).
  useEffect(() => {
    if (unlocks.length === 0) return;
    let live = true;
    void loadCelebratedDeeds().then((seen) => {
      const fresh = unlocks.filter((id) => !seen.has(id));
      if (live && fresh.length > 0) setReplay(fresh);
    });
    return () => {
      live = false;
    };
  }, [unlocks]);

  const again = (): void => {
    unlockAudio();
    playSound("uiConfirm");
    onAgain();
  };

  const back = (): void => {
    unlockAudio();
    playSound("uiConfirm");
    onBack();
  };

  const title = result.cleared ? "CLEARED" : result.reason === "ward" ? "THE ROOKIE'S DEAD" : result.reason === "draw" ? "NOBODY WINS" : "DEAD";
  const line = result.cleared
    ? `on the ${ordinal(Math.max(1, result.attempt))} attempt`
    : result.reason === "ward"
      ? "keep them breathing. that's the whole job."
      : result.reason === "draw"
        ? "everyone fell at once. it doesn't count."
        : `attempt ${Math.max(1, result.attempt)}. again?`;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.centre}>
        <Text style={styles.eyebrow}>{def.name}</Text>
        <Text style={[styles.title, result.cleared ? styles.titleWin : styles.titleLoss]}>{title}</Text>
        <Text style={styles.premise}>{line}</Text>
        {firstClear ? (
          <View style={styles.pay}>
            <Text style={styles.payAmount}>+{def.glory}</Text>
            <Text style={styles.payLabel}>GLORY · first clear</Text>
          </View>
        ) : result.cleared ? (
          <Text style={styles.wait}>already paid — this one was for the tally</Text>
        ) : null}
      </View>
      {/* A clear sends you on to the next challenge — BACK is the lit button
          and RUN IT BACK steps down (Tom kept re-running cleared ones). A loss
          keeps AGAIN one tap away. */}
      {result.cleared ? (
        <View style={styles.buttons}>
          <Pressable onPress={back} style={styles.primary}>
            <Text style={styles.primaryText}>BACK TO CHALLENGES</Text>
          </Pressable>
          <Pressable onPress={again} style={styles.ghost}>
            <Text style={styles.ghostText}>RUN IT BACK</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.buttons}>
          <Pressable onPress={again} style={styles.primary}>
            <Text style={styles.primaryText}>AGAIN</Text>
          </Pressable>
          <Pressable onPress={onBack} style={styles.ghost}>
            <Text style={styles.ghostText}>BACK TO CHALLENGES</Text>
          </Pressable>
        </View>
      )}
      {replay && <DeedReplayOverlay deeds={replay} onDone={() => setReplay(null)} />}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 24, justifyContent: "space-between" },
  centre: { flex: 1, justifyContent: "center", alignItems: "center", gap: 10 },
  eyebrow: { color: "#8a6d44", fontSize: 11, fontWeight: "900", letterSpacing: 3 },
  title: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 30,
    letterSpacing: 3,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  titleWin: { color: "#d9b46a" },
  titleLoss: { color: "#c7402e" },
  premise: { color: "#d9cbb4", fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 300 },
  rows: { marginTop: 12, gap: 4, alignItems: "center" },
  row: { color: "#d9cbb4", fontSize: 13 },
  rowLabel: { color: "#6b6257" },
  wait: { color: "#6b6257", fontSize: 12, fontStyle: "italic", marginTop: 16 },
  pay: { alignItems: "center", marginTop: 16 },
  payAmount: { fontFamily: DISPLAY_FONT, color: "#d9b46a", fontSize: 34, letterSpacing: 2 },
  payLabel: { color: "#8a6d44", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
  buttons: { gap: 10 },
  primary: { backgroundColor: "#8c2f2f", borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 2, fontSize: 15 },
  ghost: { borderColor: "#3a332a", borderWidth: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  ghostText: { color: "#8a7f70", fontWeight: "800", letterSpacing: 2, fontSize: 13 },
});
