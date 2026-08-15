import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  Canvas,
  ColorMatrix,
  Image as SkiaImage,
  LinearGradient,
  RadialGradient,
  Rect,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { playSound, unlockAudio } from "../audio";
import { GloryPill } from "../components/GloryPill";
import { devFlags } from "../dev";
import { DISPLAY_FONT } from "../typography";

export interface ModeSelectScreenProps {
  onBack: () => void;
  /** Skirmish → the existing online flow (name gate → room list → wizard). */
  onSkirmish: () => void;
  /** Ranked → the ranked home (bits-ranked.md): standing + queue. */
  onRanked: () => void;
  /** Practice → the bots-or-dummies front door. */
  onPractice: () => void;
  /** Deeds → the Chronicle (achievements.md § the codex). */
  onDeeds: () => void;
  /** The Glory pill's door: currency → what it buys (bits-store.md). */
  onArmory: () => void;
}

type ModeKey = "ranked" | "skirmish" | "practice" | "story" | "deeds";

/**
 * Per-mode card art. `image` is the forged PNG (assets/modes/<mode>.png,
 * 900×360 = 5:2 at ~2.2× phone density — scrim-covered background art
 * doesn't earn full 3×. The subject lives in the RIGHT two thirds and the
 * left third stays quiet: it renders right-anchored (CardArt), so any crop
 * comes off the quiet side under the scrim and text. Paired .forge.json
 * like every other art asset.) The `ramp` + `glow` painted a placeholder
 * gradient before the PNGs landed — kept as the fallback for any future
 * mode without art yet.
 */
const MODE_ART: Record<
  ModeKey,
  { image: number | null; ramp: [string, string, string]; glow: string; glowAt: [number, number] }
> = {
  ranked: { image: require("../../assets/modes/ranked.png"), ramp: ["#3a1c12", "#7a3a1e", "#b06a2c"], glow: "rgba(255,214,140,0.50)", glowAt: [0.78, 0.15] },
  skirmish: { image: require("../../assets/modes/skirmish.png"), ramp: ["#131a21", "#1c2733", "#2b241c"], glow: "rgba(255,160,60,0.55)", glowAt: [0.72, 0.85] },
  practice: { image: require("../../assets/modes/practice.png"), ramp: ["#4a3520", "#8a6d44", "#c9a76a"], glow: "rgba(245,237,224,0.45)", glowAt: [0.70, 0.10] },
  story: { image: require("../../assets/modes/story.png"), ramp: ["#241a12", "#2e2214", "#3a2a1a"], glow: "rgba(232,200,122,0.10)", glowAt: [0.75, 0.40] },
  deeds: { image: require("../../assets/modes/deeds.png"), ramp: ["#241a10", "#4a3520", "#8a6d44"], glow: "rgba(242,205,110,0.40)", glowAt: [0.76, 0.25] },
};

/**
 * How each card presents and reacts. Deliberately connectivity-blind (Tom,
 * 2026-07-28): this screen never probes anything — a dead server surfaces on
 * the play route's existing connect/error/update screen, one tap later.
 */
type CardState =
  | "live" //   full colour, breathing art, tap enters
  | "locked"; // not built yet (ranked pre-season, story): greyscale + faded — tap shakes

/** Luminance greyscale (ITU-R BT.709 weights) for locked cards' art. */
const GREYSCALE = [
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0, 0, 0, 1, 0,
];

/** Art sits back even when live — the card is UI first, poster second. */
const ART_OPACITY = 0.4;
/** Locked art fades harder on top of the greyscale drain. */
const LOCKED_ART_OPACITY = 0.28;

