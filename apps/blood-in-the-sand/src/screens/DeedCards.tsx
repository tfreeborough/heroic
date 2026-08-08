/**
 * The deed cards (achievements.md § unlock ceremony) — the reveal logic and
 * card face, shared by the post-match ceremony's deeds beat
 * (RankedCeremony) and the deeds screen's missed-ceremony replay
 * (DeedReplayOverlay). One home so the feel is tuned ONCE: the eased 700ms
 * staged timeline (title settles → rule → description+reward rise →
 * counter), the sting, the snap rule, and the advance dwell all live here.
 *
 * A card is celebrated the moment its reveal STARTS (per card, not per
 * batch), so a mid-queue app death only replays what never appeared.
 */
import { useMemo, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ACHIEVEMENT_DEFS, type BitsAchievementDef } from "@heroic/blood-in-the-sand-sim";
import { playSound } from "../audio";
import { markDeedsCelebrated } from "../deeds/celebrated";
import { DEED_ICONS } from "../deeds/deedIcons";
import { DISPLAY_FONT } from "../typography";


/** A deed card ignores ADVANCING taps until this long after its reveal
 * started — the ~1s deed_unlock sting gets to finish instead of being
 * stepped on by the next card (Tom's device pass, 2026-08-04). The SNAP tap
 * stays instant: visuals land at once, only the advance waits. */
const DEED_MIN_DWELL_MS = 1100;
const REVEAL_MS = 700;
const SWAP_MS = 140;

const DEED_DEFS_BY_ID = new Map<string, BitsAchievementDef>(ACHIEVEMENT_DEFS.map((d) => [d.id, d]));

/** Ids → defs, dropping ids this bundle doesn't know (a newer server's
 * content) — those are NOT celebrated, so they replay after an app update. */
export const resolveDeedDefs = (ids: readonly string[]): BitsAchievementDef[] =>
  ids.map((id) => DEED_DEFS_BY_ID.get(id)).filter((d): d is BitsAchievementDef => d !== undefined);

export type DeedTapResult = "held" | "snapped" | "advanced" | "done";

export interface DeedReveal {
  shownDeed: BitsAchievementDef | undefined;
  deedIndex: number;
  count: number;
  /** A staged slice of the reveal timeline (clamped). */
  revealSlice: (from: number, to: number, outputRange: [number, number]) => Animated.AnimatedInterpolation<number>;
  /** Drive a tap into the cards; the caller dismisses on "done". */
  tap: () => DeedTapResult;
}

/**
 * The reveal state machine: ONE eased timeline per card, staged by
 * interpolation — every visible piece is driven by this value, so no card
 * can ever flash before its reveal (reworked 2026-08-03: a container
 * crossfade between cards showed the next title at full opacity before the
 * old stamp reset it). `active` = the surface is visible and ready — the
 * reveal (and its sting) never starts on a screen the player can't see.
 */
