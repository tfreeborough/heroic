/**
 * The player window's reads and HQ's writes (hq-v2.md), seeded through the
 * real writers. The clock is pinned so "today" and the cohort windows are
 * stable; rows get their created_at rewritten where the writer stamps now.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { recordFeedback, listFeedback } from "./feedback";
import { recordGlory } from "./glory";
import { recordMatchLog } from "./matches";
import { registerPlayer, stampPlayerName, touchPlayerSeen } from "./players";
import { recordRankedMatch } from "./ranked";
import { creditIapSignets, exchangeGloryForSignet, unlockWithSignet } from "./store";
import {
  activityFeed,
  hqGrant,
  namesOf,
  playerCard,
  playerCodes,
  playerDays,
  playerMatches,
  playerWallet,
  playersTable,
  setPlayerNote,
  stalePlayers,
  deleteStalePlayers,
} from "./profile";
import { funnel, playerDaysSince, pulseByDay, quietPaidPlayers, retentionCohorts, rttSummary, dayKey } from "./stats";
import { mintCodes, redeemCode } from "./codes";
import { applyMatchAchievements } from "./achievements";

let db: Db;
const NOW = 1_800_000_000;
const DAY = 86_400;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
});

const two = async () => ({ a: (await registerPlayer(db)).playerId, b: (await registerPlayer(db)).playerId });

describe("match log seats", () => {
  test("records human seats once, bots never, and a retry is a no-op", async () => {
    const { a, b } = await two();
    const input = {
      matchId: "s1",
      mode: "skirmish" as const,
      teamSize: 1,
      teamCount: 2,
      humans: 2,
      bots: 0,
      rounds: 3,
      durationS: 100,
      arena: "desert-1",
      winnerTeam: 1,
      players: [
        { playerId: a, team: 1, won: true, weapon: "bow", abilities: ["dash"], kills: 3, deaths: 1, damageDealt: 240.6, damageTaken: 90, rttMs: 42.4 },
        { playerId: b, team: 2, won: false, weapon: "hammer", abilities: [], kills: 1, deaths: 3 },
      ],
    };
    await recordMatchLog(db, input);
    await recordMatchLog(db, input);
    const seats = await db.execute("SELECT * FROM match_players ORDER BY team");
    expect(seats.rows).toHaveLength(2);
    expect(seats.rows[0]).toMatchObject({ player_id: a, won: 1, weapon: "bow", abilities: '["dash"]', kills: 3, damage_dealt: 241, rtt_ms: 42 });
    expect(seats.rows[1]).toMatchObject({ player_id: b, won: 0, kills: 1, deaths: 3, rtt_ms: null });
    const head = await db.execute("SELECT arena, winner_team FROM match_log");
    expect(head.rows[0]).toMatchObject({ arena: "desert-1", winner_team: 1 });
  });
});

describe("seen days and names", () => {
  test("touchPlayerSeen writes one day row per day", async () => {
    const { a } = await two();
    await touchPlayerSeen(db, a);
    await touchPlayerSeen(db, a); // throttled: no second UPDATE, no second INSERT attempt
    const days = await playerDays(db, a);
    expect(days).toEqual([dayKey(Math.floor(Date.now() / 1000))]);
    expect(await playerDaysSince(db)).toBe(days[0]!);
  });

  test("stampPlayerName keeps the latest non-empty name", async () => {
    const { a, b } = await two();
    await stampPlayerName(db, a, "  Brutus ");
    await stampPlayerName(db, a, "");
    await stampPlayerName(db, b, "Livia");
    await stampPlayerName(db, b, "Livia the Red");
    const names = await namesOf(db, [a, b, "bot:x", "nobody"]);
    expect(names.get(a)).toBe("Brutus");
    expect(names.get(b)).toBe("Livia the Red");
    expect(names.size).toBe(2);
  });
});

describe("the player card", () => {
  test("joins identity, balances, counts and the last feedback stamps", async () => {
    const { a } = await two();
    await stampPlayerName(db, a, "Brutus");
    await recordGlory(db, { playerId: a, amount: 50, source: "ranked:m", idempotencyKey: "k1" });
    await creditIapSignets(db, { playerId: a, signets: 3, platform: "apple", transactionId: "t1", productId: "signet_pack_3" });
    await recordFeedback(db, { playerId: a, kind: "bug", message: "x", playerName: "Brutus", platform: "ios", osVersion: "19.1", appBinary: "1.4.0", appBundle: "abc" });
    await recordFeedback(db, { playerId: a, kind: "idea", message: "y", contactEmail: "b@example.com", platform: "android" });
    const card = await playerCard(db, a);
    expect(card).toMatchObject({ id: a, name: "Brutus", glory: 50, signets: 3, devices: 1, purchases: ["iap:apple:signet_pack_3"], loggedMatches: 0 });
    expect(card!.lastFeedback).toMatchObject({ email: "b@example.com", platform: "android" });
    expect(await playerCard(db, "nobody")).toBeNull();
  });
});

describe("player matches", () => {
  test("merges the log and the ranked history on match id, newest first, with the other seats", async () => {
    const { a, b } = await two();
    // r0: ranked, older than the log (history only). r1: ranked AND logged. s1: skirmish vs bots.
    await recordRankedMatch(db, { matchId: "r0", season: 1, bracket: "1v1", winners: [{ subjectId: b, rttMs: 70 }], losers: [{ subjectId: a, loadout: { weapon: "bow", abilities: ["dash"] }, rttMs: 30 }] });
    await recordRankedMatch(db, { matchId: "r1", season: 1, bracket: "1v1", winners: [{ subjectId: a, rttMs: 35 }], losers: [{ subjectId: b }] });
    await db.execute({ sql: "UPDATE ranked_matches SET created_at = ? WHERE id = 'r0'", args: [NOW - 3 * DAY] });
    await db.execute({ sql: "UPDATE ranked_matches SET created_at = ? WHERE id = 'r1'", args: [NOW - DAY] });
    await recordMatchLog(db, {
      matchId: "r1", mode: "ranked", bracket: "1v1", teamSize: 1, teamCount: 2, humans: 2, bots: 0, rounds: 3, arena: "arena-00", winnerTeam: 1,
      players: [{ playerId: a, team: 1, won: true, weapon: "trident", kills: 3 }, { playerId: b, team: 2, won: false, weapon: "bow", kills: 1 }],
    });
    await recordMatchLog(db, {
      matchId: "s1", mode: "skirmish", teamSize: 1, teamCount: 2, humans: 1, bots: 1, rounds: 2, arena: "desert-1", winnerTeam: 2,
      players: [{ playerId: a, team: 1, won: false, weapon: "hammer" }],
    });
    await db.execute({ sql: "UPDATE match_log SET created_at = ? WHERE id = 'r1'", args: [NOW - DAY] });
    await db.execute({ sql: "UPDATE match_log SET created_at = ? WHERE id = 's1'", args: [NOW] });
    const rows = await playerMatches(db, a);
    expect(rows.map((r) => r.matchId)).toEqual(["s1", "r1", "r0"]);
    expect(rows[0]).toMatchObject({ mode: "skirmish", won: false, weapon: "hammer", arena: "desert-1", bots: 1, ratingAfter: null, others: [] });
    expect(rows[1]).toMatchObject({ mode: "ranked", won: true, weapon: "trident", kills: 3, rttMs: 35 });
    expect(rows[1]!.ratingAfter).toBeGreaterThan(rows[1]!.ratingBefore!);
    expect(rows[1]!.others).toEqual([{ playerId: b, team: 2, won: false }]);
    expect(rows[2]).toMatchObject({ mode: "ranked", won: false, weapon: "bow", abilities: ["dash"], kills: null, rttMs: 30, arena: null });
    expect(rows[2]!.others).toEqual([{ playerId: b, team: 1, won: true }]);
  });
});

describe("wallet, codes, feedback", () => {
  test("the wallet strip interleaves both ledgers newest first", async () => {
    const { a } = await two();
    await recordGlory(db, { playerId: a, amount: 20, source: "ranked:m1", idempotencyKey: "g1" });
    await creditIapSignets(db, { playerId: a, signets: 1, platform: "google", transactionId: "o1", productId: "signet_pack_1" });
    await db.execute({ sql: "UPDATE glory_ledger SET created_at = ?", args: [NOW - 10] });
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ?", args: [NOW] });
    const rows = await playerWallet(db, a);
    expect(rows.map((r) => [r.ledger, r.amount])).toEqual([["signet", 1], ["glory", 20]]);
  });

  test("redemptions carry the code's face value; feedback filters by player", async () => {
    const { a, b } = await two();
    const [code] = await mintCodes(db, { kind: "tester", glory: 25, signets: 1 });
    await redeemCode(db, { playerId: a, clerkUserId: "user_a", code: code! });
    const rows = await playerCodes(db, a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tester", glory: 25, signets: 1 });
    await recordFeedback(db, { playerId: a, kind: "bug", message: "mine" });
    await recordFeedback(db, { playerId: b, kind: "bug", message: "theirs" });
    expect((await listFeedback(db, { playerId: a })).map((f) => f.message)).toEqual(["mine"]);
    expect(await listFeedback(db)).toHaveLength(2);
  });
});

describe("the players table", () => {
  const seed = async () => {
    const { a, b } = await two();
    await stampPlayerName(db, a, "Brutus");
    await db.execute({ sql: "UPDATE players SET created_at = ?, last_seen_at = ? WHERE id = ?", args: [NOW - 20 * DAY, NOW - 10 * DAY, a] });
    await db.execute({ sql: "UPDATE players SET created_at = ?, last_seen_at = ?, clerk_user_id = 'user_b' WHERE id = ?", args: [NOW - DAY, NOW - 60, b] });
    await creditIapSignets(db, { playerId: a, signets: 3, platform: "apple", transactionId: "t1", productId: "signet_pack_3" });
    await recordRankedMatch(db, { matchId: "r1", season: 1, bracket: "1v1", winners: [{ subjectId: b }], losers: [{ subjectId: a }] });
    await recordMatchLog(db, { matchId: "r1", mode: "ranked", bracket: "1v1", teamSize: 1, teamCount: 2, humans: 2, bots: 0, rounds: 3, players: [{ playerId: a, team: 2, won: false }, { playerId: b, team: 1, won: true }] });
    await recordMatchLog(db, { matchId: "s1", mode: "skirmish", teamSize: 1, teamCount: 2, humans: 1, bots: 1, rounds: 3, players: [{ playerId: a, team: 1, won: true }] });
    await recordFeedback(db, { playerId: b, kind: "bug", message: "x", contactEmail: "livia@example.com" });
    return { a, b };
  };

  test("counts each match once and sorts by the asked column", async () => {
    const { a, b } = await seed();
    const bySeen = await playersTable(db, {}, NOW);
    expect(bySeen.map((r) => r.id)).toEqual([b, a]);
    expect(bySeen[1]).toMatchObject({ name: "Brutus", matches: 2, purchases: 1, signets: 3, linked: false });
    expect(bySeen[0]).toMatchObject({ matches: 1, linked: true });
    expect(bySeen[0]!.rating).toBeGreaterThan(bySeen[1]!.rating!);
    const byMatches = await playersTable(db, { sort: "matches" }, NOW);
    expect(byMatches[0]!.id).toBe(a);
  });

  test("searches id prefix, name and feedback email; filters paid/linked/active/new", async () => {
    const { a, b } = await seed();
    expect((await playersTable(db, { q: a.slice(0, 6) }, NOW)).map((r) => r.id)).toEqual([a]);
    expect((await playersTable(db, { q: "brut" }, NOW)).map((r) => r.id)).toEqual([a]);
    expect((await playersTable(db, { q: "livia@" }, NOW)).map((r) => r.id)).toEqual([b]);
    expect((await playersTable(db, { filter: "paid" }, NOW)).map((r) => r.id)).toEqual([a]);
    expect((await playersTable(db, { filter: "linked" }, NOW)).map((r) => r.id)).toEqual([b]);
    expect((await playersTable(db, { filter: "active" }, NOW)).map((r) => r.id)).toEqual([b]);
    expect((await playersTable(db, { filter: "new" }, NOW)).map((r) => r.id)).toEqual([b]);
    expect((await playersTable(db, { filter: "ranked" }, NOW)).length).toBe(2);
  });
});

describe("the activity feed", () => {
  test("streams every kind newest first, pages by time, and counts a ranked match once", async () => {
    const { a, b } = await two();
    await db.execute({ sql: "UPDATE players SET created_at = ?", args: [NOW - 5 * DAY] });
    await recordRankedMatch(db, { matchId: "r0", season: 1, bracket: "1v1", winners: [{ subjectId: a }], losers: [{ subjectId: "bot:1", botRating: 1000 }] });
    await recordRankedMatch(db, { matchId: "r1", season: 1, bracket: "1v1", winners: [{ subjectId: a }], losers: [{ subjectId: b }] });
    await recordMatchLog(db, { matchId: "r1", mode: "ranked", bracket: "1v1", teamSize: 1, teamCount: 2, humans: 2, bots: 0, rounds: 3, players: [{ playerId: a, team: 1, won: true }, { playerId: b, team: 2, won: false }] });
    await db.execute({ sql: "UPDATE ranked_matches SET created_at = ?", args: [NOW - 4 * DAY] });
    await db.execute({ sql: "UPDATE match_log SET created_at = ?", args: [NOW - 3 * DAY] });
    await creditIapSignets(db, { playerId: a, signets: 3, platform: "apple", transactionId: "t1", productId: "signet_pack_3" });
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ?", args: [NOW - 2 * DAY] });
    await applyMatchAchievements(db, { matchId: "r1", playerId: a, counters: { ranked_wins: 1 }, unlocks: [{ id: "sworn-to-the-sand", glory: 10 }] });
    await db.execute({ sql: "UPDATE achievement_unlocks SET unlocked_at = ?", args: [NOW - DAY] });
    await recordGlory(db, { playerId: b, amount: 1000, source: "ranked:r1", idempotencyKey: "pay" });
    expect(await exchangeGloryForSignet(db, { playerId: b, key: "x1", price: 800 })).toBe("ok");
    expect(await unlockWithSignet(db, { playerId: b, itemId: "weapon:fang" })).toBe("ok");
    await db.execute({ sql: "UPDATE signet_ledger SET created_at = ? WHERE source = 'store:exchange'", args: [NOW - DAY - 20] });
    await db.execute({ sql: "UPDATE entitlements SET granted_at = ? WHERE source LIKE 'purchase:%'", args: [NOW - DAY - 10] });
    await recordFeedback(db, { playerId: b, kind: "idea", message: "more sand" });
    await db.execute({ sql: "UPDATE feedback SET created_at = ?", args: [NOW - 3600] });
    await hqGrant(db, { playerId: b, ledger: "glory", amount: 100, note: "sorry about the crash", key: "k1" });
    await db.execute({ sql: "UPDATE glory_ledger SET created_at = ? WHERE source LIKE 'hq:%'", args: [NOW] });

    const all = await activityFeed(db);
    expect(all.map((r) => r.kind)).toEqual(["grant", "feedback", "deed", "unlock", "exchange", "purchase", "match", "match", "joined", "joined"]);
    expect(all[3]).toMatchObject({ kind: "unlock", playerId: b, ref: "weapon:fang" });
    expect(all[4]).toMatchObject({ kind: "exchange", playerId: b, detail: "1" });
    const matches = all.filter((r) => r.kind === "match");
    expect(matches[0]).toMatchObject({ ref: "r1", players: [a, b] });
    expect(matches[0]!.detail.startsWith("ranked|1v1|2|0")).toBe(true);
    // r0 is history-only: its bot seat never appears.
    expect(matches.find((m) => m.ref === "r0")!.players).toEqual([a]);
    expect(all[0]).toMatchObject({ kind: "grant", playerId: b, ref: "hq:sorry about the crash", detail: "glory:100" });

    // A single kind that isn't first in the union still names its columns.
    for (const kind of ["deed", "match", "grant", "feedback", "code", "unlock", "exchange", "purchase"] as const) {
      const only = await activityFeed(db, { kinds: [kind] });
      expect(only.every((r) => r.kind === kind)).toBe(true);
      expect(only.length).toBeGreaterThan(kind === "code" ? -1 : 0);
    }
    const page2 = await activityFeed(db, { before: NOW - 2 * DAY, kinds: ["match", "joined"] });
    expect(page2.map((r) => r.kind)).toEqual(["match", "match", "joined", "joined"]);
  });
});

describe("HQ writes", () => {
  test("a grant needs a note and a whole non-zero amount, and lands once per key", async () => {
    const { a } = await two();
    expect(await hqGrant(db, { playerId: a, ledger: "signet", amount: 2, note: "  beta thanks  ", key: "k1" })).toBe(true);
    expect(await hqGrant(db, { playerId: a, ledger: "signet", amount: 2, note: "beta thanks", key: "k1" })).toBe(false);
    expect(await hqGrant(db, { playerId: a, ledger: "glory", amount: -30, note: "refund reversal", key: "k2" })).toBe(true);
    await expect(hqGrant(db, { playerId: a, ledger: "glory", amount: 0, note: "x", key: "k3" })).rejects.toThrow();
    await expect(hqGrant(db, { playerId: a, ledger: "glory", amount: 5, note: "   ", key: "k4" })).rejects.toThrow();
    const card = await playerCard(db, a);
    expect(card).toMatchObject({ signets: 2, glory: -30 });
    const wallet = await playerWallet(db, a);
    expect(wallet.find((w) => w.ledger === "signet")!.source).toBe("hq:beta thanks");
  });

  test("the note is free text, cleared by blank", async () => {
    const { a } = await two();
    await setPlayerNote(db, a, "  emailed 22 Oct about the crash ");
    expect((await playerCard(db, a))!.note).toBe("emailed 22 Oct about the crash");
    await setPlayerNote(db, a, "   ");
    expect((await playerCard(db, a))!.note).toBeNull();
  });
});

describe("health", () => {
  test("pulse zero-fills days and counts ranked history only when unlogged", async () => {
    const { a, b } = await two();
    await db.execute({ sql: "UPDATE players SET created_at = ?", args: [NOW - DAY] });
    await db.execute({ sql: "INSERT INTO player_days (player_id, day) VALUES (?, ?), (?, ?), (?, ?)", args: [a, dayKey(NOW), b, dayKey(NOW), a, dayKey(NOW - DAY)] });
    await recordRankedMatch(db, { matchId: "r1", season: 1, bracket: "1v1", winners: [{ subjectId: a }], losers: [{ subjectId: b }] });
    await recordRankedMatch(db, { matchId: "r2", season: 1, bracket: "1v1", winners: [{ subjectId: a }], losers: [{ subjectId: "bot:1", botRating: 1000 }] });
    await recordMatchLog(db, { matchId: "r1", mode: "ranked", bracket: "1v1", teamSize: 1, teamCount: 2, humans: 2, bots: 0, rounds: 3 });
    await recordMatchLog(db, { matchId: "s1", mode: "skirmish", teamSize: 1, teamCount: 2, humans: 1, bots: 1, rounds: 3 });
    await db.execute({ sql: "UPDATE ranked_matches SET created_at = ?", args: [NOW] });
    await db.execute({ sql: "UPDATE match_log SET created_at = ?", args: [NOW] });
    const days = await pulseByDay(db, 3, NOW);
    expect(days).toHaveLength(3);
    expect(days[2]).toMatchObject({ day: dayKey(NOW), active: 2, fresh: 0, matches: 3, humanOnly: 1, purchases: 0, feedback: 0 });
    expect(days[1]).toMatchObject({ active: 1, fresh: 2, matches: 0 });
    expect(days[0]).toMatchObject({ active: 0, fresh: 0 });
  });

  test("cohorts by registration week with eligibility per window", async () => {
    const { a, b } = await two();
    const c = (await registerPlayer(db)).playerId;
    // a: 40 days old, came back on day 1 and day 20. b: 10 days old, back on day 3. c: yesterday, nothing yet.
    await db.execute({ sql: "UPDATE players SET created_at = ? WHERE id = ?", args: [NOW - 40 * DAY, a] });
    await db.execute({ sql: "UPDATE players SET created_at = ? WHERE id = ?", args: [NOW - 10 * DAY, b] });
    await db.execute({ sql: "UPDATE players SET created_at = ? WHERE id = ?", args: [NOW - DAY, c] });
    await db.execute({
      sql: "INSERT INTO player_days (player_id, day) VALUES (?, ?), (?, ?), (?, ?)",
      args: [a, dayKey(NOW - 39 * DAY), a, dayKey(NOW - 20 * DAY), b, dayKey(NOW - 7 * DAY)],
    });
    const cohorts = await retentionCohorts(db, 8, NOW);
    expect(cohorts).toHaveLength(3);
    const ofA = cohorts.find((x) => x.size === 1 && x.d30Eligible === 1)!;
    expect(ofA).toMatchObject({ d1: 1, d1Eligible: 1, d7: 0, d7Eligible: 1, d30: 1, d30Eligible: 1 });
    const ofB = cohorts.find((x) => x.d7Eligible === 1 && x.d30Eligible === 0)!;
    expect(ofB).toMatchObject({ d1: 0, d1Eligible: 1, d7: 1 });
    const ofC = cohorts[0]!;
    expect(ofC).toMatchObject({ size: 1, d1Eligible: 0, d7Eligible: 0, d30Eligible: 0 });
  });

  test("funnel steps, quiet paid players and rtt percentiles", async () => {
    const { a, b } = await two();
    await applyMatchAchievements(db, { matchId: "m", playerId: a, counters: { ranked_matches: 6 }, unlocks: [] });
    await recordMatchLog(db, { matchId: "s1", mode: "skirmish", teamSize: 1, teamCount: 2, humans: 1, bots: 1, rounds: 1, players: [{ playerId: b, team: 1, won: true, rttMs: 120 }] });
    await recordRankedMatch(db, { matchId: "r1", season: 1, bracket: "1v1", winners: [{ subjectId: a, rttMs: 40 }], losers: [{ subjectId: "bot:1", botRating: 1000, rttMs: 1 }] });
    await creditIapSignets(db, { playerId: a, signets: 3, platform: "apple", transactionId: "t1", productId: "signet_pack_3" });
    await db.execute({ sql: "UPDATE players SET last_seen_at = ? WHERE id = ?", args: [NOW - 9 * DAY, a] });
    await db.execute({ sql: "UPDATE match_log SET created_at = ?", args: [NOW] });
    await db.execute({ sql: "UPDATE ranked_matches SET created_at = ?", args: [NOW] });
    expect(await funnel(db)).toEqual({ registered: 2, played: 2, playedFive: 1, ranked: 1, linked: 0, paid: 1 });
    const quiet = await quietPaidPlayers(db, 7, NOW);
    expect(quiet.map((q) => q.id)).toEqual([a]);
    expect(await rttSummary(db, 7, NOW)).toEqual({ samples: 2, p50: 120, p90: 120 });
  });
});

describe("tidying old test accounts", () => {
  const CUTOFF = NOW - 20 * DAY;
  const at = async (sql: string, args: (string | number)[]) => db.execute({ sql, args });

  test("lists only players quiet since the cutoff, flags the real-looking ones, and deletes just their own rows", async () => {
    const { a: old, b: active } = await two();
    const lateMatch = (await registerPlayer(db)).playerId;
    const paid = (await registerPlayer(db)).playerId;
    const fresh = (await registerPlayer(db)).playerId;
    for (const id of [old, active, lateMatch, paid]) await at("UPDATE players SET created_at = ? WHERE id = ?", [NOW - 40 * DAY, id]);
    await at("UPDATE players SET created_at = ? WHERE id = ?", [NOW - DAY, fresh]);
    await at("UPDATE players SET last_seen_at = ? WHERE id = ?", [NOW - 30 * DAY, old]);
    await at("UPDATE players SET last_seen_at = ? WHERE id = ?", [NOW - DAY, active]);
    // old played active long ago and earned some Glory; lateMatch was never "seen" but played after the cutoff.
    await recordMatchLog(db, { matchId: "early", mode: "skirmish", teamSize: 1, teamCount: 2, humans: 2, bots: 0, rounds: 1, players: [{ playerId: old, team: 1, won: true }, { playerId: active, team: 2, won: false }] });
    await recordMatchLog(db, { matchId: "late", mode: "skirmish", teamSize: 1, teamCount: 2, humans: 1, bots: 1, rounds: 1, players: [{ playerId: lateMatch, team: 1, won: true }] });
    await at("UPDATE match_log SET created_at = ? WHERE id = 'early'", [NOW - 35 * DAY]);
    await at("UPDATE match_log SET created_at = ? WHERE id = 'late'", [NOW - DAY]);
    await recordGlory(db, { playerId: old, amount: 50, source: "match:early", idempotencyKey: "g-old" });
    await recordGlory(db, { playerId: active, amount: 20, source: "match:early", idempotencyKey: "g-active" });
    await creditIapSignets(db, { playerId: paid, signets: 3, platform: "apple", transactionId: "t1", productId: "signet_pack_3" });
    await at("UPDATE glory_ledger SET created_at = ?", [NOW - 35 * DAY]);
    await at("UPDATE signet_ledger SET created_at = ?", [NOW - 35 * DAY]);
    await at("INSERT INTO skirmish_companions (player_id, other_id, with_count, against_count) VALUES (?, ?, 0, 1), (?, ?, 0, 1)", [old, active, active, old]);

    const stale = await stalePlayers(db, CUTOFF);
    expect(stale.map((r) => r.id).sort()).toEqual([old, paid].sort());
    expect(stale.find((r) => r.id === old)).toMatchObject({ matches: 1, glory: 50, protectedBy: [] });
    expect(stale.find((r) => r.id === paid)!.protectedBy).toEqual(["paid"]);

    // A table from an older schema that still points at players.
    await at("CREATE TABLE writ_ledger (id INTEGER PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), amount INTEGER NOT NULL)", []);
    await at("INSERT INTO writ_ledger (player_id, amount) VALUES (?, 1)", [old]);

    // active and lateMatch ride along in the POST but the delete re-checks the rule.
    expect(await deleteStalePlayers(db, [old, active, lateMatch], CUTOFF)).toBe(1);
    expect(await playerCard(db, old)).toBeNull();
    expect((await at("SELECT COUNT(*) AS n FROM glory_ledger WHERE player_id = ?", [old])).rows[0]!["n"]).toBe(0);
    expect((await at("SELECT COUNT(*) AS n FROM skirmish_companions", [])).rows[0]!["n"]).toBe(0);
    expect((await at("SELECT COUNT(*) AS n FROM writ_ledger", [])).rows[0]!["n"]).toBe(0);
    // Match history stays for the other side.
    expect((await at("SELECT COUNT(*) AS n FROM match_players WHERE match_id = 'early'", [])).rows[0]!["n"]).toBe(2);
    expect(await playerCard(db, active)).not.toBeNull();
    expect((await at("SELECT COUNT(*) AS n FROM glory_ledger WHERE player_id = ?", [active])).rows[0]!["n"]).toBe(1);
    expect(await deleteStalePlayers(db, [], CUTOFF)).toBe(0);
  });
});
