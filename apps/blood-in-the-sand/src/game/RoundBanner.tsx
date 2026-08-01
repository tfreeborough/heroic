import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, StyleSheet, Text, View } from "react-native";
import type { OutcomeKind } from "./roundMessages";

// The premium centre banner for round- and match-end. Round outcomes get a
// compact gilded plate that springs in; the match-end VICTORY / DEFEAT gets the
// grand treatment — darker scrim, a big glowing title that breathes, and the
// final score. Classic RN Animated (native driver) to match HomeScreen/RoomList
// and stay off the JS thread while the arena keeps rendering behind it.

interface Look {
  /** Title colour. */
  color: string;
  /** Glow colour behind the title (the breathing copy on match-end). */
  glow: string;
  /** Backdrop scrim — match-end darkens harder to sell the finality. */
  scrim: string;
  /** Match-end grandeur: bigger type, glow pulse, score row. */
  big: boolean;
}

const LOOK: Record<OutcomeKind, Look> = {
  roundWin: {
    color: "#e6b95e",
    glow: "rgba(217,154,65,0.55)",
    scrim: "rgba(10,8,6,0.26)",
    big: false,
  },
  roundLoss: {
    color: "#d6785d",
    glow: "rgba(150,50,40,0.5)",
    scrim: "rgba(10,8,6,0.30)",
    big: false,
  },
  roundDraw: {
    color: "#c7ad82",
    glow: "rgba(120,100,70,0.45)",
    scrim: "rgba(10,8,6,0.28)",
    big: false,
  },
  victory: {
    color: "#f2cd6e",
    glow: "rgba(232,176,72,0.75)",
    scrim: "rgba(8,6,4,0.62)",
    big: true,
  },
  defeat: {
    color: "#d0563f",
    glow: "rgba(150,40,30,0.62)",
    scrim: "rgba(8,6,4,0.66)",
    big: true,
  },
};

/** The match-end rank-change moment (bits-ranked.md § display v2): the
 * visual half of the rank_up / rank_down audio. Promotions get the new crest
 * popping in with "RANK UP"; demotions get one muted line and no ceremony —
 * losing already stings. */
export interface RankCallout {
  direction: "up" | "down";
  /** The new rank's full name ("GLADIATOR I"). */
  label: string;
  /** The new tier's forged crest, or null while unforged. */
  badge: number | null;
}

/** The ranked settlement under the score — structured (not a prebuilt
 * string) so the Glory number can COUNT. */
export interface RankedSettle {
  /** The pre-Glory portion ("1520 → 1540 (+20)" / "PLACEMENT MATCH 3 OF 10"). */
  line: string;
  glory: number;
  newBest: boolean;
}

export interface RoundBannerProps {
  kind: OutcomeKind;
  title: string;
  subtitle: string;
  /** [mine, theirs] — only shown on match-end. */
  score: [number, number];
  /** Ranked match-end only (bits-ranked.md): the settlement riding under the
   * score, with its Glory count-up. */
  ranked?: RankedSettle | null;
  /** Ranked match-end only: the displayed rank moved this match. */
  rankCallout?: RankCallout | null;
}

/** How long the Glory number takes to count home — matched to the
 * glory_earned choral swell (~4s), which fires on the same arrival: fast
 * early ticks easing off so the last +1 lands as the choir fades. */
const GLORY_COUNT_MS = 4000;

/** The settlement line with its counting Glory number. Ease-out cubic: most
 * of the count lands in the first second and a half, then it crawls — small
 * amounts (5–29) stretch into single satisfying ticks. NEW BEST holds back
 * until the count completes (it caps the moment, not the arrival). */
