/**
 * The Clerk boundary (bits-accounts.md): everything Clerk-shaped stays in
 * this file — the rest of the API speaks clerkUserId strings. Verification
 * is networkless after the first JWKS fetch (@clerk/backend caches the keys),
 * so /account routes don't ride Clerk's uptime per-request.
 *
 * Env: CLERK_SECRET_KEY (unset = accounts off entirely — the routes don't
 * exist and /store advertises accounts:false), ACCOUNTS_ENABLED=0 as the
 * explicit kill switch over a configured key.
 */
import { createClerkClient, verifyToken } from "@clerk/backend";

const secretKey = process.env.CLERK_SECRET_KEY;

/** One flag the routes AND /store's client config both read. */
export const accountsEnabled = Boolean(secretKey) && process.env.ACCOUNTS_ENABLED !== "0";

const clerk = secretKey ? createClerkClient({ secretKey }) : null;

/**
 * Verify a Clerk session JWT and return its user id — null means "not a
 * valid token of ours" (expired, forged, wrong instance), which the routes
 * turn into a 401. Verification failures are deliberately not distinguished:
 * the client's answer is the same (re-run the sign-in flow).
 */
export const verifyClerkToken = async (token: string): Promise<string | null> => {
  if (!secretKey) return null;
  try {
    const payload = await verifyToken(token, { secretKey });
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch (err) {
    // Surfaced in the server log because the classic cause is operational,
    // not player-caused: a client/server Clerk INSTANCE MISMATCH (an app
    // bundle built with a different publishable key than this secret key's
    // instance — e.g. Metro not restarted after a key swap).
    console.warn(`clerk verify failed: ${(err as Error).message}`);
    return null;
  }
};

/**
 * Delete a Clerk user — the account-deletion path (App Store 5.1.1(v)).
 * True on success OR already-gone (404), false when Clerk is unreachable —
 * the route then 503s and the client retries; the local link is only cleared
 * after Clerk confirms, so a half-deleted account can't exist.
 */
export const deleteClerkUser = async (clerkUserId: string): Promise<boolean> => {
  if (!clerk) return false;
  try {
    await clerk.users.deleteUser(clerkUserId);
    return true;
  } catch (err) {
    return (err as { status?: number }).status === 404;
  }
};
