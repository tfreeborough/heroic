import { StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { GameScreen } from "./src/game/GameScreen";

/**
 * Heroic: Enter the Gauntlet — app shell.
 *
 * GestureHandlerRootView must wrap everything for the thumbstick gestures to
 * fire. The game itself (canvas, loop, controls) lives in src/game.
 */
export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <GameScreen />
      <StatusBar style="light" hidden />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0e1116",
  },
});
