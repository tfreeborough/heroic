/**
 * The sign-in sheet (bits-accounts.md) — the ONE surface where an account
 * enters the game, in two dressings:
 *
 *  - `keep` (post-purchase): dismissing asks for a confirm
 *    (Tom, 2026-08-21: nobody gets to say they closed it by accident).
 *  - `restore` (the wallet door / Settings): a free close.
 *
 * Both dressings show ONE platform-matched button — Apple native on iOS,
 * Google on Android (Tom, 2026-08-23: a player straddling platforms is too
 * rare to earn a second button).
 *
 * Clerk lives entirely inside this file's hooks; success hands the session
 * JWT to accountLink, which owns the merge/adopt dance. The sheet never
 * announces success itself — the caller closes it and lets the purse/armory
 * refresh be the confirmation (the api.ts quiet-wallet rule).
 *
 * MUST render inside ClerkProvider — App.tsx only mounts the provider when
 * EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY shipped, and every door that opens this
 * sheet is gated on the wallet's `accounts` flag.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Platform, StyleSheet, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  Pressable,
} from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";
import * as WebBrowser from "expo-web-browser";
import { useAuth, useSSO } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { playSound } from "../audio";
import { C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";
import { accountLink } from "../net/account";
import { DISPLAY_FONT } from "../typography";

// Flush a pending browser SSO redirect on module load (Clerk's Expo rule).
WebBrowser.maybeCompleteAuthSession();

export interface AccountSheetProps {
  /** `keep` = post-purchase (confirm-to-skip); `restore` = the wallet door. */
  mode: "keep" | "restore";
  onClose: () => void;
  /** Sign-in landed and the link/merge finished. `adopted` = this device now
   * IS the account's player (identity rewritten) — refetch everything. */
  onLinked: (adopted: boolean) => void;
}

type Provider = "apple" | "google";

