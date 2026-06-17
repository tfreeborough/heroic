import { StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
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
