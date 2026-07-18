import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RoomListing } from "@heroic/blood-in-the-sand-sim";
import { playSound, unlockAudio } from "../audio";
import type { ArenaClient } from "../net/connection";

const REFRESH_MS = 4000;

export interface RoomListScreenProps {
  client: ArenaClient;
  /** Already claimed on the NameScreen gate — guaranteed non-empty. */
  playerName: string;
  /** Back to the title screen. */
  onBack: () => void;
}

/** Which dialog is up: create a room, join by code, or a locked room's passcode. */
type Sheet = { kind: "create" } | { kind: "code" } | { kind: "pass"; room: RoomListing };

/**
 * The front door to online play: browse → tap to join, or create. Everything
 * that needs typing happens in a closable modal (create, join-by-code, locked
 * room passcodes) — the list itself is just rooms. Rooms mid-match are hidden;
 * the list re-polls every few seconds while this screen is mounted.
 */
export const RoomListScreen = ({ client, playerName, onBack }: RoomListScreenProps) => {
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [roomName, setRoomName] = useState("");
  const [createPass, setCreatePass] = useState("");
  const [teamSize, setTeamSize] = useState(1);
  const [joinCode, setJoinCode] = useState("");
  const [joinPass, setJoinPass] = useState("");

  // The create button breathes — a slow pulse on a halo layer behind it.
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow]);

  useEffect(() => {
    const timer = setInterval(() => client.listRooms(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [client]);

  const openSheet = (next: Sheet): void => {
    unlockAudio();
    playSound("uiTap");
    client.lastError = null; // a stale failure doesn't belong in a fresh dialog
    if (next.kind === "code") setJoinCode("");
    if (next.kind !== "create") setJoinPass("");
    setSheet(next);
  };

  const closeSheet = (): void => {
    playSound("uiTap");
    setSheet(null);
  };

  const join = (room: RoomListing): void => {
    if (room.players >= room.capacity) return;
    if (room.locked) {
      openSheet({ kind: "pass", room });
      return;
    }
    playSound("uiConfirm");
    client.joinRoom(playerName, room.code, "");
  };

  const joinLocked = (room: RoomListing): void => {
    playSound("uiConfirm");
    client.joinRoom(playerName, room.code, joinPass);
  };

  const joinByCode = (): void => {
    if (joinCode.length !== 4) return;
    playSound("uiConfirm");
    client.joinRoom(playerName, joinCode, joinPass);
  };

  const create = (): void => {
    playSound("uiConfirm");
    client.createRoom(playerName, roomName.trim() || `${playerName}'s room`, createPass, teamSize);
  };

  // Mid-match rooms aren't joinable in any useful way — don't show them.
  const openRooms = client.rooms.filter((r) => r.phase === "lobby");

  const sheetError = client.lastError ? <Text style={styles.error}>{client.lastError}</Text> : null;

  const renderRoom = ({ item }: { item: RoomListing }) => (
    <Pressable onPress={() => join(item)} style={styles.roomCard}>
      <View style={styles.roomText}>
        <Text style={styles.roomName}>
          {item.locked ? "🔒 " : ""}
          {item.name}
        </Text>
        <Text style={styles.roomMeta}>
          {item.code} · {item.players}/{item.capacity} gladiators
        </Text>
      </View>
      <Text style={styles.joinHint}>{item.players < item.capacity ? "JOIN ›" : "FULL"}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Pressable onPress={onBack} hitSlop={12}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>ROOMS</Text>
        </View>
        <Pressable onPress={() => openSheet({ kind: "code" })} style={styles.codeButton}>
          <Text style={styles.codeButtonText}>JOIN BY CODE</Text>
        </Pressable>
      </View>

      {client.lastError && sheet === null ? <Text style={styles.error}>{client.lastError}</Text> : null}

      <FlatList
        data={openRooms}
        keyExtractor={(r) => r.code}
        renderItem={renderRoom}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>no rooms open — create one below</Text>}
      />

      {/* pinned create button, breathing */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glow,
              {
                opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.45] }),
                transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }],
              },
            ]}
          />
          <Pressable onPress={() => openSheet({ kind: "create" })} style={styles.createButton}>
            <Text style={styles.createButtonText}>⚔ CREATE A ROOM</Text>
          </Pressable>
        </View>
      </View>

      {sheet?.kind === "create" ? (
        <SheetModal title="CREATE A ROOM" onClose={closeSheet}>
          <TextInput
            style={styles.input}
            value={roomName}
            onChangeText={setRoomName}
            placeholder={`${playerName}'s room`}
            placeholderTextColor="#6b6257"
            maxLength={16}
          />
          <TextInput
            style={styles.input}
            value={createPass}
            onChangeText={setCreatePass}
            placeholder="passcode (optional)"
            placeholderTextColor="#6b6257"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16}
          />
          <View style={styles.sizeRow}>
            {[1, 2, 3, 4].map((n) => (
              <Pressable
                key={n}
                onPress={() => setTeamSize(n)}
                style={[styles.sizeOption, teamSize === n && styles.sizeOptionOn]}
              >
                <Text style={[styles.sizeText, teamSize === n && styles.sizeTextOn]}>{`${n}v${n}`}</Text>
              </Pressable>
            ))}
          </View>
          {sheetError}
          <Pressable onPress={create} style={styles.sheetButton}>
            <Text style={styles.sheetButtonText}>CREATE</Text>
          </Pressable>
        </SheetModal>
      ) : null}

      {sheet?.kind === "code" ? (
        <SheetModal title="JOIN BY CODE" onClose={closeSheet}>
          <TextInput
            style={styles.input}
            value={joinCode}
            onChangeText={(t) => setJoinCode(t.toUpperCase())}
            placeholder="room code, e.g. KRVX"
            placeholderTextColor="#6b6257"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={4}
            onSubmitEditing={joinByCode}
          />
          <TextInput
            style={styles.input}
            value={joinPass}
            onChangeText={setJoinPass}
            placeholder="passcode (locked rooms only)"
            placeholderTextColor="#6b6257"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16}
          />
          {sheetError}
          <Pressable
            onPress={joinByCode}
            style={[styles.sheetButton, joinCode.length !== 4 && styles.sheetButtonDim]}
          >
            <Text style={styles.sheetButtonText}>JOIN</Text>
          </Pressable>
        </SheetModal>
      ) : null}

      {sheet?.kind === "pass" ? (
        <SheetModal title={`🔒 ${sheet.room.name}`} onClose={closeSheet}>
          <TextInput
            style={styles.input}
            value={joinPass}
            onChangeText={setJoinPass}
            placeholder="passcode"
            placeholderTextColor="#6b6257"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={16}
            onSubmitEditing={() => joinLocked(sheet.room)}
          />
          {sheetError}
          <Pressable onPress={() => joinLocked(sheet.room)} style={styles.sheetButton}>
            <Text style={styles.sheetButtonText}>JOIN</Text>
          </Pressable>
        </SheetModal>
      ) : null}
    </View>
  );
};