/** The forged art, or the painted stand-in for modes without a PNG yet. */
const CardArt = ({ mode, w, h, locked }: { mode: ModeKey; w: number; h: number; locked: boolean }) => {
  const art = MODE_ART[mode];
  // Unconditional hook; only locked cards pay the Skia decode (null → null).
  const skiaArt = useImage(locked ? art.image : null);
  if (art.image !== null && locked) {
    // Not-built-yet modes read as "waiting in the dark": the art drained to
    // greyscale (RN Image can't colour-filter — Skia does it) and faded,
    // no ribbon shouting over it.
    return (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {skiaArt && (
          <SkiaImage image={skiaArt} x={0} y={0} width={w} height={h} fit="cover" opacity={LOCKED_ART_OPACITY}>
            <ColorMatrix matrix={GREYSCALE} />
          </SkiaImage>
        )}
      </Canvas>
    );
  }
  if (art.image !== null) {
    // The dumbest thing that works: fill the card, `cover` centre-crop.
    // (A measured right-anchored crop was tried and rendered wrong on
    // device — the card and art aspects are close enough that centre
    // cropping trims a few percent per edge, which the briefs absorb.)
    return (
      <Animated.Image
        source={art.image}
        resizeMode="cover"
        style={{ width: "100%", height: "100%", opacity: ART_OPACITY }}
      />
    );
  }
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={vec(0, h)} end={vec(w, 0)} colors={art.ramp} />
      </Rect>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient
          c={vec(w * art.glowAt[0], h * art.glowAt[1])}
          r={w * 0.45}
          colors={[art.glow, "rgba(0,0,0,0)"]}
        />
      </Rect>
    </Canvas>
  );
};

/** Each card owns a slice of the shared entrance clock, top card first:
 *  card i fades/rises over [i × STAGGER, i × STAGGER + SLICE]. Shared with the
 *  screen's sound scheduling so the drum hits land exactly on the settles. */
const ENTRANCE_STAGGER = 0.18;
const ENTRANCE_SLICE = 0.4;

interface ModeCardProps {
  mode: ModeKey;
  title: string;
  pitch: string;
  state: CardState;
  /** Only fires for "live" — locked cards shake instead. */
  onEnter?: () => void;
  /** The screen's shared entrance clock + this card's slot in the stagger. */
  entrance: Animated.Value;
  index: number;
  /** Half-width cards (the Skirmish/Practice row) — smaller title so it
   * doesn't crowd the narrow card. */
  compact?: boolean;
}

const ModeCard = ({ mode, title, pitch, state, onEnter, entrance, index, compact = false }: ModeCardProps) => {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const locked = state === "locked";

  // Available art breathes; anything denied sits dead still — cold reads as
  // closed. (Scale rides the art wrapper so the border never moves.)
  useEffect(() => {
    if (state !== "live") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, breathe]);

  const deny = (): void => {
    unlockAudio();
    playSound("uiTap");
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const enter = (): void => {
    unlockAudio();
    playSound("uiConfirm");
    // Choosing a mode is a commitment beat — the one menu tap that pulses.
    if (!devFlags.disableHaptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onEnter?.();
  };

  const onPress = state === "live" ? enter : deny;

  const from = index * ENTRANCE_STAGGER;
  const to = from + ENTRANCE_SLICE;
  const rise = {
    opacity: entrance.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: "clamp" as const }),
    transform: [
      { translateY: entrance.interpolate({ inputRange: [from, to], outputRange: [14, 0], extrapolate: "clamp" as const }) },
      { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }) },
      { scale: pressed && state === "live" ? 0.98 : 1 },
    ],
  };

  return (
    <Animated.View style={[styles.card, locked && styles.cardDim, rise]}>
      <Pressable
        style={styles.cardFill}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {box && (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] },
            ]}
            pointerEvents="none"
          >
            <CardArt mode={mode} w={box.w} h={box.h} locked={locked} />
          </Animated.View>
        )}
        {/* the scrim — text always reads over any art */}
        {box && (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Rect x={0} y={0} width={box.w} height={box.h}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(box.w, 0)}
                colors={["rgba(10,6,4,0.85)", "rgba(10,6,4,0.55)", "rgba(10,6,4,0)"]}
                positions={[0, 0.42, 0.72]}
              />
            </Rect>
          </Canvas>
        )}
        <View style={styles.copy} pointerEvents="none">
          <Text style={[styles.title, compact && styles.titleCompact, locked && styles.titleDim]}>{title}</Text>
          <Text style={[styles.pitch, locked && styles.pitchDim]}>{pitch}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
};

