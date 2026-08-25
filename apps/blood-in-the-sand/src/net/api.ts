/**
 * The business-logic API client (glory-economy.md) — identity + Glory wallet.
 * This talks to blood-in-the-sand-api (HTTP), NOT the game server (WS): the
 * two are separate services on purpose, so economy screens never depend on
 * the arena being up and vice versa.
 *
 * Identity is anonymous-first, forever: on first launch we silently register
 * and keep the minted playerId + bearer token in the device keychain
 * (SecureStore — survives reinstall on iOS; device-bound on Android until
 * Clerk linking exists). The token is the only credential; losing it is
 * losing the wallet, which is exactly what account linking will insure.
 */
import { useCallback, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Same conventions as the game server's EXPO_PUBLIC_DEFAULT_SERVER — unset
 * means "no API configured" and every call quietly no-ops (the title screen
 * just doesn't show a wallet), and a scheme-less value is normalised the way
 * resolveServerUrl does it: LAN hosts (IPs, localhost, *.local) get plain
 * `http://`, anything else is a TLS-terminated proxy → `https://` on 443.
 */
const resolveApiUrl = (input: string): string => {
  const t = input.trim().replace(/\/+$/, "");
  if (!t || t.includes("://")) return t;
  const [host = ""] = t.split(":");
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLocal = isIp || host === "localhost" || host.endsWith(".local");
  return `${isLocal ? "http" : "https"}://${t}`;
};

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL ?? "");

const KEY_PLAYER_ID = "bits.playerId";
const KEY_TOKEN = "bits.playerToken";
/** "1" once a wallet fetch reported linked — survives the token dying. */
const KEY_LINKED_HINT = "bits.linkedAccount";

export interface Identity {
  playerId: string;
  token: string;
}

/** Never let a dead API hang a screen — every call gets a hard deadline. */
const FETCH_TIMEOUT_MS = 8000;

const apiFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** The identity this device already holds — never registers. For places
 * that only want to SHOW the id (the feedback stamps, the support email)
 * and must not spend a network round-trip to learn there is none. */
export const storedIdentity = async (): Promise<Identity | null> => {
  const [playerId, token] = await Promise.all([
    SecureStore.getItemAsync(KEY_PLAYER_ID),
    SecureStore.getItemAsync(KEY_TOKEN),
  ]);
  return playerId && token ? { playerId, token } : null;
};

/**
 * The stored identity, registering silently if this device has none yet.
 * Null when the API is unconfigured or unreachable AND nothing is stored —
 * callers treat that as "wallet features off", never as an error the player
 * sees. A stored identity is returned even while offline.
 */
export const ensureIdentity = async (): Promise<Identity | null> => {
  const [playerId, token] = await Promise.all([
    SecureStore.getItemAsync(KEY_PLAYER_ID),
    SecureStore.getItemAsync(KEY_TOKEN),
  ]);
  if (playerId && token) return { playerId, token };
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/register", { method: "POST" });
    if (!res.ok) return null;
    const minted = (await res.json()) as Identity;
    if (typeof minted.playerId !== "string" || typeof minted.token !== "string") return null;
    await Promise.all([
      SecureStore.setItemAsync(KEY_PLAYER_ID, minted.playerId),
      SecureStore.setItemAsync(KEY_TOKEN, minted.token),
    ]);
    return minted;
  } catch {
    return null; // offline first launch — we'll register on a later launch
  }
};

/** The server-authoritative Glory balance; null = unavailable right now. */
export const fetchGlory = async (identity: Identity): Promise<number | null> => {
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/wallet", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) return null;
    const wallet = (await res.json()) as { glory?: unknown };
    return typeof wallet.glory === "number" ? wallet.glory : null;
  } catch {
    return null;
  }
};

/** Both server-authoritative balances (bits-store.md). `signets` tolerates an
 * older API that doesn't serve it yet — the field just reads 0; likewise the
 * account fields (bits-accounts.md) default to "no accounts, not linked". */
export interface Wallet {
  glory: number;
  signets: number;
  /** This player carries a Clerk link — hides every sign-in door. */
  linked: boolean;
  /** Accounts are ON server-side (key configured, kill switch open). */
  accounts: boolean;
}

/**
 * The last wallet any answer carried — the purse's stale-while-revalidate
 * seed (Tom, 2026-08-22: every screen change mounted a fresh purse that
 * painted nothing until its own fetch landed — a visible flicker). Every
 * wallet-shaped answer publishes here (fetch, forge, unlock, IAP credit,
 * dev grant), so a newly mounted purse paints the last-known numbers on its
 * first frame and its own fetch merely corrects them; mounted purses hear
 * later answers live, so a purchase on the Armory is already in the purse
 * the next screen shows. Module-level: dies with the JS world, same as the
 * app's other in-memory caches. Cleared whenever the identity changes
 * under us — another player's balance must never be the seed.
 */
