import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ABILITY_IDS,
  LOADOUT_ABILITY_COUNT,
  WEAPON_IDS,
  type AbilityId,
} from "@heroic/blood-in-the-sand-sim";
import { ArenaClient, DEFAULT_SERVER, resolveServerUrl } from "./src/net/connection";
import { PracticeClient } from "./src/net/practice";
import { GameScreen } from "./src/screens/GameScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { NameScreen } from "./src/screens/NameScreen";
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

/** The same stored "playing as" the rooms + practice screens use. */
const KEY_NAME = "bits.name";

/** Dummies on the dev menu's firing range (they share the enemy team's seats). */
const RANGE_TEAM_SIZE = 2; // 2×2 seats − you = 3 dummies

/** AUTO_START's random hand — dev convenience only, mirrors the bot script. */
const randomAutoHand = (): AbilityId[] => {
  const pool = [...ABILITY_IDS];
  const hand: AbilityId[] = [];
  while (hand.length < LOADOUT_ABILITY_COUNT) {
    hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  }
  return hand;
};

/** Shared "are you sure?" prompt for backing out of a lobby or a live match. */
const confirmLeave = (what: "lobby" | "match", leave: () => void): void => {
  Alert.alert(
    what === "match" ? "Leave the match?" : "Leave the lobby?",
    what === "match" ? "You'll forfeit this fight and leave the arena." : undefined,
    [
      { text: "Stay", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: leave },
    ],
  );
};

type Route = "home" | "play" | "practice" | "settings";

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  const [client, setClient] = useState<ArenaClient | null>(null);
  // The offline bot match — while set, the practice route shows the game.
  const [practice, setPractice] = useState<PracticeClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = still loading from storage, "" = never set → PLAY gates on NameScreen.
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);

  // A game should never dim or lock mid-session — keep the screen awake the
  // whole time the app is foregrounded, not just during a match (GameScreen
  // keeps its own call too; redundant awake locks are harmless).
  useKeepAwake();

  useEffect(() => {
    void AsyncStorage.getItem(KEY_NAME).then((v) => setPlayerName(v?.trim() ?? ""));
  }, []);

  const saveName = useCallback((name: string) => {
    setPlayerName(name);
    void AsyncStorage.setItem(KEY_NAME, name);
  }, []);

  const endPractice = useCallback(() => {
    // Bot practice returns to its lobby screen (the route stays "practice");
    // the dev firing range has no front door of its own — leaving lands home.
    if (practice?.mode === "dummies") setRoute("home");
    practice?.close();
    setPractice(null);
  }, [practice]);

  // The dev menu's firing range: offline sim, you vs a line of respawning
  // target dummies, reusing the whole practice flow (wizard → GameScreen).
  const startTargetDummies = useCallback(() => {
    setPractice(new PracticeClient(playerName || "gladiator", RANGE_TEAM_SIZE, "dummies"));
    setRoute("practice");
  }, [playerName]);

  useEffect(() => {
    if (!practice) return;
    // The lobby is a live screen now (the arming wizard) — matchEnd returns
    // there disarmed and the wizard reopens; leaving practice is RoomScreen's
    // LEAVE button (endPractice), never a phase change.
    practice.onChange = force;
    return () => {
      practice.onChange = null;
    };
  }, [practice]);

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
  // room; AUTO_START arms this client with a random loadout (the server's
  // arming countdown does the actual starting). Together with a bot,
  // "expo start" alone produces a running match.
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
    } else if (
      process.env.EXPO_PUBLIC_AUTO_START &&
      client.welcome &&
      client.phase === "lobby" &&
      client.myWeapon === null
    ) {
      autoActedAt.current = now;
      client.setWeapon(WEAPON_IDS[Math.floor(Math.random() * WEAPON_IDS.length)]!);
      client.setAbilities(randomAutoHand());
    }
  });

  // Android hardware-back / back-gesture policy. Without a handler, back exits
  // the app from ANY screen — one stray tap in a menu drops players out. So:
  //   • in a lobby or a live match → confirm before leaving (it's destructive)
  //   • any other sub-screen (settings, connecting, room list, name) → home
  //   • on home (the root) → confirm before quitting the app entirely
  // Kept in a ref so it always sees the latest client/practice state (their
  // phase/welcome fields mutate in place, so effect deps wouldn't catch them).
  // No-op on iOS, which has no hardware back.
  const handleBack = useRef<() => void>(() => {});
  handleBack.current = () => {
    if (route === "home") {
      Alert.alert("Leave Blood in the Sand?", undefined, [
        { text: "Stay", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => BackHandler.exitApp() },
      ]);
    } else if (route === "practice" && practice) {
      confirmLeave(practice.phase === "lobby" ? "lobby" : "match", endPractice);
    } else if (route === "play" && client?.welcome) {
      confirmLeave(client.phase === "lobby" ? "lobby" : "match", () => client.leaveRoom());
    } else {
      setRoute("home");
    }
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack.current();
      return true; // we always handle back ourselves — never fall through to exit
    });
    return () => sub.remove();
  }, []);

  // RoomScreen owns the lobby (the arming wizard lives there); the rest is match.
  const inMatch =
    (practice !== null && practice.phase !== "lobby") ||
    (route === "play" && client?.welcome != null && client.phase !== "lobby");

  let screen;
  if (route === "home") {
    screen = (
      <HomeScreen
        onPlay={() => setRoute("play")}
        onPractice={() => setRoute("practice")}
        onSettings={() => setRoute("settings")}
        onTargetDummies={startTargetDummies}
      />
    );
  } else if (route === "settings") {
    screen = <SettingsScreen onBack={() => setRoute("home")} playerName={playerName ?? ""} onRename={saveName} />;
  } else if (route === "practice") {
    // Practice runs the SAME arming wizard as real rooms before the match.
    screen = !practice ? (
      <PracticeScreen
        onBack={() => setRoute("home")}
        onStart={(name, teamSize, difficulty) => setPractice(new PracticeClient(name, teamSize, "bot", difficulty))}
      />
    ) : practice.phase === "lobby" ? (
      <RoomScreen client={practice} onLeave={endPractice} />
    ) : (
      <GameScreen client={practice} onLeave={endPractice} onQuit={endPractice} />
    );
  } else if (playerName !== null && playerName.length === 0) {
    // First time through PLAY: claim a name before anything else (the
    // connection keeps warming up behind this screen).
    screen = <NameScreen onSubmit={saveName} />;
  } else if (!client || client.status === "connecting" || playerName === null) {
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
    screen = <RoomListScreen client={client} playerName={playerName} onBack={() => setRoute("home")} />;
  } else if (client.phase === "lobby") {
    // The arming wizard + lobby (and its 10s countdown) all live on RoomScreen.
    screen = <RoomScreen client={client} onLeave={() => client.leaveRoom()} />;
  } else {
    screen = <GameScreen client={client} onLeave={() => client.leaveRoom()} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {/* Home is the sunlit High Sun scene — dark icons; everywhere else stays dark-ground. */}
        <StatusBar style={route === "home" ? "dark" : "light"} hidden={inMatch} />
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
