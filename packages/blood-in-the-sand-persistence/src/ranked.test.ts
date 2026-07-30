import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { registerPlayer } from "./players";
import { gloryBalance } from "./glory";
import { RATING_START } from "./elo";
import { getRating, leaderboard, rankedSummary, recentForm, recordRankedMatch } from "./ranked";

let db: Db;
let alice: string;
let bob: string;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
  alice = (await registerPlayer(db)).playerId;
  bob = (await registerPlayer(db)).playerId;
});

describe("ratings", () => {
  test("an unplayed subject reads the 1500 default without creating a row", async () => {
    const r = await getRating(db, alice, 1, "1v1");
    expect(r.rating).toBe(RATING_START);
    expect(r.wins + r.losses).toBe(0);
    expect(await rankedSummary(db, alice, 1)).toEqual([]);
  });
});

describe("recordRankedMatch", () => {
  test("settles ratings, history, and Glory in one go", async () => {
    const result = await recordRankedMatch(db, {
      matchId: "m1",
      season: 1,
      bracket: "1v1",
      winnerId: alice,
      loserId: bob,
      winnerLoadout: { weapon: "sword", abilities: ["dash"] },
      loserLoadout: { weapon: "bow", abilities: ["heal"] },
    });
    expect(result).not.toBeNull();
    // Both on placement K=40, even ratings: ±20.
    expect(result!.winner.after).toBe(1520);
    expect(result!.winner.delta).toBe(20);
    expect(result!.loser.after).toBe(1480);
    expect(result!.loser.delta).toBe(-20);
    expect(result!.winner.tier).toBe("Gladiator");
    expect(result!.winner.division).toBe(2); // 1520 sits in Gladiator II (1500–1549)
    expect(result!.loser.tier).toBe("Gladiator");
    expect(result!.loser.division).toBe(3); // 1480 is honestly Gladiator III (floor 1450)
    expect(result!.winner.matchesPlayed).toBe(1); // both mid-placements
    expect(result!.loser.matchesPlayed).toBe(1);
    // Even-fight payouts: 23 / 5.
    expect(result!.winner.glory).toBe(23);
    expect(await gloryBalance(db, alice)).toBe(23);
    expect(await gloryBalance(db, bob)).toBe(5);
    // The ladder rows persisted.
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(1520);
    expect((await getRating(db, bob, 1, "1v1")).wins).toBe(0);
    expect((await getRating(db, bob, 1, "1v1")).losses).toBe(1);
  });

  test("a replayed match id is a no-op (crash-retry safety)", async () => {
    const input = { matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob };
    expect(await recordRankedMatch(db, input)).not.toBeNull();
    expect(await recordRankedMatch(db, input)).toBeNull();
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(1520);
    expect(await gloryBalance(db, alice)).toBe(23);
  });

  test("brackets are independent ladders", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob });
    expect((await getRating(db, alice, 1, "2v2")).rating).toBe(RATING_START);
    const summary = await rankedSummary(db, alice, 1);
    expect(summary.map((r) => r.bracket)).toEqual(["1v1"]);
  });

  test("seasons are independent too", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob });
    expect((await getRating(db, alice, 2, "1v1")).rating).toBe(RATING_START);
  });

  test("loadouts land in the history row as JSON", async () => {
    await recordRankedMatch(db, {
      matchId: "m1",
      season: 1,
      bracket: "1v1",
      winnerId: alice,
      loserId: bob,
      winnerLoadout: { weapon: "sword" },
    });
    const rows = await db.execute("SELECT winner_loadout, loser_loadout FROM ranked_matches");
    expect(JSON.parse(String(rows.rows[0]!["winner_loadout"]))).toEqual({ weapon: "sword" });
    expect(rows.rows[0]!["loser_loadout"]).toBeNull();
  });
});

describe("season peak", () => {
  test("the peak rises with the rating and survives the fall", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob });
    const climbed = await getRating(db, alice, 1, "1v1");
    expect(climbed.rating).toBe(1520);
    expect(climbed.peak).toBe(1520);
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winnerId: bob, loserId: alice });
    const dipped = await getRating(db, alice, 1, "1v1");
    expect(dipped.rating).toBeLessThan(1520);
    expect(dipped.peak).toBe(1520); // monotonic — the whole point
    expect((await rankedSummary(db, alice, 1))[0]!.peak).toBe(1520);
  });

  test("the settle result flags a new best (and only a new best)", async () => {
    const first = await recordRankedMatch(db, {
      matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob,
    });
    expect(first!.winner.newBest).toBe(true);
    expect(first!.winner.peak).toBe(1520);
    expect(first!.loser.newBest).toBe(false);
    expect(first!.loser.peak).toBe(1500); // the start rating is the initial peak
    // Alice loses back to 1500-ish, then wins again without passing 1520.
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winnerId: bob, loserId: alice });
    const third = await recordRankedMatch(db, {
      matchId: "m3", season: 1, bracket: "1v1", winnerId: alice, loserId: bob,
    });
    expect(third!.winner.after).toBeLessThanOrEqual(1520);
    expect(third!.winner.newBest).toBe(false);
  });
});

describe("recent form", () => {
  test("reads oldest → newest, capped, from either side of the matches", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob });
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winnerId: bob, loserId: alice });
    await recordRankedMatch(db, { matchId: "m3", season: 1, bracket: "1v1", winnerId: alice, loserId: bob });
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([true, false, true]);
    expect(await recentForm(db, bob, 1, "1v1")).toEqual([false, true, false]);
    expect(await recentForm(db, alice, 1, "1v1", 2)).toEqual([false, true]); // the LAST two
    expect(await recentForm(db, alice, 2, "1v1")).toEqual([]); // other season
  });
});

describe("leaderboard", () => {
  test("orders by rating within a season+bracket", async () => {
    const carol = (await registerPlayer(db)).playerId;
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winnerId: alice, loserId: bob });
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winnerId: alice, loserId: carol });
    const top = await leaderboard(db, 1, "1v1");
    expect(top.map((e) => e.subjectId)[0]).toBe(alice);
    expect(top).toHaveLength(3);
    expect(top[0]!.rating).toBeGreaterThan(top[1]!.rating);
  });
});
