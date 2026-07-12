import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { WEAPON_IDS, WEAPONS } from "@heroic/blood-in-the-sand-sim";
import { ArenaClient, DEFAULT_SERVER, resolveServerUrl } from "./src/net/connection";
import { PracticeClient } from "./src/net/practice";
import { GameScreen } from "./src/screens/GameScreen";
import { RoomListScreen } from "./src/screens/RoomListScreen";
import { RoomScreen } from "./src/screens/RoomScreen";

/**
 * The app always talks to ONE server (EXPO_PUBLIC_DEFAULT_SERVER, or the
 * AUTO_HOST dev override) — it connects on launch, no address entry. Screen
 * routing is driven entirely by client state:
 *   connecting / lost     → Connect (auto-retries by tapping)
 *   connected, no room    → RoomList (name + browse / create / join by code)
 *   in room, lobby phase  → Room (players, host's START button)
 *   in room, match phase  → Game (back to Room when the phase flips to lobby)
 */
const SERVER = process.env.EXPO_PUBLIC_AUTO_HOST ?? DEFAULT_SERVER;

export default function App() {
  const [client, setClient] = useState<ArenaClient | null>(null);
  // An offline bot match (no server involved) — takes over the screen while set.
  const [practice, setPractice] = useState<PracticeClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);

  const endPractice = useCallback(() => {
    setPractice((p) => {
      p?.close();
      return null;
    });
  }, []);

  // For the connect-error screen's offline-practice shortcut (the rooms
  // screen's own practice button collects the name properly).
  const savedName = useRef("gladiator");
  useEffect(() => {
    void AsyncStorage.getItem("bits.name").then((v) => {
      if (v?.trim()) savedName.current = v.trim();
    });
  }, []);

  useEffect(() => {
    if (!practice) return;
    // The practice round machine returns to "lobby" after matchEnd — that's
    // the offline analogue of leaving the room: back to the menu.
    practice.onChange = () => {
      if (practice.phase === "lobby") endPractice();
      else force();
    };
    return () => {
      practice.onChange = null;
    };
  }, [practice, endPractice]);

  const connect = useCallback(() => {
    setError(null);
    if (!SERVER) {
      setError("no server configured — set EXPO_PUBLIC_DEFAULT_SERVER");
      return;
    }
    setClient(new ArenaClient(resolveServerUrl(SERVER)));
  }, []);

  useEffect(() => {
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  useEffect(() => {
    if (!client) return;
    // A dead connection drops back to the connect screen with the reason.
    const check = (): void => {
      if (client.status === "closed" || client.status === "rejected") {
        setError(client.rejectReason ?? "connection lost");
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

  // Simulator-loop conveniences: AUTO_JOIN=first hops into the first open
  // room; AUTO_START presses the host's button when the lobby fills. Together
  // with a bot, "expo start" alone produces a running match.
  const autoActedAt = useRef(0);
  useEffect(() => {
    if (!client || client.status !== "open") return;
    const now = Date.now();
    if (now - autoActedAt.current < 1500) return;
    if (process.env.EXPO_PUBLIC_AUTO_JOIN === "first" && !client.welcome) {
      const open = client.rooms.find((r) => r.phase === "lobby" && r.players < r.capacity && !r.locked);
      if (open) {
        autoActedAt.current = now;
        client.joinRoom("sim", open.code, "");
      }
    } else if (process.env.EXPO_PUBLIC_AUTO_START && client.welcome && client.phase === "lobby" && client.isHost) {
      const connected = client.roomState?.players.filter((p) => p.connected).length ?? 0;
      if (connected >= 2) {
        autoActedAt.current = now;
        client.startMatch();
      }
    }
  });

  const inMatch = practice !== null || (client?.welcome != null && client.phase !== "lobby");

  let screen;
  if (practice) {
    screen = <GameScreen client={practice} onLeave={endPractice} onQuit={endPractice} />;
  } else if (!client || client.status === "connecting") {
    screen = (
      <View style={styles.centre}>
        <Text style={styles.logo}>BLOOD{"\n"}IN THE SAND</Text>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={connect} style={styles.retry}>
              <Text style={styles.retryText}>RETRY</Text>
            </Pressable>
            <Text style={styles.offlineHint}>no server? fight a bot offline</Text>
            <View style={styles.weaponRow}>
              {WEAPON_IDS.map((w) => (
                <Pressable
                  key={w}
                  onPress={() => setPractice(new PracticeClient(savedName.current, w))}
                  style={styles.weaponChip}
                >
                  <Text style={styles.weaponChipText}>{WEAPONS[w].name.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Text style={styles.connecting}>connecting…</Text>
        )}
      </View>
    );
  } else if (!client.welcome) {
    screen = (
      <RoomListScreen client={client} onPractice={(name, weapon) => setPractice(new PracticeClient(name, weapon))} />
    );
  } else if (client.phase === "lobby") {
    screen = <RoomScreen client={client} onLeave={() => client.leaveRoom()} />;
  } else {
    screen = <GameScreen client={client} onLeave={() => client.leaveRoom()} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="light" hidden={inMatch} />
        {screen}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  centre: { flex: 1, backgroundColor: "#141210", alignItems: "center", justifyContent: "center", padding: 24 },
  logo: {
    color: "#d94141",
    fontSize: 40,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: 2,
    marginBottom: 24,
  },
  connecting: { color: "#8a7f70", fontSize: 15 },
  error: { color: "#e0503c", fontSize: 14, textAlign: "center", marginBottom: 16 },
  retry: { backgroundColor: "#8c2f2f", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 36 },
  retryText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
  offlineHint: { color: "#8a7f70", fontSize: 12, marginTop: 28 },
  weaponRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  weaponChip: { backgroundColor: "#3a5a3a", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14 },
  weaponChipText: { color: "#f5ede0", fontWeight: "800", fontSize: 12 },
});
