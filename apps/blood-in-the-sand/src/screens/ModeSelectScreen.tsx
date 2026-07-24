import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Canvas, LinearGradient, RadialGradient, Rect, vec } from "@shopify/react-native-skia";
import { playSound, unlockAudio } from "../audio";
import { devFlags } from "../dev";
import { useGlory } from "../net/api";
import { useApiHealth } from "../net/connectivity";

/** The game server's state, mapped from ArenaClient by App.tsx. */
export type ServerHealth = "checking" | "ok" | "down" | "updateRequired";

export interface ModeSelectScreenProps {
  onBack: () => void;
  /** Casual → the existing online flow (name gate → room list → wizard). */
  onCasual: () => void;
  /** Practice → the bots-or-dummies front door. */
  onPractice: () => void;
  server: ServerHealth;
  /** Reconnect the game socket (the API re-probe is this screen's own). */
  onRetryServer: () => void;
}

/** Same ceremony face as the title (bundled display font still owed). */
const DISPLAY_FONT = Platform.select({ ios: "Copperplate", default: "serif" });

type ModeKey = "ranked" | "casual" | "practice" | "story";

/**
 * Per-mode card art. `image` is the forged PNG (assets/modes/<mode>.png,
 * ~1600×640 — the card crops `cover`, so keep the subject in the RIGHT two
 * thirds and the left third quiet: it sits under the scrim and text. Paired
 * .forge.json like every other art asset.) Until a PNG lands, the `ramp` +
 * `glow` paint a placeholder gradient that keys the mode's mood: ranked =
 * high-sun arena, casual = firelit evening, practice = pale dawn range,
 * story = unlit.
 */
const MODE_ART: Record<
  ModeKey,
  { image: number | null; ramp: [string, string, string]; glow: string; glowAt: [number, number] }
> = {
  ranked: { image: null, ramp: ["#3a1c12", "#7a3a1e", "#b06a2c"], glow: "rgba(255,214,140,0.50)", glowAt: [0.78, 0.15] },
  casual: { image: null, ramp: ["#131a21", "#1c2733", "#2b241c"], glow: "rgba(255,160,60,0.55)", glowAt: [0.72, 0.85] },
  practice: { image: null, ramp: ["#4a3520", "#8a6d44", "#c9a76a"], glow: "rgba(245,237,224,0.45)", glowAt: [0.70, 0.10] },
  story: { image: null, ramp: ["#241a12", "#2e2214", "#3a2a1a"], glow: "rgba(232,200,122,0.10)", glowAt: [0.75, 0.40] },
};

/** How each card presents and reacts. */
type CardState =
  | "live" //     full colour, breathing art, tap enters
  | "checking" // full colour, pulsing status, tap no-ops
  | "gated" //    full colour but denied (ranked pre-season) — tap shakes
  | "down" //     desaturated + reason + RETRY — tap shakes
  | "soon"; //    desaturated + COMING SOON ribbon — tap shakes

interface Status {
  text: string;
  tone: "gold" | "muted" | "red";
  /** Show the rationed-red gem before the text (the glory mark). */
  gem?: boolean;
  /** Slow opacity pulse (the "connecting…" shimmer). */
  pulse?: boolean;
}

/** The status row's slow breathe while a probe is in flight. */
const PulseText = ({ style, children }: { style: object[]; children: string }) => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.Text style={[...style, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]}>
      {children}
    </Animated.Text>
  );
};

