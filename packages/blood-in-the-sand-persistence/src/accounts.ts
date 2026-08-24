/**
 * Account linking (bits-accounts.md): the optional Clerk account is a LINK
 * stamped onto the anonymous player — `players.clerk_user_id` — never a
 * replacement identity. Everything here speaks playerId + bearer token; the
 * Clerk JWT is verified in the API layer and arrives as a plain clerkUserId.
 *
 * Tokens are per-device (A4, 2026-08-22): a restore MINTS an additional
 * credential for the calling device — every other device stays signed in,
 * so one account plays across a household of devices with one sign-in each.
 */
import type { Db } from "./db";
import { gloryBalance, recordGlory } from "./glory";
import { mintPlayerToken, type Registration } from "./players";
import { signetBalance, recordSignet } from "./signets";

export type LinkOutcome =
  /** clerkUserId stamped onto the caller's player (or already was). */
  | { result: "linked" }
  /** The Clerk user already owns ANOTHER player: the caller's progress was
   * merged into it and the caller must ADOPT this identity — overwrite the
   * stored playerId + token with `identity` and refetch everything. */
  | { result: "restored"; identity: Registration; merged: boolean }
  /** The caller's player is linked to a DIFFERENT Clerk user — refuse;
   * re-homing a player between accounts is not a thing. */
  | { result: "conflict" };

export interface LinkInput {
  playerId: string;
  clerkUserId: string;
}

/**
 * Merge one player's progress into another: union the entitlements AND the
 * deed unlocks (keeping the earliest unlock date), take the higher of each
 * lifetime counter, credit the source player's ledger balances as single
 * aggregate rows. Deterministic idempotency keys (`merge:<fromId>:…`) and
 * only-if-better upserts make a retried or re-raced merge a no-op — which
 * also means a merged-away player that somehow earns MORE later (its token
 * can survive on a second device) merges only once, ever; union+sum at link
 * time, orphaned afterwards (bits-accounts.md merge policy).
 *
 * Counters take MAX, not SUM, because the stored values mix additive
 * lifetimes with streak high-waters (achievements.md) — summing would mint
 * a best-streak nobody ran. MAX can undercount an additive counter, but it
 * can never unlock a deed neither identity legitimately reached.
 *
 * Unlock rows are copied WITHOUT their Glory rewards — the source player
 * was already paid when the deed fired, and that payment rides the ledger
 * sum below; re-paying here would double-credit shared deeds.
 */
const mergePlayers = async (db: Db, fromId: string, intoId: string): Promise<boolean> => {
  const [glory, signets] = await Promise.all([
    gloryBalance(db, fromId),
    signetBalance(db, fromId),
  ]);
  let moved = false;
  if (glory !== 0) {
    moved =
      (await recordGlory(db, {
        playerId: intoId,
        amount: glory,
        source: `merge:${fromId}`,
        idempotencyKey: `merge:${fromId}:glory`,
      })) || moved;
  }
  if (signets !== 0) {
    moved =
      (await recordSignet(db, {
        playerId: intoId,
        amount: signets,
        source: `merge:${fromId}`,
        idempotencyKey: `merge:${fromId}:signet`,
      })) || moved;
  }
  const entitlements = await db.execute({
    sql: `INSERT OR IGNORE INTO entitlements (player_id, item_id, source)
          SELECT ?, item_id, source FROM entitlements WHERE player_id = ?`,
    args: [intoId, fromId],
  });
  // Both upserts guard their DO UPDATE on strict improvement so a retried
  // merge touches zero rows — `merged` must stay false on the second pass.
  const unlocks = await db.execute({
    sql: `INSERT INTO achievement_unlocks (player_id, achievement_id, unlocked_at)
          SELECT ?, achievement_id, unlocked_at FROM achievement_unlocks WHERE player_id = ?
          ON CONFLICT (player_id, achievement_id) DO UPDATE SET unlocked_at = excluded.unlocked_at
          WHERE excluded.unlocked_at < achievement_unlocks.unlocked_at`,
    args: [intoId, fromId],
  });
  const counters = await db.execute({
    sql: `INSERT INTO achievement_counters (player_id, counter, value)
          SELECT ?, counter, value FROM achievement_counters WHERE player_id = ?
          ON CONFLICT (player_id, counter) DO UPDATE SET value = excluded.value
          WHERE excluded.value > achievement_counters.value`,
    args: [intoId, fromId],
  });
  return moved || entitlements.rowsAffected > 0 || unlocks.rowsAffected > 0 || counters.rowsAffected > 0;
};

