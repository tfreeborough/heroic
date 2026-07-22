import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { findPlayerByToken, registerPlayer } from "./players";
import { gloryBalance, recordGlory } from "./glory";

let db: Db;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
});

describe("schema", () => {
  test("ensureSchema is idempotent (safe to run on every boot)", async () => {
    await ensureSchema(db);
    await ensureSchema(db);
  });
});

describe("players", () => {
  test("register mints an id and a token that authenticates", async () => {
    const { playerId, token } = await registerPlayer(db);
    expect(await findPlayerByToken(db, token)).toBe(playerId);
  });

  test("a wrong token resolves to nobody", async () => {
    await registerPlayer(db);
    expect(await findPlayerByToken(db, "not-a-real-token")).toBeNull();
  });

  test("tokens are stored hashed, never raw", async () => {
    const { token } = await registerPlayer(db);
    const rows = await db.execute("SELECT token_hash FROM players");
    expect(rows.rows[0]?.["token_hash"]).not.toBe(token);
  });
});

describe("glory", () => {
  test("a fresh player has 0 Glory", async () => {
    const { playerId } = await registerPlayer(db);
    expect(await gloryBalance(db, playerId)).toBe(0);
  });

  test("balance sums credits and debits", async () => {
    const { playerId } = await registerPlayer(db);
    await recordGlory(db, { playerId, amount: 100, source: "match:r1:1", idempotencyKey: "match:r1:1:win" });
    await recordGlory(db, { playerId, amount: 40, source: "app-review", idempotencyKey: `app-review:${playerId}` });
    await recordGlory(db, { playerId, amount: -50, source: "unlock:announcer.eliza", idempotencyKey: `unlock:${playerId}:announcer.eliza` });
    expect(await gloryBalance(db, playerId)).toBe(90);
  });

  test("a replayed idempotency key is ignored, not double-credited", async () => {
    const { playerId } = await registerPlayer(db);
    const entry = { playerId, amount: 100, source: "match:r1:1", idempotencyKey: "match:r1:1:win" };
    expect(await recordGlory(db, entry)).toBe(true);
    expect(await recordGlory(db, entry)).toBe(false);
    expect(await gloryBalance(db, playerId)).toBe(100);
  });

  test("balances are per-player", async () => {
    const a = await registerPlayer(db);
    const b = await registerPlayer(db);
    await recordGlory(db, { playerId: a.playerId, amount: 25, source: "match:r1:1", idempotencyKey: "k1" });
    expect(await gloryBalance(db, a.playerId)).toBe(25);
    expect(await gloryBalance(db, b.playerId)).toBe(0);
  });
});
