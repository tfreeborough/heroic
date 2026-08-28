/**
 * The Primer (bits-onboarding.md): five chapters of the rules, shown the
 * first time PLAY is pressed and replayable from Settings. Every chapter is
 * a living illustration (primerStages.tsx) over the title's sand with the
 * Chronicle's embers, then a title, a gladiator line and the plain facts —
 * staged off one reveal timeline (the deed-card rule: 700ms, a mid-reveal
 * tap snaps the chapter home, a settled tap advances). The last chapter
 * ends on two doors: the firing range, or the mode select PLAY used to go
 * straight to. Only a door or SKIP retires it (App.tsx writes the flag).
 */
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import { LOADOUT_ABILITY_COUNT, WINS_TO_TAKE_MATCH } from "@heroic/blood-in-the-sand-sim";
import { playSound, unlockAudio } from "../audio";
import { Embers } from "../components/Embers";
import { useBackClose } from "../components/sheetGestures";
import { playStrikeHaptic } from "../game/haptics";
import { HOME_ART } from "./homeArt";
import { ArmStage, GloryStage, MoveStage, StrikeStage, TheSandStage, type StageProps } from "./primerStages";
import { DISPLAY_FONT } from "../typography";

export interface PrimerScreenProps {
  /** TO THE FIGHT / SKIP → the mode select. */
  onDone: () => void;
  /** ‹ on chapter I → home, the Primer unretired. */
  onExit: () => void;
}

const REVEAL_MS = 700;
const SWAP_MS = 140;
/** The stage never shrinks below this — the scenes stop reading. */
const STAGE_MIN = 170;
/** The copy block's height budget (eyebrow, title, line, rule, ~4 fact
 * lines, gaps) at full and compact type. */
const COPY_H = 236;
const COPY_H_COMPACT = 192;

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five"] as const;
const word = (n: number): string => NUMBER_WORDS[n] ?? String(n);

interface Chapter {
  key: string;
  title: string;
  quote: string;
  facts: string;
  Stage: ComponentType<StageProps>;
}

// Copy rules: the codex's (no superlatives, no roster comparisons, nothing
// that rots as the roster grows); every number comes from the sim config.
const CHAPTERS: readonly Chapter[] = [
  {
    key: "sand",
    title: "THE SAND",
    quote: "There is no second life on the sand.",
    facts: `One life a round. The first to win ${word(WINS_TO_TAKE_MATCH)} rounds wins the match. You are Blue, the enemy is Red.`,
    Stage: TheSandStage,
  },
  {
    key: "move",
    title: "MOVE",
    quote: "The sand goes where your thumb goes.",
    facts: "Use your thumb to control movement, change to left-hand mode in the settings.",
    Stage: MoveStage,
  },
  {
    key: "strike",
    title: "STRIKE",
    quote: "Your blade knows the way.",
    facts: "You don't need to aim, the nearest enemy in reach becomes your mark, and your weapon strikes on its own. Position yourself wisely to get the edge.",
    Stage: StrikeStage,
  },
  {
    key: "arm",
    title: "ARM YOURSELF",
    quote: "Choose your steel. Choose it well.",
    facts: `Before every fight you will select a single weapon and ${word(LOADOUT_ABILITY_COUNT)} abilities, some abilities can be used more than once. Look for ways to combine their power.`,
    Stage: ArmStage,
  },
  {
    key: "glory",
    title: "GLORY",
    quote: "The crowd remembers.",
    facts: "Playing ranked mode earns you glory that you can use to unlock new devastating weapons and abilities from the armory.",
    Stage: GloryStage,
  },
];

