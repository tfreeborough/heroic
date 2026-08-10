/**
 * The store's money math (bits-store.md): every path that moves Glory or
 * Writs must be atomic, idempotent, and impossible to double-spend.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { gloryBalance, recordGlory } from "./glory";
import { writBalance, recordWrit } from "./writs";
import { exchangeGloryForWrit, unlockWithWrit } from "./store";

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

describe("exchangeGloryForWrit", () => {
  test("debits the price and credits one Writ", async () => {
    await give(1000);
    const result = await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k1" });
    expect(result).toBe("ok");
    expect(await gloryBalance(db, player)).toBe(1000 - PRICE);
    expect(await writBalance(db, player)).toBe(1);
  });

  test("refuses when Glory is short — and writes nothing at all", async () => {
    await give(PRICE - 1);
    const result = await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k1" });
    expect(result).toBe("insufficient");
    expect(await gloryBalance(db, player)).toBe(PRICE - 1);
    expect(await writBalance(db, player)).toBe(0);
  });

  test("a retried key is a no-op success, never a second spend", async () => {
    await give(PRICE * 2);
    expect(await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k1" })).toBe("ok");
    expect(await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k1" })).toBe(
      "duplicate",
    );
    expect(await gloryBalance(db, player)).toBe(PRICE);
    expect(await writBalance(db, player)).toBe(1);
  });

  test("distinct keys spend independently down to an exact zero", async () => {
    await give(PRICE * 2);
    expect(await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k1" })).toBe("ok");
    expect(await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k2" })).toBe("ok");
    expect(await exchangeGloryForWrit(db, { playerId: player, price: PRICE, key: "k3" })).toBe(
      "insufficient",
    );
    expect(await gloryBalance(db, player)).toBe(0);
    expect(await writBalance(db, player)).toBe(2);
  });
});

describe("unlockWithWrit", () => {
  const ITEM = "weapon:falx";

  const giveWrit = async (): Promise<void> => {
    await recordWrit(db, {
      playerId: player,
      amount: 1,
      source: "test",
      idempotencyKey: `test:${player}:${Math.random()}`,
    });
  };

  test("spends one Writ and grants the entitlement", async () => {
    await giveWrit();
    expect(await unlockWithWrit(db, { playerId: player, itemId: ITEM })).toBe("ok");
    expect(await writBalance(db, player)).toBe(0);
    const rows = await db.execute({
      sql: "SELECT source FROM entitlements WHERE player_id = ? AND item_id = ?",
      args: [player, ITEM],
    });
    expect(rows.rows[0]?.["source"]).toBe("purchase:writ");
  });

  test("refuses with no Writs — and grants nothing", async () => {
    expect(await unlockWithWrit(db, { playerId: player, itemId: ITEM })).toBe("insufficient");
    const rows = await db.execute({
      sql: "SELECT 1 FROM entitlements WHERE player_id = ?",
      args: [player],
    });
    expect(rows.rows.length).toBe(0);
  });

  test("a retry after success is a free no-op — one Writ spent, ever", async () => {
    await giveWrit();
    await giveWrit();
    expect(await unlockWithWrit(db, { playerId: player, itemId: ITEM })).toBe("ok");
    expect(await unlockWithWrit(db, { playerId: player, itemId: ITEM })).toBe("already-owned");
    expect(await writBalance(db, player)).toBe(1);
  });

  test("an item already owned via a deed is never charged for", async () => {
    await giveWrit();
    await db.execute({
      sql: "INSERT INTO entitlements (player_id, item_id, source) VALUES (?, ?, 'achievement:some-deed')",
      args: [player, ITEM],
    });
    expect(await unlockWithWrit(db, { playerId: player, itemId: ITEM })).toBe("already-owned");
    expect(await writBalance(db, player)).toBe(1);
    // The deed's provenance survives — the store never overwrites a grant.
    const rows = await db.execute({
      sql: "SELECT source FROM entitlements WHERE player_id = ? AND item_id = ?",
      args: [player, ITEM],
    });
    expect(rows.rows[0]?.["source"]).toBe("achievement:some-deed");
  });

  test("two different items cost two Writs", async () => {
    await giveWrit();
    await giveWrit();
    expect(await unlockWithWrit(db, { playerId: player, itemId: "weapon:falx" })).toBe("ok");
    expect(await unlockWithWrit(db, { playerId: player, itemId: "ability:mirage" })).toBe("ok");
    expect(await unlockWithWrit(db, { playerId: player, itemId: "ability:sirocco" })).toBe(
      "insufficient",
    );
    expect(await writBalance(db, player)).toBe(0);
  });
});
