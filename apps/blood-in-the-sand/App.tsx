import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Alert, BackHandler, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  CLERK_PUBLISHABLE_KEY,
  hasPendingFirstWinNudge,
  resetFirstWinNudge,
  takeFirstWinNudge,
} from "./src/net/account";
import { AccountSheet } from "./src/components/AccountSheet";
import { MatchAcceptSheet } from "./src/components/MatchAcceptSheet";
import { QueueContext, type QueuePresence } from "./src/components/QueueContext";
import { ensureIdentity, fetchWallet } from "./src/net/api";
import { StatusBar } from "expo-status-bar";
import { useKeepAwake } from "expo-keep-awake";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ABILITY_IDS,
  LOADOUT_ABILITY_COUNT,
  WEAPON_IDS,
  type AbilityId,
} from "@heroic/blood-in-the-sand-sim";
import { DEFAULT_SERVER } from "./src/net/connection";
import { useArenaConnection } from "./src/net/useArenaConnection";
import { setAnnouncerPack } from "./src/audio";
import { loadAnnouncerPack, loadPrimerSeen, savePrimerSeen } from "./src/settings";
import { loadWornTitle } from "./src/deeds/wornTitle";
import { loadEntitlements } from "./src/deeds/entitlements";
import { useFonts } from "expo-font";
import { DISPLAY_FONT_SOURCE } from "./src/typography";
import { fetchAndApplyUpdate, restartToApply, useUpdateReady } from "./src/updates";
import { PracticeClient } from "./src/net/practice";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { ArmoryScreen } from "./src/screens/ArmoryScreen";
import { DeedsScreen } from "./src/screens/DeedsScreen";
import { GameScreen } from "./src/screens/GameScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ModeSelectScreen } from "./src/screens/ModeSelectScreen";
import { NameScreen } from "./src/screens/NameScreen";
import { PracticeScreen } from "./src/screens/PracticeScreen";
import { PrimerScreen } from "./src/screens/PrimerScreen";
import { RankedScreen } from "./src/screens/RankedScreen";
import { RoomListScreen } from "./src/screens/RoomListScreen";
import { RoomScreen } from "./src/screens/RoomScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { FeedbackScreen } from "./src/screens/FeedbackScreen";

/**
 * The app always talks to ONE server (EXPO_PUBLIC_DEFAULT_SERVER, or the
 * AUTO_HOST dev override) — useArenaConnection dials on launch so PLAY is
 * instant, silently redials when the socket dies (phones kill sockets on
 * every sleep), and only surfaces trouble behind the PLAY route.
 *
 * Top-level routes (home is the title screen):
 *   home              → title + PLAY / SETTINGS
 *   primer            → the first PLAY's rules walkthrough (bits-onboarding.md);
 *                       replayable from Settings + the dev menu
 *   modes             → the fork behind PLAY: ranked / skirmish / practice / story
 *                       (bits-mode-select.md — connectivity gates live there)
 *   play              → SKIRMISH: connecting / RoomList / Room (lobby) / Game, by client state
 *   ranked            → RANKED: connecting / RankedScreen (queue) / Room / Game
 *                       (bits-ranked.md — matchFound seats us server-side, so the
 *                       same client-state routing carries the whole flow). The
 *                       QUEUE ROAMS (§ Queue roaming & match accept, 2026-08-25):
 *                       once queued the player may wander every menu route; the
 *                       header pill (QueueContext) shows the wait, the summons
 *                       (MatchAcceptSheet) rises over any of them, and a ranked
 *                       welcome pulls the route back here. Only the doors into
 *                       ANOTHER match — skirmish, practice — leave the line.
 *   practice          → bots-or-dummies front door; an offline sim match
 *   settings          → device settings (lefty mode)
 *   feedback          → bug reports / feedback form, from Settings (bits-feedback.md)
 */
const SERVER = process.env.EXPO_PUBLIC_AUTO_HOST ?? DEFAULT_SERVER;

/** The same stored "playing as" the rooms + practice screens use. */
const KEY_NAME = "bits.name";

/** Dummies on the firing range (they share the enemy team's seats). */
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

type Route =
  | "home"
  | "primer"
  | "modes"
  | "play"
  | "ranked"
  | "practice"
  | "settings"
  | "feedback"
  | "deeds"
  | "armory";

