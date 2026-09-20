import { beforeEach, describe, expect, test } from "bun:test";
import {
  achievementCounters,
  achievementUnlocks,
  applyMatchAchievements,
  companionsOf,
  entitlementsOf,
  gloryEarned,
  grantOwedEntitlements,
  payOwedBounties,
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

  test("ranked settles only — merges, codes, grants and deed rewards never move the counter (2026-09-10)", async () => {
    await recordGlory(db, { playerId, amount: 100, source: "ranked:m1", idempotencyKey: "r1" });
    await recordGlory(db, { playerId, amount: 500, source: "merge:old-device", idempotencyKey: "m1" });
    await recordGlory(db, { playerId, amount: 250, source: "code:LAUNCH", idempotencyKey: "c1" });
    await recordGlory(db, { playerId, amount: 75, source: "achievement:ranked-wins-5", idempotencyKey: "a1" });
    expect(await gloryBalance(db, playerId)).toBe(925);
    expect(await gloryEarned(db, playerId)).toBe(100);
  });
});

describe("skirmish companions (bits-skirmish-deeds.md)", () => {
  test("companions accumulate per other account inside the guarded apply — a retry never double-counts", async () => {
    const other = (await registerPlayer(db)).playerId;
    const input = {
      matchId: "s1",
      playerId,
      counters: { "skirmish:matches": 1 },
      unlocks: [],
      companions: [{ otherId: other, with: 1, against: 0 }],
    };
    expect(await applyMatchAchievements(db, input)).toBe(true);
    expect(await applyMatchAchievements(db, input)).toBe(false);
    expect(await companionsOf(db, playerId)).toEqual([{ otherId: other, withCount: 1, againstCount: 0 }]);
    // Next match, across the sand this time.
    await applyMatchAchievements(db, { ...input, matchId: "s2", companions: [{ otherId: other, with: 0, against: 1 }] });
    expect(await companionsOf(db, playerId)).toEqual([{ otherId: other, withCount: 1, againstCount: 1 }]);
    // Rows are one-directional: the other player's view is written by THEIR apply.
    expect(await companionsOf(db, other)).toEqual([]);
  });
});

describe("payOwedBounties", () => {
  const BOUNTIES = { "ranked-wins-5": 10, flawless: 25, "loss-streak-3": 0 };

  test("pays deeds held from before bounties existed, once, and skips what the live award already paid", async () => {
    // Unlocked back when nothing paid…
    await applyMatchAchievements(db, {
      matchId: "m1",
      playerId,
      counters: {},
      unlocks: [{ id: "ranked-wins-5" }, { id: "loss-streak-3" }],
    });
    // …and one the live award paid after bounties landed.
    await applyMatchAchievements(db, { matchId: "m2", playerId, counters: {}, unlocks: [{ id: "flawless", glory: 25 }] });
    expect(await gloryBalance(db, playerId)).toBe(25);

    // A dry run reports and writes nothing.
    expect(await payOwedBounties(db, BOUNTIES, { apply: false })).toEqual({ payments: 1, glory: 10, players: 1 });
    expect(await gloryBalance(db, playerId)).toBe(25);

    expect(await payOwedBounties(db, BOUNTIES, { apply: true })).toEqual({ payments: 1, glory: 10, players: 1 });
    expect(await gloryBalance(db, playerId)).toBe(35);
    // Again: nothing owed, nothing moves.
    expect(await payOwedBounties(db, BOUNTIES, { apply: true })).toEqual({ payments: 0, glory: 0, players: 0 });
    expect(await gloryBalance(db, playerId)).toBe(35);
    // Back pay is deed Glory, not match Glory — the glory-earned ladder ignores it.
    expect(await gloryEarned(db, playerId)).toBe(0);
  });

  test("a deed the live award pays later can't pay again on top of back pay", async () => {
    await applyMatchAchievements(db, { matchId: "m1", playerId, counters: {}, unlocks: [{ id: "ranked-wins-5" }] });
    await payOwedBounties(db, BOUNTIES, { apply: true });
    // Same (player, deed) key — a replayed award is a no-op on the ledger.
    await applyMatchAchievements(db, { matchId: "m9", playerId, counters: {}, unlocks: [{ id: "ranked-wins-5", glory: 10 }] });
    expect(await gloryBalance(db, playerId)).toBe(10);
  });
});

describe("grantOwedEntitlements", () => {
  const REWARDS = { "killing-blows-25": ["finisher:snuffed"], "ranked-wins-5": ["weapon:trident", "title:ranked-wins-5"] };

  test("grants items a held deed started paying later, once, under the live award's source", async () => {
    // Gravedigger earned before it paid a finisher; the trident deed was paid live.
    await applyMatchAchievements(db, {
      matchId: "m1",
      playerId,
      counters: {},
      unlocks: [{ id: "killing-blows-25" }, { id: "ranked-wins-5", entitlements: ["weapon:trident", "title:ranked-wins-5"] }],
    });
    const bystander = (await registerPlayer(db)).playerId; // holds neither deed

    // A dry run reports and writes nothing.
    expect(await grantOwedEntitlements(db, REWARDS, { apply: false })).toEqual({ grants: 1, players: 1 });
    expect((await entitlementsOf(db, playerId)).map((e) => e.itemId)).not.toContain("finisher:snuffed");

    expect(await grantOwedEntitlements(db, REWARDS, { apply: true })).toEqual({ grants: 1, players: 1 });
    const snuffed = (await entitlementsOf(db, playerId)).find((e) => e.itemId === "finisher:snuffed");
    expect(snuffed?.source).toBe("achievement:killing-blows-25");
    expect(await entitlementsOf(db, bystander)).toEqual([]);
    // Again: nothing owed, nothing moves.
    expect(await grantOwedEntitlements(db, REWARDS, { apply: true })).toEqual({ grants: 0, players: 0 });
    expect((await entitlementsOf(db, playerId)).length).toBe(3);
  });
});
