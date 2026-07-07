import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { UI } from "../ui/theme";

/**
 * A trigger's on-screen text (docs/design/triggers.md): a centered, fading banner
 * over the running scene — the same conditional-mount + FadeIn/FadeOut pattern as
 * LevelUpBanner, but styled as prose (a dark bubble, capped width) like DoorNotice
 * so a full sentence reads over any floor. GameScreen mounts it while a trigger's
 * message is active and unmounts it when the auto-dismiss timer clears the text;
 * the exit fade rides the unmount.
 */
interface Props {
  /** The message to show. */
  text: string;
  style?: StyleProp<ViewStyle>;
}

export const TriggerBanner = ({ text, style }: Props) => (
  <Animated.View
    style={[styles.wrap, style]}
    entering={FadeIn.duration(220)}
    exiting={FadeOut.duration(400)}
    pointerEvents="none"
  >
    <View style={styles.bubble}>
      <Text style={styles.text}>{text}</Text>
    </View>
  </Animated.View>
);

const styles = StyleSheet.create({
  // Full-width band anchored in the upper-middle, so the bubble centres and sits
  // clear of the player (mid-screen) and the bottom control deck.
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "28%",
    alignItems: "center",
  },
  bubble: {
    maxWidth: 380,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: "rgba(14, 17, 22, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  text: {
    fontFamily: UI.font,
    color: "rgba(255, 255, 255, 0.94)",
    fontSize: 20,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.85)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