/**
 * A centred, closable dialog card. Gesture-handler Pressables inside a Modal
 * need their own GestureHandlerRootView (Modals mount a fresh native tree).
 */
const SheetModal = ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) => (
  <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <GestureHandlerRootView style={styles.veilRoot}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.veil}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.sheetClose}>✕</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </GestureHandlerRootView>
  </Modal>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 64, paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: "#d94141", fontSize: 28, fontWeight: "900", letterSpacing: 3 },
  backText: { color: "#8a7f70", fontSize: 30, fontWeight: "800", marginTop: -3 },
  codeButton: {
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  codeButtonText: { color: "#d99a41", fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  error: { color: "#e0503c", fontSize: 14, marginTop: 10 },
  list: { marginTop: 18 },
  empty: { color: "#6b6257", textAlign: "center", marginTop: 40 },
  roomCard: {
    backgroundColor: "#1d1915",
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  roomText: { gap: 3 },
  roomName: { color: "#f0e8d8", fontSize: 16, fontWeight: "700" },
  roomMeta: { color: "#8a7f70", fontSize: 12 },
  joinHint: { color: "#d99a41", fontWeight: "800", fontSize: 13 },
  bottomBar: { paddingTop: 12 },
  glow: {
    position: "absolute",
    top: -6,
    bottom: -6,
    left: -6,
    right: -6,
    borderRadius: 16,
    backgroundColor: "#d94141",
  },
  createButton: {
    backgroundColor: "#8c2f2f",
    borderColor: "#e0503c",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  createButtonText: { color: "#f5ede0", fontWeight: "900", letterSpacing: 2, fontSize: 16 },
  veilRoot: { flex: 1 },
  veil: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheetCard: {
    backgroundColor: "#1d1915",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    width: "100%",
    maxWidth: 360,
  },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
  sheetTitle: { color: "#f0e8d8", fontSize: 16, fontWeight: "900", letterSpacing: 1 },
  sheetClose: { color: "#8a7f70", fontSize: 16, fontWeight: "800" },
  sheetButton: {
    backgroundColor: "#8c2f2f",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 2,
  },
  sheetButtonDim: { opacity: 0.4 },
  sheetButtonText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1, fontSize: 14 },
  input: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    color: "#f0e8d8",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sizeRow: { flexDirection: "row", gap: 8 },
  sizeOption: {
    flex: 1,
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: "center",
  },
  sizeOptionOn: { backgroundColor: "#8c2f2f", borderColor: "#8c2f2f" },
  sizeText: { color: "#8a7f70", fontWeight: "800", fontSize: 13, letterSpacing: 1 },
  sizeTextOn: { color: "#f5ede0" },
});
