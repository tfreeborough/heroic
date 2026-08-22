/**
 * Account linking (bits-accounts.md): the link/restore/unlink lifecycle and
 * the merge policy — union entitlements, sum wallets, never lose a purchase,
 * never double-credit on a retried merge.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { linkAccount, linkedClerkUserId, restoreAccount, unlinkAccount } from "./accounts";
import { createDb, ensureSchema, type Db } from "./db";
import { gloryBalance, recordGlory } from "./glory";
import { findPlayerByToken, registerPlayer } from "./players";
import { signetBalance, recordSignet } from "./signets";
import { unlockWithSignet } from "./store";

const CLERK_USER = "user_clerk_abc";

let db: Db;
let player: string;
let token: string;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
  const minted = await registerPlayer(db);
  player = minted.playerId;
  token = minted.token;
});

const giveSignets = async (playerId: string, amount: number): Promise<void> => {
  await recordSignet(db, {
    playerId,
    amount,
    source: "test",
    idempotencyKey: `test:${playerId}:signet:${Math.random()}`,
  });
};

const giveGlory = async (playerId: string, amount: number): Promise<void> => {
  await recordGlory(db, {
    playerId,
    amount,
    source: "test",
    idempotencyKey: `test:${playerId}:glory:${Math.random()}`,
  });
};

describe("linkAccount", () => {
  test("stamps an unclaimed Clerk user onto the caller", async () => {
    const outcome = await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    expect(outcome).toEqual({ result: "linked" });
    expect(await linkedClerkUserId(db, player)).toBe(CLERK_USER);
  });

  test("re-linking the same pair is an idempotent success", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    const again = await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    expect(again).toEqual({ result: "linked" });
  });

  test("refuses to re-home a player already linked to a different account", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    const outcome = await linkAccount(db, { playerId: player, clerkUserId: "user_clerk_other" });
    expect(outcome.result).toBe("conflict");
    expect(await linkedClerkUserId(db, player)).toBe(CLERK_USER);
  });

  test("a claimed Clerk user hands back the account's identity (own device token)", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    const second = await registerPlayer(db);
    const outcome = await linkAccount(db, { playerId: second.playerId, clerkUserId: CLERK_USER });
    if (outcome.result !== "restored") throw new Error(`expected restored, got ${outcome.result}`);
    expect(outcome.identity.playerId).toBe(player);
    expect(outcome.merged).toBe(false); // second player was empty — nothing moved
    // BOTH tokens are live — per-device model: the first device stays in.
    expect(await findPlayerByToken(db, outcome.identity.token)).toBe(player);
    expect(await findPlayerByToken(db, token)).toBe(player);
  });

  test("merge unions entitlements and sums both wallets", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    await giveSignets(player, 2);
    await unlockWithSignet(db, { playerId: player, itemId: "weapon:fang" });

    const second = await registerPlayer(db);
    await giveGlory(second.playerId, 500);
    await giveSignets(second.playerId, 3);
    await unlockWithSignet(db, { playerId: second.playerId, itemId: "weapon:scorpion" });

    const outcome = await linkAccount(db, { playerId: second.playerId, clerkUserId: CLERK_USER });
    if (outcome.result !== "restored") throw new Error(`expected restored, got ${outcome.result}`);
    expect(outcome.merged).toBe(true);
    expect(await gloryBalance(db, player)).toBe(500);
    expect(await signetBalance(db, player)).toBe(1 + 2); // 2-1 spent + 3-1 merged in
    const owned = await db.execute({
      sql: "SELECT item_id FROM entitlements WHERE player_id = ? ORDER BY item_id",
      args: [player],
    });
    expect(owned.rows.map((r) => r["item_id"])).toEqual(["weapon:fang", "weapon:scorpion"]);
  });

  test("a retried merge never double-credits", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    const second = await registerPlayer(db);
    await giveSignets(second.playerId, 3);
    await linkAccount(db, { playerId: second.playerId, clerkUserId: CLERK_USER });
    // The same orphaned player links again (e.g. its token survived on a
    // second device that never adopted the account identity).
    const retry = await linkAccount(db, { playerId: second.playerId, clerkUserId: CLERK_USER });
    if (retry.result !== "restored") throw new Error(`expected restored, got ${retry.result}`);
    expect(retry.merged).toBe(false);
    expect(await signetBalance(db, player)).toBe(3);
  });
});

describe("restoreAccount", () => {
  test("mints a device token without logging out other devices", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    const ipad = await restoreAccount(db, CLERK_USER);
    const laptop = await restoreAccount(db, CLERK_USER);
    if (!ipad || !laptop) throw new Error("expected restored identities");
    expect(ipad.playerId).toBe(player);
    // All three devices hold live credentials simultaneously.
    expect(await findPlayerByToken(db, token)).toBe(player);
    expect(await findPlayerByToken(db, ipad.token)).toBe(player);
    expect(await findPlayerByToken(db, laptop.token)).toBe(player);
  });

  test("past the device cap the OLDEST token is pruned", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    const minted: string[] = [];
    for (let i = 0; i < 10; i++) {
      const restored = await restoreAccount(db, CLERK_USER);
      if (!restored) throw new Error("expected a restored identity");
      minted.push(restored.token);
    }
    // 11 tokens existed (register + 10 restores); the cap keeps the newest
    // 10 — the original register token is the one that ages out.
    expect(await findPlayerByToken(db, token)).toBeNull();
    for (const t of minted) expect(await findPlayerByToken(db, t)).toBe(player);
  });

  test("an account that never linked has nothing to restore", async () => {
    expect(await restoreAccount(db, "user_clerk_stranger")).toBeNull();
  });
});

describe("legacy token backfill", () => {
  test("a pre-A4 player's stored token still resolves after ensureSchema", async () => {
    // Simulate a pre-A4 row: the player exists with only the legacy
    // players.token_hash (no player_tokens row) — as every player did
    // before the table existed.
    await db.execute({ sql: "DELETE FROM player_tokens WHERE player_id = ?", args: [player] });
    expect(await findPlayerByToken(db, token)).toBeNull();
    await ensureSchema(db); // the boot-time backfill
    expect(await findPlayerByToken(db, token)).toBe(player);
  });

  test("the backfill never resurrects a pruned legacy token", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    for (let i = 0; i < 10; i++) await restoreAccount(db, CLERK_USER); // prunes the register token
    expect(await findPlayerByToken(db, token)).toBeNull();
    await ensureSchema(db); // a reboot
    expect(await findPlayerByToken(db, token)).toBeNull(); // stays gone
  });
});

describe("unlinkAccount", () => {
  test("clears the link and reports which Clerk user to delete", async () => {
    await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER });
    expect(await unlinkAccount(db, player)).toBe(CLERK_USER);
    expect(await linkedClerkUserId(db, player)).toBeNull();
    // The player and its token survive as pure-anonymous.
    expect(await findPlayerByToken(db, token)).toBe(player);
    // And the freed Clerk user is claimable again.
    expect(await linkAccount(db, { playerId: player, clerkUserId: CLERK_USER })).toEqual({
      result: "linked",
    });
  });

  test("unlinking an unlinked player is a null no-op", async () => {
    expect(await unlinkAccount(db, player)).toBeNull();
  });
});
