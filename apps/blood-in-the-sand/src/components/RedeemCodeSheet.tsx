/**
 * The redeem-a-code sheet (bits-redeem-codes.md § Client): rises over the
 * Armory from the ticket door in the header. Gate the door, not the error —
 * an unlinked player sees the sign-in pitch where the field would be, never
 * a field that can't work; the sign-in rides an AccountSheet stacked on top,
 * and the moment the link lands (the wallet prop flips) the same sheet shows
 * the field, so someone who arrived with a code from Discord finishes without
 * leaving. The Armory hides the door entirely when accounts are off
 * server-side or no Clerk key shipped — nobody could link, so nobody could
 * redeem.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Modal, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { GestureHandlerRootView, Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { playSound, unlockAudio } from "../audio";
import { ensureIdentity, redeemCode, type Wallet } from "../net/api";
import { C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";
import { DISPLAY_FONT } from "../typography";
import { AccountSheet } from "./AccountSheet";

export interface RedeemCodeSheetProps {
  wallet: Wallet;
  onClose: () => void;
  /** Sign-in landed from this sheet — refetch the wallet (and, if `adopted`,
   * everything else: the identity was rewritten). */
  onLinked: (adopted: boolean) => void;
  /** A redeem paid out — the Armory owns its wallet state. */
  onRedeemed: (wallet: Wallet) => void;
}

type Note = { tone: "good" | "bad"; text: string } | null;

const WORDS = {
  invalid: "that's not a code I know",
  already: "you've already used that one",
  expired: "that one's finished",
  notLinked: "sign in first — codes need an account",
  unavailable: "couldn't reach the ledger — try again in a moment",
} as const;

const creditWords = (glory: number, signets: number): string => {
  const parts: string[] = [];
  if (glory > 0) parts.push(`+${glory} Glory`);
  if (signets > 0) parts.push(`+${signets} Signet${signets === 1 ? "" : "s"}`);
  return parts.join(" · ");
};

export const RedeemCodeSheet = ({ wallet, onClose, onLinked, onRedeemed }: RedeemCodeSheetProps) => {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [enter]);

  // The keyboard lift. KeyboardAvoidingView never sees a keyboard frame from
  // inside a Modal (Tom's device, 2026-09-10: "the keyboard covers it"), so
  // the sheet listens itself and rides up by the keyboard's measured height
  // — less the safe-area inset the keyboard already covers — on iOS to the
  // keyboard's own animation timing, on Android as the frame changes.
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) => {
      Animated.timing(lift, {
        toValue: Math.max(0, e.endCoordinates.height - insets.bottom),
        duration: ios ? (e.duration ?? 250) : 120,
        useNativeDriver: true,
      }).start();
    });
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e) => {
      Animated.timing(lift, { toValue: 0, duration: ios ? (e.duration ?? 250) : 120, useNativeDriver: true }).start();
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift, insets.bottom]);

  const requestClose = (): void => {
    if (busy) return;
    playSound("uiBack");
    onClose();
  };

  const submit = (): void => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    unlockAudio();
    setBusy(true);
    setNote(null);
    void (async () => {
      const identity = await ensureIdentity();
      const res = identity ? await redeemCode(identity, trimmed) : ({ ok: false, reason: "unavailable" } as const);
      setBusy(false);
      if (!res.ok) {
        playSound("uiError");
        setNote({ tone: "bad", text: WORDS[res.reason] });
        return;
      }
      // Signets are the money currency — their sting outranks the Glory one.
      playSound(res.credited.signets > 0 ? "signetPurchase" : "gloryEarned");
      setCode("");
      setNote({ tone: "good", text: creditWords(res.credited.glory, res.credited.signets) });
      onRedeemed(res.wallet);
    })();
  };

  return (
    <Modal transparent statusBarTranslucent animationType="none" onRequestClose={requestClose}>
      {/* A Modal hosts a native view OUTSIDE the app's gesture root — RNGH
        * touches inside it are dead without a root of its own (AccountSheet,
        * 2026-08-22). */}
      <GestureHandlerRootView style={styles.modalRoot}>
        <View style={styles.avoider}>
          <Animated.View style={[styles.scrim, { opacity: enter }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
          </Animated.View>
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: insets.bottom + 18 },
              {
                transform: [
                  { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) },
                  { translateY: Animated.multiply(lift, -1) },
                ],
              },
            ]}
          >
            <View style={styles.handle} />
            <Text style={styles.title}>REDEEM A CODE</Text>

            {wallet.linked ? (
              <>
                <Text style={styles.line}>GOT A CODE FROM ME? PUT IT IN HERE.</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t);
                    if (note) setNote(null);
                  }}
                  onSubmitEditing={submit}
                  placeholder="XXXXX-XXXXX"
                  placeholderTextColor="#6b6257"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  autoFocus
                  returnKeyType="done"
                  maxLength={40}
                  editable={!busy}
                />
                <Pressable
                  onPress={submit}
                  style={[styles.button, (busy || !code.trim()) && styles.buttonDim]}
                >
                  <Text style={styles.buttonText}>REDEEM</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.line}>
                  CODES NEED AN ACCOUNT SO I CAN MAKE SURE EACH ONE'S USED ONCE — SIGN IN AND IT'LL UNLOCK.
                </Text>
                <Pressable onPress={() => setAccountOpen(true)} style={styles.button}>
                  <Text style={styles.buttonText}>SIGN IN</Text>
                </Pressable>
              </>
            )}

            {note ? (
              <Text style={[styles.note, note.tone === "good" ? styles.noteGood : styles.noteBad]}>{note.text}</Text>
            ) : null}
            <Pressable onPress={requestClose} hitSlop={8} style={styles.skip}>
              <Text style={styles.skipText}>{wallet.linked ? "DONE" : "NOT NOW"}</Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* The sign-in, stacked on this sheet: when it lands the wallet prop
          * flips and the field appears underneath without a second tap. */}
        {accountOpen ? (
          <AccountSheet
            mode="restore"
            onClose={() => setAccountOpen(false)}
            onLinked={(adopted) => {
              setAccountOpen(false);
              onLinked(adopted);
            }}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  avoider: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: "#201b15",
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: "#3a332a",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 20,
    gap: 12,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a332a", marginBottom: 8 },
  title: { color: C_BONE, fontSize: 18, letterSpacing: 3, fontFamily: DISPLAY_FONT, textAlign: "center", marginRight: -3 },
  line: { color: "#c9bfae", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, lineHeight: 15, textAlign: "center" },
  input: {
    backgroundColor: "#1d1915",
    borderColor: "#3a332a",
    borderWidth: 1.5,
    borderRadius: 12,
    color: "#f0e8d8",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 3,
    textAlign: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: { alignItems: "center", justifyContent: "center", height: 44, borderRadius: 999, backgroundColor: C_GOLD },
  buttonDim: { opacity: 0.45 },
  buttonText: { color: "#241a0c", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  note: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textAlign: "center" },
  noteGood: { color: C_GOLD },
  noteBad: { color: "#c96a4a" },
  skip: { alignSelf: "center", paddingVertical: 4 },
  skipText: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2 },
});
