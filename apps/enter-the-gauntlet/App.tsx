import { useEffect } from "react";
import { AppState, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import * as Brightness from "expo-brightness";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { useFonts, PressStart2P_400Regular } from "@expo-google-fonts/press-start-2p";
import { SettingsProvider } from "./src/settings/SettingsContext";
import { RootNavigator } from "./src/navigation/RootNavigator";

/**
 * Heroic: Enter the Gauntlet — app shell.
 *
 * GestureHandlerRootView must wrap everything for the thumbstick gestures to
 * fire. SafeAreaProvider exposes the system-bar insets (the app draws
 * edge-to-edge on Android, so the controls would otherwise sit under the
 * navigation bar) — `initialMetrics` seeds them so there's no first-frame jump.
 * SettingsProvider hydrates persisted settings (volume, control layout) before
 * the menu renders; NavigationContainer + RootNavigator own the menu → settings →
 * game flow. The game itself (canvas, loop, controls) lives in src/game.
 */
export default function App() {
  // The pixel display font (Press Start 2P) used across the UI chrome and HUD.
  // Bundled with the app, so this resolves near-instantly; we gate the navigator
  // on it to avoid a system-font → pixel-font flash on the title screen.
  const [fontsLoaded] = useFonts({ PressStart2P_400Regular });

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
        {/* SettingsProvider hydrates in parallel; the navigator waits for the font
            so the first text it paints is already pixel. The dark root shows
            through until then. */}
        <SettingsProvider>
          {fontsLoaded ? (
            <NavigationContainer>
              <RootNavigator />
            </NavigationContainer>
          ) : null}
        </SettingsProvider>
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