let lastWallet: Wallet | null = null;
const walletListeners = new Set<(wallet: Wallet) => void>();
const publishWallet = (wallet: Wallet): Wallet => {
  lastWallet = wallet;
  walletListeners.forEach((listen) => listen(wallet));
  return wallet;
};
const forgetWallet = (): void => {
  lastWallet = null;
};
/** The seed for a screen that owns its own wallet state (the Armory) — so
 * its controlled purse paints on the first frame too. */
export const lastKnownWallet = (): Wallet | null => lastWallet;

/** The full wallet; null = unavailable right now. */
export const fetchWallet = async (identity: Identity): Promise<Wallet | null> => {
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/wallet", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) return null;
    const wallet = (await res.json()) as {
      glory?: unknown;
      signets?: unknown;
      linked?: unknown;
      accounts?: unknown;
    };
    if (typeof wallet.glory !== "number") return null;
    const linked = wallet.linked === true;
    // The 401-recovery hint (bits-accounts.md): remember linkedness OUTSIDE
    // the identity, so a token the server stops recognising can still be
    // routed to restore instead of the anonymous wipe-and-remint.
    void AsyncStorage.setItem(KEY_LINKED_HINT, linked ? "1" : "0");
    return publishWallet({
      glory: wallet.glory,
      signets: typeof wallet.signets === "number" ? wallet.signets : 0,
      linked,
      accounts: wallet.accounts === true,
    });
  } catch {
    return null;
  }
};

/** GET /store — the shelf and the one tunable price (bits-store.md). */
export interface StoreInfo {
  signetGloryPrice: number;
  /** Entitlement ids the server will sell (`weapon:*` / `ability:*`). */
  signetItems: string[];
}

export const fetchStore = async (identity: Identity): Promise<StoreInfo | null> => {
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/store", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) return null;
    const store = (await res.json()) as StoreInfo;
    return typeof store.signetGloryPrice === "number" && Array.isArray(store.signetItems)
      ? store
      : null;
  } catch {
    return null;
  }
};

/**
 * A store mutation's outcome, discriminated: `insufficient` is the server
 * affirmatively refusing (a real answer the sheet must voice — the balance
 * moved under us), `unavailable` is network/offline (retryable, no charge).
 */
export type StoreResult =
  | { ok: true; wallet: Wallet }
  | { ok: false; reason: "insufficient" | "unavailable" };

/** Normalise a wallet-shaped answer's account fields — an older API that
 * doesn't serve them reads as "no accounts", which correctly hides doors. */
const withAccountFields = (w: { glory: number; signets: number; linked?: unknown; accounts?: unknown }): Wallet => ({
  glory: w.glory,
  signets: w.signets,
  linked: w.linked === true,
  accounts: w.accounts === true,
});

/** An idempotency key for one purchase tap — a retry of the SAME tap must
 * reuse the same key, which is what makes it retry-safe on the ledger. */
