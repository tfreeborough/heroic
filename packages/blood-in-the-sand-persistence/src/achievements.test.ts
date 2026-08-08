import { beforeEach, describe, expect, test } from "bun:test";
import {
  achievementCounters,
  achievementUnlocks,
  applyMatchAchievements,
  entitlementsOf,
  gloryEarned,
} from "./achievements";
import { createDb, ensureSchema, type Db } from "./db";
import { gloryBalance, recordGlory } from "./glory";
import { registerPlayer } from "./players";

let db: Db;
let playerId: string;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
  playerId = (await registerPlayer(db)).playerId;
});

describe("achievement counters + unlocks", () => {
  test("fresh player has empty everything", async () => {
    expect(await achievementCounters(db, playerId)).toEqual({});
    expect(await achievementUnlocks(db, playerId)).toEqual([]);
    expect(await entitlementsOf(db, playerId)).toEqual([]);
  });

  test("one application lands counters, unlocks, glory, and entitlements together", async () => {
    const applied = await applyMatchAchievements(db, {
      matchId: "m1",
      playerId,
      counters: { ranked_matches: 1, ranked_wins: 1, killing_blows: 2 },
      unlocks: [
        { id: "sworn-to-the-sand", glory: 25 },
        // Rewards stack: an item AND a wearable title from one unlock.
        { id: "secret-blade", entitlements: ["shadow-blade", "title:secret-blade"] },
        { id: "loss-streak-3" }, // reward-free unlock
      ],
    });
    expect(applied).toBe(true);
    expect(await achievementCounters(db, playerId)).toEqual({
      ranked_matches: 1,
      ranked_wins: 1,
      killing_blows: 2,
    });
    expect((await achievementUnlocks(db, playerId)).map((u) => u.id).sort()).toEqual([
      "loss-streak-3",
      "secret-blade",
      "sworn-to-the-sand",
    ]);
    expect(await gloryBalance(db, playerId)).toBe(25);
    const entitlements = await entitlementsOf(db, playerId);
    expect(entitlements.map((e) => e.itemId).sort()).toEqual(["shadow-blade", "title:secret-blade"]);
    expect(entitlements.every((e) => e.source === "achievement:secret-blade")).toBe(true);
  });

  test("a retried settle is a no-op — the double-count guard", async () => {
    const input = {
      matchId: "m1",
      playerId,
      counters: { ranked_matches: 1 },
      unlocks: [{ id: "sworn-to-the-sand", glory: 25 }],
    };
    expect(await applyMatchAchievements(db, input)).toBe(true);
    // The retry arrives with STALE counters (read before the first apply
    // landed) — the guard must refuse the whole thing, values untouched.
    expect(await applyMatchAchievements(db, input)).toBe(false);
    expect(await achievementCounters(db, playerId)).toEqual({ ranked_matches: 1 });
    expect(await gloryBalance(db, playerId)).toBe(25);
  });

  test("later matches upsert absolute counter values per match id", async () => {
    await applyMatchAchievements(db, { matchId: "m1", playerId, counters: { ranked_wins: 1 }, unlocks: [] });
    await applyMatchAchievements(db, { matchId: "m2", playerId, counters: { ranked_wins: 2, win_streak_current: 2 }, unlocks: [] });
    expect(await achievementCounters(db, playerId)).toEqual({ ranked_wins: 2, win_streak_current: 2 });
  });

  test("re-awarding an already-unlocked deed in a NEW match cannot double-pay", async () => {
    await applyMatchAchievements(db, {
      matchId: "m1",
      playerId,
      counters: {},
      unlocks: [{ id: "first-blood", glory: 10 }],
    });
    // The evaluate() layer filters unlocked ids, but even if a bug let one
    // through, the ledger's idempotency key and the unlock PK both hold.
    await applyMatchAchievements(db, {
      matchId: "m2",
      playerId,
      counters: {},
      unlocks: [{ id: "first-blood", glory: 10 }],
    });
    expect(await gloryBalance(db, playerId)).toBe(10);
    expect(await achievementUnlocks(db, playerId)).toHaveLength(1);
  });

  test("marks are per-player within a match — two seats settle independently", async () => {
    const other = (await registerPlayer(db)).playerId;
    expect(await applyMatchAchievements(db, { matchId: "m1", playerId, counters: { a: 1 }, unlocks: [] })).toBe(true);
    expect(await applyMatchAchievements(db, { matchId: "m1", playerId: other, counters: { a: 5 }, unlocks: [] })).toBe(true);
    expect(await achievementCounters(db, other)).toEqual({ a: 5 });
  });
});

describe("gloryEarned", () => {
  test("counts credits only — spending never shrinks lifetime glory", async () => {
    await recordGlory(db, { playerId, amount: 100, source: "ranked:m1", idempotencyKey: "k1" });
    await recordGlory(db, { playerId, amount: 40, source: "ranked:m2", idempotencyKey: "k2" });
    await recordGlory(db, { playerId, amount: -60, source: "store:sku1", idempotencyKey: "k3" });
    expect(await gloryBalance(db, playerId)).toBe(80);
    expect(await gloryEarned(db, playerId)).toBe(140);
  });
});
