// Doubles as the title screen and the in-game pause menu (same component, two
// routes — see RootStackParamList). On the "Pause" route it renders over the
// live game as a dimmed overlay with Resume/Quit instead of New Game.

import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CLASSES } from "@heroic/core";
import type { RootStackParamList } from "../navigation/types";
import { useCharacter } from "../character/CharacterContext";
import { MenuButton } from "../ui/MenuButton";
import { UI } from "../ui/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Menu" | "Pause">;

export const MenuScreen = ({ navigation, route }: Props) => {
  const insets = useSafeAreaInsets();
  const paused = route.name === "Pause";
  // Continue is gated on `loaded`, not just `active`: GameScreen bakes the
  // character's stats into mount-time sim state, so a run must never start
  // before the persisted roster has hydrated.
  const { active, loaded } = useCharacter();

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
            {/* Continue the saved character (class/level/XP/talents persist). */}
            {loaded && active && (
              <MenuButton
                label={`Continue — Lv ${active.level} ${CLASSES[active.classId].label}`}
                onPress={() => navigation.navigate("Game")}
              />
            )}
            {/* New Game → pick a class → into realm-00 (the only zone). ClassSelect
                is the seed of the full character-creation flow. */}
            <MenuButton
              label="New Game"
              variant={loaded && active ? "secondary" : "primary"}
              onPress={() => navigation.navigate("ClassSelect")}
            />
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
