/**
 * The linked account's email (hq-v2.md, Tom 2026-10-22: "yes to email if
 * we have it"): a read of our own Clerk tenant by the player's stamped
 * clerk_user_id, with the same secret the API holds. Unset = the player
 * page shows "linked" and no address. Cached per process for an hour so
 * a page reload doesn't ride Clerk's uptime; failures cache as "unknown"
 * for a minute.
 *
 * Env: CLERK_SECRET_KEY.
 */
import { createClerkClient } from "@clerk/backend";

const secretKey = process.env.CLERK_SECRET_KEY;
const clerk = secretKey ? createClerkClient({ secretKey }) : null;

export const clerkConfigured = (): boolean => clerk !== null;

interface Cached {
  email: string | null;
  until: number;
}

const g = globalThis as { __hqClerkCache?: Map<string, Cached> };
const cache = (g.__hqClerkCache ??= new Map<string, Cached>());

const HIT_MS = 60 * 60 * 1000;
const MISS_MS = 60 * 1000;

/** The primary email on a Clerk user, or null when unknown / unconfigured. */
export const clerkEmail = async (clerkUserId: string): Promise<string | null> => {
  if (!clerk) return null;
  const hit = cache.get(clerkUserId);
  if (hit && hit.until > Date.now()) return hit.email;
  try {
    const user = await clerk.users.getUser(clerkUserId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
    const email = primary?.emailAddress ?? null;
    cache.set(clerkUserId, { email, until: Date.now() + HIT_MS });
    return email;
  } catch {
    cache.set(clerkUserId, { email: null, until: Date.now() + MISS_MS });
    return null;
  }
};