export const AccountSheet = ({ mode, onClose, onLinked }: AccountSheetProps) => {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { startSSOFlow } = useSSO();
  const { getToken } = useAuth();

  // Skipping the keep sheet needs the confirm; restore closes freely.
  // (No useBackClose here — the sheet lives in a Modal so it can rise over
  // ANY screen, and a visible Modal routes Android back to onRequestClose.)
  const requestClose = (): void => {
    if (busy) return;
    if (mode === "keep" && !confirmSkip) setConfirmSkip(true);
    else onClose();
  };

  // The handle drag — sheetGestures' useSheetDrag is a JS PanResponder,
  // which never engages inside this Modal (its touches dispatch through the
  // Modal's own gesture root — Tom's device pass, 2026-08-22), so this sheet
  // drags via RNGH instead, same thresholds as useSheetDrag. A completed
  // keep-mode swipe SPRINGS BACK and raises the skip-confirm (swiping away
  // is exactly the accidental dismiss the confirm exists for); restore mode
  // swipes away like every other sheet.
  const dragY = useRef(new Animated.Value(0)).current;
  const springBack = (): void => {
    Animated.spring(dragY, { toValue: 0, speed: 18, bounciness: 4, useNativeDriver: true }).start();
  };
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY(6) // claim only a clearly-downward pull; taps stay taps
    .onUpdate((e) => dragY.setValue(Math.max(0, e.translationY)))
    .onEnd((e) => {
      if (busy || !(e.translationY > 110 || e.velocityY > 800)) return springBack();
      if (mode === "keep" && !confirmSkip) {
        springBack();
        setConfirmSkip(true);
        return;
      }
      Animated.timing(dragY, {
        toValue: 520,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onClose();
      });
    });

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [enter]);

  const signIn = async (provider: Provider): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      // Apple rides the native sheet; Google rides the system browser SSO flow.
      const flow =
        provider === "apple"
          ? await startAppleAuthenticationFlow()
          : await startSSOFlow({ strategy: "oauth_google" });
      if (!flow.createdSessionId || !flow.setActive) {
        // A dismissed browser tab is a non-event. But a flow that RAN to its
        // end without minting a session is instance config trouble
        // (restricted sign-ups, unmet requirements) — name it, don't eat it.
        const sessionResult =
          "authSessionResult" in flow
            ? (flow.authSessionResult as { type?: string } | null)
            : null;
        const browserCancelled = sessionResult !== null && sessionResult.type !== "success";
        if (!browserCancelled) setNotice("THE SIGN-IN FINISHED WITHOUT A SESSION — TRY AGAIN LATER.");
        return;
      }
      await flow.setActive({ session: flow.createdSessionId });
      const jwt = await getToken();
      if (!jwt) {
        setNotice("THE SIGN-IN DIDN'T COMPLETE — NOTHING CHANGED.");
        return;
      }
      const result = await accountLink(jwt);
      if (result.ok) {
        playSound("uiConfirm");
        onLinked(result.adopted);
        return;
      }
      setNotice(
        result.reason === "already_linked"
          ? "THIS ARMORY IS BOUND TO A DIFFERENT ACCOUNT."
          : result.reason === "rejected"
            ? "THE SIGN-IN WAS REFUSED — TRY AGAIN IN A MOMENT."
            : "THE LEDGER COULDN'T BE REACHED — NOTHING CHANGED.",
      );
    } catch (err) {
      // The native Apple sheet throws on cancel — also a non-event.
      if ((err as { code?: string }).code !== "ERR_REQUEST_CANCELED") {
        // Clerk's messages are player-safe and specific ("invalid audience",
        // "sign-ups restricted") — surfacing them beats a generic line that
        // hides a config problem behind "didn't complete" (device pass,
        // 2026-08-23: exactly that hid a missing dashboard field).
        const clerkMessage = (err as { errors?: { message?: string }[] }).errors?.[0]?.message;
        setNotice(
          `THE SIGN-IN DIDN'T COMPLETE${clerkMessage ? ` — ${clerkMessage.toUpperCase()}` : " — NOTHING CHANGED."}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };


  return (
    <Modal transparent statusBarTranslucent animationType="none" onRequestClose={requestClose}>
      {/* A Modal hosts a native view OUTSIDE the app's gesture root — RNGH
        * touches inside it are silently dead without a root of its own
        * (Tom's device pass, 2026-08-22: "completely non-interactive"). */}
      <GestureHandlerRootView style={styles.modalRoot}>
      <Animated.View style={[styles.scrim, { opacity: enter }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + 18 },
          {
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [380, 0] }) },
              { translateY: dragY },
            ],
          },
        ]}
      >
        <GestureDetector gesture={pan}>
          <View>
            <View style={styles.handle} />
            <Text style={styles.title}>{mode === "keep" ? "KEEP YOUR ARMORY" : "RESTORE YOUR ARMORY"}</Text>
          </View>
        </GestureDetector>
        {/* The honest state first (Tom, 2026-08-22): everything currently
          * lives on this device alone — the sheet SHOWS that, then offers
          * the fix. Playing on without an account is always fine. */}
        <View style={styles.statusChip}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>SAVED TO THIS DEVICE ONLY</Text>
        </View>
        <Text style={styles.line}>
          {mode === "keep"
            ? "YOUR PURCHASES AND PROGRESS LIVE ONLY ON THIS DEVICE — LOST OR REPLACED, THEY GO WITH IT. SIGN IN ONCE AND THEY FOLLOW YOU THROUGH REINSTALLS AND NEW DEVICES."
            : "SIGN IN TO BRING YOUR PURCHASES AND PROGRESS TO THIS DEVICE — OR START SAVING THIS ONE'S ACROSS DEVICES."}
        </Text>

        <View style={[styles.buttons, busy && styles.buttonsBusy]}>
          {Platform.OS === "ios" ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={999}
              style={styles.appleButton}
              onPress={() => void signIn("apple")}
            />
          ) : (
            <Pressable style={styles.providerButton} onPress={() => void signIn("google")}>
              <Text style={styles.providerText}>SIGN IN WITH GOOGLE</Text>
            </Pressable>
          )}
        </View>

        {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
        <Text style={styles.optionalNote}>NO ACCOUNT IS EVER NEEDED TO PLAY.</Text>
        <Pressable onPress={requestClose} hitSlop={8} style={styles.skip}>
          <Text style={styles.skipText}>NOT NOW</Text>
        </Pressable>
      </Animated.View>

      {confirmSkip ? (
        <View style={styles.confirmScrim}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>SKIP FOR NOW?</Text>
            <Text style={styles.confirmLine}>
              YOUR PURCHASES AND PROGRESS STAY ON THIS DEVICE ONLY UNTIL YOU SIGN IN. YOU CAN SIGN
              IN ANY TIME FROM THE WALLET.
            </Text>
            <View style={styles.confirmRow}>
              <Pressable style={styles.confirmSkipButton} onPress={onClose}>
                <Text style={styles.confirmSkipText}>SKIP</Text>
              </Pressable>
              <Pressable style={styles.confirmStayButton} onPress={() => setConfirmSkip(false)}>
                <Text style={styles.confirmStayText}>SIGN IN</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
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
  statusChip: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(138,109,68,0.75)",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: "#1d1915",
  },
  // The brand's rationed red: this state is worth a flicker of warning.
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#8c2f2f" },
  statusText: { color: C_GOLD, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  line: {
    color: "#c9bfae",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    lineHeight: 15,
    textAlign: "center",
  },
  optionalNote: { color: C_MUTED, fontSize: 8.5, fontWeight: "800", letterSpacing: 1.2, textAlign: "center", opacity: 0.8 },
  buttons: { gap: 9, marginTop: 4 },
  buttonsBusy: { opacity: 0.45 },
  appleButton: { height: 44, alignSelf: "stretch" },
  providerButton: {
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: 999,
    backgroundColor: "#f0e8d8",
  },
  providerText: { color: "#241a0c", fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  notice: { color: "#c96a4a", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.8, lineHeight: 14, textAlign: "center" },
  skip: { alignSelf: "center", paddingVertical: 4 },
  skipText: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 2 },

  confirmScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  confirmCard: {
    alignSelf: "stretch",
    backgroundColor: "#201b15",
    borderWidth: 1.5,
    borderColor: "#3a332a",
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  confirmTitle: { color: C_BONE, fontSize: 15, letterSpacing: 2.5, fontFamily: DISPLAY_FONT, textAlign: "center" },
  confirmLine: {
    color: "#c9bfae",
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 1,
    lineHeight: 14,
    textAlign: "center",
  },
  confirmRow: { flexDirection: "row", gap: 9, marginTop: 4 },
  confirmSkipButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#3a332a",
  },
  confirmSkipText: { color: C_MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  confirmStayButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: C_GOLD,
  },
  confirmStayText: { color: "#241a0c", fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
});
