import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound, unlockAudio, type BitsSoundEvent } from "../audio";

export interface HomeScreenProps {
  onPlay: () => void;
  onPractice: () => void;
  onSettings: () => void;
}

/** Wrap a nav handler so the tap unlocks audio (first gesture) and sounds. */
const withTap = (event: BitsSoundEvent, fn: () => void) => (): void => {
  unlockAudio();
  playSound(event);
  fn();
};

/**
 * The front door: title + the three ways in. Play goes online (rooms),
 * Practice is the offline bot lobby, Settings is device settings. No server
 * needed to be here — connection concerns start behind Play.
 */
export const HomeScreen = ({ onPlay, onPractice, onSettings }: HomeScreenProps) => {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
    <Text style={styles.logo}>BLOOD{"\n"}IN THE SAND</Text>
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
});
