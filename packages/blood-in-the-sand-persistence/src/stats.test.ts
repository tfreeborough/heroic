/**
 * The studio console's reads (hq.md): seeded through the real writers
 * where one exists, raw rows where the writer is the game server's own
 * (match_log via recordMatchLog). The clock is pinned so "today" is stable.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { recordGlory } from "./glory";
import { recordSignet } from "./signets";
import { recordMatchLog } from "./matches";
import { registerPlayer, touchPlayerSeen } from "./players";
import { recordRankedMatch } from "./ranked";
import {
  activePlayersByDay,
  dayKey,
  dayKeys,
  deedCounts,
  economyOverview,
  entitlementCounts,
  feedbackOverview,
  iapByDay,
  ladderTop,
  ledgerBySource,
  loadoutStats,
  matchOverview,
  matchesByDay,
  newPlayersByDay,
  playerOverview,
  rankedOverview,
  ratingSpread,
} from "./stats";

let db: Db;
const NOW = 1_800_000_000; // a fixed UTC instant

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
});

describe("day keys", () => {
  test("dayKeys ends today, oldest first, zero-filled length", () => {
    const keys = dayKeys(3, NOW);
    expect(keys).toHaveLength(3);
    expect(keys[2]).toBe(dayKey(NOW));
    expect(keys[0]).toBe(dayKey(NOW - 2 * 86_400));
  });
});

describe("players", () => {
  test("overview counts totals, linked, new and active windows", async () => {
    const a = (await registerPlayer(db)).playerId;
    const b = (await registerPlayer(db)).playerId;
    await db.execute({ sql: "UPDATE players SET clerk_user_id = 'user_x' WHERE id = ?", args: [a] });
    // b registered 10 days ago and was last seen 3 days ago; a is fresh and seen now.
    await db.execute({ sql: "UPDATE players SET created_at = ?, last_seen_at = ? WHERE id = ?", args: [NOW - 10 * 86_400, NOW - 3 * 86_400, b] });
    await db.execute({ sql: "UPDATE players SET created_at = ?, last_seen_at = ? WHERE id = ?", args: [NOW - 3600, NOW - 60, a] });
    const o = await playerOverview(db, NOW);
    expect(o).toMatchObject({ total: 2, linked: 1, newDay: 1, newWeek: 1, activeDay: 1, activeWeek: 2, activeMonth: 2, devices: 2 });
  });

  test("touchPlayerSeen stamps once and throttles repeats", async () => {
    const id = (await registerPlayer(db)).playerId;
    await touchPlayerSeen(db, id);
    const first = Number((await db.execute({ sql: "SELECT last_seen_at FROM players WHERE id = ?", args: [id] })).rows[0]!["last_seen_at"]);
    expect(first).toBeGreaterThan(0);
    // Pretend the stamp is 5 minutes old — inside the throttle, no write.
    await db.execute({ sql: "UPDATE players SET last_seen_at = ? WHERE id = ?", args: [first - 300, id] });
    await touchPlayerSeen(db, id);
    const second = Number((await db.execute({ sql: "SELECT last_seen_at FROM players WHERE id = ?", args: [id] })).rows[0]!["last_seen_at"]);
    expect(second).toBe(first - 300);
    // 11 minutes old — refreshed.
    await db.execute({ sql: "UPDATE players SET last_seen_at = ? WHERE id = ?", args: [first - 660, id] });
    await touchPlayerSeen(db, id);
    const third = Number((await db.execute({ sql: "SELECT last_seen_at FROM players WHERE id = ?", args: [id] })).rows[0]!["last_seen_at"]);
    expect(third).toBeGreaterThanOrEqual(first);
  });

  test("per-day series are zero-filled across the window", async () => {
    const a = (await registerPlayer(db)).playerId;
    await db.execute({ sql: "UPDATE players SET created_at = ?, last_seen_at = ? WHERE id = ?", args: [NOW - 86_400, NOW, a] });
    const fresh = await newPlayersByDay(db, 3, NOW);
    expect(fresh.map((d) => d.count)).toEqual([0, 1, 0]);
    const active = await activePlayersByDay(db, 3, NOW);
    expect(active.map((d) => d.count)).toEqual([0, 0, 1]);
  });
});

describe("matches", () => {
  test("matchesByDay reads ranked from ranked_matches and the rest from the log", async () => {
    const w = (await registerPlayer(db)).playerId;
    const l = (await registerPlayer(db)).playerId;
    await recordRankedMatch(db, { matchId: "m1", season: 1, bracket: "1v1", winners: [{ subjectId: w }], losers: [{ subjectId: l }] });
    await db.execute("UPDATE ranked_matches SET created_at = " + NOW);
    await recordMatchLog(db, { matchId: "m1", mode: "ranked", bracket: "1v1", teamSize: 1, teamCount: 2, humans: 2, bots: 0, rounds: 3, durationS: 120 });
    await recordMatchLog(db, { matchId: "s1", mode: "skirmish", teamSize: 2, teamCount: 2, humans: 3, bots: 1, rounds: 2, durationS: 90.4 });
    await recordMatchLog(db, { matchId: "b1", mode: "brawl", teamSize: 1, teamCount: 6, humans: 6, bots: 0, rounds: 2, durationS: null });
    await recordMatchLog(db, { matchId: "b1", mode: "brawl", teamSize: 1, teamCount: 6, humans: 6, bots: 0, rounds: 2 }); // retry = no-op
    await db.execute("UPDATE match_log SET created_at = " + NOW);
    const days = await matchesByDay(db, 2, NOW);
    expect(days[1]).toEqual({ day: dayKey(NOW), ranked: 1, skirmish: 1, brawl: 1 });
    expect(days[0]).toEqual({ day: dayKey(NOW - 86_400), ranked: 0, skirmish: 0, brawl: 0 });
    const o = await matchOverview(db, NOW + 10);
    expect(o).toMatchObject({ rankedDay: 1, rankedWeek: 1, casualDay: 2, casualWeek: 2, avgDurationS: 105 });
    expect(o.botShareWeek).toBeCloseTo(1 / 3);
  });
});

describe("ranked", () => {
  const seed = async () => {
    const a = (await registerPlayer(db)).playerId;
    const b = (await registerPlayer(db)).playerId;
    const load = (weapon: string, ...abilities: string[]) => ({ weapon, abilities });
    await recordRankedMatch(db, {
      matchId: "r1", season: 1, bracket: "1v1",
      winners: [{ subjectId: a, loadout: load("bow", "dash"), rttMs: 40 }],
      losers: [{ subjectId: b, loadout: load("hammer", "dash", "heal"), rttMs: 80 }],
    });
    await recordRankedMatch(db, {
      matchId: "r2", season: 1, bracket: "1v1",
      winners: [{ subjectId: a, loadout: load("bow", "heal"), rttMs: 50 }],
      losers: [{ subjectId: "bot:1", loadout: load("hammer"), botRating: 1500 }],
    });
    return { a, b };
  };

  test("overview separates human-only matches and medians human rtt", async () => {
    await seed();
    const [row] = await rankedOverview(db, 1);
    expect(row).toMatchObject({ bracket: "1v1", matches: 2, humanOnly: 1, players: 2, rttMedianMs: 50, rttSamples: 3 });
  });

  test("ladder and spread never list bots", async () => {
    const { a } = await seed();
    const top = await ladderTop(db, 1, "1v1");
    expect(top[0]!.subjectId).toBe(a);
    expect(top.some((r) => r.subjectId.startsWith("bot:"))).toBe(false);
    const spread = await ratingSpread(db, 1, "1v1");
    expect(spread.reduce((n, b) => n + b.count, 0)).toBe(2);
    expect(spread.every((b) => b.floor % 100 === 0)).toBe(true);
  });

  test("loadout pick and win rates come from the loadout JSON, humans only", async () => {
    await seed();
    const s = await loadoutStats(db, 1, "1v1");
    expect(s.seats).toBe(3);
    const bow = s.weapons.find((w) => w.id === "bow")!;
    expect(bow).toMatchObject({ picks: 2, wins: 2, winRate: 1 });
    expect(bow.pickRate).toBeCloseTo(2 / 3);
    const dash = s.abilities.find((x) => x.id === "dash")!;
    expect(dash).toMatchObject({ picks: 2, wins: 1 });
    expect(s.weapons.some((w) => w.id === "hammer" && w.picks === 1)).toBe(true); // the bot's hammer excluded
    const all = await loadoutStats(db, 1, null);
    expect(all.seats).toBe(3);
  });
});

describe("economy", () => {
  test("overview, sources, iap days and entitlements", async () => {
    const p = (await registerPlayer(db)).playerId;
    await recordGlory(db, { playerId: p, amount: 100, source: "match:x", idempotencyKey: "g1" });
    await recordGlory(db, { playerId: p, amount: -30, source: "store:exchange:1", idempotencyKey: "g2" });
    await recordSignet(db, { playerId: p, amount: 3, source: "iap:ios:signet_pack_3", idempotencyKey: "s1" });
    await recordSignet(db, { playerId: p, amount: -1, source: "store:unlock:weapon:fang", idempotencyKey: "s2" });
    await db.execute({ sql: "INSERT INTO entitlements (player_id, item_id, source) VALUES (?, 'weapon:fang', 'purchase:signet')", args: [p] });
    await db.execute("UPDATE glory_ledger SET created_at = " + NOW);
    await db.execute("UPDATE signet_ledger SET created_at = " + NOW);
    const o = await economyOverview(db, NOW + 1);
    expect(o).toMatchObject({ gloryMinted: 100, gloryBurned: 30, gloryHeld: 70, signetsMinted: 3, signetsBurned: 1, signetsHeld: 2, iapTotal: 1, iapDay: 1, iapWeek: 1, unlocks: 1 });
    const glory = await ledgerBySource(db, "glory", 7, NOW);
    expect(glory).toEqual([
      { source: "match", entries: 1, amount: 100 },
      { source: "store", entries: 1, amount: -30 },
    ]);
    const iap = await iapByDay(db, 2, NOW);
    expect(iap[1]!.bySource).toEqual({ "iap:ios:signet_pack_3": 1 });
    expect(iap[0]!.bySource).toEqual({});
    expect(await entitlementCounts(db)).toEqual([{ itemId: "weapon:fang", source: "purchase", count: 1 }]);
  });
});

describe("deeds and feedback", () => {
  test("deed counts and feedback overview", async () => {
    const p = (await registerPlayer(db)).playerId;
    const q = (await registerPlayer(db)).playerId;
    await db.execute({ sql: "INSERT INTO achievement_unlocks (player_id, achievement_id) VALUES (?, 'first_blood'), (?, 'first_blood'), (?, 'lights_out')", args: [p, q, p] });
    expect(await deedCounts(db)).toEqual([
      { achievementId: "first_blood", unlocks: 2 },
      { achievementId: "lights_out", unlocks: 1 },
    ]);
    await db.execute({ sql: "INSERT INTO feedback (player_id, kind, message, created_at) VALUES (?, 'bug', 'x', ?), (?, 'idea', 'y', ?)", args: [p, NOW, q, NOW - 10 * 86_400] });
    const f = await feedbackOverview(db, NOW + 1);
    expect(f).toEqual({ total: 2, week: 1, byKind: { bug: 1, idea: 1 } });
  });
});