export default function App() {
  const [route, setRoute] = useState<Route>("home");
  // The Armory has a door on every menu screen (the home button, and the
  // shared header's purse everywhere else) — back retraces whichever one
  // was used.
  const armoryFrom = useRef<Route>("home");
  const openArmory = (from: Route): void => {
    armoryFrom.current = from;
    setRoute("armory");
  };
  // The connection lifecycle (dial / silent redial / visible failure) lives in
  // the manager; App just renders its snapshot and pokes wake() on route entry.
  const conn = useArenaConnection(SERVER || null);
  const client = conn.client;
  // The offline bot match — while set, the practice route shows the game.
  const [practice, setPractice] = useState<PracticeClient | null>(null);
  // Feedback from the UPDATE NOW attempt ("none" → store nudge, "failed" → retry).
  const [updateHint, setUpdateHint] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  // null = still loading from storage, "" = never set → PLAY gates on NameScreen.
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);

  // Staged-OTA flag for the home screen's restart pill — and the fast path
  // out of a protocol mismatch (the fix is usually already downloaded).
  const updateReady = useUpdateReady();

  // A game should never dim or lock mid-session — keep the screen awake the
  // whole time the app is foregrounded, not just during a match (GameScreen
  // keeps its own call too; redundant awake locks are harmless).
  useKeepAwake();

  // The bundled display face (typography.ts). Builds with the font embedded
  // natively (app.json expo-font plugin) report it loaded synchronously;
  // older builds load it at runtime, and the routed tree waits for that —
  // a Text that mounts before the face lands is MEASURED in the system
  // fallback and then DRAWN in Cinzel (wider), which clipped the title's
  // "SAND" and left stray fallback-font text behind. A load failure never
  // gates startup: the tree renders in the fallback face instead.
  const [fontsReady, fontError] = useFonts(DISPLAY_FONT_SOURCE);
  const typographyReady = fontsReady || fontError !== null;

  // The Primer (bits-onboarding.md): the first PLAY routes through the rules.
  // null = the boot read hasn't landed; a PLAY that early falls through to
  // the mode select — a veteran must never see it twice.
  const [primerSeen, setPrimerSeen] = useState<boolean | null>(null);
  const finishPrimer = useCallback((next: () => void) => {
    savePrimerSeen(true);
    setPrimerSeen(true);
    next();
  }, []);

  useEffect(() => {
    void AsyncStorage.getItem(KEY_NAME).then((v) => setPlayerName(v?.trim() ?? ""));
    void loadPrimerSeen().then(setPrimerSeen);
    // The persisted announcer voice (dev-menu picked) — applied before any
    // match can play a kill line; matches only exist behind PLAY/PRACTICE.
    void loadAnnouncerPack().then(setAnnouncerPack);
    // The worn title — loaded before any join can claim it (same reasoning).
    void loadWornTitle();
    // Earned entitlements — the wizard hides gated items until these load
    // (bits-secret-items.md); refreshed authoritatively on codex visits.
    void loadEntitlements();
  }, []);

  const saveName = useCallback((name: string) => {
    setPlayerName(name);
    void AsyncStorage.setItem(KEY_NAME, name);
  }, []);

  const endPractice = useCallback(() => {
    // Leaving any practice match (bots or the range) lands back on the
    // practice front door — since the mode select, dummies has one too.
    practice?.close();
    setPractice(null);
  }, [practice]);

  // The Primer's "try the range" exit: offline sim, you vs a line of
  // respawning target dummies (the player-facing way in is PRACTICE →
  // TARGET DUMMIES; this jump just skips the two screens between).
  const startTargetDummies = useCallback(() => {
    client?.queueLeave(); // an offline match is a match — the line is given up
    setPractice(new PracticeClient(playerName || "gladiator", RANGE_TEAM_SIZE, "dummies"));
    setRoute("practice");
  }, [playerName, client]);

  // The doors into another match while queued: confirm, then leave the line.
  // (Everything else — the Armory, Deeds, Settings, home — stays open; the
  // queue follows.) A no-op passthrough while not queued.
  const leaveQueueThen = useCallback(
    (what: string, next: () => void): void => {
      if (!client?.queued) return next();
      Alert.alert("Leave the ranked queue?", `${what} means giving up your place in line.`, [
        { text: "Stay queued", style: "cancel" },
        {
          text: "Leave queue",
          style: "destructive",
          onPress: () => {
            client.queueLeave();
            next();
          },
        },
      ]);
    },
    [client],
  );

  // A ranked welcome pulls the route home from wherever the player roamed:
  // the accept stage seated us, and the arming wizard lives on the ranked
  // route's RoomScreen. (A welcome on the play route is a skirmish seat.)
  const rankedSeated = client?.welcome != null && client.rankedMatch !== null;
  useEffect(() => {
    if (rankedSeated && route !== "ranked") setRoute("ranked");
  }, [rankedSeated, route]);

  // What every menu screen's header needs to show the roaming queue.
  const queued = conn.state === "online" && client?.queued === true;
  const queuedIn = client?.queueStatus.filter((b) => b.waitedSec !== undefined) ?? [];
  const waitedSec = queued && queuedIn.length > 0 ? Math.max(...queuedIn.map((b) => b.waitedSec!)) : undefined;
  const queuePresence = useMemo<QueuePresence>(
    () => ({
      queued,
      waitedSec,
      goToRanked: () => {
        conn.wake();
        setRoute("ranked");
      },
    }),
    [queued, waitedSec, conn],
  );

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

  // UPDATE NOW on the mismatch screen. If the fix is already staged, restart
  // into it; otherwise fetch it live. Success never returns (JS reloads).
  const applyUpdate = useCallback(async () => {
    setUpdateHint(null);
    if (updateReady) {
      restartToApply();
      return;
    }
    setUpdating(true);
    const result = await fetchAndApplyUpdate();
    setUpdating(false);
    if (result === "none") {
      setUpdateHint("No update is live yet — install the newest build from TestFlight or Google Play, or try again shortly.");
    } else if (result === "failed") {
      setUpdateHint("Couldn't reach the update server — check your connection and try again.");
    }
  }, [updateReady]);

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
    } else if ((route === "play" || route === "ranked") && client?.welcome) {
      confirmLeave(client.phase === "lobby" ? "lobby" : "match", () => client.leaveRoom());
    } else if (route === "play" || route === "ranked" || route === "practice") {
      // All were entered from the mode select — back retraces that step.
      // (A ranked back KEEPS the queue — it roams; the header pill carries it.)
      setRoute("modes");
    } else if (route === "armory") {
      setRoute(armoryFrom.current);
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
    ((route === "play" || route === "ranked") && client?.welcome != null && client.phase !== "lobby");

  // The first-win account nudge (bits-accounts.md): GameScreen noted an
  // online win; the sheet rises the moment the match flow releases the
  // screen — over the returned-to lobby, never over the victory plate. The
  // ranked route is excluded whole (the RankedCeremony owns that return) —
  // the claim survives and the sheet rises on the next calm surface instead.
  const [firstWinNudge, setFirstWinNudge] = useState(false);
  useEffect(() => {
    if (inMatch || route === "ranked" || firstWinNudge || !hasPendingFirstWinNudge()) return;
    let live = true;
    void takeFirstWinNudge().then((show) => {
      if (show && live) setFirstWinNudge(true);
    });
    return () => {
      live = false;
    };
  });

  let screen;
  if (route === "home") {
    screen = (
      <HomeScreen
        onPlay={() => setRoute(primerSeen === false ? "primer" : "modes")}
        onArmory={() => openArmory("home")}
        onReplayPrimer={() => {
          savePrimerSeen(false);
          setPrimerSeen(false);
          setRoute("primer");
        }}
        onSettings={() => setRoute("settings")}
        onRehearseFirstWin={
          CLERK_PUBLISHABLE_KEY.length > 0
            ? () => {
                resetFirstWinNudge();
                setFirstWinNudge(true);
              }
            : undefined
        }
        updateReady={updateReady}
        onApplyUpdate={restartToApply}
      />
    );
  } else if (route === "primer") {
    screen = (
      <PrimerScreen
        onDone={() => finishPrimer(() => setRoute("modes"))}
        onRange={() => finishPrimer(startTargetDummies)}
        onExit={() => setRoute("home")}
      />
    );
  } else if (route === "deeds") {
    // Entered from the mode select's DEEDS card — back returns there.
    screen = <DeedsScreen onBack={() => setRoute("modes")} onArmory={() => openArmory("deeds")} />;
  } else if (route === "armory") {
    screen = <ArmoryScreen onBack={() => setRoute(armoryFrom.current)} />;
  } else if (route === "modes") {
    // Connectivity-blind on purpose: Skirmish routes into the play flow,
    // whose connect screen already owns the down/update states. wake() makes
    // entry itself the redial trigger — a socket that died while the phone
    // slept reconnects invisibly instead of showing its stale corpse.
    screen = (
      <ModeSelectScreen
        onBack={() => setRoute("home")}
        onSkirmish={() =>
          leaveQueueThen("Skirmish", () => {
            conn.wake();
            setRoute("play");
          })
        }
        onRanked={() => {
          conn.wake();
          setRoute("ranked");
        }}
        onPractice={() => leaveQueueThen("Practice", () => setRoute("practice"))}
        onDeeds={() => setRoute("deeds")}
        onArmory={() => openArmory("modes")}
      />
    );
  } else if (route === "settings") {
    screen = (
      <SettingsScreen
        onBack={() => setRoute("home")}
        onArmory={() => openArmory("settings")}
        playerName={playerName ?? ""}
        onRename={saveName}
        onPrimer={() => setRoute("primer")}
        onFeedback={() => setRoute("feedback")}
      />
    );
  } else if (route === "feedback") {
    screen = (
      <FeedbackScreen
        onBack={() => setRoute("settings")}
        onArmory={() => openArmory("feedback")}
        playerName={playerName ?? ""}
      />
    );
  } else if (route === "practice") {
    // Practice runs the SAME arming wizard as real rooms before the match.
    screen = !practice ? (
      <PracticeScreen
        onBack={() => setRoute("modes")}
        onArmory={() => openArmory("practice")}
        onStart={(name, teamSize, difficulty, opponent) =>
          setPractice(
            opponent === "dummies"
              ? new PracticeClient(name, RANGE_TEAM_SIZE, "dummies")
              : new PracticeClient(name, teamSize, "bot", difficulty),
          )
        }
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
  } else if (conn.state !== "online" || !client || playerName === null) {
    // The whole not-connected surface (quiet dial / down / update / dev
    // fallback) is ConnectScreen's; the manager keeps redialing underneath.
    screen = (
      <ConnectScreen
        state={conn.state === "online" ? "connecting" : conn.state}
        offline={conn.offline}
        retryIn={conn.retryIn}
        updating={updating}
        updateHint={updateHint}
        onRetry={conn.wake}
        onUpdate={() => void applyUpdate()}
        onPractice={() => setRoute("practice")}
        onBack={() => setRoute("modes")}
      />
    );
  } else if (!client.welcome) {
    // No seat yet: the ranked route idles on its home (queue + standing);
    // skirmish browses rooms. matchFound → welcome flips both into RoomScreen.
    screen =
      route === "ranked" ? (
        <RankedScreen
          client={client}
          playerName={playerName}
          onBack={() => setRoute("modes")}
          onArmory={() => openArmory("ranked")}
        />
      ) : (
        <RoomListScreen
          client={client}
          playerName={playerName}
          onBack={() => setRoute("modes")}
          onArmory={() => openArmory("play")}
        />
      );
  } else if (client.phase === "lobby") {
    // The arming wizard + lobby (and its 10s countdown) all live on RoomScreen.
    screen = <RoomScreen client={client} onLeave={() => client.leaveRoom()} ranked={client.rankedMatch !== null} />;
  } else {
    screen = <GameScreen client={client} onLeave={() => client.leaveRoom()} />;
  }

  const tree = (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueueContext.Provider value={queuePresence}>
          {/* Home is the sunlit High Sun scene — dark icons; everywhere else stays dark-ground. */}
          <StatusBar style={route === "home" ? "dark" : "light"} hidden={inMatch} />
          {/* Dark root until the display face is ready (see useFonts above) —
              the same ground as the launch screen, so nothing visibly flashes. */}
          {typographyReady ? screen : null}
          {/* The summons (bits-ranked.md § Queue roaming & match accept): over
              every route, since the queue may have roamed anywhere. A dodge
              lands on the ranked home, where the lockout explains itself. */}
          {typographyReady && client?.pendingMatch ? (
            <MatchAcceptSheet
              client={client}
              onDismissed={(dodged) => {
                client.dismissPending();
                if (dodged) setRoute("ranked");
              }}
            />
          ) : null}
          {/* takeFirstWinNudge only fires under a shipped Clerk key, so this
              sheet always has the provider below it. */}
          {firstWinNudge ? (
            <AccountSheet
              mode="firstWin"
              onClose={() => setFirstWinNudge(false)}
              onLinked={() => {
                setFirstWinNudge(false);
                // A link (or adoption) changed the wallet under every purse —
                // one authoritative fetch republishes to all of them.
                void ensureIdentity().then((id) => {
                  if (id) void fetchWallet(id);
                });
              }}
            />
          ) : null}
        </QueueContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  // Accounts (bits-accounts.md): the Clerk provider mounts only when the
  // publishable key shipped — without it every sign-in door stays hidden
  // (the header purse/Settings gate on the key) and the tree runs Clerk-free.
  return CLERK_PUBLISHABLE_KEY.length > 0 ? (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      {tree}
    </ClerkProvider>
  ) : (
    tree
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
});
