/**
 * The Armory (bits-store.md § S2) — the storefront, and nothing else: it
 * sells what you DON'T own (Tom, 2026-08-15 — owned steel lives in the War
 * Table, not here; a store that lists your possessions reads as a codex,
 * not a counter). Every card is the War Table's own tile (loadout/ItemTile)
 * and opens the same codex body — one codex, two doors.
 *
 * Premium-bar rules this screen lives by (Tom, 2026-08-09):
 *  - curation over catalogue — one featured hero, clean rows, no badge spam;
 *  - trust reads premium — no fake discounts, no timers, one honest price;
 *  - the seal-break IS the product: unlocking must feel like a moment.
 *
 * Commerce truths live server-side (S1): prices come from GET /store, spends
 * are atomic and idempotent, and already-owned can never double-charge. This
 * screen renders; the ledger decides. Offline: everything browses, nothing
 * sells ("null = unavailable", the api.ts rule).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ABILITIES,
  WEAPONS,
  WRIT_ABILITIES,
  WRIT_WEAPONS,
  abilityEntitlement,
  weaponEntitlement,
  type AbilityId,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";
import { playSound, unlockAudio } from "../audio";
import { playStrikeHaptic } from "../game/haptics";
import {
  ensureIdentity,
  fetchStore,
  fetchWallet,
  mintPurchaseKey,
  storeExchange,
  storeUnlock,
  type Wallet,
} from "../net/api";
import { getEntitlements, grantEntitlement } from "../deeds/entitlements";
import {
  ABILITY_CODEX,
  CATEGORY_META,
  categoryOf,
  C_BONE,
  C_GOLD,
  C_MUTED,
  WEAPON_CODEX,
} from "../loadout/catalogue";
import { CodexBody } from "../loadout/CodexBody";
import { ItemTile, tileTextStyles } from "../loadout/ItemTile";
import { useBackClose, useSheetDrag } from "../components/sheetGestures";
import { WritForge, type ForgeOutcome } from "./WritForge";
import { LoadoutIcon, type IconId } from "../loadout/icons";
import { DISPLAY_FONT } from "../typography";

interface ArmoryItem {
  id: IconId;
  isWeapon: boolean;
  /** `weapon:<id>` / `ability:<id>` — the ledger's name for it. */
  entitlementId: string;
}

/** Band colour: category colour for spells, gold for steel (War Table rule). */
const bandColor = (item: ArmoryItem, alpha: string): string =>
  `${item.isWeapon ? C_GOLD : CATEGORY_META[categoryOf(item.id as AbilityId)].color}${alpha}`;

const nameOf = (item: ArmoryItem): string =>
  (item.isWeapon ? WEAPONS[item.id as WeaponId].name : ABILITIES[item.id as AbilityId].name).toUpperCase();

const hintOf = (item: ArmoryItem): string =>
  item.isWeapon ? WEAPON_CODEX[item.id as WeaponId].hint : ABILITY_CODEX[item.id as AbilityId].hint;

