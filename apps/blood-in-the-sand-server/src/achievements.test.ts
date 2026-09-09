/**
 * Achievement award-pipeline tests (achievements.md § award pipeline):
 * queue → seat → synthetic match events → settle → deeds land in the DB and
 * reach each player per-socket. Same harness as ranked.test.ts — fake
 * sockets, fake server, in-memory DB, beats driven by hand.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { PROTOCOL_VERSION, type ArenaEvent, type Team } from "@heroic/blood-in-the-sand-sim";
import {
  achievementCounters,
  achievementUnlocks,
  companionsOf,
  createDb,
  ensureSchema,
  entitlementsOf,
  registerPlayer,
  type Db,
} from "@heroic/blood-in-the-sand-persistence";
import { RoomManager } from "./manager";
import { BOT_ACCEPT_MAX_MS } from "./ranked";
import type { ClientData, Socket } from "./room";

interface FakeSocket {
  ws: Socket;
  sent: { t: string; [k: string]: unknown }[];
  of(t: string): { t: string; [k: string]: unknown }[];
}

const makeSocket = (): FakeSocket => {
  const sent: { t: string; [k: string]: unknown }[] = [];
  const state = { readyState: 1 };
  const ws = {
    data: { roomCode: null, playerId: null, accountId: null, rtt: [] } satisfies ClientData,
    get readyState() {
      return state.readyState;
    },
    send: (json: string) => {
      sent.push(JSON.parse(json));
      return json.length;
    },
    subscribe: () => {},
    unsubscribe: () => {},
    close: () => {
      state.readyState = 3;
    },
  } as unknown as Socket;
  return { ws, sent, of: (t) => sent.filter((m) => m.t === t) };
};

const until = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await Bun.sleep(5);
  }
};

type Internals = { rankedBeat(): void; tendPending(now: number): void; rooms: Map<string, import("./room").Room> };
const internals = (m: RoomManager): Internals => m as unknown as Internals;

/** The v30 accept stage (bits-ranked.md § Queue roaming & match accept): a
 * beat only summons — everyone says yes before the room builds. */
const acceptAll = (manager: RoomManager, ...socks: FakeSocket[]): void => {
  for (const s of socks) say(manager, s, { t: "matchAccept" });
};
/** …and a bot match needs the bot's own (delayed) accept off the beat. */
const acceptBotMatch = (manager: RoomManager, s: FakeSocket): void => {
  say(manager, s, { t: "matchAccept" });
  internals(manager).tendPending(performance.now() + BOT_ACCEPT_MAX_MS + 1);
};

const say = (manager: RoomManager, s: FakeSocket, msg: object): void =>
  manager.message(s.ws, JSON.stringify(msg));

const queueJoin = (manager: RoomManager, s: FakeSocket, token: string, name: string): void =>
  say(manager, s, { t: "queueJoin", v: PROTOCOL_VERSION, token, playerName: name, brackets: ["1v1"] });

