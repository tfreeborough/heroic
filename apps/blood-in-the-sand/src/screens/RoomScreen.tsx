/**
 * The room lobby AND the draft (docs/design/pvp-abilities.md, mock-approved
 * 2026-07-12): lobby → host STARTS THE DRAFT → timed blind pick (LOCK IN or
 * the clock) → the reveal moment → timed counterpick (hidden changes) → sand.
 *
 * Information rules are the server's (per-team filtered roomState); this
 * screen just renders what it was sent: your team's live picks + lock checks,
 * the enemy's lock checks, and — from the reveal on — their phase-1 locks.
 *
 * Works identically for ArenaClient (real rooms) and PracticeClient (offline
 * vs a bot) through the LobbyClient interface — practice IS the test bed.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import {
  LOADOUT_ABILITY_COUNT,
  PICK_PHASE_SECONDS,
  REVEAL_ADJUST_SECONDS,
  WEAPONS,
  type AbilityId,
  type RoomStatePlayer,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import type { LobbyClient } from "../net/connection";
import { playStrikeHaptic } from "../game/haptics";
import { LoadoutSheet, type SheetMode } from "../loadout/LoadoutSheet";
import { LoadoutIcon } from "../loadout/icons";
import { categoryOf, CATEGORY_META, C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";

export interface RoomScreenProps {
  /** ArenaClient for real rooms; PracticeClient drives the same draft offline. */
  client: LobbyClient;
  onLeave: () => void;
}

const REVEAL_SPLASH_MS = 4600;

