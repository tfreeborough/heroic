/**
 * The post-match ceremony (bits-ranked.md § ceremony, 2026-08-02): a
 * full-screen overlay on the ranked home that reveals the settlement in
 * beats — the Glory count first, then a crossfade to the rating movement and
 * the rank moment. In-game the match-end plate is title + score only
 * (RoundBanner); this is where the numbers land, with their sounds
 * (glory_earned on the count, ceremony_shift on the crossfade, rank_up /
 * rank_down when the badge moves).
 *
 * Placements swap the rating beat for placement progress — the
 * numbers-stay-hidden rule (bits-ranked.md § placements) applies here too.
 *
 * Tap rules — premium, never trapping: a tap mid-count snaps the count home;
 * a tap on a finished beat advances (the last one dismisses). Every beat
 * also auto-advances except the final one, which waits for the tap.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { playSound } from "../audio";
import { badgeFor } from "../components/rankBadges";
import { rankName } from "../net/api";
import type { RankedResultRow } from "../net/connection";

export interface RankedCeremonyProps {
  won: boolean;
  mine: RankedResultRow;
  onDone: () => void;
}

const DISPLAY_FONT = Platform.select({ ios: "Copperplate", default: "serif" });

/** The Glory count — matched to the glory_earned choral swell so the last
 * tick lands as the choir fades. (Slowed from 2400 on Tom's device pass,
 * 2026-08-02: the count was over before the moment registered.) */
const GLORY_COUNT_MS = 3200;
/** The rating count — quicker; the number is the reveal, not the ride. */
const RATING_COUNT_MS = 1400;
/** Hold on a finished Glory count before the crossfade. */
const GLORY_HOLD_MS = 1000;
const FADE_MS = 300;
/** The scrim's rise — each beat (and its sound) waits for its fade to
 * finish, so nothing starts on a screen the player can't see yet (Tom's
 * device pass: the choir was already singing when the overlay appeared). */
const SCRIM_MS = 420;

/** Ease-out-cubic count from 0 → target driving a state number. Returns the
 * shown value and a snap-home used by the tap-to-skip rule — snapping also
 * stops the loop (the effect re-runs and bails), so a tap can't be un-done
 * by the next scheduled frame. */
