// A chunky tappable button for the menu/settings chrome. Primary = filled accent
// (the main call to action); secondary = outlined.

import { Pressable, StyleSheet, Text } from "react-native";
import { UI } from "./theme";

export interface MenuButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}

export const MenuButton = ({ label, onPress, variant = "primary" }: MenuButtonProps) => {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, primary ? styles.primaryLabel : styles.secondaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minWidth: 240,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    alignItems: "center",
  },
  primary: {
    backgroundColor: UI.accent,
  },
  secondary: {
    borderWidth: 1.5,
    borderColor: UI.panelBorder,
    backgroundColor: UI.panel,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontFamily: UI.font,
    fontSize: 20,
  },
  primaryLabel: {
    color: UI.accentText,
  },
  secondaryLabel: {
    color: UI.text,
  },
});