/**
 * The fork behind PLAY (bits-mode-select.md; layout reworked 2026-08-04):
 * Ranked leads full-width, Skirmish + Practice share a half-width row (the
 * space saver), then Deeds, then locked Story. Locked modes render greyscale
 * instead of hiding — the closed doors are part of the sell. No connectivity
 * checks here: Skirmish always routes into the play flow, whose connect
 * screen already owns down/update states.
 */
export const ModeSelectScreen = ({ onBack, onSkirmish, onRanked, onPractice, onDeeds, onArmory }: ModeSelectScreenProps) => {
  const insets = useSafeAreaInsets();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The stack rises card by card, and the drum lands per card as EACH one
    // settles — a four-beat roll down the stack, not one hit after everything.
    // Listening to the clock (native-driven values still emit to JS listeners)
    // keeps the beats glued to the easing instead of guessing with timeouts.
    const settles = [0, 1, 2, 3].map((i) => i * ENTRANCE_STAGGER + ENTRANCE_SLICE);
    let next = 0;
    const sub = entrance.addListener(({ value }) => {
      while (next < settles.length && value >= settles[next]) {
        playSound("modeReveal");
        next += 1;
      }
    });
    Animated.timing(entrance, { toValue: 1, duration: 1000, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => entrance.removeListener(sub);
  }, [entrance]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            unlockAudio();
            playSound("uiBack");
            onBack();
          }}
          hitSlop={12}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <GloryPill
          onPress={() => {
            unlockAudio();
            playSound("uiTap");
            onArmory();
          }}
        />
      </View>

      <View style={styles.cards}>
        <ModeCard
          mode="ranked"
          title="RANKED"
          pitch="Win ultimate glory in the arena."
          state="live"
          onEnter={onRanked}
          entrance={entrance}
          index={0}
        />
        {/* The half-width pair — one row, one entrance beat, shared slot. */}
        <View style={styles.halfRow}>
          <ModeCard
            mode="skirmish"
            title="SKIRMISH"
            pitch="Quick games with friends."
            state="live"
            onEnter={onSkirmish}
            entrance={entrance}
            index={1}
            compact
          />
          <ModeCard
            mode="practice"
            title="PRACTICE"
            pitch="Spar with the computer."
            state="live"
            onEnter={onPractice}
            entrance={entrance}
            index={1}
            compact
          />
        </View>
        <ModeCard
          mode="deeds"
          title="DEEDS"
          pitch="Chart the legend you've carved."
          state="live"
          onEnter={onDeeds}
          entrance={entrance}
          index={2}
        />
        <ModeCard
          mode="story"
          title="STORY"
          pitch="Carve your legend into the sand."
          state="locked"
          entrance={entrance}
          index={3}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingBottom: 14,
  },
  back: { width: 44, paddingVertical: 2 },
  backText: { color: "#8a7f70", fontSize: 26, fontWeight: "800", lineHeight: 28 },
  cards: { flex: 1, gap: 12 },
  /** Skirmish + Practice side by side — each ModeCard's flex:1 splits the
   * width; the row itself takes one card-height unit of the column. */
  halfRow: { flex: 1, flexDirection: "row", gap: 12 },
  card: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#8a6d44",
    overflow: "hidden",
    backgroundColor: "#1d1712",
  },
  cardDim: { borderColor: "#4a3b26" },
  cardFill: { flex: 1 },
  copy: { flex: 1, justifyContent: "center", gap: 5, paddingHorizontal: 18, paddingVertical: 12 },
  title: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 22,
    letterSpacing: 3,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  titleCompact: { fontSize: 17, letterSpacing: 2 },
  titleDim: { color: "#cfc4b0" },
  pitch: { color: "#d9cbb4", fontSize: 13, lineHeight: 18, maxWidth: 240, flexShrink: 1 },
  pitchDim: { color: "#8d8272" },
});