const useCount = (target: number, durationMs: number, run: boolean): [number, () => void, boolean] => {
  const [shown, setShown] = useState(0);
  const [snapped, setSnapped] = useState(false);
  useEffect(() => {
    if (!run || snapped) return;
    const start = Date.now();
    let raf = 0;
    const tick = (): void => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      setShown(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, run, snapped]);
  const snap = (): void => {
    setSnapped(true);
    setShown(target);
  };
  return [shown, snap, run && shown >= target];
};

export const RankedCeremony = ({ won, mine, onDone }: RankedCeremonyProps) => {
  const [phase, setPhase] = useState<"glory" | "rating">("glory");
  // A beat is "ready" once its fade-in has finished — counts and sounds hold
  // until the player can actually see the screen they belong to.
  const [beatReady, setBeatReady] = useState(false);
  // The scrim rises once; the beat content crossfades inside it.
  const scrim = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(1)).current;
  const crossfading = useRef(false);

  const [glory, snapGlory, gloryDone] = useCount(mine.glory, GLORY_COUNT_MS, phase === "glory" && beatReady);
  // The rating counts the DELTA (before → after), signed either way.
  const [ratingStep, snapRating, ratingDone] = useCount(
    Math.abs(mine.after - mine.before),
    RATING_COUNT_MS,
    phase === "rating" && beatReady && !mine.placement,
  );
  const shownRating = mine.before + Math.sign(mine.after - mine.before) * ratingStep;
  // The rank moment holds back until the count lands — it caps the reveal.
  const rankBeat = mine.placement ? null : mine.rankChange;
  const rankRevealed = ratingDone && rankBeat !== null;
  const rankPop = useRef(new Animated.Value(0)).current;
  const rankSounded = useRef(false);

  useEffect(() => {
    // The swell waits for the scrim — on device the sound was already
    // playing over the tail of the screen transition.
    Animated.timing(scrim, { toValue: 1, duration: SCRIM_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
      playSound("gloryEarned");
      setBeatReady(true);
    });
  }, [scrim]);

  const crossfade = (): void => {
    if (crossfading.current || phase !== "glory") return;
    crossfading.current = true;
    setBeatReady(false);
    Animated.timing(beat, { toValue: 0, duration: FADE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      playSound("ceremonyShift");
      setPhase("rating");
      Animated.timing(beat, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
        setBeatReady(true);
      });
    });
  };

  // The Glory beat auto-advances after its hold; the rating beat waits for
  // the dismissing tap.
  useEffect(() => {
    if (!gloryDone) return;
    const timer = setTimeout(crossfade, GLORY_HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- crossfade is stable per phase
  }, [gloryDone]);

  useEffect(() => {
    if (!rankRevealed) return;
    if (!rankSounded.current) {
      rankSounded.current = true;
      playSound(rankBeat === "up" ? "rankUp" : "rankDown");
    }
    Animated.timing(rankPop, {
      toValue: 1,
      duration: rankBeat === "up" ? 480 : 300,
      // Promotions overshoot; demotions just fade — losing already stings.
      easing: rankBeat === "up" ? Easing.out(Easing.back(2.2)) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rankRevealed, rankBeat, rankPop]);

  const tap = (): void => {
    if (phase === "glory") {
      if (!gloryDone) snapGlory();
      else crossfade();
      return;
    }
    if (!mine.placement && !ratingDone) snapRating();
    else onDone();
  };

  const titleColor = won ? styles.titleWin : styles.titleLoss;
  const badge = mine.placement ? null : badgeFor(mine.tier);
  const settledDone = mine.placement ? true : ratingDone;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: scrim }]}>
      <Pressable onPress={tap} style={styles.fill}>
        <Animated.View style={[styles.centre, { opacity: beat }]}>
          {phase === "glory" ? (
            <>
              <Text style={[styles.title, titleColor]}>{won ? "VICTORY" : "DEFEAT"}</Text>
              <View style={styles.rule} />
              <Text style={styles.gloryNum}>{`+${glory}`}</Text>
              <Text style={styles.gloryCap}>GLORY</Text>
            </>
          ) : mine.placement ? (
            <>
              <Text style={styles.beatCap}>PLACEMENTS</Text>
              <Text style={styles.placementNum}>{`${mine.placement.number} / ${mine.placement.of}`}</Text>
              <Text style={styles.placementLine}>
                {mine.placement.of - mine.placement.number > 0
                  ? `${mine.placement.of - mine.placement.number} match${mine.placement.of - mine.placement.number === 1 ? "" : "es"} until your rank is forged`
                  : "your rank is forged — next match reveals it"}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.beatCap}>RATING</Text>
              <Text style={styles.ratingNum}>{shownRating}</Text>
              <Text style={[styles.delta, mine.delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
                {`${mine.delta >= 0 ? "+" : ""}${mine.delta}`}
              </Text>
              {/* The rank line: steady when the badge didn't move; the pop
                  moment when it did. */}
              {rankBeat === null ? (
                <View style={styles.rankRow}>
                  {badge !== null && <Image source={badge} style={styles.rankBadge} resizeMode="contain" />}
                  <Text style={styles.rankNameSteady}>{rankName(mine.tier, mine.division).toUpperCase()}</Text>
                </View>
              ) : (
                <Animated.View
                  style={[
                    styles.rankRow,
                    {
                      opacity: rankPop,
                      transform: [{ scale: rankPop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
                    },
                  ]}
                >
                  {rankBeat === "up" && badge !== null && (
                    <Image source={badge} style={styles.rankBadgeBig} resizeMode="contain" />
                  )}
                  <View>
                    <Text style={rankBeat === "up" ? styles.rankUpCap : styles.rankDownCap}>
                      {rankBeat === "up" ? "RANK UP" : "RANK DOWN"}
                    </Text>
                    <Text style={rankBeat === "up" ? styles.rankUpName : styles.rankDownName}>
                      {rankName(mine.tier, mine.division).toUpperCase()}
                    </Text>
                  </View>
                </Animated.View>
              )}
              {ratingDone && mine.newBest && <Text style={styles.newBest}>NEW SEASON BEST</Text>}
            </>
          )}
        </Animated.View>
        {phase === "rating" && settledDone && <Text style={styles.hint}>TAP TO CONTINUE</Text>}
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: { backgroundColor: "rgba(10,7,5,0.97)", zIndex: 10 },
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  title: {
    fontFamily: DISPLAY_FONT,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 6,
    textAlign: "center",
  },
  titleWin: {
    color: "#f2cd6e",
    textShadowColor: "rgba(232,176,72,0.75)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  titleLoss: {
    color: "#d0563f",
    textShadowColor: "rgba(150,40,30,0.62)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  rule: { width: 190, height: 2, borderRadius: 1, backgroundColor: "#8a6d44", marginVertical: 14, opacity: 0.85 },
  gloryNum: {
    fontFamily: DISPLAY_FONT,
    color: "#e8c87a",
    fontSize: 64,
    fontWeight: "900",
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(232,176,72,0.5)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  gloryCap: { color: "#d9cbb4", fontSize: 13, fontWeight: "900", letterSpacing: 6 },
  beatCap: { color: "#8a7f70", fontSize: 11, fontWeight: "800", letterSpacing: 4 },
  ratingNum: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 58,
    fontWeight: "900",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  delta: { fontSize: 17, fontWeight: "900", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  deltaUp: { color: "#e8c87a" },
  // Muted warm grey, deliberately NOT defeat-red — the number slipped, the
  // world didn't end.
  deltaDown: { color: "#9c8577" },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20 },
  rankBadge: { width: 34, height: 34 },
  rankBadgeBig: { width: 52, height: 52 },
  rankNameSteady: {
    fontFamily: DISPLAY_FONT,
    color: "#d9cbb4",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 2,
  },
  rankUpCap: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 3,
    color: "#f2cd6e",
    textShadowColor: "rgba(232,176,72,0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  rankUpName: {
    fontFamily: DISPLAY_FONT,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#f5ede0",
  },
  rankDownCap: { fontSize: 11, fontWeight: "800", letterSpacing: 3, color: "#9c8577" },
  rankDownName: {
    fontFamily: DISPLAY_FONT,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#b3a795",
  },
  newBest: { color: "#e8c87a", fontSize: 13, fontWeight: "900", letterSpacing: 3, marginTop: 16 },
  placementNum: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 54,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  placementLine: { color: "#d9cbb4", fontSize: 13, fontWeight: "700", letterSpacing: 0.5, marginTop: 6 },
  hint: {
    position: "absolute",
    bottom: 46,
    alignSelf: "center",
    color: "#8a7f70",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 3,
  },
});
