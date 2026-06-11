import { StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Canvas, Fill } from "@shopify/react-native-skia";

/**
 * Heroic: Journey to Greatness — app shell.
 *
 * The main game; intentionally an empty Skia canvas + title for now. "Enter the
 * Arena" ships first to validate the shared systems, which then carry over here.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill color="#0b0d10" />
      </Canvas>

      <View style={styles.hud} pointerEvents="box-none">
        <Text style={styles.title}>HEROIC</Text>
        <Text style={styles.subtitle}>Journey to Greatness</Text>
      </View>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b0d10",
  },
  hud: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#ffffff",
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 4,
  },
  subtitle: {
    color: "#9aa4b2",
    fontSize: 15,
    marginTop: 8,
  },
});