export const RoomScreen = ({ client, onLeave }: RoomScreenProps) => {
  const insets = useSafeAreaInsets();
  const phase = client.phase;
  const drafting = phase === "pick" || phase === "reveal";

  // The draft countdown lives in snapshots, which don't re-render this screen
  // — tick it ourselves while a draft phase is open.
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!drafting) return;
    const id = setInterval(force, 250);
    return () => clearInterval(id);
  }, [drafting]);

  const [sheetMode, setSheetMode] = useState<SheetMode | null>(null);

  // The reveal moment: a staged overlay when the reveal phase opens.
  const [splash, setSplash] = useState(false);
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current !== "reveal" && phase === "reveal") {
      setSplash(true);
      playStrikeHaptic("medium"); // TODO real reveal SFX via Asset Forge
      const id = setTimeout(() => setSplash(false), REVEAL_SPLASH_MS);
      return () => clearTimeout(id);
    }
    prevPhase.current = phase;
  }, [phase]);
  useEffect(() => {
    prevPhase.current = phase;
  }, [phase]);

  const welcome = client.welcome;
  if (!welcome) return null;

  const players = client.roomState?.players ?? [];
  const myTeam = welcome.team;
  const mine = players.filter((p) => p.team === myTeam);
  const theirs = players.filter((p) => p.team !== myTeam);
  const me = players.find((p) => p.id === welcome.playerId);

  const everyoneHere = players.length >= 2 && players.every((p) => p.connected);
  const canStart = client.isHost && phase === "lobby" && everyoneHere;
  const myWeapon = client.myWeapon;
  const myAbilities = client.myAbilities;
  const myComplete = myWeapon !== null && myAbilities.length === LOADOUT_ABILITY_COUNT;
  const myLocked = me?.locked ?? false;
  const slotsInert = !(phase === "lobby" || (drafting && !myLocked));

  // Round state (timer, last match) from the snapshot stream.
  const view = client.buffer.sample(performance.now());
  const round = view?.round;
  const timerLeft = Math.max(0, Math.ceil(round?.timer ?? 0));
  const timerTotal = phase === "pick" ? PICK_PHASE_SECONDS : REVEAL_ADJUST_SECONDS;
  const lastMatch =
    phase === "lobby" && round && round.lastWinner !== 0
      ? `last match: ${round.lastWinner === myTeam ? "you won" : "you lost"} ${Math.max(...round.wins)}–${Math.min(...round.wins)}`
      : null;

  const lockIn = (): void => {
    playStrikeHaptic("heavy"); // TODO real lock-in SFX via Asset Forge
    client.lockIn();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.roomName}>{welcome.roomName}</Text>
          <Text style={styles.phaseLine}>
            {phase === "lobby"
              ? `room ${welcome.roomCode} — tell a friend`
              : phase === "pick"
                ? "PHASE I — BLIND PICK"
                : "PHASE II — COUNTERPICK"}
          </Text>
        </View>
        {drafting ? <TimerRing left={timerLeft} total={timerTotal} /> : null}
      </View>

      <View style={styles.teams}>
        <TeamHeader label="YOUR TEAM" color="#d94141" />
        {mine.map((p) => (
          <PlayerRow key={p.id} p={p} isMe={p.id === welcome.playerId} hostId={client.hostId} own />
        ))}
        <TeamHeader label="ENEMY TEAM" color="#4da3d9" />
        {theirs.map((p) => (
          <PlayerRow key={p.id} p={p} isMe={false} hostId={client.hostId} own={false} revealing={phase !== "lobby" && phase !== "pick"} />
        ))}
        {theirs.length === 0 ? <Text style={styles.waitingSeat}>waiting for an opponent…</Text> : null}
        {phase === "pick" ? (
          <Text style={styles.intelNote}>enemy picks stay hidden until the reveal</Text>
        ) : phase === "reveal" ? (
          <Text style={styles.intelNote}>their picks as revealed — counterpick changes stay hidden</Text>
        ) : null}
      </View>

      <Text style={styles.slotLabel}>YOUR LOADOUT</Text>
      <View style={styles.slots}>
        <Pressable
          onPress={() => !slotsInert && setSheetMode("weapon")}
          style={[styles.slot, styles.slotWeapon, myWeapon !== null && styles.slotFilled, slotsInert && styles.slotInert]}
        >
          <Text style={styles.slotKind}>WEAPON</Text>
          {myWeapon !== null ? (
            <>
              <LoadoutIcon id={myWeapon} size={30} color={C_GOLD} />
              <Text style={styles.slotName}>{WEAPONS[myWeapon].name.toUpperCase()}</Text>
            </>
          ) : (
            <Text style={styles.slotEmpty}>+</Text>
          )}
          <Text style={styles.slotHint}>{myLocked ? "LOCKED" : myWeapon !== null ? "TAP TO CHANGE" : "TAP TO CHOOSE"}</Text>
        </Pressable>
        <Pressable
          onPress={() => !slotsInert && setSheetMode("ability")}
          style={[
            styles.slot,
            styles.slotAbility,
            myAbilities.length === LOADOUT_ABILITY_COUNT && styles.slotFilled,
            myAbilities.length > 0 && myAbilities.length < LOADOUT_ABILITY_COUNT && styles.slotPartial,
            slotsInert && styles.slotInert,
          ]}
        >
          <Text style={styles.slotKind}>ABILITIES</Text>
          <View style={styles.miniRow}>
            {Array.from({ length: LOADOUT_ABILITY_COUNT }, (_, i) => {
              const id = myAbilities[i];
              return id ? (
                <LoadoutIcon key={i} id={id} size={26} color={CATEGORY_META[categoryOf(id)].color} />
              ) : (
                <View key={i} style={styles.miniGhost}>
                  <Text style={styles.miniGhostText}>+</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.slotHint}>
            {myLocked
              ? "LOCKED"
              : myAbilities.length === 0
                ? "TAP TO CHOOSE"
                : myAbilities.length < LOADOUT_ABILITY_COUNT
                  ? `${myAbilities.length}/${LOADOUT_ABILITY_COUNT} · TAP TO FINISH`
                  : "TAP TO CHANGE"}
          </Text>
        </Pressable>
      </View>

      {lastMatch ? <Text style={styles.lastMatch}>{lastMatch}</Text> : null}

      {phase === "lobby" ? (
        client.isHost ? (
          <Pressable
            onPress={() => canStart && client.startMatch()}
            style={[styles.mainButton, styles.hostButton, !canStart && styles.buttonDisabled]}
          >
            <Text style={styles.mainButtonText}>{canStart ? "START DRAFT" : "NEED 2 PLAYERS"}</Text>
          </Pressable>
        ) : (
          <Text style={styles.waitingText}>waiting for the host to start the draft…</Text>
        )
      ) : myLocked ? (
        <View style={[styles.mainButton, styles.lockedButton]}>
          <Text style={styles.lockedButtonText}>✓ LOCKED IN — WAITING…</Text>
        </View>
      ) : (
        <Pressable
          onPress={() => myComplete && lockIn()}
          style={[styles.mainButton, styles.lockButton, !myComplete && styles.buttonDisabled]}
        >
          <Text style={[styles.mainButtonText, myComplete && styles.lockButtonText]}>
            {myComplete ? "LOCK IN" : "PICK YOUR LOADOUT"}
          </Text>
        </Pressable>
      )}
      {drafting && !myLocked ? (
        <Text style={styles.timeoutHint}>timer hits zero → empty picks get random fills</Text>
      ) : null}

      <Pressable onPress={onLeave} style={styles.leave} hitSlop={8}>
        <Text style={styles.leaveText}>LEAVE ROOM</Text>
      </Pressable>

      {sheetMode !== null && !slotsInert ? (
        <LoadoutSheet
          mode={sheetMode}
          weapon={myWeapon}
          abilities={myAbilities}
          onPickWeapon={(w) => client.setWeapon(w)}
          onPickAbilities={(a) => client.setAbilities(a)}
          onClose={() => setSheetMode(null)}
        />
      ) : null}

      {splash ? <RevealSplash enemies={theirs} onDismiss={() => setSplash(false)} /> : null}
    </View>
  );
};

// ── Pieces ─────────────────────────────────────────────────────────────────

const TeamHeader = ({ label, color }: { label: string; color: string }) => (
  <View style={styles.teamHead}>
    <Text style={[styles.teamLabel, { color }]}>{label}</Text>
    <View style={styles.teamRule} />
  </View>
);

/** Weapon + 3 ability mini-icons in a row (gold · sep · category colours). */
const PickIcons = ({ weapon, abilities }: { weapon: WeaponId | null; abilities: AbilityId[] | null }) => (
  <View style={styles.pickIcons}>
    {weapon !== null ? <LoadoutIcon id={weapon} size={17} color={C_GOLD} /> : null}
    {weapon !== null && abilities && abilities.length > 0 ? <View style={styles.pickSep} /> : null}
    {(abilities ?? []).map((id) => (
      <LoadoutIcon key={id} id={id} size={17} color={CATEGORY_META[categoryOf(id)].color} />
    ))}
  </View>
);

interface PlayerRowProps {
  p: RoomStatePlayer;
  isMe: boolean;
  hostId: number | null;
  own: boolean;
  /** Enemy rows only: show their phase-1 reveal instead of lock-state text. */
  revealing?: boolean;
}

const PlayerRow = ({ p, isMe, hostId, own, revealing = false }: PlayerRowProps) => {
  const hasLivePicks = own && (p.weapon !== null || (p.abilities?.length ?? 0) > 0);
  const hasReveal = !own && revealing && p.revealed !== null;
  return (
    <View style={[styles.playerRow, !p.connected && styles.playerGone]}>
      <Text style={styles.playerName}>
        {p.id === hostId ? "♛ " : ""}
        {p.name}
        {isMe ? " (you)" : ""}
        {p.connected ? "" : " — reconnecting…"}
      </Text>
      <View style={styles.playerRight}>
        {hasLivePicks ? (
          <PickIcons weapon={p.weapon} abilities={p.abilities} />
        ) : hasReveal ? (
          <PickIcons weapon={p.revealed} abilities={p.revealedAbilities} />
        ) : (
          <Text style={styles.playerStatus}>{p.locked ? "locked in" : "choosing…"}</Text>
        )}
        <View style={[styles.lockMark, p.locked && styles.lockMarkOn]}>
          <Text style={[styles.lockMarkText, p.locked && styles.lockMarkTextOn]}>✓</Text>
        </View>
      </View>
    </View>
  );
};

/** Depleting radial countdown — gold, red inside the last 10 seconds. */
const TimerRing = ({ left, total }: { left: number; total: number }) => {
  const frac = Math.max(0, Math.min(1, left / total));
  const color = left <= 10 ? "#d94141" : C_GOLD;
  const track = Skia.Path.Make();
  track.addCircle(22, 22, 17);
  const arc = Skia.Path.Make();
  arc.addArc({ x: 5, y: 5, width: 34, height: 34 }, -90, 360 * frac);
  return (
    <View style={styles.timer}>
      <Canvas style={styles.timerCanvas}>
        <Path path={track} style="stroke" strokeWidth={3.5} color="#221e19" />
        <Path path={arc} style="stroke" strokeWidth={3.5} color={color} strokeCap="round" />
      </Canvas>
      <Text style={[styles.timerNum, left <= 10 && styles.timerNumLow]}>{left}</Text>
    </View>
  );
};

/** The reveal moment: enemy loadouts flip up one by one over a dark takeover. */
const RevealSplash = ({ enemies, onDismiss }: { enemies: RoomStatePlayer[]; onDismiss: () => void }) => {
  const anims = useRef(enemies.map(() => new Animated.Value(0))).current;
  const foot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.stagger(500, [
      ...anims.map((a) => Animated.timing(a, { toValue: 1, duration: 420, useNativeDriver: true })),
      Animated.timing(foot, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [anims, foot]);

  return (
    <Pressable style={styles.splash} onPress={onDismiss}>
      <Text style={styles.splashEyebrow}>PICKS ARE LOCKED</Text>
      <Text style={styles.splashTitle}>THE REVEAL</Text>
      <View style={styles.splashCards}>
        {enemies.map((p, i) => (
          <Animated.View
            key={p.id}
            style={[
              styles.splashCard,
              {
                opacity: anims[i]!,
                transform: [{ translateY: anims[i]!.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
              },
            ]}
          >
            <Text style={styles.splashName}>{p.name}</Text>
            <View style={styles.splashPicks}>
              {p.revealed !== null ? <LoadoutIcon id={p.revealed} size={24} color={C_GOLD} /> : null}
              <View style={styles.pickSepTall} />
              {(p.revealedAbilities ?? []).map((id) => (
                <LoadoutIcon key={id} id={id} size={24} color={CATEGORY_META[categoryOf(id)].color} />
              ))}
            </View>
          </Animated.View>
        ))}
      </View>
      <Animated.Text style={[styles.splashFoot, { opacity: foot }]}>
        they see your team's picks too —{"\n"}counterpick is open, and those changes stay hidden
      </Animated.Text>
    </Pressable>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 64, paddingHorizontal: 22 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerText: { flexShrink: 1, gap: 5 },
  roomName: { color: C_BONE, fontSize: 22, fontWeight: "900", letterSpacing: 1 },
  phaseLine: { color: C_GOLD, fontSize: 10, fontWeight: "900", letterSpacing: 2.5 },

  timer: { width: 44, height: 44 },
  timerCanvas: { width: 44, height: 44 },
  timerNum: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    textAlign: "center",
    textAlignVertical: "center",
    lineHeight: 44,
    color: C_BONE,
    fontSize: 13,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  timerNumLow: { color: "#d94141" },

  teams: { marginTop: 14, gap: 3 },
  teamHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 3 },
  teamLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 2.5 },
  teamRule: { flex: 1, height: 1, backgroundColor: "#2e2820" },
  playerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5 },
  playerGone: { opacity: 0.45 },
  playerName: { color: C_BONE, fontSize: 13.5, fontWeight: "700", flexShrink: 1 },
  playerRight: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" },
  playerStatus: { color: C_MUTED, fontSize: 12, fontStyle: "italic" },
  pickIcons: { flexDirection: "row", alignItems: "center", gap: 5 },
  pickSep: { width: 1, height: 13, backgroundColor: "#3a332a", marginHorizontal: 3 },
  pickSepTall: { width: 1, height: 18, backgroundColor: "#3a332a", marginHorizontal: 4 },
  lockMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#2e2820",
    alignItems: "center",
    justifyContent: "center",
  },
  lockMarkOn: { backgroundColor: "#5fc75f", borderColor: "#5fc75f" },
  lockMarkText: { color: "#4a4238", fontSize: 9, fontWeight: "900" },
  lockMarkTextOn: { color: "#0f130f" },
  waitingSeat: { color: "#6b6257", fontSize: 13, fontStyle: "italic", paddingVertical: 5 },
  intelNote: { color: "#6b6257", fontSize: 10, fontStyle: "italic", marginTop: 4 },

  slotLabel: { color: C_MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 3, marginTop: 18, marginBottom: 8 },
  slots: { flexDirection: "row", gap: 10 },
  slot: {
    backgroundColor: "#1d1915",
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#3a332a",
    minHeight: 104,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  slotWeapon: { flex: 2 },
  slotAbility: { flex: 3 },
  slotFilled: { borderStyle: "solid", borderColor: C_GOLD, backgroundColor: "#26201a" },
  slotPartial: { borderStyle: "solid", borderColor: "#5a4c34", backgroundColor: "#26201a" },
  slotInert: { opacity: 0.45 },
  slotKind: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2.5 },
  slotEmpty: { color: "#4a4238", fontSize: 26, fontWeight: "300", lineHeight: 30 },
  slotName: { color: C_BONE, fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  slotHint: { color: C_MUTED, fontSize: 9.5, letterSpacing: 1 },
  miniRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  miniGhost: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#3a332a",
    alignItems: "center",
    justifyContent: "center",
  },
  miniGhostText: { color: "#4a4238", fontSize: 14, fontWeight: "300" },

  lastMatch: { color: C_MUTED, fontSize: 13, marginTop: 16, textAlign: "center" },

  mainButton: { borderRadius: 10, marginTop: "auto", paddingVertical: 15, alignItems: "center" },
  hostButton: { backgroundColor: "#3a5a3a" },
  lockButton: { backgroundColor: C_GOLD },
  lockButtonText: { color: "#241a0c" },
  lockedButton: { backgroundColor: "#26201a", borderWidth: 1.5, borderColor: "#5fc75f" },
  lockedButtonText: { color: "#5fc75f", fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  buttonDisabled: { backgroundColor: "#221e19" },
  mainButtonText: { color: "#f5ede0", fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  waitingText: { color: C_MUTED, fontSize: 14, marginTop: "auto", textAlign: "center", paddingVertical: 15 },
  timeoutHint: { color: "#6b6257", fontSize: 10.5, textAlign: "center", marginTop: 8 },

  leave: { alignSelf: "center", marginTop: 14, marginBottom: 34 },
  leaveText: { color: C_MUTED, fontWeight: "700", letterSpacing: 1, fontSize: 12 },

  splash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,7,6,0.97)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  splashEyebrow: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 4 },
  splashTitle: { color: "#d94141", fontSize: 30, fontWeight: "900", letterSpacing: 4, marginTop: 6, marginBottom: 22 },
  splashCards: { alignSelf: "stretch", gap: 10 },
  splashCard: {
    backgroundColor: "#1d1915",
    borderWidth: 1,
    borderColor: "#33231d",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  splashName: { color: C_BONE, fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  splashPicks: { flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" },
  splashFoot: {
    color: C_MUTED,
    fontSize: 11,
    fontStyle: "italic",
    textAlign: "center",
    lineHeight: 17,
    marginTop: 24,
  },
});
