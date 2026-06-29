// Doubles as the title screen and the in-game pause menu (same component, two
// routes — see RootStackParamList). On the "Pause" route it renders over the
// live game as a dimmed overlay with Resume/Quit instead of New Game.

import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { MenuButton } from "../ui/MenuButton";
import { UI } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Menu" | "Pause">;

export const MenuScreen = ({ navigation, route }: Props) => {
  const insets = useSafeAreaInsets();
  const paused = route.name === "Pause";

  return (
    <View
      style={[
        styles.root,
        paused ? styles.pausedRoot : styles.titleRoot,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.titleBlock}>
        {paused ? (
          <Text style={styles.paused}>Paused</Text>
        ) : (
          <>
            <Text style={styles.kicker}>Heroic</Text>
            <Text style={styles.title}>Enter the{"\n"}Gauntlet</Text>
          </>
        )}
      </View>

      <View style={styles.buttons}>
        {paused ? (
          <>
            {/* Close the overlay → back to the still-mounted, paused run. */}
            <MenuButton label="Resume" onPress={() => navigation.goBack()} />
            <MenuButton
              label="Settings"
              variant="secondary"
              onPress={() => navigation.navigate("Settings")}
            />
            {/* End the run and return to the title. */}
            <MenuButton
              label="Quit to Menu"
              variant="secondary"
              onPress={() => navigation.popToTop()}
            />
          </>
        ) : (
          <>
            {/* New Game currently always loads realm-00 (the only zone); this is
                the seam where run-initialization will later hook in. */}
            <MenuButton label="New Game" onPress={() => navigation.navigate("Game")} />
            <MenuButton
              label="Settings"
              variant="secondary"
              onPress={() => navigation.navigate("Settings")}
            />
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
  },
  titleRoot: {
    backgroundColor: UI.bg,
  },
  // Pause: a scrim over the live game rather than an opaque screen.
  pausedRoot: {
    backgroundColor: "rgba(8, 10, 14, 0.9)",
  },
  titleBlock: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  kicker: {
    fontFamily: UI.font,
    color: UI.accent,
    fontSize: 18,
    letterSpacing: 2,
    marginBottom: 12,
  },
  title: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 44,
    textAlign: "center",
    lineHeight: 52,
  },
  paused: {
    fontFamily: UI.font,
    color: UI.text,
    fontSize: 34,
  },
  buttons: {
    width: "100%",
    alignItems: "center",
    gap: 16,
    paddingBottom: 48,
  },
});