export const useDeedReveal = (
  deedDefs: readonly BitsAchievementDef[],
  active: boolean,
  rehearsal: boolean,
): DeedReveal => {
  const [deedIndex, setDeedIndex] = useState(0);
  const shownDeed = deedDefs[deedIndex];
  const deedReveal = useRef(new Animated.Value(0)).current;
  /** The reveal ran to completion (or a tap snapped it home). */
  const settled = useRef(false);
  /** Fading the old card down before the index moves — taps hold. */
  const swapping = useRef(false);
  /** When this card's reveal (and sting) started — the advance dwell gate. */
  const shownAtMs = useRef(0);

  useEffect(() => {
    if (!shownDeed || !active) return;
    swapping.current = false;
    settled.current = false;
    shownAtMs.current = Date.now();
    deedReveal.setValue(0);
    playSound("deedUnlock");
    if (!rehearsal) markDeedsCelebrated([shownDeed.id]);
    Animated.timing(deedReveal, {
      toValue: 1,
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) settled.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one reveal per shown card
  }, [shownDeed, active]);

  const revealSlice = (from: number, to: number, outputRange: [number, number]) =>
    deedReveal.interpolate({ inputRange: [from, to], outputRange, extrapolate: "clamp" });

  const tap = (): DeedTapResult => {
    if (!active || swapping.current) return "held"; // mid-transition
    if (!settled.current) {
      // The snap rule: a tap mid-reveal lands the whole card at once.
      deedReveal.stopAnimation();
      deedReveal.setValue(1);
      settled.current = true;
      return "snapped";
    }
    // The dwell gate: never advance under the sting's tail.
    if (Date.now() - shownAtMs.current < DEED_MIN_DWELL_MS) return "held";
    if (deedIndex + 1 < deedDefs.length) {
      // Quick fade-down, then the next card runs its own reveal — the
      // surface never crossfades between cards (see the reveal comment).
      swapping.current = true;
      Animated.timing(deedReveal, {
        toValue: 0,
        duration: SWAP_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setDeedIndex((i) => i + 1));
      return "advanced";
    }
    return "done";
  };

  return { shownDeed, deedIndex, count: deedDefs.length, revealSlice, tap };
};

/** One card's face — cap, title, rule, description-as-reveal, reward,
 * counter — all staged off the shared reveal timeline. */
export const DeedCardFace = ({ reveal }: { reveal: DeedReveal }) => {
  const { shownDeed, deedIndex, count, revealSlice } = reveal;
  if (!shownDeed) return null;
  const iconSource = DEED_ICONS[shownDeed.icon] ?? null;
  return (
    <>
      {/* Steady anchor — it never moves between cards. */}
      <Text style={styles.deedCap}>DEED COMPLETE</Text>
      {iconSource != null && (
        <Animated.View
          style={{
            opacity: revealSlice(0, 0.35, [0, 1]),
            transform: [{ scale: revealSlice(0, 0.35, [1.12, 1]) }],
          }}
        >
          <Image source={iconSource} style={styles.deedIcon} resizeMode="contain" />
        </Animated.View>
      )}
      <Animated.View
        style={{
          opacity: revealSlice(0, 0.35, [0, 1]),
          transform: [{ scale: revealSlice(0, 0.35, [1.12, 1]) }],
        }}
      >
        <Text style={styles.deedTitle}>{shownDeed.title.toUpperCase()}</Text>
      </Animated.View>
      <Animated.View style={{ opacity: revealSlice(0.3, 0.55, [0, 1]) }}>
        <View style={styles.rule} />
      </Animated.View>
      {/* The description IS the reveal: frontier players only ever saw the
          title. It rises in after the title has landed. */}
      <Animated.View
        style={{
          opacity: revealSlice(0.45, 0.8, [0, 1]),
          transform: [{ translateY: revealSlice(0.45, 0.8, [10, 0]) }],
          alignItems: "center",
        }}
      >
        <Text style={styles.deedDesc}>{shownDeed.description}</Text>
        {shownDeed.rewards?.map((r, i) => (
          <Text key={i} style={styles.deedReward}>
            {r.kind === "glory" ? `+${r.amount} GLORY` : r.kind === "entitlement" ? "NEW SPOILS CLAIMED" : "TITLE EARNED"}
          </Text>
        ))}
      </Animated.View>
      {count > 1 && (
        <Animated.Text style={[styles.deedCount, { opacity: revealSlice(0.7, 1, [0, 1]) }]}>
          {`${deedIndex + 1} OF ${count}`}
        </Animated.Text>
      )}
    </>
  );
};

/**
 * The missed-ceremony replay (achievements.md § unlock ceremony): mounted by
 * the deeds screen over anything in /achievements/me the local celebrated
 * set hasn't seen — a disconnect delays the moment, never skips it. Same
 * scrim-then-cards shape as the post-match ceremony, minus the settlement
 * beats (there's no fresh match to settle).
 */
export const DeedReplayOverlay = ({ deeds, onDone }: { deeds: string[]; onDone: () => void }) => {
  const insets = useSafeAreaInsets();
  const deedDefs = useMemo(() => resolveDeedDefs(deeds), [deeds]);
  const [ready, setReady] = useState(false);
  const scrim = useRef(new Animated.Value(0)).current;
  const reveal = useDeedReveal(deedDefs, ready, false);

  useEffect(() => {
    Animated.timing(scrim, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      () => setReady(true),
    );
  }, [scrim]);

  // Every id resolved to nothing (an update gap) — nothing to show.
  useEffect(() => {
    if (deedDefs.length === 0) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [deedDefs.length]);
  if (deedDefs.length === 0) return null;

  const tap = (): void => {
    if (reveal.tap() === "done") onDone();
  };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.replayRoot, { opacity: scrim }]}>
      <Pressable onPress={tap} style={styles.fill}>
        <View style={styles.centre}>
          <DeedCardFace reveal={reveal} />
        </View>
        {ready && <Text style={[styles.hint, { bottom: insets.bottom + 34 }]}>TAP TO CONTINUE</Text>}
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  replayRoot: { backgroundColor: "rgba(10,7,5,0.97)", zIndex: 10 },
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  rule: { width: 190, height: 2, borderRadius: 1, backgroundColor: "#8a6d44", marginVertical: 14, opacity: 0.85 },
  deedCap: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
    color: "#f2cd6e",
    textShadowColor: "rgba(232,176,72,0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
    marginBottom: 10,
  },
  deedIcon: { width: 76, height: 76, marginBottom: 8 },
  deedTitle: {
    fontFamily: DISPLAY_FONT,
    fontSize: 30,
    letterSpacing: 3,
    textAlign: "center",
    color: "#f2cd6e",
    textShadowColor: "rgba(232,176,72,0.75)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
    paddingHorizontal: 28,
  },
  deedDesc: {
    color: "#d9cbb4",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 21,
  },
  deedReward: { color: "#e8c87a", fontSize: 13, fontWeight: "900", letterSpacing: 3, marginTop: 14 },
  deedCount: { color: "#8a7f70", fontSize: 11, fontWeight: "800", letterSpacing: 3, marginTop: 18 },
  hint: {
    position: "absolute",
    alignSelf: "center",
    color: "#8a7f70",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 3,
  },
});
