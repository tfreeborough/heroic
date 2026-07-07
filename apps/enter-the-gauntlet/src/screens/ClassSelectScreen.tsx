// Class selection — a hero-style carousel: full-bleed class art fading through
// a Skia gradient into a stat panel on the lower half. The carousel is
// finger-tracked: all three portraits live on a strip driven by a shared
// translateX, so they move WITH the swipe (neighbours peeking in, a slight
// scale/fade falloff for depth) and settle with a clean ease-out — no spring
// wobble. Arrows drive the same settle.
//
// Stats are deliberately non-numeric: each core attribute is a colour-coded,
// segmented bar showing where the class sits RELATIVE to the other classes
// (the best class in a stat fills the bar). The bars stay mounted across
// swaps and animate between fills with a small cascade — comparison is the
// message; exact numbers live in-game where they matter (character sheet,
// later).

import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CLASS_LIST, type ClassDef, type ClassId } from "@heroic/core";
import type { RootStackParamList } from "../navigation/types";
import { useCharacter } from "../character/CharacterContext";
import { MenuButton } from "../ui/MenuButton";
import { UI } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "ClassSelect">;

const N = CLASS_LIST.length;

// Class portraits (assets/classes/, pngquant-optimized). A class without art
// falls back to a monogram panel.
const CLASS_ART: Partial<Record<ClassId, ImageSourcePropType>> = {
  warrior: require("../../assets/classes/warrior.png"),
  ranger: require("../../assets/classes/ranger.png"),
  mage: require("../../assets/classes/mage.png"),
};

// The screen's base backdrop, shared by all classes (pngquant-optimized).
const SCREEN_BG = require("../../assets/ui/class_selection_background.png") as ImageSourcePropType;

// Per-class backdrops — drop them into assets/classes/ as bg-<class>.png and
// register here; they crossfade OVER the shared backdrop. A class without
// one just shows the base.
const CLASS_BG: Partial<Record<ClassId, ImageSourcePropType>> = {
  // warrior: require("../../assets/classes/bg-warrior.png"),
  // ranger: require("../../assets/classes/bg-ranger.png"),
  // mage: require("../../assets/classes/bg-mage.png"),
};

// The four attributes shown at selection (wisdom/renewal exist but stay off
// this screen — decided 2026-07-02). Plain-language descriptions and an
// identity colour each; no numbers on this screen.
const CORE_STATS: {
  key: keyof ClassDef["base"];
  label: string;
  desc: string;
  color: string;
}[] = [
  { key: "vitality", label: "Vitality", desc: "Increases health", color: "#d96a6a" },
  { key: "strength", label: "Strength", desc: "Increases melee damage", color: "#d99a5b" },
  {
    key: "agility",
    label: "Agility",
    desc: "Increases ranged damage and crit chance",
    color: "#8fbf6f",
  },
  {
    key: "intellect",
    label: "Intellect",
    desc: "Increases magic damage and crit chance",
    color: "#6f9fd9",
  },
];

const SEGMENTS = 5;

// Per-stat range across the roster: bars are min-max relative BETWEEN the
// classes — the weakest class in a stat shows 1 segment, the strongest shows
// all 5, and the middle spreads across the gap. Pure comparison, no absolutes.
const STAT_RANGE = Object.fromEntries(
  CORE_STATS.map((s) => {
    const values = CLASS_LIST.map((c) => c.base[s.key]);
    return [s.key, { min: Math.min(...values), max: Math.max(...values) }];
  }),
) as Record<string, { min: number; max: number }>;

/** Quantized fill fraction: snaps to whole segments so the bar reads discrete. */
const fillFor = (key: keyof ClassDef["base"], value: number): number => {
  const { min, max } = STAT_RANGE[key]!;
  // A stat identical across all classes isn't a differentiator — show middle.
  const seg =
    max === min ? 3 : 1 + Math.round(((value - min) / (max - min)) * (SEGMENTS - 1));
  return seg / SEGMENTS;
};

/**
 * One segmented stat bar. A continuous fill animates under fixed segment
 * dividers; it starts empty and glides to each new class's level (staggered
 * per row), which is what makes swiping feel like the stats "re-weigh".
 */
