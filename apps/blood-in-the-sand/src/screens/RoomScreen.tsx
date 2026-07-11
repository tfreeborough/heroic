import { StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { WEAPONS, WEAPON_IDS, type WeaponId } from "@heroic/blood-in-the-sand-sim";
import type { ArenaClient } from "../net/connection";

/** One-line sales pitch per weapon — the tuning table stays in the sim. */
const WEAPON_BLURBS: Record<WeaponId, string> = {
  blade: "long cuts that bleed",
  bow: "long-range shots",
  staff: "slow seeking orb",
  hammer: "huge knockback",
};

export interface RoomScreenProps {
  client: ArenaClient;
  onLeave: () => void;
}

/**
 * The room lobby: who's here, the shareable code, each player's weapon pick,
 * and — for the host — the START button (gated until everyone has picked).
 * Everyone lands back here after each match (no auto-rematch).
 */
export const RoomScreen = ({ client, onLeave }: RoomScreenProps) => {
  const welcome = client.welcome;
  if (!welcome) return null;

  const players = client.roomState?.players ?? [];
  const hostId = client.hostId;
  const connected = players.filter((p) => p.connected).length;
  const allPicked = players.length >= 2 && players.every((p) => p.weapon !== null);
  const canStart = client.isHost && connected >= 2 && allPicked;
  const myWeapon = client.myWeapon;

  // Last match line, from the snapshot round state kept through the lobby.
  const view = client.buffer.sample(performance.now());
  const round = view?.round;
  const lastMatch =
    round && round.lastWinner !== 0
      ? `last match: ${round.lastWinner === welcome.team ? "you won" : "you lost"} ${Math.max(...round.wins)}–${Math.min(...round.wins)}`
      : null;

  return (
    <View style={styles.root}>
      <Text style={styles.roomName}>{welcome.roomName}</Text>
      <View style={styles.codeChip}>
        <Text style={styles.codeLabel}>room code</Text>
        <Text style={styles.code}>{welcome.roomCode}</Text>
        <Text style={styles.codeHint}>tell a friend — they can join with it</Text>
      </View>

      <View style={styles.playerList}>
        {players.map((p) => (
          <View key={p.id} style={[styles.playerRow, !p.connected && styles.playerGone]}>
            <View style={[styles.teamDot, p.team === 1 ? styles.team1 : styles.team2]} />
            <Text style={styles.playerName}>
              {p.name}
              {p.id === hostId ? " 👑" : ""}
              {p.id === welcome.playerId ? "  (you)" : ""}
              {p.connected ? "" : "  — reconnecting…"}
            </Text>
            <Text style={[styles.playerPick, p.weapon === null && styles.playerPickNone]}>
              {p.weapon === null ? "choosing…" : WEAPONS[p.weapon].name}
            </Text>
          </View>
        ))}
        {players.length < 2 ? (
          <View style={styles.playerRow}>
            <View style={[styles.teamDot, styles.teamEmpty]} />
            <Text style={styles.waitingSeat}>waiting for an opponent…</Text>
          </View>
        ) : null}
      </View>

      {/* weapon picker — tap to (re)pick until the host starts */}
      <Text style={styles.pickTitle}>your weapon</Text>
      <View style={styles.weaponRow}>
        {WEAPON_IDS.map((id) => (
          <Pressable
            key={id}
            onPress={() => client.setWeapon(id)}
            style={[styles.weaponChip, myWeapon === id && styles.weaponChipPicked]}
          >
            <Text style={[styles.weaponName, myWeapon === id && styles.weaponNamePicked]}>
              {WEAPONS[id].name}
            </Text>
            <Text style={styles.weaponBlurb}>{WEAPON_BLURBS[id]}</Text>
          </Pressable>
        ))}
      </View>

      {lastMatch ? <Text style={styles.lastMatch}>{lastMatch}</Text> : null}

      {client.isHost ? (
        <Pressable
          onPress={() => canStart && client.startMatch()}
          style={[styles.startButton, !canStart && styles.startDisabled]}
        >
          <Text style={styles.startText}>
            {canStart ? "START MATCH" : connected < 2 ? "NEED 2 PLAYERS" : "WAITING FOR WEAPONS"}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.waitingHost}>
          {myWeapon === null ? "pick a weapon…" : "waiting for the host to start…"}
        </Text>
      )}

      <Pressable onPress={onLeave} style={styles.leave} hitSlop={8}>
        <Text style={styles.leaveText}>LEAVE ROOM</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 80, paddingHorizontal: 24, alignItems: "center" },
  roomName: { color: "#f0e8d8", fontSize: 26, fontWeight: "900", letterSpacing: 1 },
  codeChip: { alignItems: "center", marginTop: 18, backgroundColor: "#1d1915", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 34 },
  codeLabel: { color: "#8a7f70", fontSize: 12 },
  code: { color: "#d99a41", fontSize: 40, fontWeight: "900", letterSpacing: 8, marginVertical: 2 },
  codeHint: { color: "#6b6257", fontSize: 11 },
  playerList: { alignSelf: "stretch", marginTop: 30, gap: 10 },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1d1915",
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  playerGone: { opacity: 0.45 },
  playerPick: { marginLeft: "auto", color: "#d99a41", fontSize: 13, fontWeight: "700" },
  playerPickNone: { color: "#6b6257", fontWeight: "400", fontStyle: "italic" },
  pickTitle: { color: "#8a7f70", fontSize: 12, marginTop: 26, letterSpacing: 1, textTransform: "uppercase" },
  weaponRow: { flexDirection: "row", gap: 8, marginTop: 10, alignSelf: "stretch" },
  weaponChip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#1d1915",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  weaponChipPicked: { borderColor: "#d99a41", backgroundColor: "#26201a" },
  weaponName: { color: "#f0e8d8", fontSize: 14, fontWeight: "800" },
  weaponNamePicked: { color: "#d99a41" },
  weaponBlurb: { color: "#8a7f70", fontSize: 10, marginTop: 3, textAlign: "center" },
  teamDot: { width: 14, height: 14, borderRadius: 7 },
  team1: { backgroundColor: "#d94141" },
  team2: { backgroundColor: "#4d7fd9" },
  teamEmpty: { backgroundColor: "#3a332a" },
  playerName: { color: "#f0e8d8", fontSize: 16, fontWeight: "600" },
  waitingSeat: { color: "#6b6257", fontSize: 15, fontStyle: "italic" },
  lastMatch: { color: "#8a7f70", fontSize: 14, marginTop: 22 },
  startButton: {
    backgroundColor: "#8c2f2f",
    borderRadius: 10,
    marginTop: 26,
    paddingVertical: 16,
    paddingHorizontal: 48,
  },
  startDisabled: { opacity: 0.4 },
  startText: { color: "#f5ede0", fontSize: 17, fontWeight: "900", letterSpacing: 1 },
  waitingHost: { color: "#8a7f70", fontSize: 15, marginTop: 30 },
  leave: { position: "absolute", bottom: 48 },
  leaveText: { color: "#8a7f70", fontWeight: "700", letterSpacing: 1, fontSize: 13 },
});