describe("achievement awards at settle", () => {
  let db: Db;
  let manager: RoomManager;
  let tokenA: string;
  let tokenB: string;
  let accountA: string;
  let accountB: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    await ensureSchema(db);
    const a = await registerPlayer(db);
    const b = await registerPlayer(db);
    tokenA = a.token;
    tokenB = b.token;
    accountA = a.playerId;
    accountB = b.playerId;
    manager = new RoomManager(db, { enabled: false, minWaitMs: 15_000, maxWaitMs: 25_000, ratingJitter: 50 });
    const server = {
      publish: () => 0,
    } as unknown as Server<ClientData>;
    (manager as unknown as { server: Server<ClientData> }).server = server;
  });

  /** Queue both, beat the matcher, return the room + each side's seat id. */
  const startMatch = async (a: FakeSocket, b: FakeSocket) => {
    queueJoin(manager, a, tokenA, "Alice");
    queueJoin(manager, b, tokenB, "Bob");
    await until(() => a.of("queueStatus").length > 0 && b.of("queueStatus").length > 0);
    internals(manager).rankedBeat();
    acceptAll(manager, a, b);
    const room = [...internals(manager).rooms.values()][0]!;
    return { room, seatA: a.ws.data.playerId!, seatB: b.ws.data.playerId! };
  };

  /** Synthetic match: `winner` takes one round with one lethal blow. */
  const playOut = (seatW: number, seatL: number): ArenaEvent[] => [
    { type: "roundStart", roundNumber: 1 },
    { type: "cast", playerId: seatW, ability: "dash" },
    { type: "hit", attackerId: seatW, targetId: seatL, damage: 60, crit: false, lethal: true, x: 0, y: 0 },
    { type: "death", playerId: seatL },
    { type: "roundEnd", winnerTeam: 0, wins: [0, 0], standing: [{ id: seatW, hpFrac: 1 }] },
  ];

  test("a settled match lands counters + unlocks and tells each player privately", async () => {
    const a = makeSocket();
    const b = makeSocket();
    const { room, seatA, seatB } = await startMatch(a, b);
    const winnerTeam = room.sim.state.players[seatA]!.team as Team;

    room.matchStats!.ingest(playOut(seatA, seatB));
    room.onRankedMatchEnd!(winnerTeam);
    await until(() => room.ranked!.settled);
    await until(() => a.of("deedUnlocks").length > 0);

    // Alice: first match (+ nothing else on one win — one kill ≠ five).
    const aUnlocks = a.of("deedUnlocks")[0]!["unlocks"] as string[];
    expect(aUnlocks).toContain("sworn-to-the-sand");
    expect(aUnlocks).not.toContain("killing-blows-5");
    expect(aUnlocks).not.toContain("ranked-wins-5");

    // Bob still gets his first-match deed — losers earn too.
    await until(() => b.of("deedUnlocks").length > 0);
    const bUnlocks = b.of("deedUnlocks")[0]!["unlocks"] as string[];
    expect(bUnlocks).toContain("sworn-to-the-sand");
    expect(bUnlocks).toHaveLength(1);

    // Privacy: neither socket ever saw the other's unlock list.
    expect(a.of("deedUnlocks")).toHaveLength(1);
    expect(b.of("deedUnlocks")).toHaveLength(1);

    // The DB agrees with the wire.
    const aDb = (await achievementUnlocks(db, accountA)).map((u) => u.id);
    expect(aDb.sort()).toEqual([...aUnlocks].sort());

    // The first-match deed is canWear — its name landed as a wearable-title
    // entitlement (achievements.md § titles).
    const aTitles = (await entitlementsOf(db, accountA)).map((e) => e.itemId);
    expect(aTitles).toContain("title:sworn-to-the-sand");
    const counters = await achievementCounters(db, accountA);
    expect(counters["ranked_matches"]).toBe(1);
    expect(counters["ranked_wins"]).toBe(1);
    expect(counters["killing_blows"]).toBe(1);
    expect(counters["damage_dealt"]).toBe(60);
    expect(counters["cast:dash"]).toBe(1);
    expect(counters["win_streak_current"]).toBe(1);
    // A deathless win starts the undying streak (Still Standing's counter).
    expect(counters["undying_streak_current"]).toBe(1);
    expect(counters["undying_streak_best"]).toBe(1);
    // Lifetime Glory rode the ledger into the counter set.
    expect(counters["glory_earned"]).toBeGreaterThan(0);
  });

  test("counters accumulate across matches and streaks track results", async () => {
    for (let i = 0; i < 2; i++) {
      const a = makeSocket();
      const b = makeSocket();
      const { room, seatA, seatB } = await startMatch(a, b);
      const winnerTeam = room.sim.state.players[seatA]!.team as Team;
      room.matchStats!.ingest(playOut(seatA, seatB));
      // The real path sets `ended` in logEvents as the matchEnd event goes
      // by, THEN fires the hook — mirror it, or the leave below reads as a
      // lobby dodge and lockouts poison the next iteration's queue join.
      room.ranked!.ended = true;
      room.onRankedMatchEnd!(winnerTeam);
      await until(() => room.ranked!.settled); // settled ⇒ the deeds pass ran
      // Tear the room down so the next iteration's queue starts clean.
      say(manager, a, { t: "leaveRoom" });
      say(manager, b, { t: "leaveRoom" });
    }
    const aCounters = await achievementCounters(db, accountA);
    expect(aCounters["ranked_wins"]).toBe(2);
    expect(aCounters["win_streak_current"]).toBe(2);
    expect(aCounters["win_streak_best"]).toBe(2);
    expect(aCounters["undying_streak_current"]).toBe(2);
    const bCounters = await achievementCounters(db, accountB);
    expect(bCounters["undying_streak_current"]).toBe(0);
    expect(bCounters["ranked_matches"]).toBe(2);
    expect(bCounters["loss_streak_current"]).toBe(2);
    expect(bCounters["win_streak_current"]).toBe(0);
    // First-match deeds fired once, in match one — never again.
    expect((await achievementUnlocks(db, accountA)).filter((u) => u.id === "sworn-to-the-sand")).toHaveLength(1);
  });

  test("a ranked bot match still counts for the human — bots leave no trace", async () => {
    manager = new RoomManager(db, { enabled: true, minWaitMs: 0, maxWaitMs: 0, ratingJitter: 50 });
    (manager as unknown as { server: Server<ClientData> }).server = {
      publish: () => 0,
    } as unknown as Server<ClientData>;
    const a = makeSocket();
    queueJoin(manager, a, tokenA, "Alice");
    await until(() => a.of("queueStatus").length > 0);
    // Deadline 0 → the next beat summons a bot match immediately.
    internals(manager).rankedBeat();
    acceptBotMatch(manager, a);
    await until(() => a.of("welcome").length > 0);
    const room = [...internals(manager).rooms.values()][0]!;
    const seatA = a.ws.data.playerId!;
    const seatBot = [...room.ranked!.accounts.keys()].find((id) => id !== seatA)!;
    const winnerTeam = room.sim.state.players[seatA]!.team as Team;

    room.matchStats!.ingest(playOut(seatA, seatBot));
    room.onRankedMatchEnd!(winnerTeam);
    await until(() => room.ranked!.settled);
    await until(() => a.of("deedUnlocks").length > 0);

    const unlocks = a.of("deedUnlocks")[0]!["unlocks"] as string[];
    expect(unlocks).toContain("sworn-to-the-sand");
    const counters = await achievementCounters(db, accountA);
    expect(counters["killing_blows"]).toBe(1);
    expect(counters["ranked_wins"]).toBe(1);
    // The throwaway bot subject never grew achievement rows.
    const botAccount = [...room.ranked!.accounts.values()].find((acc) => acc.bot)!;
    expect(await achievementCounters(db, botAccount.accountId)).toEqual({});
    expect(await achievementUnlocks(db, botAccount.accountId)).toEqual([]);
  });

  test("ranked verifies the worn title — owned claims stick, unowned are silently stripped", async () => {
    // Alice EARNED her title; Bob claims one he never unlocked.
    await db.execute({
      sql: "INSERT INTO entitlements (player_id, item_id, source) VALUES (?, ?, ?)",
      args: [accountA, "title:sworn-to-the-sand", "achievement:sworn-to-the-sand"],
    });
    const a = makeSocket();
    const b = makeSocket();
    say(manager, a, {
      t: "queueJoin", v: PROTOCOL_VERSION, token: tokenA, playerName: "Alice",
      brackets: ["1v1"], title: "sworn-to-the-sand",
    });
    say(manager, b, {
      t: "queueJoin", v: PROTOCOL_VERSION, token: tokenB, playerName: "Bob",
      brackets: ["1v1"], title: "ranked-wins-1000",
    });
    await until(() => a.of("queueStatus").length > 0 && b.of("queueStatus").length > 0);
    internals(manager).rankedBeat();
    acceptAll(manager, a, b);
    const room = [...internals(manager).rooms.values()][0]!;

    expect(room.sim.state.players[a.ws.data.playerId!]!.title).toBe("sworn-to-the-sand");
    expect(room.sim.state.players[b.ws.data.playerId!]!.title).toBe(""); // stripped, but Bob still got his match
    // The claim reaches the roster both sides see (roomState carries it).
    const roster = a.of("roomState").at(-1)!["players"] as { id: number; title: string }[];
    expect(roster.find((p) => p.id === a.ws.data.playerId)?.title).toBe("sworn-to-the-sand");
  });

  test("ranked gates the trident — owned picks stick, unowned are silently ignored", async () => {
    // Alice EARNED the trident; Bob just claims one.
    await db.execute({
      sql: "INSERT INTO entitlements (player_id, item_id, source) VALUES (?, ?, ?)",
      args: [accountA, "weapon:trident", "achievement:ranked-wins-5"],
    });
    const a = makeSocket();
    const b = makeSocket();
    const { room, seatA, seatB } = await startMatch(a, b);

    say(manager, a, { t: "setWeapon", weapon: "trident" });
    say(manager, b, { t: "setWeapon", weapon: "trident" });
    expect(room.sim.state.players[seatA]!.weapon).toBe("trident");
    expect(room.sim.state.players[seatB]!.weapon).toBeNull(); // ignored, seat unharmed
    // The free roster stays free — Bob picks up a hammer like anyone.
    say(manager, b, { t: "setWeapon", weapon: "hammer" });
    expect(room.sim.state.players[seatB]!.weapon).toBe("hammer");
  });
});

