import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import type { AbilityId, WeaponId } from "@heroic/blood-in-the-sand-sim";
import { LoadoutIcon } from "../loadout/icons";
import { playSound } from "../audio";
import { TitleFlex } from "./TitleFlex";
import type { OutcomeKind } from "./roundMessages";

// The premium centre banner for round- and match-end. Round outcomes get a
// compact gilded plate that springs in; the match-end VICTORY / DEFEAT gets the
// grand treatment — darker scrim, a big glowing title that breathes, and the
// final score. Classic RN Animated (native driver) to match HomeScreen/RoomList
// and stay off the JS thread while the arena keeps rendering behind it.
//
// Ranked settlements deliberately do NOT ride this plate (bits-ranked.md §
// ceremony, 2026-08-02): in-game the match-end is title + score only, and the
// Glory/rating reveal happens in RankedCeremony back on the ranked screen.

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

/** One winning-team seat on the match-end roll of honour
 * (bits-title-moments.md § moment 4). `title` is already-resolved display
 * text; `weapon`/`abilities` come from the matchEnd kit reveal and can be
 * null for a beat while the unveiled roomState is in flight — the icons pop
 * in when it lands. */
export interface HonourRow {
  id: number;
  name: string;
  title: string | null;
  weapon: WeaponId | null;
  abilities: AbilityId[] | null;
}

export interface RoundBannerProps {
  kind: OutcomeKind;
  title: string;
  subtitle: string;
  /** [mine, theirs] — only shown on match-end. */
  score: [number, number];
  /** The victors, match-end only — shown to BOTH sides (the flex). */
  honour?: HonourRow[];
}

/** Rows land staggered after the plate settles — a ceremony, not a table. */
const HONOUR_DELAY_MS = 900;
const HONOUR_STAGGER_MS = 450;

const HonourRowView = ({ row, index, color }: { row: HonourRow; index: number; color: string }) => {
  const land = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const delay = HONOUR_DELAY_MS + index * HONOUR_STAGGER_MS;
    Animated.timing(land, {
      toValue: 1,
      duration: 320,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // The deed-card stamp doubles as the row land — the honour roll is
    // deed-flavoured by design (bits-title-moments.md § sound).
    const stamp = setTimeout(() => playSound("deedUnlock"), delay);
    return () => clearTimeout(stamp);
  }, [land, index]);
  return (
    <Animated.View
      style={[
        styles.honourRow,
        {
          opacity: land,
          transform: [{ translateY: land.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      {/* Name and title stack — a title NEVER shares a line with the name
          (Tom, 2026-09-01: long name + long title blew the row out). */}
      <View style={styles.honourId}>
        <Text style={[styles.honourName, { color }]} numberOfLines={1}>
          {row.name}
        </Text>
        <TitleFlex title={row.title} size={11} style={styles.honourTitle} />
      </View>
      <View style={styles.honourIcons}>
        {row.weapon ? <LoadoutIcon id={row.weapon} size={22} /> : null}
        {(row.abilities ?? []).map((a) => (
          <LoadoutIcon key={a} id={a} size={22} />
        ))}
      </View>
    </Animated.View>
  );
};

export const RoundBanner = ({ kind, title, subtitle, score, honour }: RoundBannerProps) => {
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

          {/* The roll of honour (bits-title-moments.md § moment 4): the
              victors — name, worn title, and the kit the matchEnd reveal
              just unveiled. Shown on the DEFEAT plate too: reading who beat
              you, what they're called, and what they carried is the flex
              (and the shop window). */}
          {look.big && honour && honour.length > 0 ? (
            <View style={styles.honourCol}>
              {honour.map((row, i) => (
                <HonourRowView
                  key={row.id}
                  row={row}
                  index={i}
                  color={kind === "victory" ? "#5aa9e0" : "#e07a6a"}
                />
              ))}
            </View>
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
  honourCol: { marginTop: 22, gap: 12, width: 340, maxWidth: "88%" },
  honourRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  // The identity block: name over title, left-aligned; the flexed width (with
  // minWidth 0) is what lets both lines actually shrink instead of shoving
  // the icons off screen.
  honourId: { flex: 1, minWidth: 0, alignItems: "flex-start" },
  // Name in the winners' allegiance colour (your blue on victory, their red
  // on defeat) — the same cue the bodies and the scoreboard wear.
  honourName: {
    fontSize: 15,
    fontWeight: "800",
    maxWidth: "100%",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  honourTitle: { marginTop: 1 },
  honourIcons: { flexDirection: "row", alignItems: "center", gap: 6 },
});
