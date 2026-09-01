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
      winners: [{ subjectId: alice, loadout: { weapon: "sword", abilities: ["dash"] } }],
      losers: [{ subjectId: bob, loadout: { weapon: "bow", abilities: ["heal"] } }],
    });
    expect(result).not.toBeNull();
    // Both on placement K=24, even ratings: ±12.
    expect(result!.winners[0]!.after).toBe(1512);
    expect(result!.winners[0]!.delta).toBe(12);
    expect(result!.losers[0]!.after).toBe(1488);
    expect(result!.losers[0]!.delta).toBe(-12);
    expect(result!.winners[0]!.tier).toBe("Gladiator");
    expect(result!.winners[0]!.division).toBe(2); // 1512 sits in Gladiator II (1500–1549)
    expect(result!.winners[0]!.rankChange).toBeNull(); // 1500 → 1512 stays inside Gladiator II
    expect(result!.losers[0]!.tier).toBe("Gladiator");
    expect(result!.losers[0]!.division).toBe(3); // 1488 is honestly Gladiator III (floor 1450)
    expect(result!.losers[0]!.rankChange).toBe("down"); // II → III — divisions have no grace
    expect(result!.winners[0]!.matchesPlayed).toBe(1); // both mid-placements
    expect(result!.losers[0]!.matchesPlayed).toBe(1);
    // Even-fight payouts: 23 / 5.
    expect(result!.winners[0]!.glory).toBe(23);
    expect(await gloryBalance(db, alice)).toBe(23);
    expect(await gloryBalance(db, bob)).toBe(5);
    // The ladder rows persisted.
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(1512);
    expect((await getRating(db, bob, 1, "1v1")).wins).toBe(0);
    expect((await getRating(db, bob, 1, "1v1")).losses).toBe(1);
  });

  test("a replayed match id is a no-op (crash-retry safety)", async () => {
    const input = { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] };
    expect(await recordRankedMatch(db, input)).not.toBeNull();
    expect(await recordRankedMatch(db, input)).toBeNull();
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(1512);
    expect(await gloryBalance(db, alice)).toBe(23);
  });

  test("brackets are independent ladders", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] });
    expect((await getRating(db, alice, 1, "2v2")).rating).toBe(RATING_START);
    const summary = await rankedSummary(db, alice, 1);
    expect(summary.map((r) => r.bracket)).toEqual(["1v1"]);
  });

  test("seasons are independent too", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] });
    expect((await getRating(db, alice, 2, "1v1")).rating).toBe(RATING_START);
  });

  test("loadouts land in the history row as JSON", async () => {
    await recordRankedMatch(db, {
      matchId: "m1",
      season: 1,
      bracket: "1v1",
      winners: [{ subjectId: alice, loadout: { weapon: "sword" } }],
      losers: [{ subjectId: bob }],
    });
    const rows = await db.execute("SELECT winner_loadout, loser_loadout FROM ranked_matches");
    expect(JSON.parse(String(rows.rows[0]!["winner_loadout"]))).toEqual({ weapon: "sword" });
    expect(rows.rows[0]!["loser_loadout"]).toBeNull();
  });
});