const StatBar = ({ fraction, color, delay }: { fraction: number; color: string; delay: number }) => {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(
      delay,
      withTiming(fraction, { duration: 320, easing: Easing.out(Easing.cubic) }),
    );
  }, [fraction, delay, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { backgroundColor: color }, fill]} />
      {Array.from({ length: SEGMENTS - 1 }, (_, i) => (
        <View
          key={i}
          style={[styles.barDivider, { left: `${((i + 1) / SEGMENTS) * 100}%` }]}
        />
      ))}
    </View>
  );
};

/**
 * One portrait on the carousel strip. Position is resolved as the shortest
 * circular offset from the live index (-1 / 0 / +1 for three classes), so the
 * correct neighbour is always waiting just offscreen on either side.
 */
const ClassPortrait = ({
  def,
  position,
  indexSv,
  tx,
  width,
  top,
  height,
}: {
  def: ClassDef;
  position: number;
  indexSv: SharedValue<number>;
  tx: SharedValue<number>;
  width: number;
  top: number;
  height: number;
}) => {
  const art = CLASS_ART[def.id];
  const animated = useAnimatedStyle(() => {
    const raw = (((position - indexSv.value) % N) + N) % N;
    const d = raw > N / 2 ? raw - N : raw;
    const x = d * width + tx.value;
    const p = Math.min(Math.abs(x) / width, 1);
    return {
      transform: [{ translateX: x }, { scale: 1 - 0.08 * p }],
      opacity: 1 - 0.45 * p,
    };
  });
  return (
    <Animated.View style={[styles.portraitWrap, { top, height }, animated]}>
      {art ? (
        <Image source={art} style={styles.portrait} resizeMode="contain" />
      ) : (
        <View style={[styles.portrait, styles.portraitPlaceholder]}>
          <Text style={styles.monogram}>{def.label[0]}</Text>
        </View>
      )}
    </Animated.View>
  );
};