export const ArmoryScreen = ({ onBack }: { onBack: () => void }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  // Bumped after every local grant so the stock re-derives.
  const [entitledStamp, setEntitledStamp] = useState(0);
  const [sheet, setSheet] = useState<ArmoryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ceremony, setCeremony] = useState<ArmoryItem | null>(null);
  const [forgeOpen, setForgeOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity || !live) return;
      const [w, s] = await Promise.all([fetchWallet(identity), fetchStore(identity)]);
      if (!live) return;
      if (w) setWallet(w);
      if (s) setPrice(s.writGloryPrice);
    })();
    return () => {
      live = false;
    };
  }, []);

  // ── The stock: writ items you don't own yet. Nothing else is for sale,
  //    so nothing else appears — a storefront, not a codex. ────────────────
  const { steel, sorcery } = useMemo(() => {
    const entitled = getEntitlements();
    return {
      steel: [...WRIT_WEAPONS]
        .filter((id) => !entitled.has(weaponEntitlement(id)))
        .map((id): ArmoryItem => ({ id, isWeapon: true, entitlementId: weaponEntitlement(id) })),
      sorcery: [...WRIT_ABILITIES]
        .filter((id) => !entitled.has(abilityEntitlement(id)))
        .map((id): ArmoryItem => ({ id, isWeapon: false, entitlementId: abilityEntitlement(id) })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitledStamp]);
  const stock = useMemo(() => [...steel, ...sorcery], [steel, sorcery]);

  // Featured hero — one item, rotated daily, never a scroll of banners.
  const featured = useMemo(() => {
    if (stock.length === 0) return null;
    return stock[Math.floor(Date.now() / 86_400_000) % stock.length] ?? null;
  }, [stock]);

  // Entrance — the mode-select rise, shared value + staggered slices.
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);
  const rise = (from: number, to: number) => ({
    opacity: entrance.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: "clamp" }),
    transform: [
      { translateY: entrance.interpolate({ inputRange: [from, to], outputRange: [14, 0], extrapolate: "clamp" }) },
    ],
  });

  // ── Sheet open/close (the War Table's spring + scrim, same feel) ──────────
  const sheetT = useRef(new Animated.Value(0)).current;
  const openSheet = (item: ArmoryItem): void => {
    unlockAudio();
    playSound("uiTap");
    playStrikeHaptic("soft");
    setNotice(null);
    setSheet(item);
    Animated.timing(sheetT, {
      toValue: 1,
      duration: 300,
      easing: Easing.out(Easing.back(1.1)),
      useNativeDriver: true,
    }).start();
  };
  const closeSheet = (): void => {
    playSound("uiBack");
    Animated.timing(sheetT, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) setSheet(null);
      },
    );
  };

  // ── Commerce. The ledger is the referee; this just narrates its answers. ──
  const refreshWallet = async (): Promise<void> => {
    const identity = await ensureIdentity();
    if (!identity) return;
    const w = await fetchWallet(identity);
    if (w) setWallet(w);
  };

  /**
   * Forge one Writ from Glory — the ONLY place Glory is ever spent (Tom,
   * 2026-08-15: the Glory↔Writ boundary lives on the forge screen; the
   * rest of the Armory deals in Writs alone). Pure commerce, deliberately
   * silent — the WritForge ritual owns every sound and haptic.
   */
  const forgeWrit = async (): Promise<ForgeOutcome> => {
    if (busy.current || wallet === null || price === null) return "unavailable";
    if (wallet.glory < price) return "insufficient";
    busy.current = true;
    try {
      const identity = await ensureIdentity();
      if (!identity) return "unavailable";
      const res = await storeExchange(identity, mintPurchaseKey());
      if (!res.ok) {
        if (res.reason === "insufficient") void refreshWallet();
        return res.reason;
      }
      setWallet(res.wallet);
      return "ok";
    } finally {
      busy.current = false;
    }
  };

  /** The unlock: spends a HELD Writ, nothing else — no Writ, no sale (the
   * sheet routes writless players to the forge instead). */
  const unlock = (item: ArmoryItem): void => {
    if (busy.current || wallet === null || wallet.writs < 1) return;
    busy.current = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity) {
        busy.current = false;
        return;
      }
      const res = await storeUnlock(identity, item.entitlementId);
      if (!res.ok) {
        setNotice(
          res.reason === "insufficient"
            ? "NO WRIT IN HAND — THE FORGE AWAITS."
            : "THE LEDGER IS OUT OF REACH — NOTHING WAS SPENT.",
        );
        playSound("uiError");
        if (res.reason === "insufficient") void refreshWallet();
        busy.current = false;
        return;
      }
      setWallet(res.wallet);
      grantEntitlement(item.entitlementId);
      setEntitledStamp((s) => s + 1);
      setSheet(null);
      sheetT.setValue(0);
      setCeremony(item);
      busy.current = false;
    })();
  };

  const tileW = Math.floor((width - 32 - 18) / 3);

  const renderStock = (items: ArmoryItem[]) => (
    <View style={styles.grid}>
      {items.map((item) => (
        <ItemTile
          key={item.entitlementId}
          id={item.id}
          width={tileW}
          onPress={() => openSheet(item)}
          sub={<Text style={tileTextStyles.price}>1 WRIT</Text>}
        />
      ))}
    </View>
  );

  return (
    // Safe-area padding lives on the ROOT, not the scroll content — content
    // must never slide under the system tray as it scrolls (Tom's Android
    // pass, 2026-08-15).
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: door back, the sign, the purse. */}
        <Animated.View style={[styles.header, rise(0, 0.35)]}>
          <Pressable
            onPress={() => {
              unlockAudio();
              playSound("uiBack");
              onBack();
            }}
            hitSlop={12}
          >
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <Text style={styles.title}>THE ARMORY</Text>
          <View style={styles.purse}>
            {wallet !== null ? (
              <>
                <View style={styles.gloryGem} />
                <Text style={styles.purseText}>{wallet.glory.toLocaleString()}</Text>
                <View style={styles.purseDivider} />
                <View style={styles.writSeal} />
                <Text style={styles.purseText}>{wallet.writs}</Text>
              </>
            ) : (
              <Text style={styles.purseOffline}>—</Text>
            )}
          </View>
        </Animated.View>

        {/* The counter: what this place IS, and the clear door to making the
            money it takes (Tom, 2026-08-15: one obvious "create Writs"
            button; Glory↔Writ talk lives on the forge screen it opens). */}
        <Animated.View style={[styles.counter, rise(0.05, 0.4)]}>
          <Text style={styles.tagline}>NEW ARMS FOR THE PIT</Text>
          {wallet !== null && price !== null ? (
            <Pressable
              onPress={() => {
                unlockAudio();
                playSound("uiTap");
                setForgeOpen(true);
              }}
              style={styles.forgeBtn}
            >
              <View style={styles.writSeal} />
              <Text style={styles.forgeBtnText}>FORGE WRITS</Text>
            </Pressable>
          ) : null}
        </Animated.View>

        {/* The featured hero — one item, full width, rotated daily. */}
        {featured !== null ? (
          <Animated.View style={rise(0.1, 0.5)}>
            <Pressable onPress={() => openSheet(featured)} style={[styles.hero, { height: Math.round((width - 32) * 0.42) }]}>
              <View style={[styles.heroGlow, { backgroundColor: bandColor(featured, "14") }]} />
              <View style={styles.heroText}>
                <Text style={[styles.heroEyebrow, { color: bandColor(featured, "ff") }]}>FEATURED</Text>
                <Text style={styles.heroName}>{nameOf(featured)}</Text>
                <Text style={styles.heroHint} numberOfLines={3}>
                  {hintOf(featured)}
                </Text>
                <View style={styles.heroPrice}>
                  <View style={styles.writSeal} />
                  <Text style={styles.heroPriceText}>1 WRIT</Text>
                </View>
              </View>
              <View style={styles.heroIcon}>
                <LoadoutIcon id={featured.id} size={Math.round((width - 32) * 0.3)} />
              </View>
            </Pressable>
          </Animated.View>
        ) : null}

        {/* The stock, by trade. Sold steel simply leaves the racks. */}
        {steel.length > 0 ? (
          <Animated.View style={rise(0.25, 0.65)}>
            <Text style={styles.sectionTitle}>STEEL</Text>
            {renderStock(steel)}
          </Animated.View>
        ) : null}
        {sorcery.length > 0 ? (
          <Animated.View style={rise(0.35, 0.75)}>
            <Text style={styles.sectionTitle}>SORCERY</Text>
            {renderStock(sorcery)}
          </Animated.View>
        ) : null}
        {stock.length === 0 ? (
          <Animated.View style={[styles.clearedBox, rise(0.25, 0.65)]}>
            <Text style={styles.cleared}>EVERY SEAL BROKEN — NOTHING LEFT TO SELL YOU.</Text>
            <Text style={styles.clearedSub}>NEW ARMS REACH THE PIT WITH EVERY SEASON.</Text>
          </Animated.View>
        ) : null}

        <Animated.Text style={[styles.footNote, rise(0.5, 0.9)]}>
          EVERY ARM IS FREE TO TRY IN PRACTICE — A WRIT UNLOCKS MATCHMADE USE, FOREVER.
        </Animated.Text>
      </ScrollView>

      {/* ── The codex sheet, armory-tongued. ── */}
      {sheet !== null ? (
        <ArmorySheet
          item={sheet}
          wallet={wallet}
          notice={notice}
          sheetT={sheetT}
          onUnlock={() => unlock(sheet)}
          onForge={() => {
            playSound("uiTap");
            setForgeOpen(true);
          }}
          onDismiss={closeSheet}
          onGone={() => {
            setSheet(null);
            sheetT.setValue(0);
          }}
        />
      ) : null}

      {/* ── The Writ Forge — over the sheet, so closing it lands the player
          back on the item they wanted, now holding the Writ to break. ── */}
      {forgeOpen && wallet !== null && price !== null ? (
        <WritForge wallet={wallet} price={price} onForge={forgeWrit} onClose={() => setForgeOpen(false)} />
      ) : null}

      {/* ── The seal breaks. ── */}
      {ceremony !== null ? <WritCeremony item={ceremony} onDone={() => setCeremony(null)} /> : null}
    </View>
  );
};