/** The painted stand-in until the mode's forged PNG lands (MODE_ART). */
const CardArt = ({ mode, w, h }: { mode: ModeKey; w: number; h: number }) => {
  const art = MODE_ART[mode];
  if (art.image !== null) {
    return <Animated.Image source={art.image} resizeMode="cover" style={StyleSheet.absoluteFill} />;
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

interface ModeCardProps {
  mode: ModeKey;
  title: string;
  pitch: string;
  status: Status;
  state: CardState;
  /** Only fires for "live" — denied states handle their own tap. */
  onEnter?: () => void;
  onRetry?: () => void;
  /** The screen's shared entrance clock + this card's slot in the stagger. */
  entrance: Animated.Value;
  index: number;
}

const ModeCard = ({ mode, title, pitch, status, state, onEnter, onRetry, entrance, index }: ModeCardProps) => {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const dimmed = state === "down" || state === "soon";

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

  const onPress = state === "live" ? enter : state === "checking" ? undefined : deny;

  // Each card owns a slice of the shared entrance clock, top card first.
  const from = index * 0.14;
  const to = from + 0.5;
  const rise = {
    opacity: entrance.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: "clamp" as const }),
    transform: [
      { translateY: entrance.interpolate({ inputRange: [from, to], outputRange: [14, 0], extrapolate: "clamp" as const }) },
      { translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-4, 4] }) },
      { scale: pressed && state === "live" ? 0.98 : 1 },
    ],
  };

  const statusStyle = [
    styles.status,
    status.tone === "gold" ? styles.statusGold : status.tone === "red" ? styles.statusRed : styles.statusMuted,
  ];

  return (
    <Animated.View style={[styles.card, dimmed && styles.cardDim, rise]}>
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
            <CardArt mode={mode} w={box.w} h={box.h} />
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
        {/* denied modes go dark — one overlay, no second art asset */}
        {dimmed && <View style={styles.dimOverlay} pointerEvents="none" />}

        <View style={styles.copy} pointerEvents="none">
          <Text style={[styles.title, dimmed && styles.titleDim]}>{title}</Text>
          <Text style={[styles.pitch, dimmed && styles.pitchDim]}>{pitch}</Text>
          <View style={styles.statusRow}>
            {status.gem === true && <View style={styles.statusGem} />}
            {status.pulse === true ? (
              <PulseText style={statusStyle}>{status.text}</PulseText>
            ) : (
              <Text style={statusStyle}>{status.text}</Text>
            )}
          </View>
        </View>

        {/* RETRY lives on the card so the fix sits next to the reason */}
        {state === "down" && onRetry && (
          <Pressable
            onPress={() => {
              unlockAudio();
              playSound("uiTap");
              onRetry();
            }}
            style={styles.retry}
            hitSlop={8}
          >
            <Text style={styles.retryText}>RETRY</Text>
          </Pressable>
        )}

        {state === "soon" && (
          <View style={styles.ribbon} pointerEvents="none">
            <Text style={styles.ribbonText}>COMING SOON</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
};

/**
 * The fork behind PLAY (bits-mode-select.md): four full-art cards, stacked —
 * Ranked, Casual, Practice, Story. Every card is always rendered; a mode you
 * can't enter shows WHY (season gate, connectivity, coming soon) instead of
 * hiding — the closed doors are part of the sell. Ranked and Casual need both
 * the game server (prop, from ArenaClient) and the API (probed here) up;
 * Practice never checks anything.
 */
export const ModeSelectScreen = ({ onBack, onCasual, onPractice, server, onRetryServer }: ModeSelectScreenProps) => {
  const insets = useSafeAreaInsets();
  const glory = useGlory();
  const { api, recheckApi } = useApiHealth();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The stack rises card by card; the drum lands as the last one settles.
    Animated.timing(entrance, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) playSound("modeReveal");
      },
    );
  }, [entrance]);

  const retryBoth = (): void => {
    if (server === "down") onRetryServer();
    recheckApi();
  };

  // Both services gate the online modes; the server's protocol gate wins the
  // message because its fix (update) is different from "check your wifi".
  const online: CardState =
    server === "updateRequired"
      ? "live" // tapping routes into the existing UPDATE REQUIRED flow
      : server === "checking" || (server === "ok" && api === "checking")
        ? "checking"
        : server === "ok" && api === "ok"
          ? "live"
          : "down";

  const casualStatus: Status =
    server === "updateRequired"
      ? { text: "UPDATE REQUIRED — TAP TO FIX", tone: "gold" }
      : online === "checking"
        ? { text: "CONNECTING…", tone: "muted", pulse: true }
        : online === "down"
          ? { text: "CAN'T REACH THE ARENA — CHECK YOUR CONNECTION", tone: "red" }
          : { text: "GLORY WHEN EARNED", tone: "gold", gem: true };

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
        <Text style={styles.headerTitle}>CHOOSE YOUR FIGHT</Text>
        {glory !== null ? (
          <View style={styles.gloryPill}>
            <View style={styles.gloryGem} />
            <Text style={styles.gloryText}>{glory.toLocaleString()}</Text>
          </View>
        ) : (
          <View style={styles.back} />
        )}
      </View>

      <View style={styles.cards}>
        <ModeCard
          mode="ranked"
          title="RANKED"
          pitch="Queue against the ladder."
          // The season gate, NOT the connectivity message — ranked is closed
          // for everyone until the matchmaking queue exists (design doc).
          status={{ text: "SEASON I — OPENING SOON", tone: "gold" }}
          state="gated"
          entrance={entrance}
          index={0}
        />
        <ModeCard
          mode="casual"
          title="CASUAL"
          pitch="Your rooms, your rules — invite anyone, add bots."
          status={casualStatus}
          state={online}
          onEnter={onCasual}
          onRetry={retryBoth}
          entrance={entrance}
          index={1}
        />
        <ModeCard
          mode="practice"
          title="PRACTICE"
          pitch="Bots or target dummies. Every weapon and ability unlocked."
          status={
            online === "down"
              ? { text: "ALWAYS AVAILABLE — SIMULATED ON DEVICE", tone: "muted" }
              : { text: "NO STAKES · NO GLORY", tone: "muted" }
          }
          state="live"
          onEnter={onPractice}
          entrance={entrance}
          index={2}
        />
        <ModeCard
          mode="story"
          title="STORY"
          pitch="Carve your legend into the sand."
          status={{ text: "", tone: "muted" }}
          state="soon"
          entrance={entrance}
          index={3}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 14 },
  back: { width: 44, paddingVertical: 2 },
  backText: { color: "#8a7f70", fontSize: 26, fontWeight: "800", lineHeight: 28 },
  // RN letterSpacing adds a trailing space — centered tracked text needs the
  // negative marginRight (HomeScreen's lesson).
  headerTitle: {
    flex: 1,
    fontFamily: DISPLAY_FONT,
    color: "#e8c87a",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 4,
    marginRight: -4,
  },
  gloryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 44,
    justifyContent: "flex-end",
    borderColor: "rgba(138,109,68,0.75)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,24,16,0.72)",
  },
  gloryGem: { width: 6, height: 6, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  gloryText: { color: "#e8c87a", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  cards: { flex: 1, gap: 12 },
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
  dimOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(16,13,10,0.66)" },
  copy: { flex: 1, justifyContent: "center", gap: 5, paddingHorizontal: 18, paddingVertical: 12 },
  title: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 3,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  titleDim: { color: "#cfc4b0" },
  pitch: { color: "#d9cbb4", fontSize: 13, lineHeight: 18, maxWidth: 240 },
  pitchDim: { color: "#8d8272" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, minHeight: 14 },
  statusGem: { width: 5, height: 5, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  status: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  statusGold: { color: "#e8c87a" },
  statusMuted: { color: "#9a8d78" },
  statusRed: { color: "#d94141" },
  retry: {
    position: "absolute",
    right: 14,
    bottom: 12,
    borderColor: "#d94141",
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: "rgba(163,44,34,0.14)",
  },
  retryText: { color: "#d94141", fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  ribbon: {
    position: "absolute",
    top: 16,
    right: -40,
    transform: [{ rotate: "15deg" }],
    backgroundColor: "#e8c87a",
    paddingVertical: 5,
    paddingHorizontal: 44,
  },
  ribbonText: { fontFamily: DISPLAY_FONT, color: "#2a1c0e", fontSize: 10, fontWeight: "900", letterSpacing: 2 },
});
