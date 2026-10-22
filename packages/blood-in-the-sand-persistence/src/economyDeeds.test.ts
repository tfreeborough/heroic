/** The economy and deeds pages' detail reads (hq-v2.md), seeded through
 * the real writers with the clock pinned. */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { recordGlory } from "./glory";
import { registerPlayer, stampPlayerName } from "./players";
import { creditIapSignets, exchangeGloryForSignet, unlockWithSignet } from "./store";
import { applyMatchAchievements } from "./achievements";
import {
  balanceBuckets,
  counterTotals,
  dayKey,
  deedOverview,
  deedStats,
  economyPulse,
  ledgerByDay,
  purchases,
  recentUnlocks,
  storeUnlocks,
  topSpenders,
  unlocksByDay,
} from "./stats";

let db: Db;
const NOW = 1_800_000_000;
const DAY = 86_400;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
});

describe("economy detail", () => {
  const seed = async () => {
    const a = (await registerPlayer(db)).playerId;
    const b = (await registerPlayer(db)).playerId;
    const c = (await registerPlayer(db)).playerId;
    await stampPlayerName(db, a, "Brutus");
    await creditIapSignets(db, { playerId: a, signets: 3, platform: "apple", transactionId: "tx-1", productId: "signet_pack_3" });
    await creditIapSignets(db, { playerId: a, signets: 1, platform: "apple", transactionId: "tx-2", productId: "signet_pack_1" });
    await creditIapSignets(db, { playerId: b, signets: 6, platform: "google", transactionId: "GPA.1", productId: "signet_pack_6" });
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ? WHERE idempotency_key = 'iap:apple:tx-1'", args: [NOW - 20 * DAY] });
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ? WHERE idempotency_key = 'iap:apple:tx-2'", args: [NOW - DAY] });
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ? WHERE idempotency_key = 'iap:google:GPA.1'", args: [NOW - 2 * DAY] });
    await recordGlory(db, { playerId: c, amount: 900, source: "ranked:m", idempotencyKey: "g1" });
    await exchangeGloryForSignet(db, { playerId: c, price: 800, key: "x1" });
    await unlockWithSignet(db, { playerId: c, itemId: "weapon:fang" });
    await db.execute({ sql: "UPDATE glory_ledger SET created_at = ?", args: [NOW - 3600] });
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ? WHERE source LIKE 'store:%'", args: [NOW - 3600] });
    await db.execute({ sql: "UPDATE entitlements SET granted_at = ?", args: [NOW - 1800] });
    return { a, b, c };
  };

  test("purchases list newest first with platform, sku and transaction id; pages by id", async () => {
    const { a, b } = await seed();
    const all = await purchases(db);
    expect(all.map((p) => [p.playerId, p.sku, p.platform, p.transactionId, p.signets])).toEqual([
      [a, "signet_pack_1", "apple", "tx-2", 1],
      [b, "signet_pack_6", "google", "GPA.1", 6],
      [a, "signet_pack_3", "apple", "tx-1", 3],
    ]);
    expect(all[0]!.name).toBe("Brutus");
    expect(all[1]!.name).toBeNull();
    const page2 = await purchases(db, { before: all[0]!.at, limit: 1 });
    expect(page2).toHaveLength(1);
    expect(page2[0]!.transactionId).toBe("GPA.1");
  });

  test("spenders, pulse, ledger days and balance buckets", async () => {
    const { a, b, c } = await seed();
    const spenders = await topSpenders(db);
    expect(spenders.map((s) => [s.playerId, s.purchases])).toEqual([
      [a, 2],
      [b, 1],
    ]);
    expect(spenders[0]!.bySku).toEqual({ signet_pack_3: 1, signet_pack_1: 1 });
    expect(await economyPulse(db, NOW)).toEqual({ payingPlayers: 2, payingWeek: 2, firstTimeBuyersWeek: 1, repeatBuyers: 1, exchangesWeek: 1, exchangesTotal: 1, unlocksWeek: 1 });
    const days = await ledgerByDay(db, "glory", 3, NOW);
    expect(days[2]).toEqual({ day: dayKey(NOW), minted: 900, burned: 800 });
    expect(days[0]).toEqual({ day: dayKey(NOW - 2 * DAY), minted: 0, burned: 0 });
    const sig = await ledgerByDay(db, "signet", 3, NOW);
    expect(sig[2]).toMatchObject({ minted: 1, burned: 1 });
    expect(sig[1]).toMatchObject({ minted: 1 }); // yesterday's single pack
    // Balances: a 4, b 6, c 0 (1 exchanged, 1 spent).
    expect(await balanceBuckets(db, "signet", [1, 2, 6])).toEqual([
      { floor: 0, ceil: 0, players: 1 },
      { floor: 1, ceil: 1, players: 0 },
      { floor: 2, ceil: 5, players: 1 },
      { floor: 6, ceil: null, players: 1 },
    ]);
    const gb = await balanceBuckets(db, "glory", [1, 800]);
    expect(gb.map((x) => x.players)).toEqual([2, 1, 0]); // c holds 100
    const unlocks = await storeUnlocks(db);
    expect(unlocks).toEqual([{ at: NOW - 1800, playerId: c, name: null, itemId: "weapon:fang" }]);
  });
});

describe("deeds detail", () => {
  test("stats, overview, days, recent and counter totals", async () => {
    const a = (await registerPlayer(db)).playerId;
    const b = (await registerPlayer(db)).playerId;
    await stampPlayerName(db, b, "Livia");
    await applyMatchAchievements(db, { matchId: "m1", playerId: a, counters: { "challenge:godlike:clears": 1, "challenge:godlike:attempts": 9 }, unlocks: [{ id: "sworn-to-the-sand", glory: 10 }, { id: "challenge-godlike" }] });
    await applyMatchAchievements(db, { matchId: "m2", playerId: b, counters: { "challenge:godlike:attempts": 4 }, unlocks: [{ id: "sworn-to-the-sand", glory: 10 }] });
    await db.execute({ sql: "UPDATE achievement_unlocks SET unlocked_at = ? WHERE player_id = ?", args: [NOW - 10 * DAY, a] });
    await db.execute({ sql: "UPDATE achievement_unlocks SET unlocked_at = ? WHERE player_id = ?", args: [NOW - 60, b] });
    const stats = await deedStats(db, NOW);
    expect(stats.find((s) => s.achievementId === "sworn-to-the-sand")).toEqual({ achievementId: "sworn-to-the-sand", unlocks: 2, week: 1, firstAt: NOW - 10 * DAY, lastAt: NOW - 60 });
    expect(await deedOverview(db, NOW)).toEqual({ unlocks: 3, unlocksWeek: 1, players: 2, playersWithDeeds: 2, bountiesPaid: 20 });
    const days = await unlocksByDay(db, 2, NOW);
    expect(days[1]).toEqual({ day: dayKey(NOW), count: 1 });
    const recent = await recentUnlocks(db, { limit: 2 });
    expect(recent[0]).toEqual({ at: NOW - 60, playerId: b, name: "Livia", achievementId: "sworn-to-the-sand" });
    const page2 = await recentUnlocks(db, { before: NOW - 60 });
    expect(page2).toHaveLength(2);
    const totals = await counterTotals(db, "challenge:");
    expect(totals.find((t) => t.counter === "challenge:godlike:attempts")).toEqual({ counter: "challenge:godlike:attempts", total: 13, players: 2 });
    expect(totals.find((t) => t.counter === "challenge:godlike:clears")).toEqual({ counter: "challenge:godlike:clears", total: 1, players: 1 });
  });
});
