/**
 * The gate in front of every online route (play/ranked): quiet connecting,
 * the visible can't-reach state, the protocol-mismatch update flow, and the
 * unconfigured dev fallback. Quiet dials read as a splash screen; only
 * exhausted retries earn the framed failure panel — useArenaConnection owns
 * that policy, this screen just renders its snapshot. Every failure state
 * offers PRACTICE OFFLINE, so a dead server never means "nothing to do".
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound, unlockAudio } from "../audio";
import type { ConnectState } from "../net/useArenaConnection";

export interface ConnectScreenProps {
  state: Exclude<ConnectState, "online">;
  /** Reachability verdict while "down" (see useArenaConnection.offline). */
  offline: boolean | null;
  /** Seconds until the next auto-redial; null = a dial is in flight. */
  retryIn: number | null;
  updating: boolean;
  updateHint: string | null;
  onRetry: () => void;
  onUpdate: () => void;
  onPractice: () => void;
  onBack: () => void;
}

/** Same ceremony face as the title and mode cards (bundled font still owed). */
const DISPLAY_FONT = Platform.select({ ios: "Copperplate", default: "serif" });

const press = (fn: () => void, sound: "uiTap" | "uiConfirm" | "uiBack") => () => {
  unlockAudio();
  playSound(sound);
  fn();
};

/** The escape hatch every failure panel carries: bots need no connection. */
const PracticeDoor = ({ onPractice }: { onPractice: () => void }) => (
  <View style={styles.doorWrap}>
    <View style={styles.divider} />
    <Pressable onPress={press(onPractice, "uiConfirm")} style={styles.ghost}>
      <Text style={styles.ghostText}>PRACTICE OFFLINE</Text>
    </Pressable>
    <Text style={styles.ghostSub}>bots don't need a connection</Text>
  </View>
);

export const ConnectScreen = ({
  state,
  offline,
  retryIn,
  updating,
  updateHint,
  onRetry,
  onUpdate,
  onPractice,
  onBack,
}: ConnectScreenProps) => {
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const quiet = state === "connecting" || state === "waking";

  // The probe decides whose fault the silence is — the copy owns up when
  // it's ours, and points at the airplane-mode toggle when it's theirs.
  const downCopy =
    offline === true
      ? {
          title: "YOU'RE OFFLINE",
          body: "Live matches need an internet connection. We'll reconnect the moment one returns.",
        }
      : offline === false
        ? {
            title: "THE ARENA ISN'T ANSWERING",
            body: "Your connection is fine — the trouble is on our end. We'll keep retrying.",
          }
        : {
            title: "CAN'T REACH THE ARENA",
            body: "We're having trouble reaching the arena. We'll keep retrying.",
          };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.centre}>
        <Text style={styles.logo}>BLOOD{"\n"}IN THE SAND</Text>
        <View style={styles.rule} />

        {quiet ? (
          <>
            <Animated.Text
              style={[styles.connecting, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }]}
            >
              entering the arena…
            </Animated.Text>
            {state === "waking" && (
              <Text style={styles.hint}>Still trying — this is taking longer than usual.</Text>
            )}
          </>
        ) : state === "mismatch" ? (
          <View style={styles.panel}>
            <Text style={[styles.panelTitle, styles.gold]}>UPDATE REQUIRED</Text>
            <Text style={styles.panelBody}>
              Your game is a version behind the arena, so live matches are off until you update.
            </Text>
            <Pressable
              onPress={press(onUpdate, "uiTap")}
              style={[styles.primary, updating && styles.primaryDim]}
              disabled={updating}
            >
              <Text style={styles.primaryText}>{updating ? "UPDATING…" : "UPDATE NOW"}</Text>
            </Pressable>
            {updateHint && <Text style={styles.hint}>{updateHint}</Text>}
            <PracticeDoor onPractice={onPractice} />
          </View>
        ) : state === "unconfigured" ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>NO SERVER CONFIGURED</Text>
            <Text style={styles.panelBody}>Set EXPO_PUBLIC_DEFAULT_SERVER to point this build at an arena server.</Text>
            <PracticeDoor onPractice={onPractice} />
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{downCopy.title}</Text>
            <Text style={styles.panelBody}>{downCopy.body}</Text>
            <Text style={styles.retrying}>
              {retryIn !== null && retryIn > 0 ? `retrying in ${retryIn}s` : "retrying…"}
            </Text>
            <Pressable onPress={press(onRetry, "uiTap")} style={styles.primary}>
              <Text style={styles.primaryText}>RETRY NOW</Text>
            </Pressable>
            <PracticeDoor onPractice={onPractice} />
          </View>
        )}
      </View>

      <Pressable onPress={press(onBack, "uiBack")} style={styles.backLink} hitSlop={10}>
        <Text style={styles.backText}>‹ BACK</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingHorizontal: 24 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: {
    fontFamily: DISPLAY_FONT,
    color: "#d94141",
    fontSize: 38,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 2,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  rule: { width: 44, height: 2, backgroundColor: "#8a6d44", borderRadius: 1, marginTop: 16, marginBottom: 26 },
  connecting: { color: "#b0a493", fontSize: 15, letterSpacing: 1 },
  hint: { color: "#8a7f70", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 14, maxWidth: 300 },
  panel: {
    alignItems: "center",
    alignSelf: "stretch",
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#8a6d44",
    backgroundColor: "#1d1712",
    paddingVertical: 22,
    paddingHorizontal: 20,
  },
  panelTitle: {
    fontFamily: DISPLAY_FONT,
    color: "#f5ede0",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
  },
  gold: { color: "#e8c87a" },
  panelBody: { color: "#d9cbb4", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 10, maxWidth: 280 },
  retrying: { color: "#8a7f70", fontSize: 12, marginTop: 14, fontVariant: ["tabular-nums"] },
  primary: { backgroundColor: "#8c2f2f", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 36, marginTop: 10 },
  primaryDim: { opacity: 0.6 },
  primaryText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
  doorWrap: { alignSelf: "stretch", alignItems: "center", marginTop: 18 },
  divider: { alignSelf: "stretch", height: 1, backgroundColor: "#3a2f22", marginBottom: 16 },
  ghost: { borderWidth: 1, borderColor: "#8a6d44", borderRadius: 8, paddingVertical: 11, paddingHorizontal: 28 },
  ghostText: { color: "#e8c87a", fontWeight: "800", letterSpacing: 1, fontSize: 13 },
  ghostSub: { color: "#8a7f70", fontSize: 11, marginTop: 8 },
  backLink: { alignSelf: "center" },
  backText: { color: "#8a7f70", fontSize: 14, fontWeight: "800", letterSpacing: 1 },
});