// ── The sheet ───────────────────────────────────────────────────────────────

interface ArmorySheetProps {
  item: ArmoryItem;
  wallet: Wallet | null;
  notice: string | null;
  sheetT: Animated.Value;
  onUnlock: () => void;
  /** No Writ in hand → the CTA routes to the Writ Forge instead of selling. */
  onForge: () => void;
  onDismiss: () => void;
  /** Instant removal (state null + anim reset) — the drag exit's landing. */
  onGone: () => void;
}

const ArmorySheet = ({ item, wallet, notice, sheetT, onUnlock, onForge, onDismiss, onGone }: ArmorySheetProps) => {
  const insets = useSafeAreaInsets();
  // Android back closes the sheet, never navigates; the handle drags for real.
  useBackClose(onDismiss);
  const { dragY, panHandlers } = useSheetDrag(onGone);
  const meta = item.isWeapon ? null : CATEGORY_META[categoryOf(item.id as AbilityId)];
  const charges = item.isWeapon ? 0 : ABILITIES[item.id as AbilityId].charges;
  // The one CTA — and it speaks WRITS ONLY (Tom, 2026-08-15): Glory never
  // appears on an item; a writless player is sent to the forge, where the
  // two currencies are allowed to meet.
  const cta = ((): { label: string; live: boolean; action: () => void } => {
    if (wallet === null) return { label: "CONNECT TO UNLOCK", live: false, action: () => {} };
    if (wallet.writs >= 1) return { label: "BREAK THE SEAL — 1 WRIT", live: true, action: onUnlock };
    return { label: "FORGE A WRIT", live: true, action: onForge };
  })();
  return (
    <>
      <Animated.View style={[styles.sheetScrim, { opacity: sheetT }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          // The home-indicator inset rides INSIDE the sheet's padding — the
          // CTA must never sit under gesture-nav chrome (Tom's device pass).
          { paddingBottom: insets.bottom + 18 },
          {
            transform: [
              { translateY: sheetT.interpolate({ inputRange: [0, 1], outputRange: [440, 0] }) },
              // Sequential translateYs compose additively — the live drag
              // rides on top of the open/close animation.
              { translateY: dragY },
            ],
          },
        ]}
      >
        {/* The grab zone: handle + header — wide enough to find blind. */}
        <View {...panHandlers}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetTop}>
            <LoadoutIcon id={item.id} size={64} />
            <View style={styles.sheetHeadText}>
              <Text style={styles.sheetName}>{nameOf(item)}</Text>
              {meta !== null ? (
                <Text style={[styles.sheetMeta, { color: meta.color }]}>
                  {`${meta.label} · CD ${ABILITIES[item.id as AbilityId].cooldown}S · ${charges} / ROUND`}
                </Text>
              ) : null}
            </View>
            {wallet !== null ? (
              <View style={styles.sheetPurse}>
                <View style={styles.writSeal} />
                <Text style={styles.sheetPurseText}>{`${wallet.writs} HELD`}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <CodexBody id={item.id} isWeapon={item.isWeapon} />
        <Text style={styles.practiceNote}>FREE TO TRY IN PRACTICE — THE WRIT UNLOCKS MATCHMADE USE.</Text>
        {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
        <Pressable
          onPress={() => {
            if (cta.live) cta.action();
          }}
          style={[styles.cta, !cta.live && styles.ctaGhost]}
        >
          <Text style={[styles.ctaText, !cta.live && styles.ctaGhostText]}>{cta.label}</Text>
        </Pressable>
      </Animated.View>
    </>
  );
};

// ── The ceremony ────────────────────────────────────────────────────────────

/** The unlock moment (bits-store.md § premium bar): scrim, the wax seal
 * splits, the item pops through with the deed ceremony's staged rhythm.
 * Tap mid-reveal snaps to done (the DeedCards rule); a min dwell keeps the
 * sting from being skipped by the purchase tap's own bounce. */
const CEREMONY_MIN_DWELL_MS = 1100;

const WritCeremony = ({ item, onDone }: { item: ArmoryItem; onDone: () => void }) => {
  const reveal = useRef(new Animated.Value(0)).current;
  const bornAt = useRef(0);
  useEffect(() => {
    bornAt.current = Date.now();
    playSound("writUnlock");
    playStrikeHaptic("heavy");
    Animated.timing(reveal, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reveal, item]);
  const slice = (from: number, to: number, outputRange: [number, number]) =>
    reveal.interpolate({ inputRange: [from, to], outputRange, extrapolate: "clamp" });
  const tap = (): void => {
    if (Date.now() - bornAt.current < CEREMONY_MIN_DWELL_MS) {
      reveal.stopAnimation();
      reveal.setValue(1);
      return;
    }
    onDone();
  };
  // Back behaves like a tap — snaps the reveal, then continues. Never
  // navigates out from under the ceremony.
  useBackClose(tap);
  return (
    <Pressable style={styles.ceremonyScrim} onPress={tap}>
      <Animated.Text style={[styles.ceremonyEyebrow, { opacity: slice(0, 0.25, [0, 1]) }]}>
        THE SEAL BREAKS
      </Animated.Text>
      <View style={styles.sealStage}>
        {/* The wax halves part as the item comes through. */}
        <Animated.View
          style={[
            styles.sealHalf,
            styles.sealLeft,
            {
              opacity: slice(0.15, 0.5, [1, 0]),
              transform: [
                { translateX: slice(0.1, 0.55, [0, -46]) },
                { rotate: reveal.interpolate({ inputRange: [0.1, 0.55], outputRange: ["0deg", "-14deg"], extrapolate: "clamp" }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.sealHalf,
            styles.sealRight,
            {
              opacity: slice(0.15, 0.5, [1, 0]),
              transform: [
                { translateX: slice(0.1, 0.55, [0, 46]) },
                { rotate: reveal.interpolate({ inputRange: [0.1, 0.55], outputRange: ["0deg", "14deg"], extrapolate: "clamp" }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={{
            opacity: slice(0.2, 0.5, [0, 1]),
            transform: [{ scale: slice(0.2, 0.65, [1.25, 1]) }],
          }}
        >
          <LoadoutIcon id={item.id} size={104} />
        </Animated.View>
      </View>
      <Animated.Text style={[styles.ceremonyName, { opacity: slice(0.4, 0.7, [0, 1]) }]}>
        {nameOf(item)}
      </Animated.Text>
      <Animated.Text
        style={[
          styles.ceremonyLine,
          { opacity: slice(0.55, 0.9, [0, 1]), transform: [{ translateY: slice(0.55, 0.9, [10, 0]) }] },
        ]}
      >
        YOURS, FOREVER — IT WAITS ON THE WAR TABLE.
      </Animated.Text>
      <Animated.Text style={[styles.ceremonyContinue, { opacity: slice(0.85, 1, [0, 1]) }]}>
        TAP TO CONTINUE
      </Animated.Text>
    </Pressable>
  );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#141210" },
  scroll: { paddingHorizontal: 16, gap: 16 },

  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: { color: C_MUTED, fontSize: 30, lineHeight: 32, fontWeight: "700", paddingHorizontal: 4 },
  title: { flex: 1, color: C_BONE, fontSize: 20, letterSpacing: 3, fontFamily: DISPLAY_FONT },
  purse: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderColor: "rgba(138,109,68,0.75)",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "rgba(30,24,16,0.72)",
  },
  purseText: { color: "#e8c87a", fontSize: 11, fontWeight: "800", letterSpacing: 1, fontVariant: ["tabular-nums"] },
  purseDivider: { width: 1, height: 10, backgroundColor: "rgba(138,109,68,0.5)" },
  purseOffline: { color: C_MUTED, fontSize: 11, fontWeight: "800" },
  gloryGem: { width: 6, height: 6, backgroundColor: "#8c2f2f", transform: [{ rotate: "45deg" }] },
  // The Writ's mark: a wax dot in a gold ring — the seal before it breaks.
  writSeal: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: C_GOLD,
    backgroundColor: "#7e2020",
  },

  counter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  tagline: { flexShrink: 1, color: C_MUTED, fontSize: 9, fontWeight: "900", letterSpacing: 2 },
  // The clear "make Writs" door — solid gold, unmissable (Tom, 2026-08-15).
  forgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: C_GOLD,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  forgeBtnText: { color: "#241a0c", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },

  hero: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3a332a",
    backgroundColor: "#1d1915",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  heroGlow: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroText: { flex: 1, padding: 16, gap: 6 },
  heroEyebrow: { fontSize: 9, fontWeight: "900", letterSpacing: 3 },
  heroName: { color: C_BONE, fontSize: 24, letterSpacing: 2, fontFamily: DISPLAY_FONT },
  heroHint: { color: "#c9bfae", fontSize: 10.5, lineHeight: 14 },
  heroPrice: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  heroPriceText: { color: C_GOLD, fontSize: 11, fontWeight: "900", letterSpacing: 1.5 },
  heroIcon: { paddingRight: 12 },

  sectionTitle: { color: C_MUTED, fontSize: 11, fontWeight: "900", letterSpacing: 3, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },

  clearedBox: { alignItems: "center", gap: 6, paddingVertical: 16 },
  cleared: { color: C_BONE, fontSize: 11, fontWeight: "900", letterSpacing: 1.5, textAlign: "center" },
  clearedSub: { color: C_MUTED, fontSize: 9, fontWeight: "800", letterSpacing: 1.2, textAlign: "center" },
  footNote: { color: "#6a6155", fontSize: 8.5, fontWeight: "800", letterSpacing: 1, textAlign: "center", lineHeight: 14 },

  sheetScrim: {
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
    paddingBottom: 24,
    paddingHorizontal: 20,
    gap: 4,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#3a332a", marginBottom: 6 },
  sheetTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  sheetHeadText: { flex: 1, gap: 4 },
  sheetName: { color: C_BONE, fontSize: 19, fontWeight: "900", letterSpacing: 2 },
  sheetMeta: { fontSize: 8.5, fontWeight: "900", letterSpacing: 1.6, fontVariant: ["tabular-nums"] },
  sheetPurse: { alignItems: "center", gap: 3 },
  sheetPurseText: { color: C_MUTED, fontSize: 8, fontWeight: "800", letterSpacing: 1, fontVariant: ["tabular-nums"] },

  practiceNote: { color: "#6a6155", fontSize: 8.5, fontWeight: "800", letterSpacing: 0.8, marginTop: 10 },
  notice: { color: "#c96a4a", fontSize: 9, fontWeight: "800", letterSpacing: 0.8, marginTop: 6, lineHeight: 13 },

  cta: {
    marginTop: 12,
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: C_GOLD,
  },
  ctaText: { color: "#241a0c", fontSize: 13, fontWeight: "900", letterSpacing: 2.5 },
  ctaGhost: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: "#3a332a" },
  ctaGhostText: { color: C_MUTED },

  // The forge itself moved to WritForge.tsx (the ritual owns its styles).

  ceremonyScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,7,5,0.97)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 14,
  },
  ceremonyEyebrow: { color: C_MUTED, fontSize: 10, fontWeight: "900", letterSpacing: 4, marginRight: -4 },
  sealStage: { width: 150, height: 150, alignItems: "center", justifyContent: "center" },
  sealHalf: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#7e2020",
    borderWidth: 3,
    borderColor: "#5d1717",
  },
  sealLeft: { left: 33 },
  sealRight: { right: 33 },
  ceremonyName: { color: C_BONE, fontSize: 26, letterSpacing: 3, fontFamily: DISPLAY_FONT, textAlign: "center" },
  ceremonyLine: { color: "#c9bfae", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textAlign: "center" },
  ceremonyContinue: { color: C_MUTED, fontSize: 9, fontWeight: "900", letterSpacing: 3, marginTop: 18 },
});