describe("bot subjects (recordRankedMatch with botRating)", () => {
  const bot = (id: string, botRating = RATING_START, loadout?: unknown) => ({
    subjectId: `bot:${id}`,
    botRating,
    ...(loadout === undefined ? {} : { loadout }),
  });
  const botMatch = (matchId: string, humanWon: boolean, botRating = RATING_START) => ({
    matchId,
    season: 1,
    bracket: "1v1",
    winners: humanWon ? [{ subjectId: alice }] : [bot("0000-test", botRating)],
    losers: humanWon ? [bot("0000-test", botRating)] : [{ subjectId: alice }],
  });

  test("settles the human exactly like an even human match", async () => {
    const result = await recordRankedMatch(db, botMatch("m1", true));
    expect(result).not.toBeNull();
    expect(result!.winners[0]!.subjectId).toBe(alice);
    expect(result!.winners[0]!.after).toBe(1512); // placement K=24, even ratings
    expect(result!.winners[0]!.matchesPlayed).toBe(1);
    expect(result!.winners[0]!.glory).toBe(23);
    expect(await gloryBalance(db, alice)).toBe(23);
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(1512);
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([true]);
  });

  test("a human loss settles the other way", async () => {
    const result = await recordRankedMatch(db, botMatch("m1", false));
    expect(result!.losers[0]!.subjectId).toBe(alice);
    expect(result!.losers[0]!.after).toBe(1488);
    expect(result!.losers[0]!.glory).toBe(5);
    expect(result!.winners[0]!.subjectId).toBe("bot:0000-test");
    expect(await gloryBalance(db, alice)).toBe(5);
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([false]);
  });

  test("the fabricated bot side is settled-K and never in placements", async () => {
    const result = await recordRankedMatch(db, botMatch("m1", true, 1512));
    const botSide = result!.losers[0]!;
    expect(botSide.subjectId).toBe("bot:0000-test");
    expect(botSide.before).toBe(1512);
    expect(botSide.matchesPlayed).toBe(20); // > PLACEMENT_MATCHES → placement: null upstream
    expect(botSide.after).toBeLessThan(1512); // settled K=15 loss
    expect(botSide.before - botSide.after).toBeLessThanOrEqual(15);
    expect(botSide.peak).toBe(1512);
  });

  test("bots never touch ranked_ratings or glory_ledger", async () => {
    await recordRankedMatch(db, botMatch("m1", true));
    await recordRankedMatch(db, botMatch("m2", false));
    const ratings = await db.execute("SELECT subject_id FROM ranked_ratings");
    expect(ratings.rows.map((r) => String(r["subject_id"]))).toEqual([alice]);
    const glory = await db.execute("SELECT player_id FROM glory_ledger");
    expect(glory.rows.map((r) => String(r["player_id"]))).toEqual([alice, alice]);
    const top = await leaderboard(db, 1, "1v1");
    expect(top.map((e) => e.subjectId)).toEqual([alice]);
  });

  test("a replayed match id is a no-op", async () => {
    expect(await recordRankedMatch(db, botMatch("m1", true))).not.toBeNull();
    expect(await recordRankedMatch(db, botMatch("m1", true))).toBeNull();
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(1512);
    expect(await gloryBalance(db, alice)).toBe(23);
  });

  test("the history row carries the bot id and both loadouts", async () => {
    await recordRankedMatch(db, {
      matchId: "m1",
      season: 1,
      bracket: "1v1",
      winners: [{ subjectId: alice, loadout: { weapon: "sword" } }],
      losers: [bot("0000-test", RATING_START, { weapon: "bow" })],
    });
    const rows = await db.execute("SELECT winner_id, loser_id, winner_loadout, loser_loadout FROM ranked_matches");
    expect(String(rows.rows[0]!["winner_id"])).toBe(alice);
    expect(String(rows.rows[0]!["loser_id"])).toBe("bot:0000-test");
    expect(JSON.parse(String(rows.rows[0]!["winner_loadout"]))).toEqual({ weapon: "sword" });
    expect(JSON.parse(String(rows.rows[0]!["loser_loadout"]))).toEqual({ weapon: "bow" });
  });

  test("a mixed 2v2: bot ratings weigh into the means, humans settle, bots stay off the ladder", async () => {
    // Alice (1500) + a 1600 bot partner vs a 1500 bot + Bob (1500): means
    // 1550 vs 1500 — Alice's win settles against 1500 (even, +12 at
    // placement K), Bob's loss against 1550 (underdog — sheds less than 12).
    const result = await recordRankedMatch(db, {
      matchId: "m1",
      season: 1,
      bracket: "2v2",
      winners: [{ subjectId: alice }, bot("partner", 1600)],
      losers: [bot("enemy", 1500), { subjectId: bob }],
    });
    expect(result!.winners).toHaveLength(2);
    expect(result!.losers).toHaveLength(2);
    expect(result!.winners[0]!.after).toBe(1512);
    expect(result!.losers[1]!.after).toBeGreaterThan(1488); // vs 1550, not even
    expect(result!.losers[1]!.after).toBeLessThan(1500);
    // Humans only, both tables; all four in the history rows.
    const ratings = await db.execute("SELECT subject_id FROM ranked_ratings ORDER BY subject_id");
    expect(ratings.rows.map((r) => String(r["subject_id"])).sort()).toEqual([alice, bob].sort());
    const glory = await db.execute("SELECT player_id FROM glory_ledger");
    expect(glory.rows.map((r) => String(r["player_id"])).sort()).toEqual([alice, bob].sort());
    const players = await db.execute("SELECT subject_id FROM ranked_match_players");
    expect(players.rows).toHaveLength(4);
  });
});

