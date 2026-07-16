import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound, unlockAudio, type BitsSoundEvent } from "../audio";

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

/**
 * The front door: title + the three ways in. Play goes online (rooms),
 * Practice is the offline bot lobby, Settings is device settings. No server
 * needed to be here — connection concerns start behind Play.
 *
 * There's also a hidden fourth way in: tapping the title DEV_TAPS times in a
 * row toggles the dev menu, a small panel pinned to the bottom-left corner.
 * Session-only on purpose — it never persists, so a fresh launch is always
 * clean (nothing to stumble into mid-playtest).
 */
export const HomeScreen = ({ onPlay, onPractice, onSettings, onTargetDummies }: HomeScreenProps) => {
  const insets = useSafeAreaInsets();
  const [devOpen, setDevOpen] = useState(false);
  const knock = useRef({ count: 0, lastMs: 0 });

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

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
    <Pressable onPress={onTitleTap}>
      <Text style={styles.logo}>BLOOD{"\n"}IN THE SAND</Text>
    </Pressable>
    <View style={styles.buttons}>
      <Pressable onPress={withTap("uiConfirm", onPlay)} style={[styles.button, styles.play]}>
        <Text style={styles.buttonText}>PLAY</Text>
      </Pressable>
      <Pressable onPress={withTap("uiConfirm", onPractice)} style={[styles.button, styles.practice]}>
        <Text style={styles.buttonText}>PRACTICE</Text>
      </Pressable>
      <Pressable onPress={withTap("uiTap", onSettings)} style={[styles.button, styles.settings]}>
        <Text style={styles.buttonText}>SETTINGS</Text>
      </Pressable>
    </View>
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
      </View>
    )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", alignItems: "center", justifyContent: "center", padding: 24 },
  logo: {
    color: "#d94141",
    fontSize: 44,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 2,
    marginBottom: 48,
  },
  buttons: { width: 240, gap: 12 },
  button: { borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  play: { backgroundColor: "#8c2f2f" },
  practice: { backgroundColor: "#3a5a3a" },
  settings: { backgroundColor: "#3a332a" },
  buttonText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 2, fontSize: 15 },
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
