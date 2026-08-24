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
  SIGNET_ABILITIES,
  SIGNET_WEAPONS,
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
  lastKnownWallet,
  mintPurchaseKey,
  storeExchange,
  storeIapCredit,
  storeUnlock,
  type Wallet,
} from "../net/api";
import {
  buySignetPack,
  connectIap,
  disconnectIap,
  fetchSignetPackListings,
  iapAvailable,
  type IapEvent,
  type SignetPackListing,
} from "../net/iap";
import { SIGNET_PACKS } from "@heroic/blood-in-the-sand-sim";
import { getEntitlements, grantEntitlement } from "../deeds/entitlements";
import { AccountSheet } from "../components/AccountSheet";
import { ScreenHeader } from "../components/ScreenHeader";
import {
  CLERK_PUBLISHABLE_KEY,
  markOfferShown,
  shouldOfferAfterPurchase,
} from "../net/account";
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
import { loadFeaturedPin, saveFeaturedPin } from "../settings";
import { SignetForge, type ForgeOutcome } from "./SignetForge";
import { SignetPacks } from "./SignetPacks";
import { LoadoutIcon, type IconId } from "../loadout/icons";
import { DISPLAY_FONT } from "../typography";

/** Dev-shelf reference prices (ratified 2026-08-15) — presentation only,
 * mock path only; the server credits from SIGNET_PACKS regardless. */
