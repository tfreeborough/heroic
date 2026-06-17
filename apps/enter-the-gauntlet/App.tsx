import { useEffect } from "react";
import { AppState, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import * as Brightness from "expo-brightness";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { GameScreen } from "./src/game/GameScreen";

/**
 * Heroic: Enter the Gauntlet — app shell.
 *
 * GestureHandlerRootView must wrap everything for the thumbstick gestures to
 * fire. SafeAreaProvider exposes the system-bar insets (the app draws
 * edge-to-edge on Android, so the controls would otherwise sit under the
 * navigation bar) — `initialMetrics` seeds them so there's no first-frame jump.
 * The game itself (canvas, loop, controls) lives in src/game.
 */
export default function App() {
  // Hold the screen on for as long as the app is mounted — a game shouldn't
  // dim or sleep mid-session.
  useKeepAwake();

  // Crank the app's window brightness to max so the game stays readable in any
  // lighting. This is an app-level override: it needs no permissions, only
  // affects our own window, and clears itself once the app is gone. iOS drops
  // the override when the device locks, so we reapply it whenever the app
  // returns to the foreground.
  useEffect(() => {
    const goMaxBrightness = () => {
      Brightness.setBrightnessAsync(1).catch(() => {});
    };
    goMaxBrightness();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") goMaxBrightness();
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <GameScreen />
        <StatusBar style="light" hidden />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0e1116",
  },
});
