/**
 * The Signet pack shelf (bits-store.md § S3) — the ONE surface where money
 * enters the game. Three packs, store-localized prices, no decoys: the
 * single stays impulse-priced and the bundles discount honestly (ratified
 * 2026-08-15: 1 · $1.89 / 3 · $4.49 / 6 · $7.99). Presentation only —
 * ArmoryScreen owns the commerce (buy calls, credit events, wallet), the
 * same split the SignetForge ritual uses.
 *
 * On a client without the IAP native module (pre-rebuild dev client, Expo
 * Go) the same shelf renders the dev-mock path against a STORE_DEV_TOOLS
 * API — full flow, fake receipts, no store account (testing tier 2).
 */
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C_BONE, C_GOLD, C_MUTED } from "../loadout/catalogue";
import { SignetIcon } from "../loadout/icons";
import { useBackClose, useSheetDrag } from "../components/sheetGestures";
import type { SignetPackListing } from "../net/iap";
import { DISPLAY_FONT } from "../typography";

export interface SignetPacksProps {
  /** Null = the store can't answer right now (offline / unconfigured). */
  listings: SignetPackListing[] | null;
  /** Dev-mock shelf (no native IAP module) — prices read DEV, taps hit the
   * dev API's mock arm instead of a store sheet. */
  mock: boolean;
  notice: string | null;
  /** In-flight guard — buying dims the shelf until the store answers. */
  busy: boolean;
  onBuy: (sku: string) => void;
  onClose: () => void;
}

/** The seal row: one forged Signet per unit in the pack — the pile you're
 * buying. The forged art (20px) replaced the styled-View dots the moment it
 * landed; the tiny purse dot elsewhere stays a View on purpose (9px is
 * below the art's readable floor). */
const SealRow = ({ count }: { count: number }) => (
  <View style={styles.sealRow}>
    {Array.from({ length: count }, (_, i) => (
      <SignetIcon key={i} size={20} />
    ))}
  </View>
);

export const SignetPacks = ({ listings, mock, notice, busy, onBuy, onClose }: SignetPacksProps) => {
  const insets = useSafeAreaInsets();
  useBackClose(onClose);
  const { dragY, panHandlers } = useSheetDrag(onClose);

  // Enter once, spring up — the codex sheets' feel without their state
  // machine (this sheet's close is instant; nothing animates out under it).
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [enter]);

  return (
    <>
      <Animated.View style={[styles.scrim, { opacity: enter }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
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
        <View {...panHandlers}>
          <View style={styles.handle} />
          <Text style={styles.title}>GET SIGNET PACKS</Text>
        </View>

        {listings === null ? (
          <Text style={styles.closed}>THE STOREFRONT IS CURRENTLY CLOSED.</Text>
        ) : (
          listings.map((pack) => (
            <Pressable
              key={pack.sku}
              onPress={() => {
                if (!busy) onBuy(pack.sku);
              }}
              style={[styles.pack, busy && styles.packBusy]}
            >
              <SealRow count={pack.signets} />
              <Text style={styles.packName}>
                {pack.signets === 1 ? "1 SIGNET" : `${pack.signets} SIGNETS`}
              </Text>
              <View style={styles.priceChip}>
                <Text style={styles.priceText}>{mock ? "DEV" : pack.displayPrice}</Text>
              </View>
            </Pressable>
          ))
        )}

        {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
        <Text style={styles.footNote}>
          A SIGNET UNLOCKS ANY ONE WEAPON OR SPELL, FOREVER. NO SUBSCRIPTIONS, NO EXPIRY.
        </Text>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
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
    gap: 10,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a332a", marginBottom: 8 },
  title: { color: C_BONE, fontSize: 18, letterSpacing: 3, fontFamily: DISPLAY_FONT, textAlign: "center" },

  pack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#3a332a",
    borderRadius: 14,
    backgroundColor: "#1d1915",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  packBusy: { opacity: 0.45 },
  sealRow: { flexDirection: "row", gap: 4 },
  packName: { flex: 1, color: C_BONE, fontSize: 13, fontWeight: "900", letterSpacing: 2 },
  priceChip: {
    backgroundColor: C_GOLD,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  priceText: { color: "#241a0c", fontSize: 11, fontWeight: "900", letterSpacing: 1 },

  closed: { color: C_MUTED, fontSize: 9.5, fontWeight: "800", letterSpacing: 1, textAlign: "center", paddingVertical: 18 },
  notice: { color: "#c96a4a", fontSize: 9, fontWeight: "800", letterSpacing: 0.8, lineHeight: 13, textAlign: "center" },
  footNote: {
    color: "#6a6155",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
    textAlign: "center",
    lineHeight: 12,
    marginTop: 2,
  },
});