export const ClassSelectScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { createCharacter } = useCharacter();
  // The strip: indexSv is the settled class, tx the live drag offset. Both
  // owned by the UI thread; React's `index` mirror (for stats/dots/button)
  // updates only when a transition lands.
  const indexSv = useSharedValue(0);
  const tx = useSharedValue(0);
  const busy = useSharedValue(false);
  const [index, setIndex] = useState(0);
  const def = CLASS_LIST[index]!;
  const bg = CLASS_BG[def.id];

  /** Complete a transition toward direction d (also the arrows' entry point). */
  const settle = (d: 1 | -1) => {
    busy.value = true;
    tx.value = withTiming(
      -d * width,
      { duration: 220, easing: Easing.out(Easing.cubic) },
      (finished) => {
        "worklet";
        if (!finished) {
          busy.value = false;
          return;
        }
        indexSv.value = (indexSv.value + d + N) % N;
        tx.value = 0;
        busy.value = false;
        runOnJS(setIndex)(indexSv.value);
      },
    );
  };

  // Finger-tracked swipe: the strip follows the drag live; release either
  // completes the move (past 60px or a flick) or eases back. The ±16px
  // activation keeps plain taps (arrows, Choose) from being captured.
  const swipe = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .onChange((e) => {
      if (busy.value) return;
      tx.value = Math.max(-width, Math.min(width, e.translationX));
    })
    .onEnd((e) => {
      if (busy.value) return;
      const d = tx.value < -60 || e.velocityX < -600
        ? 1
        : tx.value > 60 || e.velocityX > 600
          ? -1
          : 0;
      if (d === 0) {
        tx.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
      } else {
        runOnJS(settle)(d as 1 | -1);
      }
    });

  const portraitTop = insets.top + 44;
  const portraitH = height * 0.5;

  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.root}>
        {/* Backdrop: the shared base, with per-class art crossfading over it. */}
        <Image source={SCREEN_BG} style={[StyleSheet.absoluteFill as object, styles.bg]} resizeMode="cover" />
        {bg && (
          <Animated.View
            key={`bg-${def.id}`}
            style={StyleSheet.absoluteFill}
            entering={FadeIn.duration(450)}
            exiting={FadeOut.duration(450)}
          >
            <Image source={bg} style={styles.bg} resizeMode="cover" />
          </Animated.View>
        )}

        {/* The carousel strip — every portrait mounted, positioned by offset. */}
        {CLASS_LIST.map((c, i) => (
          <ClassPortrait
            key={c.id}
            def={c}
            position={i}
            indexSv={indexSv}
            tx={tx}
            width={width}
            top={portraitTop}
            height={portraitH}
          />
        ))}

        {/* The gradient: art melts into the chrome black where the stats live. */}
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={0} y={0} width={width} height={height}>
            <LinearGradient
              start={vec(0, height * 0.34)}
              end={vec(0, height * 0.58)}
              colors={["rgba(14, 17, 22, 0)", "rgba(14, 17, 22, 1)"]}
            />
          </Rect>
        </Canvas>

        {/* Chrome: back + kicker, in-flow so they sit above the canvas. */}
        <View style={[styles.header, { marginTop: insets.top + 8 }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.back}>
            <Text style={styles.backGlyph}>‹ Back</Text>
          </Pressable>
          <Text style={styles.kicker}>Choose your Class</Text>
          <View style={styles.back} />
        </View>

        <View style={styles.spacer} />

        {/* The stat panel. The name/blurb swap with a fade; the bar grid stays
            mounted so fills animate BETWEEN classes instead of resetting. */}
        <View style={styles.panel}>
          <Animated.View
            key={`title-${def.id}`}
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(110)}
          >
            <Text style={styles.name}>{def.label}</Text>
            <Text style={styles.blurb}>{def.blurb}</Text>
          </Animated.View>
          <View style={styles.rows}>
            {CORE_STATS.map((s, i) => (
              <View key={s.key} style={styles.statRow}>
                <View style={styles.statText}>
                  <Text style={styles.statLabel}>{s.label}</Text>
                  <Text style={styles.statDesc}>{s.desc}</Text>
                </View>
                <StatBar
                  fraction={fillFor(s.key, def.base[s.key])}
                  color={s.color}
                  delay={i * 35}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.dots}>
          {CLASS_LIST.map((c, i) => (
            <View key={c.id} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
          <MenuButton
            label={`Choose ${def.label}`}
            onPress={() => {
              // A fresh level-1 record becomes the active character; the Game
              // reads it from CharacterContext (no route params). Old
              // characters stay in the roster for the future roster screen.
              createCharacter(def.id);
              navigation.navigate("Game");
            }}
          />
        </View>

        {/* Arrows: vertically centered on the screen edges, above everything. */}
        <Pressable onPress={() => settle(-1)} hitSlop={16} style={[styles.arrow, styles.arrowLeft]}>
          <Text style={styles.arrowGlyph}>‹</Text>
        </Pressable>
        <Pressable onPress={() => settle(1)} hitSlop={16} style={[styles.arrow, styles.arrowRight]}>
          <Text style={styles.arrowGlyph}>›</Text>
        </Pressable>
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  bg: {
    width: "100%",
    height: "100%",
  },
  portraitWrap: {
    position: "absolute",
    alignSelf: "center",
    width: "68%",
    alignItems: "center",
    justifyContent: "flex-start",
    // iOS shadow follows the art's opaque pixels; Android gets none (fine —
    // the gradient does most of the seating work there).
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
  },
  portrait: {
    width: "100%",
    height: "100%",
  },
  portraitPlaceholder: {
    backgroundColor: UI.panel,
    borderColor: UI.panelBorder,
    borderWidth: 1.5,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  monogram: {
    fontFamily: UI.font,
    color: UI.textDim,
    fontSize: 72,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  back: {
    minWidth: 64,
  },
  backGlyph: {
    fontFamily: UI.font,
    color: UI.textDim,
    fontSize: 18,
  },
  kicker: {
    fontFamily: UI.font,
    color: UI.accent,
    fontSize: 18,
    letterSpacing: 1,
  },
  spacer: {
    flex: 1,
  },
  panel: {
    paddingHorizontal: 28,
  },
  name: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 34,
    textAlign: "center",
  },
  blurb: {
    color: UI.textDim,
    fontSize: 14,
    marginTop: 2,
    marginBottom: 12,
    textAlign: "center",
  },
  rows: {
    gap: 9,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statText: {
    width: "46%",
  },
  statLabel: {
    color: UI.text,
    fontSize: 13.5,
  },
  statDesc: {
    color: UI.textDim,
    fontSize: 10.5,
  },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: UI.track,
    overflow: "hidden",
  },
  barFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 5,
  },
  barDivider: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: UI.bg,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    marginBottom: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: UI.track,
  },
  dotActive: {
    backgroundColor: UI.accent,
  },
  footer: {
    alignItems: "center",
  },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -32,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  arrowLeft: {
    left: 2,
  },
  arrowRight: {
    right: 2,
  },
  arrowGlyph: {
    fontFamily: UI.font,
    color: UI.accent,
    fontSize: 44,
    lineHeight: 48,
  },
});