describe("season peak", () => {
  test("the peak rises with the rating and survives the fall", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] });
    const climbed = await getRating(db, alice, 1, "1v1");
    expect(climbed.rating).toBe(1512);
    expect(climbed.peak).toBe(1512);
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winners: [{ subjectId: bob }], losers: [{ subjectId: alice }] });
    const dipped = await getRating(db, alice, 1, "1v1");
    expect(dipped.rating).toBeLessThan(1512);
    expect(dipped.peak).toBe(1512); // monotonic — the whole point
    expect((await rankedSummary(db, alice, 1))[0]!.peak).toBe(1512);
  });

  test("the settle result flags a new best (and only a new best)", async () => {
    const first = await recordRankedMatch(db, {
      matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }],
    });
    expect(first!.winners[0]!.newBest).toBe(true);
    expect(first!.winners[0]!.peak).toBe(1512);
    expect(first!.losers[0]!.newBest).toBe(false);
    expect(first!.losers[0]!.peak).toBe(1500); // the start rating is the initial peak
    // Alice loses back to 1500-ish, then wins again without passing 1512.
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winners: [{ subjectId: bob }], losers: [{ subjectId: alice }] });
    const third = await recordRankedMatch(db, {
      matchId: "m3", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }],
    });
    expect(third!.winners[0]!.after).toBeLessThanOrEqual(1512);
    expect(third!.winners[0]!.newBest).toBe(false);
  });
});

describe("recent form", () => {
  test("reads oldest → newest, capped, from either side of the matches", async () => {
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] });
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winners: [{ subjectId: bob }], losers: [{ subjectId: alice }] });
    await recordRankedMatch(db, { matchId: "m3", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] });
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([true, false, true]);
    expect(await recentForm(db, bob, 1, "1v1")).toEqual([false, true, false]);
    expect(await recentForm(db, alice, 1, "1v1", 2)).toEqual([false, true]); // the LAST two
    expect(await recentForm(db, alice, 2, "1v1")).toEqual([]); // other season
  });
});

describe("leaderboard", () => {
  test("orders by rating within a season+bracket", async () => {
    const carol = (await registerPlayer(db)).playerId;
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: bob }] });
    await recordRankedMatch(db, { matchId: "m2", season: 1, bracket: "1v1", winners: [{ subjectId: alice }], losers: [{ subjectId: carol }] });
    const top = await leaderboard(db, 1, "1v1");
    expect(top.map((e) => e.subjectId)[0]).toBe(alice);
    expect(top).toHaveLength(3);
    expect(top[0]!.rating).toBeGreaterThan(top[1]!.rating);
  });
});

