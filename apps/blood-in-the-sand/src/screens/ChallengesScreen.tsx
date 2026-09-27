/**
 * The Challenges front door (docs/design/bits-challenges.md): four tier
 * rows of cards — name, premise, the Glory a first clear pays, your
 * attempt tally and a cleared tick. Tap a card → the match (a locked-kit
 * recipe arms you itself; the rest run the arming wizard like practice).
 * The tally is the device's (challenges/progress.ts); on open, the server's
 * copy is folded in so a reinstall keeps the brag number.
 *
 * The queue pill in the header is deliberate: challenges are the funnel
 * INTO ranked, not a substitute — the queue is one tap away from here.
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable, ScrollView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHALLENGES,
  CHALLENGE_TIERS,
  challengesOfTier,
  type ChallengeDef,
  type ChallengeTier,
} from "@heroic/blood-in-the-sand-sim";
import { ScreenHeader, ScreenSign } from "../components/ScreenHeader";
import { DISPLAY_FONT } from "../typography";
import { playSound, unlockAudio } from "../audio";
import { ensureIdentity, fetchAchievements } from "../net/api";
import {
  adoptServerCounters,
  loadChallengeProgress,
  onChallengeProgress,
  peekChallengeProgress,
  progressOf,
  type ChallengeProgressMap,
} from "../challenges/progress";

const KEY_NAME = "bits.name";

const TIER_LABELS: Record<ChallengeTier, { title: string; hint: string; colour: string }> = {
  easy: { title: "EASY", hint: "Something nice to get you warmed up", colour: "#6f9a5a" },
  medium: { title: "MEDIUM", hint: "Should give you a bit of difficulty", colour: "#c9a34a" },
  hard: { title: "HARD", hint: "Bragging rights", colour: "#c7702e" },
  deathwish: { title: "DEATHWISH", hint: "Only the best of the best", colour: "#c7402e" },
};

export interface ChallengesScreenProps {
  onBack: () => void;
  /** The header purse → the Armory. */
  onArmory: () => void;
  onStart: (playerName: string, challenge: ChallengeDef) => void;
  /** A deep link landed on a specific challenge — highlighted on open. */
  focusId?: string | null;
}

export const ChallengesScreen = ({ onBack, onArmory, onStart, focusId = null }: ChallengesScreenProps) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("gladiator");
  const [progress, setProgress] = useState<ChallengeProgressMap>(peekChallengeProgress());

  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(KEY_NAME).then((v) => {
      if (live && v?.trim()) setName(v.trim());
    });
    void loadChallengeProgress().then((p) => {
      if (live) setProgress({ ...p });
    });
    const off = onChallengeProgress(() => {
      if (live) setProgress({ ...peekChallengeProgress() });
    });
    // The server's tally — a reinstall or a second phone picks up where
    // the account left off. Best effort; offline the device's copy stands.
    void (async () => {
      const identity = await ensureIdentity();
      const me = identity ? await fetchAchievements(identity) : null;
      if (live && me) await adoptServerCounters(me.counters);
    })();
    return () => {
      live = false;
      off();
    };
  }, []);

  const start = (def: ChallengeDef): void => {
    unlockAudio();
    playSound("uiConfirm");
    onStart(name, def);
  };

  const cleared = Object.values(progress).filter((p) => p.clears > 0).length;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
      <ScreenHeader onBack={onBack} onPurse={onArmory} />
      <ScreenSign title="CHALLENGES" right={<Text style={styles.tally}>{cleared} / {CHALLENGES.length}</Text>} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Text style={styles.hint}>
          Fight against the odds, and win glory as your reward, some of these challenges are designed to make you think, sweat and bleed.
        </Text>
        {CHALLENGE_TIERS.map((tier) => (
          <View key={tier} style={styles.tier}>
            <View style={styles.tierHead}>
              <Text style={[styles.tierTitle, { color: TIER_LABELS[tier].colour }]}>{TIER_LABELS[tier].title}</Text>
              <Text style={styles.tierHint}>{TIER_LABELS[tier].hint}</Text>
            </View>
            {challengesOfTier(tier).map((def) => {
              const p = progressOf(progress, def.id);
              const done = p.clears > 0;
              const focused = def.id === focusId;
              return (
                <Pressable
                  key={def.id}
                  onPress={() => start(def)}
                  style={({ pressed }) => [
                    styles.card,
                    done && styles.cardDone,
                    focused && styles.cardFocused,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardName}>{def.name}</Text>
                    <Text style={styles.cardPremise}>{def.premise}</Text>
                    <Text style={styles.cardMeta}>
                      {p.attempts === 0
                        ? "not yet attempted"
                        : done
                          ? `cleared on attempt ${p.firstClearAttempt ?? p.attempts} · ${p.attempts} ${p.attempts === 1 ? "attempt" : "attempts"} in all`
                          : `${p.attempts} ${p.attempts === 1 ? "attempt" : "attempts"} so far`}
                    </Text>
                  </View>
                  <View style={styles.cardSide}>
                    {done ? (
                      <Text style={styles.tick}>✓</Text>
                    ) : (
                      <>
                        <Text style={styles.glory}>{def.glory}</Text>
                        <Text style={styles.gloryLabel}>GLORY</Text>
                      </>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Text style={styles.playingAs}>playing as {name}</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 20 },
  body: { paddingBottom: 24 },
  hint: { color: "#8a7f70", fontSize: 13, marginTop: 10, lineHeight: 19 },
  tally: { fontFamily: DISPLAY_FONT, color: "#d9b46a", fontSize: 16, letterSpacing: 1.5 },
  tier: { marginTop: 22, gap: 8 },
  tierHead: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: 2 },
  tierTitle: { fontFamily: DISPLAY_FONT, fontSize: 14, letterSpacing: 3 },
  tierHint: { color: "#6b6257", fontSize: 12, fontStyle: "italic", flexShrink: 1 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1d1712",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  cardDone: { borderColor: "#5a7a3a" },
  cardFocused: { borderColor: "#d9b46a" },
  cardPressed: { backgroundColor: "#262019" },
  cardCopy: { flex: 1, gap: 3 },
  cardName: { fontFamily: DISPLAY_FONT, color: "#f5ede0", fontSize: 16, letterSpacing: 1 },
  cardPremise: { color: "#d9cbb4", fontSize: 13, lineHeight: 18 },
  cardMeta: { color: "#6b6257", fontSize: 11, marginTop: 2 },
  cardSide: { alignItems: "center", minWidth: 44 },
  glory: { fontFamily: DISPLAY_FONT, color: "#d9b46a", fontSize: 18, letterSpacing: 1 },
  gloryLabel: { color: "#8a6d44", fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  tick: { color: "#8fbf6a", fontSize: 24, fontWeight: "900" },
  playingAs: { color: "#6b6257", fontSize: 12, marginTop: 20, textAlign: "center" },
});
