/**
 * Real-money Signet packs (bits-store.md § S3) — the expo-iap layer, used by
 * the Armory alone (the one surface with real-money IAP, by design).
 *
 * The money flow is server-authoritative end to end: the native sheet
 * charges, the store hands us proof (iOS: the StoreKit 2 signed transaction;
 * Android: the Play purchase token), the API verifies that proof with
 * Apple/Google and credits the ledger, and only THEN do we finish (consume)
 * the store transaction. A purchase interrupted anywhere — app killed after
 * the charge, API briefly down — stays unfinished in the store and is
 * replayed through the same pipe on the next connect, so a paid pack can be
 * delayed but never lost. The server's transaction-id idempotency makes
 * every replay safe.
 *
 * The native module needs a dev-client REBUILD (bits-store.md § testing) —
 * on older dev clients and in Expo Go `require("expo-iap")` throws, and this
 * whole module degrades to `available: false`; the Armory then offers the
 * dev-API mock path instead (tier 2 of the testing ladder).
 */
import { Platform } from "react-native";
import { SIGNET_PACKS } from "@heroic/blood-in-the-sand-sim";
import { storeIapCredit, type Identity, type IapProof, type Wallet } from "./api";

/** One purchasable pack, ready for the shelf. */
export interface SignetPackListing {
  sku: string;
  signets: number;
  /** Store-localized ("US$4.49" etc.) — never derived client-side. */
  displayPrice: string;
}

export type IapEvent =
  | { t: "credited"; wallet: Wallet; credited: number }
  | { t: "cancelled" }
  /** The charge may exist but crediting must wait (API unreachable) — the
   * transaction stays unfinished and replays on the next connect. */
  | { t: "deferred" }
  | { t: "failed" };

type IapModule = typeof import("expo-iap");

/** The native module, or null on a client built before expo-iap existed. */
const nativeIap = ((): IapModule | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-iap") as IapModule;
  } catch {
    return null;
  }
})();

export const iapAvailable = (): boolean => nativeIap !== null;

const SKUS = Object.keys(SIGNET_PACKS);

/** Tokens currently being credited — the update listener and the pending
 * replay can both deliver the same transaction; one credit call is plenty. */
const inFlight = new Set<string>();

let subscriptions: { remove: () => void }[] = [];
let connected = false;

/**
 * Verify-with-server → finish-with-store, in that order. Finishing first
 * would let a crash between the two eat a paid pack; this order can only
 * ever double-SUBMIT, which the server's idempotency answers with
 * `credited: 0` (still a success — finish the transaction).
 */
const creditPurchase = async (
  identity: Identity,
  purchase: {
    purchaseToken?: string | null;
    productId: string;
    /** Optional in expo-iap's own types — fall back to the running OS. */
    platform?: string | null;
  },
  emit: (event: IapEvent) => void,
): Promise<void> => {
  const iap = nativeIap;
  const token = purchase.purchaseToken;
  if (!iap || !token || inFlight.has(token)) return;
  inFlight.add(token);
  try {
    const isApple = (purchase.platform ?? Platform.OS) === "ios";
    const proof: IapProof = isApple
      ? { platform: "apple", jws: token }
      : { platform: "google", productId: purchase.productId, purchaseToken: token };
    const res = await storeIapCredit(identity, proof);
    if (res.ok) {
      await iap.finishTransaction({ purchase: purchase as never, isConsumable: true });
      emit({ t: "credited", wallet: res.wallet, credited: res.credited });
      return;
    }
    if (res.reason === "invalid") {
      // Affirmatively not a purchase of ours — finish it anyway, or the
      // store replays a poison transaction at us forever.
      await iap.finishTransaction({ purchase: purchase as never, isConsumable: true });
      emit({ t: "failed" });
      return;
    }
    emit({ t: "deferred" }); // unfinished on purpose — replays next connect
  } catch {
    emit({ t: "deferred" });
  } finally {
    inFlight.delete(token);
  }
};

/**
 * Bring the store up: connection, listeners, and a replay pass over any
 * unfinished purchases (the crash-recovery path). Call from the Armory's
 * mount; safe to call again — a live connection is reused.
 */
export const connectIap = async (
  identity: Identity,
  emit: (event: IapEvent) => void,
): Promise<boolean> => {
  const iap = nativeIap;
  if (!iap) return false;
  try {
    if (!connected) {
      await iap.initConnection();
      connected = true;
    }
    subscriptions.forEach((s) => s.remove());
    subscriptions = [
      iap.purchaseUpdatedListener((purchase) => {
        void creditPurchase(identity, purchase, emit);
      }),
      iap.purchaseErrorListener((error) => {
        // "user cancelled" is a quiet non-event; anything else gets a voice.
        emit(error.code === "user-cancelled" ? { t: "cancelled" } : { t: "failed" });
      }),
    ];
    // Replay: consumables the store still holds because finishTransaction
    // never ran (killed app, dead API). Server-side idempotency makes a
    // double replay free.
    const pending = await iap.getAvailablePurchases();
    for (const purchase of pending ?? []) {
      if (purchase.productId in SIGNET_PACKS) void creditPurchase(identity, purchase, emit);
    }
    return true;
  } catch {
    return false;
  }
};

/** Tear down the listeners (screen unmount). The connection itself stays —
 * re-init is expensive and the module is app-lifetime anyway. */
export const disconnectIap = (): void => {
  subscriptions.forEach((s) => s.remove());
  subscriptions = [];
};

/** The shelf: our packs with the STORE's localized prices, sorted small →
 * large. Null when the store can't answer (offline, unconfigured console). */
export const fetchSignetPackListings = async (): Promise<SignetPackListing[] | null> => {
  const iap = nativeIap;
  if (!iap) return null;
  try {
    const products = await iap.fetchProducts({ skus: [...SKUS], type: "in-app" });
    const listings = (products ?? [])
      .filter((p): p is typeof p & { displayPrice: string } => typeof p.displayPrice === "string")
      .map((p) => ({ sku: p.id, signets: SIGNET_PACKS[p.id] ?? 0, displayPrice: p.displayPrice }))
      .filter((l) => l.signets > 0)
      .sort((a, b) => a.signets - b.signets);
    return listings.length > 0 ? listings : null;
  } catch {
    return null;
  }
};

/** Open the native purchase sheet. The outcome arrives via the connectIap
 * listeners — this resolves when the sheet is up, not when money moves. */
export const buySignetPack = async (sku: string): Promise<void> => {
  const iap = nativeIap;
  if (!iap) return;
  try {
    await iap.requestPurchase({
      request: { apple: { sku }, google: { skus: [sku] } },
      type: "in-app",
    });
  } catch {
    // Failures surface through purchaseErrorListener; nothing to do here.
  }
};
