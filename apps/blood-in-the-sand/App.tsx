import { useCallback, useEffect, useReducer, useState } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ArenaClient, resolveServerUrl } from "./src/net/connection";
import { GameScreen } from "./src/screens/GameScreen";
import { JoinScreen } from "./src/screens/JoinScreen";

export default function App() {
  const [client, setClient] = useState<ArenaClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!client) return;
    // A connection that fails before being seated falls back to the join screen.
    const check = (): void => {
      if (!client.welcome && (client.status === "closed" || client.status === "rejected")) {
        setError(client.rejectReason ?? "couldn't reach the server");
        client.close();
        setClient(null);
      }
    };
    client.onChange = () => {
      force();
      check();
    };
    check();
    return () => {
      client.onChange = null;
    };
  }, [client]);

  const connect = useCallback((address: string, name: string) => {
    setError(null);
    setClient(new ArenaClient(resolveServerUrl(address), name));
  }, []);

  // Dev convenience: EXPO_PUBLIC_AUTO_HOST=localhost bunx expo start --ios
  // skips the join form on launch — handy for the simulator loop.
  useEffect(() => {
    const auto = process.env.EXPO_PUBLIC_AUTO_HOST;
    if (auto) connect(auto, "sim");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  const leave = useCallback(() => {
    client?.close();
    setClient(null);
  }, [client]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="light" hidden={client?.welcome != null} />
        {client && client.welcome ? (
          <GameScreen client={client} onLeave={leave} />
        ) : (
          <JoinScreen connecting={client !== null} error={error} onConnect={connect} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
});
