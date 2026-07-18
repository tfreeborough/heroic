import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Picture } from "@shopify/react-native-skia";
import { playSound, unlockAudio, type BitsSoundEvent } from "../audio";
import { devFlags } from "../dev";
import { buildCrowd, makeHighSunPicture, makeLifePicture, sceneAnchors } from "./homeScene";
import { pickDuel, TITLE_SPRITE_SCALE, TITLE_SPRITES } from "./titleSprites";

export interface HomeScreenProps {
  onPlay: () => void;
  onPractice: () => void;
  onSettings: () => void;
  /** Dev menu: start the target-dummy firing range (offline, respawning dummies). */
  onTargetDummies: () => void;
}

/** Wrap a nav handler so the tap unlocks audio (first gesture) and sounds. */
const withTap = (event: BitsSoundEvent, fn: () => void) => (): void => {
  unlockAudio();
  playSound(event);
  fn();
};

/** The secret knock: this many title taps toggles the dev menu… */
const DEV_TAPS = 5;
/** …as long as no two taps are further apart than this (slower = start over). */
const DEV_TAP_GAP_MS = 1500;

/** The ceremony face — iOS ships Copperplate; Android falls back to its serif
 * until a bundled display font is picked (owed). */
const DISPLAY_FONT = Platform.select({ ios: "Copperplate", default: "serif" });

/** Drifting sunlit dust motes over the scene. */
const MOTE_COUNT = 14;

/** One mote: a slow diagonal drift with a fade-in/out, then respawn (loop). */
const Mote = ({ w, h, seed }: { w: number; h: number; seed: number }) => {
  const t = useRef(new Animated.Value(0)).current;
  // Deterministic-ish spread from the index; exact positions don't matter.
  const x0 = ((seed * 97) % 100) / 100 * w;
  const y0 = ((seed * 61) % 100) / 100 * h * 0.66;
  const dur = 9000 + ((seed * 137) % 7) * 1000;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t, dur]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x0,
        top: y0,
        width: 2 + (seed % 3),
        height: 2 + (seed % 3),
        borderRadius: 2,
        backgroundColor: seed % 4 === 0 ? "#fff3d0" : "#e8d8b0",
        opacity: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.4, 0.4, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 40 + (seed % 5) * 12] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, 18 + (seed % 3) * 10] }) },
        ],
      }}
    />
  );
};

/**
 * The scene's slow living details — rippling banners + the stands' glint
 * (makeLifePicture) — re-recorded on a vsync-aligned rAF throttled to ~30fps.
 * Isolated in its own component so the tick re-renders a dozen Skia draws,
 * not the whole home screen. Fast movers (the swallows) are NOT here — they
 * ride native-driver Animated transforms below, immune to redraw cadence.
 */
