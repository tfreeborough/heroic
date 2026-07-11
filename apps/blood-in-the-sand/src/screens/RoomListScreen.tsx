import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RoomListing } from "@heroic/blood-in-the-sand-sim";
import type { ArenaClient } from "../net/connection";

const REFRESH_MS = 4000;
const KEY_NAME = "bits.name";

export interface RoomListScreenProps {
  client: ArenaClient;
}

/**
 * The front door: pick a name, then browse → join, or create. Locked rooms
 * expand an inline passcode prompt on tap. The list re-polls every few
 * seconds while this screen is mounted.
 */
export const RoomListScreen = ({ client }: RoomListScreenProps) => {
  const [name, setName] = useState("");
  const [nameHint, setNameHint] = useState(false);
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [createPass, setCreatePass] = useState("");
  const [passFor, setPassFor] = useState<string | null>(null); // room code awaiting a passcode
  const [joinPass, setJoinPass] = useState("");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    void AsyncStorage.getItem(KEY_NAME).then((v) => v && setName(v));
    const timer = setInterval(() => client.listRooms(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [client]);

  /** Name is required at the point of action — nudge the field if it's empty. */
  const requireName = (): string | null => {
    const n = name.trim();
    if (!n) {
      setNameHint(true);
      return null;
    }
    setNameHint(false);
    void AsyncStorage.setItem(KEY_NAME, n);
    return n;
  };

  const join = (room: RoomListing): void => {
    const n = requireName();
    if (!n) return;
    if (room.locked && passFor !== room.code) {
      setPassFor(room.code);
      setJoinPass("");
      return;
    }
    client.joinRoom(n, room.code, room.locked ? joinPass : "");
  };

  const joinByCode = (): void => {
    const n = requireName();
    if (n && joinCode.length === 4) client.joinRoom(n, joinCode, joinPass);
  };

  const create = (): void => {
    const n = requireName();
    if (n) client.createRoom(n, roomName.trim() || `${n}'s room`, createPass);
  };

  const renderRoom = ({ item }: { item: RoomListing }) => (
    <View style={styles.roomCard}>
      <Pressable onPress={() => join(item)} style={styles.roomRow}>
        <View style={styles.roomText}>
          <Text style={styles.roomName}>
            {item.locked ? "🔒 " : ""}
            {item.name}
          </Text>
          <Text style={styles.roomMeta}>
            {item.code} · {item.players}/{item.capacity} · {item.phase === "lobby" ? "in lobby" : "match running"}
          </Text>
        </View>
        <Text style={styles.joinHint}>{item.players < item.capacity ? "JOIN ›" : "FULL"}</Text>
      </Pressable>
      {passFor === item.code ? (
        <View style={styles.passRow}>
          <TextInput
            style={[styles.input, styles.passInput]}
            value={joinPass}
            onChangeText={setJoinPass}
            placeholder="passcode"
            placeholderTextColor="#6b6257"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => join(item)}
          />
          <Pressable onPress={() => join(item)} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>GO</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>ROOMS</Text>
        <View style={styles.nameWrap}>
          <Text style={styles.nameLabel}>playing as</Text>
          <TextInput
            style={[styles.input, styles.nameInput, nameHint && styles.inputAttention]}
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (t.trim()) setNameHint(false);
            }}
            placeholder="your name"
            placeholderTextColor="#6b6257"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16}
          />
        </View>
      </View>
      {nameHint ? <Text style={styles.error}>pick a name first</Text> : null}

      {client.lastError ? <Text style={styles.error}>{client.lastError}</Text> : null}

      {/* create */}
      {creating ? (
        <View style={styles.createForm}>
          <TextInput
            style={styles.input}
            value={roomName}
            onChangeText={setRoomName}
            placeholder={name.trim() ? `${name.trim()}'s room` : "room name"}
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
          <View style={styles.createButtons}>
            <Pressable onPress={() => setCreating(false)} style={[styles.smallButton, styles.ghost]}>
              <Text style={styles.smallButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable onPress={create} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>CREATE</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setCreating(true)} style={styles.createButton}>
          <Text style={styles.createButtonText}>+ CREATE A ROOM</Text>
        </Pressable>
      )}

      {/* join by code */}
      <View style={styles.codeRow}>
        <TextInput
          style={[styles.input, styles.codeInput]}
          value={joinCode}
          onChangeText={(t) => setJoinCode(t.toUpperCase())}
          placeholder="have a code? e.g. KRVX"
          placeholderTextColor="#6b6257"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={4}
          onSubmitEditing={joinByCode}
        />
        <Pressable onPress={joinByCode} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>JOIN</Text>
        </Pressable>
      </View>

      <FlatList
        data={client.rooms}
        keyExtractor={(r) => r.code}
        renderItem={renderRoom}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>no rooms open — create one</Text>}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 64, paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: "#d94141", fontSize: 28, fontWeight: "900", letterSpacing: 3 },
  nameWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  nameLabel: { color: "#8a7f70", fontSize: 12 },
  nameInput: { minWidth: 120 },
  inputAttention: { borderColor: "#e0503c" },
  error: { color: "#e0503c", fontSize: 14, marginTop: 10 },
  createButton: {
    backgroundColor: "#8c2f2f",
    borderRadius: 8,
    marginTop: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  createButtonText: { color: "#f5ede0", fontWeight: "800", letterSpacing: 1 },
  createForm: {
    backgroundColor: "#1d1915",
    borderRadius: 8,
    marginTop: 16,
    padding: 12,
    gap: 8,
  },
  createButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  codeRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "center" },
  codeInput: { flex: 1 },
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
  smallButton: {
    backgroundColor: "#8c2f2f",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ghost: { backgroundColor: "#3a332a" },
  smallButtonText: { color: "#f5ede0", fontWeight: "800", fontSize: 13 },
  list: { marginTop: 18 },
  roomCard: {
    backgroundColor: "#1d1915",
    borderRadius: 8,
    marginBottom: 10,
    overflow: "hidden",
  },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  roomText: { gap: 3 },
  roomName: { color: "#f0e8d8", fontSize: 16, fontWeight: "700" },
  roomMeta: { color: "#8a7f70", fontSize: 12 },
  joinHint: { color: "#d99a41", fontWeight: "800", fontSize: 13 },
  passRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 12, alignItems: "center" },
  passInput: { flex: 1 },
  empty: { color: "#6b6257", textAlign: "center", marginTop: 40 },
});
