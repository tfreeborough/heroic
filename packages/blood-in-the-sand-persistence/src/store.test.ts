/**
 * The store's money math (bits-store.md): every path that moves Glory or
 * Signets must be atomic, idempotent, and impossible to double-spend.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { gloryBalance, recordGlory } from "./glory";
import { signetBalance, recordSignet } from "./signets";
import { creditIapSignets, exchangeGloryForSignet, unlockWithSignet } from "./store";

const PRICE = 800;

let db: Db;
let player: string;

const give = async (glory: number): Promise<void> => {
  await recordGlory(db, {
    playerId: player,
    amount: glory,
    source: "test",
    idempotencyKey: `test:${player}:${glory}:${Math.random()}`,
  });
};

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
  const { registerPlayer } = await import("./players");
  player = (await registerPlayer(db)).playerId;
});

describe("exchangeGloryForSignet", () => {
  test("debits the price and credits one Signet", async () => {
    await give(1000);
    const result = await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k1" });
    expect(result).toBe("ok");
    expect(await gloryBalance(db, player)).toBe(1000 - PRICE);
    expect(await signetBalance(db, player)).toBe(1);
  });

  test("refuses when Glory is short — and writes nothing at all", async () => {
    await give(PRICE - 1);
    const result = await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k1" });
    expect(result).toBe("insufficient");
    expect(await gloryBalance(db, player)).toBe(PRICE - 1);
    expect(await signetBalance(db, player)).toBe(0);
  });

  test("a retried key is a no-op success, never a second spend", async () => {
    await give(PRICE * 2);
    expect(await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k1" })).toBe("ok");
    expect(await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k1" })).toBe(
      "duplicate",
    );
    expect(await gloryBalance(db, player)).toBe(PRICE);
    expect(await signetBalance(db, player)).toBe(1);
  });

  test("distinct keys spend independently down to an exact zero", async () => {
    await give(PRICE * 2);
    expect(await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k1" })).toBe("ok");
    expect(await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k2" })).toBe("ok");
    expect(await exchangeGloryForSignet(db, { playerId: player, price: PRICE, key: "k3" })).toBe(
      "insufficient",
    );
    expect(await gloryBalance(db, player)).toBe(0);
    expect(await signetBalance(db, player)).toBe(2);
  });
});

describe("creditIapSignets", () => {
  const purchase = (transactionId: string, playerId = player) => ({
    playerId,
    signets: 3,
    platform: "apple" as const,
    transactionId,
    productId: "signet_pack_3",
  });

  test("credits the pack size onto the Signet ledger", async () => {
    expect(await creditIapSignets(db, purchase("tx-1"))).toBe("ok");
    expect(await signetBalance(db, player)).toBe(3);
    const rows = await db.execute({
      sql: "SELECT source FROM signet_ledger WHERE player_id = ?",
      args: [player],
    });
    expect(rows.rows[0]?.["source"]).toBe("iap:apple:signet_pack_3");
  });

  test("a retried transaction id is a no-op duplicate, never a second credit", async () => {
    expect(await creditIapSignets(db, purchase("tx-1"))).toBe("ok");
    expect(await creditIapSignets(db, purchase("tx-1"))).toBe("duplicate");
    expect(await signetBalance(db, player)).toBe(3);
  });

  test("the same store transaction replayed from ANOTHER account credits nothing", async () => {
    const { registerPlayer } = await import("./players");
    const rival = (await registerPlayer(db)).playerId;
    expect(await creditIapSignets(db, purchase("tx-1"))).toBe("ok");
    expect(await creditIapSignets(db, purchase("tx-1", rival))).toBe("duplicate");
    expect(await signetBalance(db, player)).toBe(3);
    expect(await signetBalance(db, rival)).toBe(0);
  });

  test("the same transaction id on different platforms are different purchases", async () => {
    expect(await creditIapSignets(db, purchase("tx-1"))).toBe("ok");
    expect(
      await creditIapSignets(db, { ...purchase("tx-1"), platform: "google" as const }),
    ).toBe("ok");
    expect(await signetBalance(db, player)).toBe(6);
  });
});

describe("unlockWithSignet", () => {
  const ITEM = "weapon:falx";

  const giveSignet = async (): Promise<void> => {
    await recordSignet(db, {
      playerId: player,
      amount: 1,
      source: "test",
      idempotencyKey: `test:${player}:${Math.random()}`,
    });
  };

  test("spends one Signet and grants the entitlement", async () => {
    await giveSignet();
    expect(await unlockWithSignet(db, { playerId: player, itemId: ITEM })).toBe("ok");
    expect(await signetBalance(db, player)).toBe(0);
    const rows = await db.execute({
      sql: "SELECT source FROM entitlements WHERE player_id = ? AND item_id = ?",
      args: [player, ITEM],
    });
    expect(rows.rows[0]?.["source"]).toBe("purchase:signet");
  });

  test("refuses with no Signets — and grants nothing", async () => {
    expect(await unlockWithSignet(db, { playerId: player, itemId: ITEM })).toBe("insufficient");
    const rows = await db.execute({
      sql: "SELECT 1 FROM entitlements WHERE player_id = ?",
      args: [player],
    });
    expect(rows.rows.length).toBe(0);
  });

  test("a retry after success is a free no-op — one Signet spent, ever", async () => {
    await giveSignet();
    await giveSignet();
    expect(await unlockWithSignet(db, { playerId: player, itemId: ITEM })).toBe("ok");
    expect(await unlockWithSignet(db, { playerId: player, itemId: ITEM })).toBe("already-owned");
    expect(await signetBalance(db, player)).toBe(1);
  });

  test("an item already owned via a deed is never charged for", async () => {
    await giveSignet();
    await db.execute({
      sql: "INSERT INTO entitlements (player_id, item_id, source) VALUES (?, ?, 'achievement:some-deed')",
      args: [player, ITEM],
    });
    expect(await unlockWithSignet(db, { playerId: player, itemId: ITEM })).toBe("already-owned");
    expect(await signetBalance(db, player)).toBe(1);
    // The deed's provenance survives — the store never overwrites a grant.
    const rows = await db.execute({
      sql: "SELECT source FROM entitlements WHERE player_id = ? AND item_id = ?",
      args: [player, ITEM],
    });
    expect(rows.rows[0]?.["source"]).toBe("achievement:some-deed");
  });

  test("two different items cost two Signets", async () => {
    await giveSignet();
    await giveSignet();
    expect(await unlockWithSignet(db, { playerId: player, itemId: "weapon:falx" })).toBe("ok");
    expect(await unlockWithSignet(db, { playerId: player, itemId: "ability:mirage" })).toBe("ok");
    expect(await unlockWithSignet(db, { playerId: player, itemId: "ability:sirocco" })).toBe(
      "insufficient",
    );
    expect(await signetBalance(db, player)).toBe(0);
  });
});