const SceneLife = ({ w, h }: { w: number; h: number }) => {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const crowd = useMemo(() => buildCrowd(w, h), [w, h]);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (t: number): void => {
      if (t - last >= 30) {
        last = t;
        tick();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Picture picture={makeLifePicture(w, h, crowd, performance.now())} />
    </Canvas>
  );
};

/**
 * One swallow crossing the sky — drift, bob, and wing flap are all
 * native-driver transforms, so the bird stays smooth at the display's refresh
 * rate no matter what the JS thread does (the life layer's re-record cadence
 * visibly stuttered these — fast movers can't live on a redraw loop). The
 * loop's leading delay staggers the birds and leaves natural empty-sky gaps.
 */
const Swallow = ({ w, h, i }: { w: number; h: number; i: number }) => {
  const drift = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const flap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const flapMs = 150 + i * 35;
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 2600),
          Animated.timing(drift, { toValue: 1, duration: 26000 - i * 5000, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(drift, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(bob, { toValue: 1, duration: 1900 + i * 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bob, { toValue: 0, duration: 1900 + i * 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(flap, { toValue: 1, duration: flapMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(flap, { toValue: 0, duration: flapMs, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [drift, bob, flap, i]);
  // Clockwise degrees lift a left-pointing wing and drop a right-pointing one
  // — mirrored ranges make both tips rise together on the upstroke.
  const rotL = flap.interpolate({ inputRange: [0, 1], outputRange: ["-14deg", "26deg"] });
  const rotR = flap.interpolate({ inputRange: [0, 1], outputRange: ["14deg", "-26deg"] });
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        top: h * (0.13 + i * 0.045),
        width: 12,
        height: 8,
        pointerEvents: "none",
        transform: [
          { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-45, w + 45] }) },
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) },
        ],
      }}
    >
      <Animated.View style={[styles.wing, { left: 0, transformOrigin: "100% 50%", transform: [{ rotate: rotL }] }]} />
      <Animated.View style={[styles.wing, { left: 6, transformOrigin: "0% 50%", transform: [{ rotate: rotR }] }]} />
    </Animated.View>
  );
};

/**
 * The front door: the High Sun arena scene (homeScene.ts — static Skia
 * painting; forged gladiator sprites breathe over it) with the title at the
 * top and the three ways in at the bottom. Red is rationed to the banners and
 * PLAY. No server needed to be here — connection concerns start behind Play.
 *
 * There's also a hidden fourth way in: tapping the title DEV_TAPS times in a
 * row toggles the dev menu, a small panel pinned to the bottom-left corner.
 * Session-only on purpose — it never persists, so a fresh launch is always
 * clean (nothing to stumble into mid-playtest).
 */
export const HomeScreen = ({ onPlay, onPractice, onSettings, onTargetDummies }: HomeScreenProps) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [devOpen, setDevOpen] = useState(false);
  // Mirror devFlags so the toggle labels re-render on tap.
  const [perfOverlay, setPerfOverlay] = useState(devFlags.perfOverlay);
  const [sfxOff, setSfxOff] = useState(devFlags.disableSfx);
  const [hapticsOff, setHapticsOff] = useState(devFlags.disableHaptics);
  const knock = useRef({ count: 0, lastMs: 0 });

  const scene = useMemo(() => makeHighSunPicture(width, height), [width, height]);
  const anchors = useMemo(() => sceneAnchors(width, height), [width, height]);
  // Today's matchup — two random fighters from the pool, fixed for the mount.
  const [duel] = useState(pickDuel);
  // The sprite box: square art, figure fills ~90% of it, feet ~4% above the
  // bottom edge (the forge template leaves margin all round).
  const figBox = anchors.figureSize * 1.5;
  const leftBox = figBox * (TITLE_SPRITE_SCALE[duel.left] ?? 1);
  const rightBox = figBox * (TITLE_SPRITE_SCALE[duel.right] ?? 1);

  // Breathing sway on the duellists — statues that live, not animations.
  const sway = useRef(new Animated.Value(0)).current;
  // Entrance: title, then the scene's cast, then the menu rises in.
  const entrance = useRef(new Animated.Value(0)).current;
  // The PLAY halo breathes like the rooms screen's create button.
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(sway, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(sway, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    ];
    loops.forEach((l) => l.start());
    Animated.timing(entrance, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => loops.forEach((l) => l.stop());
  }, [sway, glow, entrance]);

  const rise = (from: number, to: number) => ({
    opacity: entrance.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: "clamp" }),
    transform: [
      {
        translateY: entrance.interpolate({ inputRange: [from, to], outputRange: [14, 0], extrapolate: "clamp" }),
      },
    ],
  });

  const onTogglePerf = (): void => {
    devFlags.perfOverlay = !devFlags.perfOverlay;
    setPerfOverlay(devFlags.perfOverlay);
  };

  const onToggleSfx = (): void => {
    devFlags.disableSfx = !devFlags.disableSfx;
    setSfxOff(devFlags.disableSfx);
  };

  const onToggleHaptics = (): void => {
    devFlags.disableHaptics = !devFlags.disableHaptics;
    setHapticsOff(devFlags.disableHaptics);
  };

  // Deliberately silent until the fifth tap — a secret shouldn't click.
  const onTitleTap = (): void => {
    const now = Date.now();
    knock.current.count = now - knock.current.lastMs <= DEV_TAP_GAP_MS ? knock.current.count + 1 : 1;
    knock.current.lastMs = now;
    if (knock.current.count >= DEV_TAPS) {
      knock.current.count = 0;
      unlockAudio();
      playSound("uiConfirm");
      setDevOpen((open) => !open);
    }
  };

  const swayY = sway.interpolate({ inputRange: [0, 1], outputRange: [0, 2.5] });
  const swayYOpposed = sway.interpolate({ inputRange: [0, 1], outputRange: [2.5, 0] });

  return (
    <View style={styles.root}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Picture picture={scene} />
      </Canvas>
      <SceneLife w={width} h={height} />
      {[0, 1, 2].map((i) => (
        <Swallow key={i} w={width} h={height} i={i} />
      ))}

      {Array.from({ length: MOTE_COUNT }, (_, i) => (
        <Mote key={i} w={width} h={height} seed={i + 3} />
      ))}

      {/* the duel — two random fighters from the pool over the painted sand;
          all sprites face right, so the right slot is always mirrored */}
      <Animated.Image
        source={TITLE_SPRITES[duel.left]}
        style={[
          styles.figure,
          {
            left: anchors.leftX - leftBox / 2,
            top: anchors.figureY - leftBox * 0.96,
            width: leftBox,
            height: leftBox,
            opacity: entrance.interpolate({ inputRange: [0.2, 0.6], outputRange: [0, 1], extrapolate: "clamp" }),
            transform: [{ translateY: swayY }],
          },
        ]}
      />
      <Animated.Image
        source={TITLE_SPRITES[duel.right]}
        style={[
          styles.figure,
          {
            left: anchors.rightX - rightBox / 2,
            top: anchors.figureY - rightBox * 0.96,
            width: rightBox,
            height: rightBox,
            opacity: entrance.interpolate({ inputRange: [0.2, 0.6], outputRange: [0, 1], extrapolate: "clamp" }),
            transform: [{ scaleX: -1 }, { translateY: swayYOpposed }],
          },
        ]}
      />

      <View style={[styles.ui, { paddingTop: insets.top + 54, paddingBottom: insets.bottom + 70 }]} pointerEvents="box-none">
        <Animated.View style={rise(0, 0.45)}>
          <Pressable onPress={onTitleTap}>
            <Text style={styles.wordA}>BLOOD</Text>
            <Text style={styles.wordB}>IN THE SAND</Text>
          </Pressable>
          <Text style={styles.tagline}>ONE LIFE · NO MERCY</Text>
          <View style={styles.rule}>
            <View style={styles.ruleLine} />
            <View style={styles.gem} />
            <View style={styles.ruleLine} />
          </View>
        </Animated.View>

        <View style={styles.spacer} pointerEvents="none" />

        <Animated.View style={[styles.menu, rise(0.4, 1)]}>
          <View>
            {/* Two stacked halo layers fake a blur RN views can't do. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                styles.haloOuter,
                {
                  opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.2] }),
                  transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }],
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                {
                  opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.32] }),
                  transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }],
                },
              ]}
            />
            <Pressable onPress={withTap("uiConfirm", onPlay)} style={styles.play}>
              <Text style={styles.playText}>PLAY</Text>
            </Pressable>
          </View>
          <Pressable onPress={withTap("uiConfirm", onPractice)} style={styles.ghost}>
            <Text style={styles.ghostText}>PRACTICE</Text>
          </Pressable>
          <Pressable onPress={withTap("uiTap", onSettings)} style={styles.ghost}>
            <Text style={styles.ghostText}>SETTINGS</Text>
          </Pressable>
        </Animated.View>
      </View>

      <Text style={[styles.foot, { bottom: insets.bottom + 18 }]}>THE CROWD WAITS</Text>

      {devOpen && (
        <View style={[styles.devMenu, { bottom: insets.bottom + 16 }]}>
          <View style={styles.devHeader}>
            <Text style={styles.devTitle}>DEV</Text>
            <Pressable onPress={withTap("uiTap", () => setDevOpen(false))} hitSlop={10}>
              <Text style={styles.devClose}>✕</Text>
            </Pressable>
          </View>
          <Pressable onPress={withTap("uiConfirm", onTargetDummies)} style={styles.devButton}>
            <Text style={styles.devButtonText}>TARGET DUMMIES</Text>
          </Pressable>
          <Pressable onPress={withTap("uiTap", onTogglePerf)} style={styles.devButton}>
            <Text style={styles.devButtonText}>PERF OVERLAY {perfOverlay ? "◉ ON" : "○ OFF"}</Text>
          </Pressable>
          {/* Perf A/B: kills playSound outright (scheduler + native calls), so a
              choppy device can answer "is it the audio?" in one toggle. */}
          <Pressable onPress={withTap("uiTap", onToggleSfx)} style={styles.devButton}>
            <Text style={styles.devButtonText}>SFX {sfxOff ? "○ KILLED" : "◉ ON"}</Text>
          </Pressable>
          {/* Same A/B for the other per-moment native cost (iOS allocates a
              feedback generator per pulse). */}
          <Pressable onPress={withTap("uiTap", onToggleHaptics)} style={styles.devButton}>
            <Text style={styles.devButtonText}>HAPTICS {hapticsOff ? "○ KILLED" : "◉ ON"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  figure: { position: "absolute", resizeMode: "contain", pointerEvents: "none" },
  wing: {
    position: "absolute",
    top: 3.5,
    width: 6,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(58,48,36,0.6)",
  },
  ui: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  // RN letterSpacing adds a trailing space — tracked centered text needs the
  // negative marginRight (the wizard's YOU ARE ARMED lesson).
  wordA: {
    fontFamily: DISPLAY_FONT,
    color: "#a32c22",
    fontSize: 54,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 6,
    marginRight: -6,
    textShadowColor: "rgba(46,28,14,0.45)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 1,
  },
  wordB: {
    fontFamily: DISPLAY_FONT,
    color: "#4a3626",
    fontSize: 23,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 10,
    marginRight: -10,
    marginTop: 4,
    textShadowColor: "rgba(240,228,200,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
  },
  tagline: {
    color: "#6b5335",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 4,
    marginRight: -4,
    textAlign: "center",
    marginTop: 12,
  },
  rule: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, width: 220, alignSelf: "center" },
  ruleLine: { flex: 1, height: 1, backgroundColor: "rgba(138,109,68,0.8)" },
  gem: {
    width: 7,
    height: 7,
    backgroundColor: "#8c2f2f",
    transform: [{ rotate: "45deg" }],
  },
  spacer: { flex: 1 },
  menu: { width: 250, gap: 12 },
  halo: {
    position: "absolute",
    top: -5,
    bottom: -5,
    left: -5,
    right: -5,
    borderRadius: 15,
    backgroundColor: "#d94141",
  },
  haloOuter: { top: -11, bottom: -11, left: -11, right: -11, borderRadius: 21 },
  play: {
    backgroundColor: "#8c2f2f",
    borderColor: "#e0503c",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 17,
    alignItems: "center",
  },
  playText: { color: "#f5ede0", fontWeight: "900", letterSpacing: 3, fontSize: 17 },
  ghost: {
    backgroundColor: "rgba(43,30,18,0.55)",
    borderColor: "rgba(58,45,30,0.9)",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  ghostText: { color: "#f0e4c8", fontWeight: "800", letterSpacing: 2, fontSize: 13 },
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: "rgba(59,44,26,0.78)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginRight: -2,
  },
  devMenu: {
    position: "absolute",
    left: 16,
    backgroundColor: "#1d1a16",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    minWidth: 160,
  },
  devHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  devTitle: { color: "#6b6257", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  devClose: { color: "#6b6257", fontSize: 12, fontWeight: "800" },
  devButton: { backgroundColor: "#3a332a", borderRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  devButtonText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1, fontSize: 12 },
});