export const PrimerScreen = ({ onDone, onExit }: PrimerScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const reveal = useRef(new Animated.Value(0)).current;
  const settled = useRef(false);
  const swapping = useRef(false);
  const chapter = CHAPTERS[index]!;
  const last = index === CHAPTERS.length - 1;

  useEffect(() => {
    swapping.current = false;
    settled.current = false;
    reveal.setValue(0);
    // The chapter lands on the mode-select drum — a premium surface arriving.
    playSound("modeReveal");
    if (chapter.key === "glory") playSound("deedUnlock");
    Animated.timing(reveal, { toValue: 1, duration: REVEAL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) settled.current = true;
      },
    );
  }, [reveal, chapter]);

  const slice = (from: number, to: number, outputRange: [number, number]) =>
    reveal.interpolate({ inputRange: [from, to], outputRange, extrapolate: "clamp" });

  const goTo = useCallback(
    (next: number) => {
      if (swapping.current) return;
      swapping.current = true;
      Animated.timing(reveal, { toValue: 0, duration: SWAP_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() =>
        setIndex(next),
      );
    },
    [reveal],
  );

  /** A tap anywhere: snap a running reveal home, else advance. */
  const onTap = (): void => {
    unlockAudio();
    if (swapping.current) return;
    if (!settled.current) {
      reveal.stopAnimation();
      reveal.setValue(1);
      settled.current = true;
      return;
    }
    if (last) return; // the doors take over
    playSound("uiTap");
    goTo(index + 1);
  };

  const onBack = (): void => {
    unlockAudio();
    playSound("uiBack");
    if (index === 0) onExit();
    else goTo(index - 1);
  };

  // Android back = the ‹ (previous chapter, home from chapter I).
  useBackClose(onBack);

  const onSkip = (): void => {
    unlockAudio();
    playSound("uiBack");
    onDone();
  };

  const door = (fn: () => void) => (): void => {
    unlockAudio();
    playSound("uiConfirm");
    playStrikeHaptic("light");
    fn();
  };

  // The stage takes whatever the phone has left once the copy and the footer
  // are paid for — never a fixed share of the screen (Tom, 2026-08-25: on a
  // small phone the content ran off the bottom and there's nothing to
  // scroll — everything is tap-anywhere). Tight phones drop into compact
  // type before the stage gives up its minimum.
  const bodyTop = insets.top + 56;
  const bodyBottom = insets.bottom + 22;
  const footH = last ? 124 : 56; // pips + prompt, or pips + the two doors
  const spare = height - bodyTop - bodyBottom - footH;
  const compact = spare < STAGE_MIN + COPY_H;
  const copyH = compact ? COPY_H_COMPACT : COPY_H;
  const stageW = width - 32;
  const stageH = Math.max(STAGE_MIN, Math.min(380, spare - copyH));
  const Stage = chapter.Stage;

  return (
    <Pressable style={styles.root} onPress={onTap}>
      {/* the sand — the title's backdrop, dimmed under a vertical scrim */}
      {HOME_ART.home ? (
        <Image
          source={HOME_ART.home}
          style={{ position: "absolute", top: 0, left: 0, width, height, resizeMode: "cover", opacity: 0.32 }}
        />
      ) : null}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={["rgba(12,8,5,0.55)", "rgba(12,8,5,0.78)", "rgba(12,8,5,0.96)"]}
            positions={[0, 0.45, 1]}
          />
        </Rect>
      </Canvas>
      {/* the Chronicle's candlelight */}
      <Embers w={width} h={height} count={18} seed={11} />

      <View style={[styles.bar, { top: insets.top + 8 }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.barButton}>
          <Text style={styles.chev}>‹</Text>
        </Pressable>
        <Pressable onPress={onSkip} hitSlop={12} style={styles.barButton}>
          <Text style={styles.skip}>SKIP ›</Text>
        </Pressable>
      </View>

      <View style={[styles.body, { paddingTop: bodyTop, paddingBottom: bodyBottom }]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.stage,
            { width: stageW, height: stageH, opacity: slice(0, 0.35, [0, 1]), transform: [{ scale: slice(0, 0.5, [0.96, 1]) }] },
          ]}
          pointerEvents="none"
        >
          {/* keyed so each chapter's loops mount fresh and the old ones stop */}
          <Stage key={chapter.key} w={stageW} h={stageH} />
        </Animated.View>

        <View style={[styles.copy, compact && styles.copyCompact]} pointerEvents="none">
          <Animated.Text
            style={[
              styles.title,
              compact && styles.titleCompact,
              { opacity: slice(0.05, 0.4, [0, 1]), transform: [{ scale: slice(0.05, 0.4, [1.08, 1]) }] },
            ]}
          >
            {chapter.title}
          </Animated.Text>
          <Animated.Text style={[styles.quote, compact && styles.quoteCompact, { opacity: slice(0.25, 0.55, [0, 1]) }]}>
            {chapter.quote}
          </Animated.Text>
          <Animated.View style={[styles.rule, { opacity: slice(0.3, 0.55, [0, 1]), transform: [{ scaleX: slice(0.3, 0.6, [0.2, 1]) }] }]}>
            <View style={styles.ruleLine} />
            <View style={styles.gem} />
            <View style={styles.ruleLine} />
          </Animated.View>
          <Animated.Text
            style={[
              styles.facts,
              compact && styles.factsCompact,
              { opacity: slice(0.45, 0.8, [0, 1]), transform: [{ translateY: slice(0.45, 0.8, [10, 0]) }] },
            ]}
          >
            {chapter.facts}
          </Animated.Text>
        </View>

        <View style={styles.spacer} pointerEvents="none" />

        <Animated.View style={[styles.pips, { opacity: slice(0.7, 1, [0, 1]) }]} pointerEvents="none">
          {CHAPTERS.map((c, i) => (
            <View key={c.key} style={[styles.pip, i === index && styles.pipOn, i < index && styles.pipDone]} />
          ))}
        </Animated.View>

        {last ? (
          <Animated.View style={[styles.doors, { opacity: slice(0.7, 1, [0, 1]), transform: [{ translateY: slice(0.7, 1, [12, 0]) }] }]}>
            <Pressable onPress={door(onDone)} style={styles.primary}>
              <Text style={styles.primaryText}>ENTER THE ARENA</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.Text style={[styles.prompt, { opacity: slice(0.7, 1, [0, 1]) }]} pointerEvents="none">
            TAP TO CONTINUE
          </Animated.Text>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0c0907" },
  bar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 2,
  },
  barButton: { paddingVertical: 4, paddingHorizontal: 4 },
  chev: { color: "#d9cbb4", fontSize: 30, lineHeight: 32, fontWeight: "300", marginTop: -4 },
  skip: { color: "#8a7f70", fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  body: { flex: 1, alignItems: "center", paddingHorizontal: 16 },
  stage: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(138,109,68,0.55)",
    backgroundColor: "rgba(12,8,5,0.5)",
    overflow: "hidden",
  },
  copy: { alignItems: "center", marginTop: 22, gap: 8, maxWidth: 340, flexShrink: 1 },
  copyCompact: { marginTop: 14, gap: 5 },
  eyebrow: { color: "#d99a41", fontSize: 11, fontWeight: "800", letterSpacing: 3, marginRight: -3 },
  title: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 28,
    letterSpacing: 4,
    marginRight: -4,
    textAlign: "center",
    textShadowColor: "rgba(232,176,72,0.45)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  titleCompact: { fontSize: 22, letterSpacing: 3 },
  quote: { color: "#e8c87a", fontSize: 15, fontStyle: "italic", textAlign: "center", lineHeight: 21 },
  quoteCompact: { fontSize: 13, lineHeight: 18 },
  rule: { flexDirection: "row", alignItems: "center", width: 180, gap: 8, marginVertical: 2 },
  ruleLine: { flex: 1, height: 1, backgroundColor: "rgba(138,109,68,0.8)" },
  gem: { width: 7, height: 7, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  facts: { color: "#d9cbb4", fontSize: 14, lineHeight: 21, textAlign: "center" },
  factsCompact: { fontSize: 13, lineHeight: 18 },
  spacer: { flex: 1 },
  pips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  pip: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(138,109,68,0.35)" },
  pipOn: { backgroundColor: "#f2cd6e", width: 18 },
  pipDone: { backgroundColor: "rgba(217,154,65,0.8)" },
  prompt: { color: "#8a7f70", fontSize: 11, fontWeight: "800", letterSpacing: 3, marginRight: -3 },
  doors: { width: 250, gap: 12 },
  primary: {
    backgroundColor: "#8c2f2f",
    borderColor: "#e0503c",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryText: { color: "#f5ede0", fontWeight: "900", letterSpacing: 3, fontSize: 15, marginRight: -3 },
  ghost: {
    backgroundColor: "rgba(43,30,18,0.55)",
    borderColor: "rgba(138,109,68,0.9)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  ghostText: { color: "#f0e4c8", fontWeight: "800", letterSpacing: 2, fontSize: 13, marginRight: -2 },
});
