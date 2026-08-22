/**
 * The account layer (bits-accounts.md): thin client over /account/* — link
 * the anonymous player to the signed-in Clerk user, restore on a new device,
 * unlink on account deletion. Clerk itself (providers, sessions, JWTs) lives
 * in the AccountSheet's hooks; this module only ever sees the session JWT
 * as an opaque string.
 *
 * Identity rule: a link answer that carries an `identity` means this device
 * must BECOME that player — adoptIdentity overwrites SecureStore and every
 * subsequent fetch speaks as the account's player. The abandoned local
 * player was merged server-side; nothing is lost.
 */
import { API_URL, ensureIdentity, storeIdentity, type Identity } from "./api";

/** Accounts exist client-side at all only when the Clerk key shipped. */
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

/** Never let a dead API hang the sheet — same deadline discipline as api.ts. */
const FETCH_TIMEOUT_MS = 8000;

const accountPost = async (
  path: string,
  body: object,
  token?: string,
): Promise<Response | null> => {
  if (!API_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export type LinkResult =
  /** Linked. When `identity` is set the account already owned a player —
   * it has been adopted (SecureStore overwritten): refetch everything. */
  | { ok: true; adopted: boolean }
  /** This player already belongs to a different account. */
  | { ok: false; reason: "already_linked" }
  /** The API AFFIRMATIVELY refused the Clerk session (401) — the classic
   * cause is a client/server Clerk instance mismatch (stale Metro env after
   * a key swap), never a network blip. Distinct so the sheet doesn't blame
   * "the ledger" for a sign-in the server rejected. */
  | { ok: false; reason: "rejected" }
  /** Sign-in was fine but the API/link couldn't complete — retryable. */
  | { ok: false; reason: "unavailable" };

/**
 * Link the local player to the signed-in Clerk user (the JWT from
 * useAuth().getToken()). Handles the whole adoption dance: a merge answer
 * rewrites the stored identity before returning.
 */
export const accountLink = async (clerkToken: string): Promise<LinkResult> => {
  const identity = await ensureIdentity();
  // No local identity (offline first launch): fall back to a pure restore —
  // an account that owns a player can still get in.
  if (!identity) {
    const restored = await accountRestore(clerkToken);
    return restored ? { ok: true, adopted: true } : { ok: false, reason: "unavailable" };
  }
  const res = await accountPost("/account/link", { clerkToken }, identity.token);
  if (!res) return { ok: false, reason: "unavailable" };
  if (res.status === 409) return { ok: false, reason: "already_linked" };
  if (res.status === 401) return { ok: false, reason: "rejected" };
  if (!res.ok) return { ok: false, reason: "unavailable" };
  const body = (await res.json().catch(() => null)) as {
    linked?: unknown;
    identity?: { playerId?: unknown; token?: unknown };
  } | null;
  if (body?.linked !== true) return { ok: false, reason: "unavailable" };
  const handed = body.identity;
  if (typeof handed?.playerId === "string" && typeof handed.token === "string") {
    await storeIdentity({ playerId: handed.playerId, token: handed.token });
    return { ok: true, adopted: true };
  }
  return { ok: true, adopted: false };
};

/**
 * Restore with nothing but the Clerk session — the no-local-identity path.
 * Null when the account never linked a player (or the API is unreachable).
 */
export const accountRestore = async (clerkToken: string): Promise<Identity | null> => {
  const res = await accountPost("/account/restore", { clerkToken });
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    playerId?: unknown;
    token?: unknown;
  } | null;
  if (typeof body?.playerId !== "string" || typeof body.token !== "string") return null;
  const identity = { playerId: body.playerId, token: body.token };
  await storeIdentity(identity);
  return identity;
};

/**
 * Account deletion (bits-accounts.md, App Store 5.1.1(v)): the server
 * deletes the Clerk user then clears the link; the player + purchases
 * survive as pure-anonymous on this device. False = retryable failure.
 */
export const accountUnlink = async (identity: Identity): Promise<boolean> => {
  const res = await accountPost("/account/unlink", {}, identity.token);
  return res?.ok === true;
};

/**
 * The post-purchase sheet's once-per-session throttle (bits-accounts.md
 * § re-offer cadence): module state — a fresh launch offers again, a
 * confirmed skip holds for this session. The header door and Settings stay
 * available regardless.
 */
let offeredThisSession = false;
export const shouldOfferAfterPurchase = (): boolean => !offeredThisSession;
export const markOfferShown = (): void => {
  offeredThisSession = true;
};