describe("team brackets (2v2)", () => {
  let carol: string;
  let dave: string;
  beforeEach(async () => {
    carol = (await registerPlayer(db)).playerId;
    dave = (await registerPlayer(db)).playerId;
  });

  const seed = async (subjectId: string, rating: number, wins = 10, losses = 10): Promise<void> => {
    await db.execute({
      sql: `INSERT INTO ranked_ratings (subject_id, season, bracket, rating, wins, losses, peak_rating, updated_at)
            VALUES (?, 1, '2v2', ?, ?, ?, ?, 0)`,
      args: [subjectId, rating, wins, losses, rating],
    });
  };

  test("every member rates against the ENEMY MEAN with their own K", async () => {
    // Winners 1600 + 1400 (mean 1500) beat losers 1500 + 1500 (mean 1500):
    // an even fight by team mean, but each winner's own E differs.
    await seed(alice, 1600);
    await seed(bob, 1400);
    await seed(carol, 1500);
    await seed(dave, 1500);
    const result = await recordRankedMatch(db, {
      matchId: "t1",
      season: 1,
      bracket: "2v2",
      winners: [{ subjectId: alice }, { subjectId: bob }],
      losers: [{ subjectId: carol }, { subjectId: dave }],
    });
    expect(result).not.toBeNull();
    const [a, b] = result!.winners;
    const [c, d] = result!.losers;
    // Settled K=15. Alice (1600 vs mean 1500, E≈0.64) gains ~5; Bob (1400
    // vs 1500, E≈0.36) gains ~10 — the underdog member earns more.
    expect(a!.delta).toBe(5);
    expect(b!.delta).toBe(10);
    // Both losers sat at the winners' mean: even loss, −7 each (half rounds up).
    expect(c!.delta).toBe(-7);
    expect(d!.delta).toBe(-7);
    expect(a!.matchesPlayed).toBe(21);
    // The ladder rows moved per member.
    expect((await getRating(db, alice, 1, "2v2")).rating).toBe(1605);
    expect((await getRating(db, bob, 1, "2v2")).rating).toBe(1410);
    expect((await getRating(db, carol, 1, "2v2")).losses).toBe(11);
    // The 1v1 ladder is untouched — brackets are independent.
    expect((await getRating(db, alice, 1, "1v1")).rating).toBe(RATING_START);
  });

  test("Glory is paid in FULL to every member — never split", async () => {
    const result = await recordRankedMatch(db, {
      matchId: "t1",
      season: 1,
      bracket: "2v2",
      winners: [{ subjectId: alice }, { subjectId: bob }],
      losers: [{ subjectId: carol }, { subjectId: dave }],
    });
    // Even means → the even-fight payout, 23 each; losers 5 each.
    for (const w of result!.winners) expect(w.glory).toBe(23);
    for (const l of result!.losers) expect(l.glory).toBe(5);
    expect(await gloryBalance(db, alice)).toBe(23);
    expect(await gloryBalance(db, bob)).toBe(23);
    expect(await gloryBalance(db, carol)).toBe(5);
    expect(await gloryBalance(db, dave)).toBe(5);
  });

  test("the header row holds comma-joined ids, team means, and loadout arrays; players table holds each member", async () => {
    await seed(alice, 1600);
    await seed(bob, 1400);
    await recordRankedMatch(db, {
      matchId: "t1",
      season: 1,
      bracket: "2v2",
      winners: [{ subjectId: alice, loadout: { weapon: "sword" } }, { subjectId: bob }],
      losers: [{ subjectId: carol, loadout: { weapon: "bow" } }, { subjectId: dave, loadout: { weapon: "axe" } }],
    });
    const header = (await db.execute("SELECT * FROM ranked_matches")).rows[0]!;
    expect(String(header["winner_id"])).toBe(`${alice},${bob}`);
    expect(String(header["loser_id"])).toBe(`${carol},${dave}`);
    expect(Number(header["winner_rating_before"])).toBe(1500); // mean of 1600 + 1400
    expect(Number(header["loser_rating_before"])).toBe(1500);
    expect(JSON.parse(String(header["winner_loadout"]))).toEqual([{ weapon: "sword" }, null]);
    expect(JSON.parse(String(header["loser_loadout"]))).toEqual([{ weapon: "bow" }, { weapon: "axe" }]);

    const players = (await db.execute("SELECT * FROM ranked_match_players ORDER BY team, subject_id")).rows;
    expect(players).toHaveLength(4);
    const mine = players.find((r) => String(r["subject_id"]) === alice)!;
    expect(Number(mine["team"])).toBe(1);
    expect(Number(mine["won"])).toBe(1);
    expect(Number(mine["rating_before"])).toBe(1600);
    expect(JSON.parse(String(mine["loadout"]))).toEqual({ weapon: "sword" });
    const theirs = players.find((r) => String(r["subject_id"]) === dave)!;
    expect(Number(theirs["team"])).toBe(2);
    expect(Number(theirs["won"])).toBe(0);
  });

  test("recent form reads per member across team matches", async () => {
    const sides = (w: string[], l: string[]) => ({
      winners: w.map((subjectId) => ({ subjectId })),
      losers: l.map((subjectId) => ({ subjectId })),
    });
    await recordRankedMatch(db, { matchId: "t1", season: 1, bracket: "2v2", ...sides([alice, bob], [carol, dave]) });
    await recordRankedMatch(db, { matchId: "t2", season: 1, bracket: "2v2", ...sides([carol, alice], [bob, dave]) });
    expect(await recentForm(db, alice, 1, "2v2")).toEqual([true, true]);
    expect(await recentForm(db, bob, 1, "2v2")).toEqual([true, false]);
    expect(await recentForm(db, dave, 1, "2v2")).toEqual([false, false]);
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([]);
  });

  test("malformed sides are refused before anything is written", async () => {
    await expect(
      recordRankedMatch(db, { matchId: "t1", season: 1, bracket: "2v2", winners: [{ subjectId: alice }], losers: [] }),
    ).rejects.toThrow("malformed sides");
    expect((await db.execute("SELECT 1 FROM ranked_matches")).rows).toHaveLength(0);
  });

  test("a replayed team match id is a no-op", async () => {
    const input = {
      matchId: "t1",
      season: 1,
      bracket: "2v2",
      winners: [{ subjectId: alice }, { subjectId: bob }],
      losers: [{ subjectId: carol }, { subjectId: dave }],
    };
    expect(await recordRankedMatch(db, input)).not.toBeNull();
    expect(await recordRankedMatch(db, input)).toBeNull();
    expect(await gloryBalance(db, alice)).toBe(23);
    expect((await db.execute("SELECT 1 FROM ranked_match_players")).rows).toHaveLength(4);
  });
});

