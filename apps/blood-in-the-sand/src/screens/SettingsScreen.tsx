import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import { AccountSheet } from "../components/AccountSheet";
import { ScreenHeader, ScreenSign } from "../components/ScreenHeader";
import { CLERK_PUBLISHABLE_KEY, accountUnlink } from "../net/account";
import { ensureIdentity, useWalletInfo } from "../net/api";
import { loadLefty, saveLefty } from "../settings";
import { runningVersion } from "../updates";

export interface SettingsScreenProps {
  onBack: () => void;
  /** The header purse → the Armory. */
  onArmory: () => void;
  /** The stored gladiator name ("" if never claimed). */
  playerName: string;
  /** Commit a new non-empty name — persists and applies from the next match. */
  onRename: (name: string) => void;
}

/**
 * Device settings: Lefty mode (mirrors the in-match control band) and the
 * gladiator name (first claimed on the way into PLAY — this is the only place
 * to change it afterwards). Saved on toggle / end of editing.
 */
export const SettingsScreen = ({ onBack, onArmory, playerName, onRename }: SettingsScreenProps) => {
  const insets = useSafeAreaInsets();
  const [lefty, setLefty] = useState(false);
  const [name, setName] = useState(playerName);

  useEffect(() => {
    void loadLefty().then(setLefty);
  }, []);

  const toggleLefty = (on: boolean): void => {
    setLefty(on);
    saveLefty(on);
  };

  // An emptied field reverts rather than erasing the name (which would
  // re-trigger the first-run prompt on PLAY).
  const commitName = (): void => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== playerName) onRename(trimmed);
    else setName(playerName);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom }]}>
      <ScreenHeader onBack={onBack} onPurse={onArmory} />
      <ScreenSign title="SETTINGS" />

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Gladiator name</Text>
          <Text style={styles.rowHint}>how other players see you</Text>
        </View>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          onEndEditing={commitName}
          placeholder="your name"
          placeholderTextColor="#6b6257"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={16}
        />
      </View>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Lefty mode</Text>
          <Text style={styles.rowHint}>movement on the left, buttons on the right</Text>
        </View>
        <Switch
          value={lefty}
          onValueChange={toggleLefty}
          trackColor={{ false: "#3a332a", true: "#8c2f2f" }}
          thumbColor="#f0e8d8"
        />
      </View>

      {CLERK_PUBLISHABLE_KEY.length > 0 ? <AccountRows /> : null}

      <View style={styles.version}>
        <Text style={styles.versionText}>{version.binary}</Text>
        <Text style={styles.versionText}>{version.bundle}</Text>
      </View>
    </View>
  );
};

/**
 * The account rows (bits-accounts.md § restore door): the always-available
 * fallback to the wallet glyph, and the home of account DELETION (App Store
 * 5.1.1(v) — mandatory once sign-in exists). Rendered only under a shipped
 * Clerk key (the hooks need App.tsx's provider) and only once the wallet
 * confirms accounts are on server-side; deletion clears the LINK — the
 * armory survives on this device as pure-anonymous.
 */
const AccountRows = () => {
  const { wallet, refresh } = useWalletInfo();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { signOut } = useAuth();
  if (wallet === null || !wallet.accounts) return null;

  const confirmDelete = (): void => {
    Alert.alert(
      "Delete account?",
      "Your sign-in is removed everywhere. Purchases stay on this device only.",
      [
        { text: "Keep account", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy(true);
              const identity = await ensureIdentity();
              const done = identity !== null && (await accountUnlink(identity));
              // The Clerk user is gone (or was never reachable) — drop the
              // local session either way; a dead session helps nobody.
              if (done) await signOut().catch(() => undefined);
              setBusy(false);
              if (done) refresh();
              else {
                Alert.alert("Couldn't delete", "The ledger couldn't be reached — nothing changed.");
              }
            })();
          },
        },
      ],
    );
  };

  return wallet.linked ? (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>Purchases saved</Text>
        <Text style={styles.rowHint}>your armory follows your account</Text>
      </View>
      <Pressable onPress={confirmDelete} hitSlop={8} style={busy && styles.rowBusy}>
        <Text style={styles.deleteText}>DELETE ACCOUNT</Text>
      </Pressable>
    </View>
  ) : (
    <>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Save purchases</Text>
          <Text style={styles.rowHint}>sign in — your armory follows you to any device</Text>
        </View>
        <Pressable onPress={() => setSheetOpen(true)} hitSlop={8}>
          <Text style={styles.signInText}>SIGN IN</Text>
        </Pressable>
      </View>
      {sheetOpen ? (
        <AccountSheet
          mode="restore"
          onClose={() => setSheetOpen(false)}
          onLinked={() => {
            setSheetOpen(false);
            refresh();
          }}
        />
      ) : null}
    </>
  );
};

// Fixed for the life of the JS world — a reload lands in a new one.
const version = runningVersion();

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210", paddingTop: 64, paddingHorizontal: 20 },
  row: {
    backgroundColor: "#1d1915",
    borderRadius: 8,
    marginTop: 24,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowText: { gap: 3, flexShrink: 1 },
  nameInput: {
    backgroundColor: "#221e19",
    borderColor: "#3a332a",
    borderWidth: 1,
    borderRadius: 8,
    color: "#f0e8d8",
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 140,
    textAlign: "center",
  },
  rowTitle: { color: "#f0e8d8", fontSize: 16, fontWeight: "700" },
  rowHint: { color: "#8a7f70", fontSize: 12 },
  rowBusy: { opacity: 0.45 },
  signInText: { color: "#e8c87a", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  deleteText: { color: "#c96a4a", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  version: { marginTop: "auto", paddingVertical: 12, alignItems: "center", gap: 2 },
  versionText: { color: "#564e43", fontSize: 11, letterSpacing: 0.5 },
});
