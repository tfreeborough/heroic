/**
 * Redeem codes (bits-redeem-codes.md): once per code per player, guards
 * inside the write, nothing half-applied.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { gloryBalance } from "./glory";
import { signetBalance } from "./signets";
import { registerPlayer } from "./players";
import { listCodes, mintCodes, normaliseCode, redeemCode, setCodeActive } from "./codes";

let db: Db;
let alice: string;
let bob: string;

const FAR = Math.floor(Date.now() / 1000) + 86_400;
const PAST = Math.floor(Date.now() / 1000) - 60;

const promo = (over: Partial<Parameters<typeof mintCodes>[1]> = {}) =>
  mintCodes(db, {
    kind: "promo",
    display: "BLOOD-TIDE",
    glory: 200,
    signets: 0,
    maxRedemptions: 2,
    expiresAt: FAR,
    ...over,
  });

const redeem = (player: string, code: string) =>
  redeemCode(db, { playerId: player, clerkUserId: `clerk_${player}`, code });

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
  alice = (await registerPlayer(db)).playerId;
  bob = (await registerPlayer(db)).playerId;
});

describe("normaliseCode", () => {
  test("case, hyphens and spaces don't matter", () => {
    expect(normaliseCode("blood tide-2026")).toBe("BLOODTIDE2026");
    expect(normaliseCode("BLOODTIDE2026")).toBe("BLOODTIDE2026");
  });
});

describe("mintCodes", () => {
  test("a promo code needs both a use limit and an expiry", async () => {
    await expect(promo({ maxRedemptions: null })).rejects.toThrow("promo_needs_limits");
    await expect(promo({ expiresAt: null })).rejects.toThrow("promo_needs_limits");
  });

  test("a code must pay something", async () => {
    await expect(promo({ glory: 0, signets: 0 })).rejects.toThrow("empty_reward");
  });

  test("tester batches generate distinct single-use codes", async () => {
    const codes = await mintCodes(db, { kind: "tester", glory: 0, signets: 3, count: 5 });
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const listed = await listCodes(db);
    expect(listed.every((c) => c.maxRedemptions === 1)).toBe(true);
  });

  test("an authored code that already exists is refused, not overwritten", async () => {
    await promo();
    await expect(promo({ glory: 9999 })).rejects.toThrow("code_exists");
    expect((await listCodes(db))[0]?.glory).toBe(200);
  });
});

describe("redeemCode", () => {
  test("credits the payout once and reports it", async () => {
    await promo({ signets: 1 });
    const result = await redeem(alice, "blood tide");
    expect(result).toEqual({ result: "ok", glory: 200, signets: 1 });
    expect(await gloryBalance(db, alice)).toBe(200);
    expect(await signetBalance(db, alice)).toBe(1);
  });

  test("a second go by the same player is refused with nothing credited", async () => {
    await promo();
    await redeem(alice, "BLOOD-TIDE");
    expect(await redeem(alice, "BLOODTIDE")).toEqual({ result: "already" });
    expect(await gloryBalance(db, alice)).toBe(200);
  });

  test("different players each get paid until the use limit fills", async () => {
    const carol = (await registerPlayer(db)).playerId;
    await promo({ maxRedemptions: 2 });
    expect((await redeem(alice, "BLOOD-TIDE")).result).toBe("ok");
    expect((await redeem(bob, "BLOOD-TIDE")).result).toBe("ok");
    expect(await redeem(carol, "BLOOD-TIDE")).toEqual({ result: "expired" });
    expect(await gloryBalance(db, carol)).toBe(0);
    // Whoever got in stays paid; the limit refuses newcomers only.
    expect(await redeem(alice, "BLOOD-TIDE")).toEqual({ result: "already" });
  });

  test("an expired code is refused", async () => {
    await promo({ expiresAt: PAST });
    expect(await redeem(alice, "BLOOD-TIDE")).toEqual({ result: "expired" });
    expect(await gloryBalance(db, alice)).toBe(0);
  });

  test("an unknown or switched-off code is invalid", async () => {
    expect(await redeem(alice, "NOPE-NOPE")).toEqual({ result: "invalid" });
    expect(await redeem(alice, "")).toEqual({ result: "invalid" });
    await promo();
    expect(await setCodeActive(db, "blood-tide", false)).toBe(true);
    expect(await redeem(alice, "BLOOD-TIDE")).toEqual({ result: "invalid" });
    expect(await setCodeActive(db, "BLOODTIDE", true)).toBe(true);
    expect((await redeem(alice, "BLOOD-TIDE")).result).toBe("ok");
    expect(await setCodeActive(db, "MISSING", false)).toBe(false);
  });

  test("a tester code works for exactly one player", async () => {
    const [code] = await mintCodes(db, { kind: "tester", glory: 0, signets: 3 });
    expect((await redeem(alice, code!)).result).toBe("ok");
    expect(await redeem(bob, code!)).toEqual({ result: "expired" });
    expect(await signetBalance(db, alice)).toBe(3);
    expect(await signetBalance(db, bob)).toBe(0);
  });

  test("ledger rows name the kind and carry the code key", async () => {
    await promo({ signets: 1 });
    await redeem(alice, "BLOOD-TIDE");
    const rows = await db.execute({
      sql: "SELECT source, idempotency_key FROM signet_ledger WHERE player_id = ?",
      args: [alice],
    });
    expect(rows.rows[0]?.["source"]).toBe("code:promo");
    expect(rows.rows[0]?.["idempotency_key"]).toBe(`code:BLOODTIDE:${alice}`);
  });

  test("the list counts redemptions", async () => {
    await promo();
    await redeem(alice, "BLOOD-TIDE");
    const [row] = await listCodes(db);
    expect(row?.display).toBe("BLOOD-TIDE");
    expect(row?.redemptions).toBe(1);
    expect(row?.active).toBe(true);
  });
});
