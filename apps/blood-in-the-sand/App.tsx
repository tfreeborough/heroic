import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ArenaClient, DEFAULT_SERVER, resolveServerUrl } from "./src/net/connection";
import { PracticeClient } from "./src/net/practice";
import { GameScreen } from "./src/screens/GameScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { PracticeScreen } from "./src/screens/PracticeScreen";
import { RoomListScreen } from "./src/screens/RoomListScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";

/**
 * The app always talks to ONE server (EXPO_PUBLIC_DEFAULT_SERVER, or the
 * AUTO_HOST dev override) — it connects on launch so PLAY is instant, but
 * connection concerns only surface behind the PLAY route.
 *
 * Top-level routes (home is the title screen):
 *   home              → title + PLAY / PRACTICE / SETTINGS
 *   play              → connecting / RoomList / Room (lobby) / Game, by client state
 *   practice          → one-person weapon lobby; PLAY spawns an offline bot match
 *   settings          → device settings (lefty mode)
 */
const SERVER = process.env.EXPO_PUBLIC_AUTO_HOST ?? DEFAULT_SERVER;

type Route = "home" | "play" | "practice" | "settings";

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [client, setClient] = useState<ArenaClient | null>(null);
  // The offline bot match — while set, the practice route shows the game.
  const [practice, setPractice] = useState<PracticeClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);

  const endPractice = useCallback(() => {
    setPractice((p) => {
      p?.close();
      return null; // back to the practice lobby (the route stays "practice")
    });
  }, []);

  useEffect(() => {
    if (!practice) return;
    // The practice round machine returns to "lobby" after matchEnd — that's
    // the offline analogue of leaving the room: back to the weapon lobby.
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
    // A dead connection drops the play route back to its connect screen.
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
        setRoute("play");
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

  // Every phase RoomScreen owns (the lobby + both draft beats); the rest is match.
  const lobbyPhase = (phase: string): boolean =>
    phase === "lobby" || phase === "pick" || phase === "reveal";

  const inMatch =
    (practice !== null && !lobbyPhase(practice.phase)) ||
    (route === "play" && client?.welcome != null && !lobbyPhase(client.phase));

  let screen;
  if (route === "home") {
    screen = (
      <HomeScreen
        onPlay={() => setRoute("play")}
        onPractice={() => setRoute("practice")}
        onSettings={() => setRoute("settings")}
      />
    );
  } else if (route === "settings") {
    screen = <SettingsScreen onBack={() => setRoute("home")} />;
  } else if (route === "practice") {
    // Practice runs the SAME 4-beat draft as real rooms before the match.
    screen = !practice ? (
      <PracticeScreen onBack={() => setRoute("home")} onStart={(name) => setPractice(new PracticeClient(name))} />
    ) : practice.phase === "pick" || practice.phase === "reveal" ? (
      <RoomScreen client={practice} onLeave={endPractice} />
    ) : (
      <GameScreen client={practice} onLeave={endPractice} onQuit={endPractice} />
    );
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
          </>
        ) : (
          <Text style={styles.connecting}>connecting…</Text>
        )}
        <Pressable onPress={() => setRoute("home")} style={styles.homeLink} hitSlop={10}>
          <Text style={styles.homeLinkText}>‹ BACK</Text>
        </Pressable>
      </View>
    );
  } else if (!client.welcome) {
    screen = <RoomListScreen client={client} onBack={() => setRoute("home")} />;
  } else if (lobbyPhase(client.phase)) {
    // The whole draft (blind pick → reveal → counterpick) plays out on the lobby screen.
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
  homeLink: { marginTop: 28 },
  homeLinkText: { color: "#8a7f70", fontSize: 14, fontWeight: "800", letterSpacing: 1 },
});
