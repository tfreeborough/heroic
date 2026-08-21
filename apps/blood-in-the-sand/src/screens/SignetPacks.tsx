/**
 * The Signet pack shelf (bits-store.md § S3) — the ONE surface where money
 * enters the game. Three packs, store-localized prices, no decoys: the
 * single stays impulse-priced and the bundles discount honestly (ratified
 * 2026-08-15: 1 · $1.89 / 3 · $4.49 / 6 · $7.99). Presentation only —
 * ArmoryScreen owns the commerce (buy calls, credit events, wallet), the
 * same split the SignetForge ritual uses.
 *
 * Layout is three upright cards, not rows: a row had the seal pile, the
 * name, and a localized price chip fighting over one line, and on narrow
 * phones the loser wrapped (Tom, 2026-08-21). A card stacks everything —
 * pile, numeral, caption, price pill — so nothing CAN wrap; the price text
 * auto-shrinks instead, because storefront strings run long ("IDR 129.000").
 * The biggest pack wears BEST VALUE — honest by the ratified per-Signet
 * math, and the only badge on the shelf (curation over catalogue).
 *
 * On a client without the IAP native module (pre-rebuild dev client, Expo
 * Go) the same shelf renders the dev-mock path against a STORE_DEV_TOOLS
 * API — full flow, fake receipts, no store account (testing tier 2). The
 * dev shelf shows the reference prices (from ArmoryScreen's mock listings)
 * under a "won't be charged" note, so it reads like the shipped sheet
 * instead of a debug screen (Tom, 2026-08-21).
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
  /** Signets already in the purse — anchors "buying MORE", not "buying".
   * Null when the wallet hasn't answered; the line simply stays off. */
  held: number | null;
  /** Dev-mock shelf (no native IAP module) — shows the no-charge note, taps
   * hit the dev API's mock arm instead of a store sheet. */
  mock: boolean;
  notice: string | null;
  /** In-flight guard — buying dims the shelf until the store answers. */
  busy: boolean;
  onBuy: (sku: string) => void;
  onClose: () => void;
}

/** The seal pile: one forged Signet per unit, overlapped like coins on a
 * counter — the pile visibly grows card to card, inside a fixed footprint
 * that never crowds the card (the old side-by-side row of six was what
 * forced the pack name to wrap). */
const SealPile = ({ count }: { count: number }) => (
  <View style={styles.sealPile}>
    {Array.from({ length: count }, (_, i) => (
      <View key={i} style={i > 0 ? styles.sealOverlap : null}>
        <SignetIcon size={22} />
      </View>
    ))}
  </View>
);

export const SignetPacks = ({ listings, held, mock, notice, busy, onBuy, onClose }: SignetPacksProps) => {
  const insets = useSafeAreaInsets();
  useBackClose(onClose);
  const { dragY, panHandlers } = useSheetDrag(onClose);

  // Enter once, spring up — the codex sheets' feel without their state
  // machine (this sheet's close is instant; nothing animates out under it).
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [enter]);

  // Listings arrive sorted ascending (iap.ts), so the last card is the big
  // bundle — the one honest badge on the shelf.
  const bestSku = listings !== null && listings.length > 1 ? listings[listings.length - 1]?.sku : undefined;

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
          <Text style={styles.title}>SIGNET PACKS</Text>
          {held !== null ? (
            <View style={styles.heldRow}>
              <View style={styles.heldSeal} />
              <Text style={styles.heldText}>{`${held} HELD`}</Text>
            </View>
          ) : null}
        </View>

        {listings === null ? (
          <Text style={styles.closed}>THE STOREFRONT IS CURRENTLY CLOSED.</Text>
        ) : (
          <View style={styles.shelf}>
            {listings.map((pack) => {
              const best = pack.sku === bestSku;
              return (
                <Pressable
                  key={pack.sku}
                  onPress={() => {
                    if (!busy) onBuy(pack.sku);
                  }}
                  style={[styles.pack, best && styles.packBest, busy && styles.packBusy]}
                >
                  {best ? <Text style={styles.bestTag}>BEST VALUE</Text> : null}
                  <SealPile count={pack.signets} />
                  <Text style={styles.packCount}>{pack.signets}</Text>
                  <Text style={styles.packUnit}>{pack.signets === 1 ? "SIGNET" : "SIGNETS"}</Text>
                  <View style={styles.priceChip}>
                    <Text style={styles.priceText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
                      {pack.displayPrice}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
        {mock ? <Text style={styles.devNote}>YOU WON'T BE CHARGED IN DEVELOPER MODE.</Text> : null}
        <Text style={styles.footNote}>A SIGNET UNLOCKS ANY ONE WEAPON OR SPELL, FOREVER.</Text>
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
    paddingHorizontal: 16,
    gap: 12,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a332a", marginBottom: 8 },
  title: { color: C_BONE, fontSize: 18, letterSpacing: 3, fontFamily: DISPLAY_FONT, textAlign: "center", marginRight: -3 },
  heldRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4 },
  heldSeal: {
    width: 8,
    height: 8,
    borderRadius: 4.5,
    borderWidth: 1.5,
    borderColor: C_GOLD,
    backgroundColor: "#7e2020",
  },
  heldText: { color: C_MUTED, fontSize: 9, fontWeight: "800", letterSpacing: 1.5, fontVariant: ["tabular-nums"] },

  shelf: { flexDirection: "row", gap: 9, marginTop: 2 },
  pack: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#3a332a",
    borderRadius: 14,
    backgroundColor: "#1d1915",
    paddingTop: 22,
    paddingBottom: 12,
    paddingHorizontal: 8,
    gap: 2,
  },
  packBest: { borderColor: "rgba(217,154,65,0.65)", backgroundColor: "#221c15" },
  packBusy: { opacity: 0.45 },
  bestTag: {
    position: "absolute",
    top: 7,
    color: C_GOLD,
    fontSize: 7.5,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  // A fixed-height stage so the pile's growth never reflows the numerals —
  // the three cards' contents stay row-aligned.
  sealPile: { flexDirection: "row", alignItems: "center", height: 26, marginBottom: 4 },
  sealOverlap: { marginLeft: -13 },
  packCount: { color: C_BONE, fontSize: 26, fontFamily: DISPLAY_FONT, fontVariant: ["tabular-nums"] },
  packUnit: { color: C_MUTED, fontSize: 8, fontWeight: "900", letterSpacing: 2, marginRight: -2 },
  priceChip: {
    alignSelf: "stretch",
    alignItems: "center",
    backgroundColor: C_GOLD,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginTop: 10,
  },
  priceText: { color: "#241a0c", fontSize: 11, fontWeight: "900", letterSpacing: 1 },

  closed: { color: C_MUTED, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textAlign: "center", paddingVertical: 22 },
  notice: { color: "#c96a4a", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.8, lineHeight: 14, textAlign: "center" },
  devNote: { color: C_GOLD, fontSize: 8.5, fontWeight: "800", letterSpacing: 1, textAlign: "center", opacity: 0.75 },
  footNote: {
    color: "#8a8071",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
    lineHeight: 13,
    marginTop: 2,
  },
});
