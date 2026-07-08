import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SERVER } from "../net/connection";

const KEY_HOST = "bits.host";
const KEY_NAME = "bits.name";

export interface JoinScreenProps {
  /** Non-null while a connection attempt is in flight. */
  connecting: boolean;
  error: string | null;
  onConnect: (host: string, name: string) => void;
}

/** Server address + name entry. The server prints its LAN IP at boot. */
export const JoinScreen = ({ connecting, error, onConnect }: JoinScreenProps) => {
  // The baked-in default (the Render URL) fills the field on first launch;
  // whatever was last used wins after that.
  const [host, setHost] = useState(DEFAULT_SERVER);
  const [name, setName] = useState("");

  useEffect(() => {
    void AsyncStorage.multiGet([KEY_HOST, KEY_NAME]).then((pairs) => {
      for (const [key, value] of pairs) {
        if (!value) continue;
        if (key === KEY_HOST) setHost(value);
        if (key === KEY_NAME) setName(value);
      }
    });
  }, []);

  const canSubmit = host.trim().length > 0 && name.trim().length > 0 && !connecting;
  const submit = (): void => {
    if (!canSubmit) return;
    const h = host.trim();
    const n = name.trim();
    void AsyncStorage.multiSet([
      [KEY_HOST, h],
      [KEY_NAME, n],
    ]);
    onConnect(h, n);
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Text style={styles.title}>BLOOD{"\n"}IN THE SAND</Text>
      <Text style={styles.subtitle}>first to 3 rounds · one life each</Text>

      <View style={styles.form}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="gladiator"
          placeholderTextColor="#6b6257"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16}
        />
        <Text style={styles.label}>Server address</Text>
        <TextInput
          style={styles.input}
          value={host}
          onChangeText={setHost}
          placeholder="xxx.onrender.com or 192.168.1.xx"
          placeholderTextColor="#6b6257"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={submit}
        />
        <Text style={styles.hint}>hostname (wss) or LAN IP — a local server prints its IP at boot</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={submit} style={[styles.button, !canSubmit && styles.buttonDisabled]}>
          <Text style={styles.buttonText}>{connecting ? "CONNECTING…" : "ENTER THE ARENA"}</Text>
        </Pressable>
      </View>
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
  title: {
    color: "#d94141",
    fontSize: 40,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 2,
  },
  subtitle: {
    color: "#8a7f70",
    fontSize: 14,
    marginTop: 8,
    marginBottom: 36,
  },
  form: { width: "100%", maxWidth: 320 },
  label: { color: "#b3a893", fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    color: "#f0e8d8",
    fontSize: 17,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hint: { color: "#6b6257", fontSize: 12, marginTop: 6 },
  error: { color: "#e0503c", fontSize: 14, marginTop: 14 },
  button: {
    backgroundColor: "#8c2f2f",
    borderRadius: 8,
    marginTop: 24,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#f5ede0", fontSize: 16, fontWeight: "800", letterSpacing: 1 },
});