/**
 * Link the caller's player to a Clerk user. Three shapes come back:
 * `linked` (stamped, idempotent), `restored` (the account already owned a
 * player — caller merges in and adopts it), `conflict` (caller belongs to a
 * different account). Ranked ratings and names never merge — the account
 * player's records stand; Elo merging is unprincipled (bits-accounts.md).
 */
export const linkAccount = async (db: Db, input: LinkInput): Promise<LinkOutcome> => {
  const caller = await db.execute({
    sql: "SELECT clerk_user_id FROM players WHERE id = ?",
    args: [input.playerId],
  });
  const callerLink = caller.rows[0]?.["clerk_user_id"];
  if (callerLink === input.clerkUserId) return { result: "linked" };
  if (typeof callerLink === "string") return { result: "conflict" };

  // Claim the Clerk user for this player — the guarded UPDATE plus the
  // partial unique index make a concurrent double-claim impossible: exactly
  // one caller lands the row, the loser falls through to the adopt path.
  try {
    const claimed = await db.execute({
      sql: `UPDATE players SET clerk_user_id = ?
            WHERE id = ? AND clerk_user_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM players WHERE clerk_user_id = ?)`,
      args: [input.clerkUserId, input.playerId, input.clerkUserId],
    });
    if (claimed.rowsAffected > 0) return { result: "linked" };
  } catch (err) {
    if (!String((err as Error).message).includes("UNIQUE")) throw err;
  }

  // The Clerk user already owns a player: merge the caller into it and hand
  // the caller its own device token for that identity (other devices keep
  // theirs — per-device model).
  const owner = await db.execute({
    sql: "SELECT id FROM players WHERE clerk_user_id = ?",
    args: [input.clerkUserId],
  });
  const ownerId = owner.rows[0]?.["id"];
  if (typeof ownerId !== "string") throw new Error("clerk link claim raced to nowhere");
  const merged = await mergePlayers(db, input.playerId, ownerId);
  const token = await mintPlayerToken(db, ownerId);
  return { result: "restored", identity: { playerId: ownerId, token }, merged };
};

/**
 * New-device restore: resolve the Clerk user to its linked player and mint
 * this device its own bearer token — existing devices' tokens stay live.
 * Null when this account never linked a player — the client tells them
 * there's nothing to restore.
 */
export const restoreAccount = async (db: Db, clerkUserId: string): Promise<Registration | null> => {
  const owner = await db.execute({
    sql: "SELECT id FROM players WHERE clerk_user_id = ?",
    args: [clerkUserId],
  });
  const ownerId = owner.rows[0]?.["id"];
  if (typeof ownerId !== "string") return null;
  const token = await mintPlayerToken(db, ownerId);
  return { playerId: ownerId, token };
};

/**
 * Clear the link (account deletion, bits-accounts.md § restore door — App
 * Store 5.1.1(v)). Returns the Clerk user id that was linked so the API can
 * delete the Clerk user, or null when there was nothing to unlink. The
 * player and every purchase survive as pure-anonymous.
 */
export const unlinkAccount = async (db: Db, playerId: string): Promise<string | null> => {
  const linked = await linkedClerkUserId(db, playerId);
  if (!linked) return null;
  await db.execute({
    sql: "UPDATE players SET clerk_user_id = NULL WHERE id = ?",
    args: [playerId],
  });
  return linked;
};

/** The wallet's `linked` flag — and unlink's lookup. */
export const linkedClerkUserId = async (db: Db, playerId: string): Promise<string | null> => {
  const result = await db.execute({
    sql: "SELECT clerk_user_id FROM players WHERE id = ?",
    args: [playerId],
  });
  const id = result.rows[0]?.["clerk_user_id"];
  return typeof id === "string" ? id : null;
};