// ── Skirmish deeds (bits-skirmish-deeds.md, 2026-09-09) ────────────────────
describe("skirmish deed awards", () => {
  let db: Db;
  let manager: RoomManager;
  let tokenA: string;
  let tokenB: string;
  let accountA: string;
  let accountB: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    await ensureSchema(db);
    const a = await registerPlayer(db);
    const b = await registerPlayer(db);
    tokenA = a.token;
    tokenB = b.token;
    accountA = a.playerId;
    accountB = b.playerId;
    manager = new RoomManager(db, { enabled: false, minWaitMs: 15_000, maxWaitMs: 25_000, ratingJitter: 50 });
    (manager as unknown as { server: Server<ClientData> }).server = { publish: () => 0 } as unknown as Server<ClientData>;
  });

  /** Synthetic match: `winner` takes one round with one lethal blow. */
  const playOut = (seatW: number, seatL: number): ArenaEvent[] => [
    { type: "roundStart", roundNumber: 1 },
    { type: "hit", attackerId: seatW, targetId: seatL, damage: 60, crit: false, lethal: true, x: 0, y: 0 },
    { type: "death", playerId: seatL },
    { type: "roundEnd", winnerTeam: room_team(seatW), wins: [0, 0], standing: [{ id: seatW, hpFrac: 1 }] },
  ];
  // The synthetic roundEnd needs a winner team, but events are built before
  // the room exists in some helpers — resolve lazily through this slot.
  let room_team: (seat: number) => Team = () => 1;

  /** Host creates (locked), guest joins by code — both carrying bearer tokens. */
  const seatTwo = async (a: FakeSocket, b: FakeSocket, opts: { tokenB?: string | null; pass?: string } = {}) => {
    say(manager, a, { t: "createRoom", v: PROTOCOL_VERSION, playerName: "Alice", teamSize: 1, token: tokenA, ...(opts.pass ? { pass: opts.pass } : {}) });
    const room = [...internals(manager).rooms.values()][0]!;
    const joinToken = opts.tokenB === undefined ? tokenB : opts.tokenB;
    say(manager, b, {
      t: "joinRoom",
      v: PROTOCOL_VERSION,
      code: room.meta.code,
      playerName: "Bob",
      ...(opts.pass ? { pass: opts.pass } : {}),
      ...(joinToken ? { token: joinToken } : {}),
    });
    const seatA = a.ws.data.playerId!;
    const seatB = b.ws.data.playerId!;
    await until(() => room.accounts.size === (joinToken ? 2 : 1));
    return { room, seatA, seatB };
  };

  /** Drive a match without stepping the sim: begin, play, end, wait. */
  const playMatch = async (room: import("./room").Room, seatW: number, seatL: number) => {
    room_team = (seat) => room.sim.state.players[seat]!.team as Team;
    room.beginSkirmishMatch();
    room.matchStats!.ingest(playOut(seatW, seatL));
    const winnerTeam = room.sim.state.players[seatW]!.team as Team;
    const matchId = room.skirmish.matchId!;
    const indexBefore = room.skirmish.matchIndex;
    room.onSkirmishMatchEnd!(winnerTeam);
    // The room memory is written AFTER every seat's apply landed — a
    // match-specific signal (the index climbs once per contested match).
    await until(() => room.skirmish.matchIndex !== indexBefore);
    return matchId;
  };

  test("two humans, tokens on the door: Well Met for both, counters namespaced, per-socket unlock, companions written", async () => {
    const a = makeSocket();
    const b = makeSocket();
    const { room, seatA, seatB } = await seatTwo(a, b, { pass: "1234" });
    expect(room.accounts.get(seatA)).toBe(accountA);
    expect(room.accounts.get(seatB)).toBe(accountB);
    const matchId = await playMatch(room, seatA, seatB);
    await until(() => a.of("deedUnlocks").length > 0 && b.of("deedUnlocks").length > 0);

    const aDeeds = a.of("deedUnlocks")[0]!;
    expect(aDeeds.matchId).toBe(matchId);
    expect(aDeeds.unlocks).toEqual(expect.arrayContaining(["well-met", "behind-closed-doors"]));
    const bDeeds = b.of("deedUnlocks")[0]!;
    expect(bDeeds.unlocks).toContain("well-met");
    expect(bDeeds.unlocks).not.toContain("behind-closed-doors"); // the loser

    const counters = await achievementCounters(db, accountA);
    expect(counters["skirmish:matches"]).toBe(1);
    expect(counters["skirmish:companion_best"]).toBe(1);
    expect(Object.keys(counters).every((k) => k.startsWith("skirmish:"))).toBe(true); // nothing ranked moved
    expect((await achievementUnlocks(db, accountA)).map((u) => u.id)).toContain("well-met");
    expect(await companionsOf(db, accountA)).toEqual([{ otherId: accountB, withCount: 0, againstCount: 1 }]);
    // Nothing material: no Glory, no entitlements for either.
    expect(await entitlementsOf(db, accountA)).toEqual([]);
  });

  test("a seat without a token plays but earns nothing — and the other human still counts as opposition", async () => {
    const a = makeSocket();
    const b = makeSocket();
    const { room, seatA, seatB } = await seatTwo(a, b, { tokenB: null });
    expect(room.accounts.has(seatB)).toBe(false);
    await playMatch(room, seatA, seatB);
    await until(() => a.of("deedUnlocks").length > 0);
    expect(a.of("deedUnlocks")[0]!.unlocks).toContain("well-met");
    expect(b.of("deedUnlocks")).toHaveLength(0);
    expect(await achievementCounters(db, accountB)).toEqual({});
  });

  test("room memory: the rematch is a Grudge Match for the avenged loser, and the third match is One More", async () => {
    const a = makeSocket();
    const b = makeSocket();
    const { room, seatA, seatB } = await seatTwo(a, b);
    await playMatch(room, seatA, seatB); // Alice wins
    await until(() => a.of("deedUnlocks").length > 0);
    await playMatch(room, seatB, seatA); // Bob runs it back and wins
    await until(() => b.of("deedUnlocks").length >= 2);
    const bobSecond = b.of("deedUnlocks").at(-1)!;
    expect(bobSecond.unlocks).toContain("grudge-match");
    expect(a.of("deedUnlocks").flatMap((m) => m.unlocks as string[])).not.toContain("grudge-match");
    expect(room.skirmish.matchIndex).toBe(2);
    await playMatch(room, seatA, seatB);
    expect(room.skirmish.matchIndex).toBe(3);
    expect((await achievementUnlocks(db, accountA)).map((u) => u.id)).toContain("one-more");
    expect((await achievementUnlocks(db, accountB)).map((u) => u.id)).toContain("one-more");
  });
});