export const mintPurchaseKey = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const storePost = async (path: string, identity: Identity, body: object): Promise<StoreResult> => {
  if (!API_URL) return { ok: false, reason: "unavailable" };
  try {
    const res = await apiFetch(path, {
      method: "POST",
      headers: { authorization: `Bearer ${identity.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { ok: false, reason: "insufficient" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const wallet = (await res.json()) as Wallet;
    if (typeof wallet.glory !== "number" || typeof wallet.signets !== "number") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, wallet: publishWallet(withAccountFields(wallet)) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
};

/** Debit the Glory price, credit 1 Signet — atomic server-side. */
export const storeExchange = (identity: Identity, key: string): Promise<StoreResult> =>
  storePost("/store/exchange", identity, { key });

/**
 * A real-money purchase's proof, as the API's /store/iap wants it: Apple
 * sends the StoreKit 2 signed transaction, Google the purchase token, and
 * the mock arm is the dev-API test path (bits-store.md § testing, tier 2 —
 * the server refuses it unless STORE_DEV_TOOLS=1).
 */
export type IapProof =
  | { platform: "apple"; jws: string }
  | { platform: "google"; productId: string; purchaseToken: string }
  | { platform: "mock"; productId: string; key: string };

export type IapCreditResult =
  | { ok: true; wallet: Wallet; credited: number }
  /** `invalid` = the server affirmatively rejected the receipt (finish the
   * transaction — it will never credit); `unavailable` = verification
   * couldn't complete (keep it unfinished, the replay path retries). */
  | { ok: false; reason: "invalid" | "unavailable" };

/** Submit a store receipt for verification + Signet credit. `credited` is 0
 * when this transaction was already banked — still a success. */
export const storeIapCredit = async (
  identity: Identity,
  proof: IapProof,
): Promise<IapCreditResult> => {
  if (!API_URL) return { ok: false, reason: "unavailable" };
  try {
    const res = await apiFetch("/store/iap", {
      method: "POST",
      headers: { authorization: `Bearer ${identity.token}`, "content-type": "application/json" },
      body: JSON.stringify(proof),
    });
    if (res.status === 400) return { ok: false, reason: "invalid" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { glory?: unknown; signets?: unknown; credited?: unknown };
    if (typeof body.glory !== "number" || typeof body.signets !== "number") {
      return { ok: false, reason: "unavailable" };
    }
    const extra = body as { linked?: unknown; accounts?: unknown };
    return {
      ok: true,
      wallet: publishWallet(
        withAccountFields({
          glory: body.glory,
          signets: body.signets,
          linked: extra.linked,
          accounts: extra.accounts,
        }),
      ),
      credited: typeof body.credited === "number" ? body.credited : 0,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
};

/** Spend 1 Signet for a permanent entitlement. Already-owned is a no-op
 * success server-side — it never double-charges, whatever the client thinks. */
export const storeUnlock = (identity: Identity, itemId: string): Promise<StoreResult> =>
  storePost("/store/unlock", identity, { itemId });

/** Dev-only (STORE_DEV_TOOLS=1): forget every Signet purchase so an unlock
 * flow can be re-tested. Deed grants are untouched. */
export const devResetPurchases = async (identity: Identity): Promise<boolean> => {
  if (!API_URL) return false;
  try {
    const res = await apiFetch("/dev/reset-purchases", {
      method: "POST",
      headers: { authorization: `Bearer ${identity.token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Overwrite the stored identity — the account-adoption write
 * (bits-accounts.md): link/restore handed us the account's player + a fresh
 * token, and this device becomes that player from here on.
 */
export const storeIdentity = async (identity: Identity): Promise<void> => {
  // A handed identity (account link/restore) may be a different player —
  // the last wallet is no longer ours to seed the purse with.
  forgetWallet();
  await Promise.all([
    SecureStore.setItemAsync(KEY_PLAYER_ID, identity.playerId),
    SecureStore.setItemAsync(KEY_TOKEN, identity.token),
  ]);
};

/**
 * Self-heal a stored identity the backend no longer recognises (a dev
 * database reset, a wiped row — or, since accounts, a token another device's
 * restore rotated away). An ANONYMOUS unknown token is unrecoverable by
 * design — no second factor — so the only path forward is a fresh
 * registration. But a player last seen LINKED has a recovery path (sign in →
 * restore), so their identity is kept for the doors to fix; wiping it would
 * discard the one crumb that says "this device had an account"
 * (bits-accounts.md § 401 recovery). Wipes and re-mints ONLY when the API
 * affirmatively answers 401; any network failure keeps the stored identity
 * untouched (offline must never cost a player their wallet).
 */
export const revalidateIdentity = async (identity: Identity): Promise<Identity | null> => {
  if (!API_URL) return identity;
  try {
    const res = await apiFetch("/wallet", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (res.status !== 401) return identity; // ok — or server trouble that isn't ours
  } catch {
    return identity; // unreachable — keep what we have
  }
  if ((await AsyncStorage.getItem(KEY_LINKED_HINT)) === "1") return identity;
  forgetWallet();
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_PLAYER_ID),
    SecureStore.deleteItemAsync(KEY_TOKEN),
  ]);
  return ensureIdentity();
};

/** One bracket's standing from GET /ranked/me — everything band-shaped
 * (display tier with its sticky-badge grace, division, rung floors) is
 * computed server-side; the client renders, never re-implements the bands. */
export interface RankedBracketStanding {
  bracket: string;
  rating: number;
  tier: string;
  /** Division inside the tier (3 = entry, 1 = top); null in the single-rung
   * end tiers (Initiate, Immortal). */
  division: 1 | 2 | 3 | null;
  /** Floor of the DISPLAYED rung — the progress bar's left edge (Initiate
   * gets a synthetic 1150; below rankFloor the bar hides entirely). */
  rankFloor: number;
  /** The rung above the displayed one; null at the summit. */
  nextRank: { tier: string; division: 1 | 2 | 3 | null; floor: number } | null;
  /** Season-high rating — monotonic, the hoverer's "you're still climbing". */
  peak: number;
  /** Last ≤10 results, oldest → newest — true = won (the form-dots row). */
  form: boolean[];
  wins: number;
  losses: number;
  /** > 0 = still in placement matches — rank and rating stay hidden and the
   * UI shows placement progress instead. */
  placementsLeft: number;
}

export interface RankedMe {
  season: number;
  brackets: RankedBracketStanding[];
}

/** "Gladiator" + 2 → "Gladiator II" — the one place numerals are spelled.
 * Divisions count down toward the next tier (3 = entry, 1 = top). */
export const rankName = (tier: string, division: 1 | 2 | 3 | null): string =>
  division === null ? tier : `${tier} ${["", "I", "II", "III"][division]}`;

/** The caller's ranked standing; null = unavailable (offline / no API). */
export const fetchRankedMe = async (identity: Identity): Promise<RankedMe | null> => {
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/ranked/me", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) return null;
    const me = (await res.json()) as RankedMe;
    return Array.isArray(me.brackets) ? me : null;
  } catch {
    return null;
  }
};

/** One unlocked deed from GET /achievements/me. */
export interface DeedUnlockRecord {
  id: string;
  /** Unix seconds. */
  unlockedAt: number;
}

/** The deeds screen's one read (achievements.md § API): unlock STATE only —
 * definitions ship in the app bundle (the sim package). `counters` includes
 * `glory_earned` served live off the ledger. */
export interface AchievementsMe {
  unlocks: DeedUnlockRecord[];
  counters: Record<string, number>;
  entitlements: { itemId: string; source: string; grantedAt: number }[];
}

/** The caller's achievement state; null = unavailable (offline / no API). */
export const fetchAchievements = async (identity: Identity): Promise<AchievementsMe | null> => {
  if (!API_URL) return null;
  try {
    const res = await apiFetch("/achievements/me", {
      headers: { authorization: `Bearer ${identity.token}` },
    });
    if (!res.ok) return null;
    const me = (await res.json()) as AchievementsMe;
    return Array.isArray(me.unlocks) ? me : null;
  } catch {
    return null;
  }
};

/** One feedback report as POST /feedback wants it (bits-feedback.md). The
 * context stamps come from support.ts's deviceContext(). */
export interface FeedbackReport {
  kind: "bug" | "idea" | "other";
  message: string;
  contactEmail: string;
  playerName: string;
  platform: string;
  osVersion: string;
  appBinary: string;
  appBundle: string;
}

/** `sent` = the row exists server-side; `rejected` = the server refused the
 * shape (empty message — the form guards this, so it's a belt-and-braces
 * answer); `unavailable` = never reached it (offline, API down, timeout,
 * rate-limited) — the form keeps the draft and offers the email door. */
export type FeedbackResult = "sent" | "rejected" | "unavailable";

export const sendFeedback = async (identity: Identity, report: FeedbackReport): Promise<FeedbackResult> => {
  if (!API_URL) return "unavailable";
  try {
    const res = await apiFetch("/feedback", {
      method: "POST",
      headers: { authorization: `Bearer ${identity.token}`, "content-type": "application/json" },
      body: JSON.stringify(report),
    });
    if (res.status === 400) return "rejected";
    return res.ok ? "sent" : "unavailable";
  } catch {
    return "unavailable";
  }
};

/**
 * The title screen's wallet: registers if needed, then loads the balance.
 * Stays null (render nothing) until a real number arrives — the scene
 * shouldn't show an error state for a feature the player never asked for.
 */
export const useGlory = (): number | null => {
  const [glory, setGlory] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity || !live) return;
      const balance = await fetchGlory(identity);
      if (live && balance !== null) setGlory(balance);
    })();
    return () => {
      live = false;
    };
  }, []);
  return glory;
};

/**
 * The full wallet as a hook — same silence rules as useGlory (null until a
 * real answer; never an error state the player didn't ask for), plus the
 * account fields the sign-in doors key off and a `refresh` for the moment a
 * sign-in lands (adoption changes the identity under every balance).
 */
export const useWalletInfo = (): { wallet: Wallet | null; refresh: () => void } => {
  // Seeded from the last-known wallet (no first-frame blank) and kept live
  // by every later answer; the mount fetch below is the revalidation.
  const [wallet, setWallet] = useState<Wallet | null>(lastWallet);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    walletListeners.add(setWallet);
    return () => {
      walletListeners.delete(setWallet);
    };
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const identity = await ensureIdentity();
      if (!identity || !live) return;
      // fetchWallet publishes — the listener above delivers it to us and to
      // every other mounted purse in one go.
      await fetchWallet(identity);
    })();
    return () => {
      live = false;
    };
  }, [stamp]);
  const refresh = useCallback(() => setStamp((s) => s + 1), []);
  return { wallet, refresh };
};
