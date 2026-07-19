import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
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

export interface RoundBannerProps {
  kind: OutcomeKind;
  title: string;
  subtitle: string;
  /** [mine, theirs] — only shown on match-end. */
  score: [number, number];
}

export const RoundBanner = ({
  kind,
  title,
  subtitle,
  score,
}: RoundBannerProps) => {
  const look = LOOK[kind];
  // One driver for the plate (opacity + scale + rule sweep), one delayed driver
  // for the subtitle rise, one looping driver for the match-end glow breath.
  const intro = useRef(new Animated.Value(0)).current;
  const sub = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

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