describe("ranked_match_players backfill", () => {
  test("pre-table 1v1 history rows gain participant rows on schema apply, idempotently", async () => {
    // A history row written the old way — no participant rows.
    await db.execute({
      sql: `INSERT INTO ranked_matches (id, season, bracket, winner_id, loser_id,
              winner_rating_before, winner_rating_after, loser_rating_before, loser_rating_after,
              winner_loadout, loser_loadout)
            VALUES ('old1', 1, '1v1', ?, ?, 1500, 1512, 1500, 1488, '{"weapon":"sword"}', NULL)`,
      args: [alice, bob],
    });
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([]);
    await ensureSchema(db); // the next boot
    expect(await recentForm(db, alice, 1, "1v1")).toEqual([true]);
    expect(await recentForm(db, bob, 1, "1v1")).toEqual([false]);
    const rows = (await db.execute("SELECT * FROM ranked_match_players ORDER BY team")).rows;
    expect(rows).toHaveLength(2);
    expect(JSON.parse(String(rows[0]!["loadout"]))).toEqual({ weapon: "sword" });
    expect(rows[1]!["loadout"]).toBeNull();
    await ensureSchema(db); // and again — still two rows
    expect((await db.execute("SELECT 1 FROM ranked_match_players")).rows).toHaveLength(2);
  });
});
