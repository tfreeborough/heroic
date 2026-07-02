// The root screen stack: Menu → Settings and Menu → ClassSelect → Game. Headers
// are hidden (every screen draws its own chrome edge-to-edge); a fade keeps
// transitions unobtrusive in front of the full-screen game canvas.

import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GameScreen } from "../game/GameScreen";
import { ClassSelectScreen } from "../screens/ClassSelectScreen";
import { MenuScreen } from "../screens/MenuScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { UI } from "../ui/theme";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => (
  <Stack.Navigator
    initialRouteName="Menu"
    screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: UI.bg },
      animation: "fade",
    }}
  >
    <Stack.Screen name="Menu" component={MenuScreen} />
    <Stack.Screen name="Settings" component={SettingsScreen} />
    <Stack.Screen name="ClassSelect" component={ClassSelectScreen} />
    {/* Gameplay binds its own gestures; disable the swipe-back so a thumbstick
        drag from the edge can't pop the screen mid-fight. */}
    <Stack.Screen name="Game" component={GameScreen} options={{ gestureEnabled: false }} />
    {/* Pause: a transparent modal over the (paused-but-mounted) Game, so closing
        it drops straight back into the same run. Reuses MenuScreen. */}
    <Stack.Screen
      name="Pause"
      component={MenuScreen}
      options={{ presentation: "transparentModal", animation: "fade" }}
    />
  </Stack.Navigator>
);