const MOCK_PACK_PRICES: Readonly<Record<string, string>> = {
  signet_pack_1: "$1.89",
  signet_pack_3: "$4.49",
  signet_pack_6: "$7.99",
};

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

  // Seeded from the last-known wallet so the purse never blanks on entry;
  // the mount fetch below corrects it.
  const [wallet, setWallet] = useState<Wallet | null>(lastKnownWallet);
  const [price, setPrice] = useState<number | null>(null);
  // Bumped after every local grant so the stock re-derives.
  const [entitledStamp, setEntitledStamp] = useState(0);
  const [sheet, setSheet] = useState<ArmoryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ceremony, setCeremony] = useState<ArmoryItem | null>(null);
  const [forgeOpen, setForgeOpen] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [packListings, setPackListings] = useState<SignetPackListing[] | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  /** The shelf is running on fake receipts (module-less client, or a dev
   * build whose .dev bundle id can never see the real products). Routes
   * buys to the API's mock arm and labels the shelf DEV. */
  const [packsMock, setPacksMock] = useState(false);
  /** The post-purchase account offer (bits-accounts.md § the sheet). */
  const [accountOffer, setAccountOffer] = useState(false);
  const busy = useRef(false);

  /**
   * Offer the account sheet after a purchase — the moment of maximum
   * investment, EITHER purchase kind (Tom, 2026-08-21: an Armory unlock and
   * a Signet pack are equally worth protecting). Only while unlinked, only
   * with accounts live at both ends, at most once per app session; the
   * ceremony/shelf has always finished before this is called.
   */
  const maybeOfferAccount = (w: Wallet | null): void => {
    if (!w?.accounts || w.linked || CLERK_PUBLISHABLE_KEY.length === 0) return;
    if (!shouldOfferAfterPurchase()) return;
    markOfferShown();
    setAccountOffer(true);
  };

  /** A store answer landing — from a live purchase OR the crash-recovery
   * replay on entry. `credited: 0` = an already-banked replay: refresh
   * silently, no fanfare for Signets the player was already paid. */
  const onIapEvent = (event: IapEvent): void => {
    setPackBusy(false);
    switch (event.t) {
      case "credited":
        setWallet(event.wallet);
        if (event.credited > 0) {
          playSound("signetPurchase");
          playStrikeHaptic("heavy");
          // The sale is done — the shelf closes (Tom, 2026-08-21: staying
          // open reads as greedy). The purse ticking up + the purchase
          // sting are the confirmation; no notice needed.
          setPacksOpen(false);
          maybeOfferAccount(event.wallet);
        }
        return;
      case "cancelled":
        return; // the player closed the sheet — not an error, not a notice
      case "deferred":
        setPackNotice("CHARGE RECORDED — THE SIGNETS LAND WHEN THE LEDGER RETURNS.");
        return;
      case "failed":
        playSound("uiError");
        setPackNotice("THE STORE REFUSED — NOTHING WAS CHARGED.");
        return;
    }
  };
  // Effects read the latest handler through a ref — the IAP listeners are
  // wired once, not per render.
  const onIapEventRef = useRef(onIapEvent);
  onIapEventRef.current = onIapEvent;

  useEffect(() => {
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity || !live) return;
      const [w, s] = await Promise.all([fetchWallet(identity), fetchStore(identity)]);
      if (!live) return;
      if (w) setWallet(w);
      if (s) setPrice(s.signetGloryPrice);
      // Store connection + unfinished-purchase replay ride Armory entry —
      // a purchase that charged just before a crash credits HERE, even if
      // the player never opens the pack shelf again.
      const up = await connectIap(identity, (event) => {
        if (live) onIapEventRef.current(event);
      });
      if (!live) return;
      if (up) {
        const listings = await fetchSignetPackListings();
        if (!live) return;
        if (listings) {
          setPackListings(listings);
        } else if (__DEV__) {
          // Native store present but no products — on a DEV build that's
          // structural, not transient: the .dev bundle id can never see the
          // prod app's products. Fall back to the mock shelf so the flow
          // stays testable; a release build keeps the honest closed state.
          setPackListings(mockPackListings());
          setPacksMock(true);
        }
      } else if (!iapAvailable() || __DEV__) {
        // Module absent (pre-rebuild client / Expo Go) — or a DEV build
        // whose store CONNECTION failed (the Android .dev package isn't on
        // Play, so Play Billing refuses to even connect; the iOS twin fails
        // at the products step and is handled above). Either way the dev
        // shelf runs on mock receipts, which the prod API refuses — inert
        // everywhere real (bits-store.md § testing). A release build with a
        // dead store keeps the honest closed state.
        setPackListings(mockPackListings());
        setPacksMock(true);
      }
    })();
    return () => {
      live = false;
      disconnectIap();
    };
  }, []);

  // ── The stock: signet items you don't own yet. Nothing else is for sale,
  //    so nothing else appears — a storefront, not a codex. ────────────────
  const { steel, sorcery } = useMemo(() => {
    const entitled = getEntitlements();
    return {
      steel: [...SIGNET_WEAPONS]
        .filter((id) => !entitled.has(weaponEntitlement(id)))
        .map((id): ArmoryItem => ({ id, isWeapon: true, entitlementId: weaponEntitlement(id) })),
      sorcery: [...SIGNET_ABILITIES]
        .filter((id) => !entitled.has(abilityEntitlement(id)))
        .map((id): ArmoryItem => ({ id, isWeapon: false, entitlementId: abilityEntitlement(id) })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitledStamp]);
  const stock = useMemo(() => [...steel, ...sorcery], [steel, sorcery]);

  // Featured hero — ONE item, pinned for the whole day (settings.ts pin).
  // The old positional day-hash re-pointed whenever the stock shifted (a
  // purchase shrinks the array under the index — Tom, 2026-08-21). Now the
  // pinned ITEM shows all day; if it sells, the slot rests until tomorrow
  // (re-seeding the spotlight right after a sale reads greedy, the pack-
  // sheet rule); a new day picks and pins afresh.
  const [featured, setFeatured] = useState<ArmoryItem | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      if (stock.length === 0) {
        if (live) setFeatured(null);
        return;
      }
      const today = Math.floor(Date.now() / 86_400_000);
      const pin = await loadFeaturedPin();
      if (!live) return;
      if (pin !== null && pin.day === today) {
        setFeatured(stock.find((item) => item.entitlementId === pin.id) ?? null);
        return;
      }
      const pick = stock[today % stock.length];
      if (pick === undefined) return;
      saveFeaturedPin({ day: today, id: pick.entitlementId });
      setFeatured(pick);
    })();
    return () => {
      live = false;
    };
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
  /** A sign-in landed — from the post-purchase offer OR the header's
   * restore door. accountLink already refreshed the entitlement cache from
   * the server on adoption (net/account.ts — deeds/loadEntitlements only
   * re-reads the LOCAL cache, the 2026-08-24 "purchases didn't restore"
   * bug); the shelf just refilters off the fresh cache, then the wallet. */
  const onAccountLinked = (adopted: boolean): void => {
    void (async () => {
      if (adopted) setEntitledStamp((s) => s + 1);
      await refreshWallet();
    })();
  };

  const refreshWallet = async (): Promise<void> => {
    const identity = await ensureIdentity();
    if (!identity) return;
    const w = await fetchWallet(identity);
    if (w) setWallet(w);
  };

  /**
   * Forge one Signet from Glory — the ONLY place Glory is ever spent (Tom,
   * 2026-08-15: the Glory↔Signet boundary lives on the forge screen; the
   * rest of the Armory deals in Signets alone). Pure commerce, deliberately
   * silent — the SignetForge ritual owns every sound and haptic.
   */
  const forgeSignet = async (): Promise<ForgeOutcome> => {
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

  /** The dev shelf's stock — real pack table, reference USD prices. The
   * real localized prices live only in the store consoles (items.ts rule);
   * these just let the dev shelf read like the shipped one (Tom,
   * 2026-08-21 — the sheet carries a "won't be charged" note instead of
   * DEV price tags). */
  const mockPackListings = (): SignetPackListing[] =>
    Object.entries(SIGNET_PACKS).map(([sku, signets]) => ({
      sku,
      signets,
      displayPrice: MOCK_PACK_PRICES[sku] ?? "—",
    }));

  /**
   * Buy a Signet pack. Native path: open the store sheet — money moves there,
   * and the outcome (charged, cancelled, deferred) comes back through the
   * connectIap listeners. Mock path (`packsMock` — module-less client or a
   * productless dev build): the same server flow with a fake receipt the
   * prod API refuses. Routes on the shelf's OWN mode, not iapAvailable() —
   * a dev build can hold a live native store that simply has no products,
   * and requestPurchase against a missing sku is just an error sting.
   */
  const buyPack = (sku: string): void => {
    setPackNotice(null);
    setPackBusy(true);
    if (!packsMock && iapAvailable()) {
      void buySignetPack(sku);
      return;
    }
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity) {
        setPackBusy(false);
        return;
      }
      const res = await storeIapCredit(identity, {
        platform: "mock",
        productId: sku,
        key: mintPurchaseKey(),
      });
      if (res.ok) {
        onIapEventRef.current({ t: "credited", wallet: res.wallet, credited: res.credited });
        return;
      }
      setPackBusy(false);
      playSound("uiError");
      setPackNotice(
        res.reason === "invalid"
          ? "THE DEV SHELF NEEDS A DEV LEDGER (STORE_DEV_TOOLS=1)."
          : "THE LEDGER IS OUT OF REACH — NOTHING WAS CHARGED.",
      );
    })();
  };

  /** The unlock: spends a HELD Signet, nothing else — no Signet, no sale (the
   * sheet routes signetless players to the forge instead). */
  const unlock = (item: ArmoryItem): void => {
    if (busy.current || wallet === null || wallet.signets < 1) return;
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
            ? "NO SIGNET IN HAND — THE FORGE AWAITS."
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
          sub={<Text style={tileTextStyles.price}>1 SIGNET</Text>}
        />
      ))}
    </View>
  );

  return (
    // Safe-area padding lives on the ROOT, not the scroll content — content
    // must never slide under the system tray as it scrolls (Tom's Android
    // pass, 2026-08-15).
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The shared bar, CONTROLLED: this screen owns the live wallet
            (purchases move it), so the purse reads ours, not a second
            fetch. No door on the purse — we're already here. The sign
            that used to sit between ("THE ARMORY") went with the 2026-08-22
            header unification: the featured hero IS the sign. */}
        <Animated.View style={[styles.header, rise(0, 0.35)]}>
          <ScreenHeader
            wallet={wallet}
            onLinked={onAccountLinked}
            onBack={() => {
              unlockAudio();
              playSound("uiBack");
              onBack();
            }}
          />
        </Animated.View>

        {/* The counter: the two doors to getting Signets, full-width pair
            (Tom, 2026-08-15: one obvious "create Signets" button;
            Glory↔Signet talk lives on the forge screen it opens; the
            tagline that used to sit here was cut 2026-08-21). */}
        <Animated.View style={[styles.counter, rise(0.05, 0.4)]}>
          {wallet !== null ? (
            <View style={styles.counterBtns}>
              {/* Money door — quieter than the forge; Glory play stays the
                  headline path, sponsorship the alternative. */}
              <Pressable
                onPress={() => {
                  unlockAudio();
                  playSound("uiTap");
                  setPackNotice(null);
                  setPacksOpen(true);
                }}
                style={styles.packsBtn}
              >
                <Text style={styles.packsBtnText} numberOfLines={1}>
                  BUY SIGNETS
                </Text>
              </Pressable>
              {price !== null ? (
                <Pressable
                  onPress={() => {
                    unlockAudio();
                    playSound("uiTap");
                    setForgeOpen(true);
                  }}
                  style={styles.forgeBtn}
                >
                  <View style={styles.signetSeal} />
                  <Text style={styles.forgeBtnText} numberOfLines={1}>
                    FORGE SIGNETS
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Animated.View>

        {/* The featured hero — one item, full width, rotated daily. */}
        {featured !== null ? (
          <Animated.View style={rise(0.1, 0.5)}>
            <Pressable onPress={() => openSheet(featured)} style={[styles.hero, { height: Math.round((width - 32) * 0.42) }]}>
              <View style={[styles.heroGlow, { backgroundColor: bandColor(featured, "14") }]} />
              <View style={styles.heroText}>
                <Text style={[styles.heroEyebrow, { color: bandColor(featured, "ff") }]}>FEATURED</Text>
                <Text style={styles.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>
                  {nameOf(featured)}
                </Text>
                <Text style={styles.heroHint} numberOfLines={3}>
                  {hintOf(featured)}
                </Text>
                <View style={styles.heroPrice}>
                  <View style={styles.signetSeal} />
                  <Text style={styles.heroPriceText}>1 SIGNET</Text>
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
          EVERY ARM IS FREE TO TRY IN PRACTICE — A SIGNET UNLOCKS MATCHMADE USE, FOREVER.
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

      {/* ── The Signet Forge — over the sheet, so closing it lands the player
          back on the item they wanted, now holding the Signet to break. ── */}
      {forgeOpen && wallet !== null && price !== null ? (
        <SignetForge
          wallet={wallet}
          price={price}
          onForge={forgeSignet}
          // The forge's buy door opens the shelf OVER the forge — a credited
          // pack closes the shelf and lands the player back on the forge,
          // fan grown, Signet in hand (the forge stays; the Armory's sheet
          // beneath it is still the item they came for).
          onBuy={() => {
            setPackNotice(null);
            setPacksOpen(true);
          }}
          buyFrom={packListings?.[0]?.displayPrice ?? null}
          onClose={() => setForgeOpen(false)}
        />
      ) : null}

      {/* ── The pack shelf — the one surface where money enters. ── */}
      {packsOpen ? (
        <SignetPacks
          listings={packListings}
          held={wallet?.signets ?? null}
          mock={packsMock}
          notice={packNotice}
          busy={packBusy}
          onBuy={buyPack}
          onClose={() => {
            playSound("uiBack");
            setPacksOpen(false);
          }}
        />
      ) : null}

      {/* ── The seal breaks. ── */}
      {ceremony !== null ? (
        <SignetCeremony
          item={ceremony}
          onDone={() => {
            // The ceremony always lands whole; the account offer waits its turn.
            setCeremony(null);
            maybeOfferAccount(wallet);
          }}
        />
      ) : null}

      {/* ── Keep your armory (bits-accounts.md) — after either purchase. ── */}
      {accountOffer ? (
        <AccountSheet
          mode="keep"
          onClose={() => setAccountOffer(false)}
          onLinked={(adopted) => {
            setAccountOffer(false);
            onAccountLinked(adopted);
          }}
        />
      ) : null}
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
  /** No Signet in hand → the CTA routes to the Signet Forge instead of selling. */
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
  // The one CTA — and it speaks SIGNETS ONLY (Tom, 2026-08-15): Glory never
  // appears on an item; a signetless player is sent to the forge, where the
  // two currencies are allowed to meet.
  const cta = ((): { label: string; live: boolean; action: () => void } => {
    if (wallet === null) return { label: "CONNECT TO UNLOCK", live: false, action: () => {} };
    if (wallet.signets >= 1) return { label: "BREAK THE SEAL — 1 SIGNET", live: true, action: onUnlock };
    return { label: "FORGE A SIGNET", live: true, action: onForge };
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
              <Text style={styles.sheetName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {nameOf(item)}
              </Text>
              {meta !== null ? (
                <Text
                  style={[styles.sheetMeta, { color: meta.color }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {`${meta.label} · CD ${ABILITIES[item.id as AbilityId].cooldown}S · ${charges} / ROUND`}
                </Text>
              ) : null}
            </View>
            {wallet !== null ? (
              <View style={styles.sheetPurse}>
                <View style={styles.signetSeal} />
                <Text style={styles.sheetPurseText}>{`${wallet.signets} HELD`}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <CodexBody id={item.id} isWeapon={item.isWeapon} />
        <Text style={styles.practiceNote}>FREE TO TRY IN PRACTICE — THE SIGNET UNLOCKS MATCHMADE USE.</Text>
        {notice !== null ? <Text style={styles.notice}>{notice}</Text> : null}
        <Pressable
          onPress={() => {
            if (cta.live) cta.action();
          }}
          style={[styles.cta, !cta.live && styles.ctaGhost]}
        >
          <Text
            style={[styles.ctaText, !cta.live && styles.ctaGhostText]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {cta.label}
          </Text>
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

const SignetCeremony = ({ item, onDone }: { item: ArmoryItem; onDone: () => void }) => {
  const reveal = useRef(new Animated.Value(0)).current;
  const bornAt = useRef(0);
  useEffect(() => {
    bornAt.current = Date.now();
    playSound("signetUnlock");
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

  // The bar: scroll pads 16, the bar's own 4 lands it 20 from the edge like
  // every screen. The scroll's gap:16 below it stacks on the bar's 14 — the
  // bar pads its own bottom, so give the gap back here.
  header: { paddingHorizontal: 4, marginBottom: -14 },
  // The Signet's mark: a wax dot in a gold ring — the seal before it breaks.
  signetSeal: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: C_GOLD,
    backgroundColor: "#7e2020",
  },

  counter: { gap: 10 },
  counterBtns: { flexDirection: "row", alignItems: "stretch", gap: 9 },
  // The money door: outlined, not solid — present, never shouting.
  packsBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderColor: C_GOLD,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  packsBtnText: { color: C_GOLD, fontSize: 10.5, fontWeight: "900", letterSpacing: 1.5 },
  // The clear "make Signets" door — solid gold, unmissable (Tom, 2026-08-15).
  forgeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: C_GOLD,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  forgeBtnText: { color: "#241a0c", fontSize: 10.5, fontWeight: "900", letterSpacing: 1.5 },

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
  footNote: { color: "#8a8071", fontSize: 9, fontWeight: "800", letterSpacing: 1, textAlign: "center", lineHeight: 14 },

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

  practiceNote: { color: "#8a8071", fontSize: 9, fontWeight: "800", letterSpacing: 0.8, lineHeight: 13, marginTop: 10 },
  notice: { color: "#c96a4a", fontSize: 9.5, fontWeight: "800", letterSpacing: 0.8, marginTop: 6, lineHeight: 14 },

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

  // The forge itself moved to SignetForge.tsx (the ritual owns its styles).

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
