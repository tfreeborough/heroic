import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound, unlockAudio } from "../audio";

export interface NameScreenProps {
  /** Called with the trimmed name — the caller persists it and moves on. */
  onSubmit: (name: string) => void;
}

/**
 * First-run rite of passage on the way into PLAY: claim a name before the
 * rooms appear. Shown only while no name is stored — after this it's
 * changeable from Settings, never asked again.
 */
export const NameScreen = ({ onSubmit }: NameScreenProps) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const ready = name.trim().length > 0;

  const submit = (): void => {
    if (!ready) return;
    unlockAudio();
    playSound("uiConfirm");
    onSubmit(name.trim());
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}
    >
      <Text style={styles.ask}>WHAT IS YOUR NAME,{"\n"}GLADIATOR?</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="your name"
        placeholderTextColor="#6b6257"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        maxLength={16}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <Pressable onPress={submit} style={[styles.button, !ready && styles.buttonDim]}>
        <Text style={styles.buttonText}>ENTER THE ARENA</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#141210",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  ask: {
    color: "#d94141",
    fontSize: 30,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 2,
    lineHeight: 40,
    marginBottom: 32,
  },
  input: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 10,
    color: "#f0e8d8",
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    textAlign: "center",
    width: 240,
  },
  button: {
    backgroundColor: "#8c2f2f",
    borderRadius: 10,
    marginTop: 16,
    paddingVertical: 14,
    alignItems: "center",
    width: 240,
  },
  buttonDim: { opacity: 0.4 },
  buttonText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 2, fontSize: 15 },
});