const RankedSettleLine = ({ settle }: { settle: RankedSettle }) => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = Date.now();
    let raf = 0;
    const tick = (): void => {
      const t = Math.min(1, (Date.now() - start) / GLORY_COUNT_MS);
      setShown(Math.round(settle.glory * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [settle.glory]);
  const done = shown >= settle.glory;
  return (
    <Text style={styles.rankedLine}>
      {`${settle.line}  ·  +${shown} GLORY`}
      {settle.newBest ? <Text style={{ opacity: done ? 1 : 0 }}>{"  ·  NEW BEST"}</Text> : null}
    </Text>
  );
};

export const RoundBanner = ({
  kind,
  title,
  subtitle,
  score,
  ranked = null,
  rankCallout = null,
}: RoundBannerProps) => {
  const look = LOOK[kind];
  // One driver for the plate (opacity + scale + rule sweep), one delayed driver
  // for the subtitle rise, one looping driver for the match-end glow breath.
  const intro = useRef(new Animated.Value(0)).current;
  const sub = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  // The rank callout rides its OWN driver keyed on arrival, not the intro:
  // the settlement broadcast lands a beat after the plate is already up, so
  // the crest pops the moment the data exists (in step with the rank_up
  // fanfare, which fires on the same arrival).
  const callout = useRef(new Animated.Value(0)).current;
  const calloutKey = rankCallout ? `${rankCallout.direction}:${rankCallout.label}` : null;
  useEffect(() => {
    callout.setValue(0);
    if (!calloutKey) return;
    Animated.timing(callout, {
      toValue: 1,
      duration: rankCallout?.direction === "up" ? 480 : 300,
      // Promotions overshoot like the plate itself; demotions just fade.
      easing: rankCallout?.direction === "up" ? Easing.out(Easing.back(2.2)) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the callout's identity
  }, [callout, calloutKey]);

  useEffect(() => {
    intro.setValue(0);
    sub.setValue(0);
    // Plate springs in with a touch of overshoot — heavier bounce for match-end.
    Animated.timing(intro, {
      toValue: 1,
      duration: look.big ? 520 : 380,
      easing: Easing.out(Easing.back(look.big ? 1.9 : 1.5)),
      useNativeDriver: true,
    }).start();
    // Flavour line settles a beat after the title lands.
    Animated.timing(sub, {
      toValue: 1,
      duration: 340,
      delay: look.big ? 380 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (look.big) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
  }, [intro, sub, pulse, look.big]);

  const plateOpacity = intro.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const plateScale = intro.interpolate({
    inputRange: [0, 1],
    outputRange: [look.big ? 0.7 : 0.84, 1],
  });
  const ruleScale = intro; // 0 → 1 sweeps the hairline rules open
  const subOpacity = sub;
  const subRise = sub.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });
  // Match-end title breathes: a faint zoom + a glow copy fading in and out.
  const titleScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, look.big ? 1.035 : 1],
  });
  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.9],
  });

  const titleSize = look.big ? 54 : 42;
  const titleStyle = {
    fontSize: titleSize,
    fontWeight: "900" as const,
    color: look.color,
    letterSpacing: look.big ? 6 : 4,
    textAlign: "center" as const,
    textShadowColor: look.glow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: look.big ? 18 : 10,
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* backdrop scrim — fades with the plate so the arena stays legible */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: look.scrim, opacity: plateOpacity },
        ]}
      />
      <View style={styles.centre}>
        <Animated.View
          style={{
            opacity: plateOpacity,
            transform: [{ scale: plateScale }],
            alignItems: "center",
          }}
        >
          <Animated.View
            style={[
              styles.rule,
              look.big && styles.ruleBig,
              { backgroundColor: look.color, transform: [{ scaleX: ruleScale }] },
            ]}
          />

          <View style={styles.titleWrap}>
            {look.big ? (
              // A blurred-feeling glow copy sat behind the crisp title, its
              // opacity breathing with the pulse loop.
              <Animated.Text
                numberOfLines={1}
                style={[
                  titleStyle,
                  styles.titleGlow,
                  { textShadowRadius: 34, opacity: glowOpacity },
                ]}
              >
                {title}
              </Animated.Text>
            ) : null}
            <Animated.Text
              numberOfLines={1}
              style={[titleStyle, { transform: [{ scale: titleScale }] }]}
            >
              {title}
            </Animated.Text>
          </View>

          <Animated.View
            style={[
              styles.rule,
              look.big && styles.ruleBig,
              { backgroundColor: look.color, transform: [{ scaleX: ruleScale }] },
            ]}
          />

          <Animated.Text
            style={[
              styles.subtitle,
              look.big && styles.subtitleBig,
              { opacity: subOpacity, transform: [{ translateY: subRise }] },
            ]}
          >
            {subtitle}
          </Animated.Text>

          {look.big ? (
            <Animated.View
              style={[
                styles.scoreRow,
                { opacity: subOpacity, transform: [{ translateY: subRise }] },
              ]}
            >
              <Animated.Text style={[styles.scoreNum, { color: look.color }]}>
                {score[0]}
              </Animated.Text>
              <Animated.Text style={styles.scoreDash}>—</Animated.Text>
              <Animated.Text style={styles.scoreNum}>{score[1]}</Animated.Text>
            </Animated.View>
          ) : null}

          {look.big && ranked ? (
            <Animated.View style={{ opacity: subOpacity, transform: [{ translateY: subRise }] }}>
              <RankedSettleLine settle={ranked} />
            </Animated.View>
          ) : null}

          {look.big && rankCallout ? (
            rankCallout.direction === "up" ? (
              <Animated.View
                style={[
                  styles.rankUp,
                  {
                    opacity: callout,
                    transform: [{ scale: callout.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
                  },
                ]}
              >
                {rankCallout.badge !== null && (
                  <Image source={rankCallout.badge} style={styles.rankUpBadge} resizeMode="contain" />
                )}
                <View>
                  <Animated.Text style={styles.rankUpCap}>RANK UP</Animated.Text>
                  <Animated.Text style={styles.rankUpName}>{rankCallout.label}</Animated.Text>
                </View>
              </Animated.View>
            ) : (
              // One quiet line, no crest, no ceremony — the demotion twin of
              // rank_down's "subtle, non-punishing" rule.
              <Animated.Text style={[styles.rankDownLine, { opacity: callout }]}>
                {`RANK DOWN · ${rankCallout.label}`}
              </Animated.Text>
            )
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  centre: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // Gilded hairline that frames the title; scaleX sweeps it open on entrance.
  rule: {
    width: 132,
    height: 2,
    borderRadius: 1,
    marginVertical: 10,
    opacity: 0.85,
  },
  ruleBig: { width: 230, height: 3, marginVertical: 16 },
  titleWrap: { alignItems: "center", justifyContent: "center" },
  // The glow copy is layered exactly over the crisp title.
  titleGlow: { position: "absolute" },
  rankedLine: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: "800",
    color: "#e8c87a",
    letterSpacing: 1.5,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    // The Glory count ticks — fixed-width digits keep the line from jittering.
    fontVariant: ["tabular-nums"],
  },
  rankUp: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 },
  rankUpBadge: { width: 46, height: 46 },
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
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#f5ede0",
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Muted warm grey, deliberately NOT defeat-red — the badge slipped, the
  // world didn't end.
  rankDownLine: {
    marginTop: 12,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: "#9c8577",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "600",
    fontStyle: "italic",
    color: "#e8dcc4",
    opacity: 0.9,
    letterSpacing: 0.5,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitleBig: { fontSize: 18, marginTop: 8 },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 18,
  },
  scoreNum: {
    fontSize: 30,
    fontWeight: "900",
    color: "#8a7f70",
    fontVariant: ["tabular-nums"],
  },
  scoreDash: { fontSize: 22, color: "#6b6155" },
});
