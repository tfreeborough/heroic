/**
 * Ranked queue + ranked-room lifecycle tests. The matcher rules are pure and
 * tested directly; the manager flow (queueJoin → verify → match → seat →
 * settle/void) runs against fake sockets, a fake Bun server, and an
 * in-memory database — no network, no timers, beats driven by hand.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { ABILITY_IDS, LOADOUT_ABILITY_COUNT, PROTOCOL_VERSION, type Team } from "@heroic/blood-in-the-sand-sim";
import {
  createDb,
  ensureSchema,
  getRating,
  gloryBalance,
  registerPlayer,
  type Db,
} from "@heroic/blood-in-the-sand-persistence";
import { RoomManager } from "./manager";
import type { ClientData, Socket } from "./room";
import {
  ARM_DEADLINE_MS,
  RankedQueue,
  SEASON,
  canGroup,
  canPair,
  groupBracket,
  pairBracket,
  ratingWindow,
  splitTeams,
  type QueueEntry,
} from "./ranked";

// ── pure matcher rules ─────────────────────────────────────────────────────

describe("rating window", () => {
  test("starts at the base and widens every 10s", () => {
    expect(ratingWindow(0)).toBe(100);
    expect(ratingWindow(9_999)).toBe(100);
    expect(ratingWindow(10_000)).toBe(150);
    expect(ratingWindow(60_000)).toBe(400);
  });

  test("matchAnyone pairs any gap; windows gate otherwise", () => {
    const fresh = (rating: number) => ({ rating, joinedMs: 0 });
    expect(canPair(fresh(1500), fresh(2200), 0, true)).toBe(true);
    expect(canPair(fresh(1500), fresh(2200), 0, false)).toBe(false);
    expect(canPair(fresh(1500), fresh(1590), 0, false)).toBe(true);
    // 700 apart pairs once someone has waited 2 minutes (window 100+50×12=700).
    expect(canPair(fresh(1500), { rating: 2200, joinedMs: 0 }, 120_000, false)).toBe(true);
  });
});

describe("pairBracket", () => {
  const entry = (rating: number, joinedMs = 0) => ({ rating, joinedMs });

  test("pairs by rating adjacency, odd one out waits", () => {
    const { sorted, pairs } = pairBracket([entry(1800), entry(1500), entry(1520)], 0, true);
    expect(pairs).toEqual([[0, 1]]);
    expect(sorted[0]!.rating).toBe(1500);
    expect(sorted[1]!.rating).toBe(1520); // the close pair matches, 1800 waits
  });

  test("empty and singleton queues pair nobody", () => {
    expect(pairBracket([], 0, true).pairs).toEqual([]);
    expect(pairBracket([entry(1500)], 0, true).pairs).toEqual([]);
  });

  test("window mode holds far-apart players, then relents with wait", () => {
    const now = 0;
    expect(pairBracket([entry(1500), entry(2200)], now, false).pairs).toEqual([]);
    expect(pairBracket([entry(1500, -120_000), entry(2200)], now, false).pairs).toEqual([[0, 1]]);
  });
});

describe("groupBracket + splitTeams (2v2)", () => {
  const entry = (rating: number, joinedMs = 0) => ({ rating, joinedMs });

  test("takes four contiguous entries in rating order; the leftovers wait", () => {
    const { sorted, groups } = groupBracket(
      [entry(1800), entry(1500), entry(1520), entry(1400), entry(1700)],
      4,
      0,
      true,
    );
    expect(groups).toEqual([[0, 1, 2, 3]]);
    expect(sorted.map((e) => e.rating)).toEqual([1400, 1500, 1520, 1700, 1800]);
  });

  test("three queued form nothing", () => {
    expect(groupBracket([entry(1500), entry(1500), entry(1500)], 4, 0, true).groups).toEqual([]);
  });

  test("window mode gates on the group's SPREAD, relenting with the longest wait", () => {
    const wide = [entry(1400), entry(1500), entry(1600), entry(1700)]; // spread 300 > 100
    expect(canGroup(wide, 0, false)).toBe(false);
    expect(groupBracket(wide, 4, 0, false).groups).toEqual([]);
    // One member waiting 40s widens the window to 300 — the group forms.
    expect(groupBracket([entry(1400, -40_000), entry(1500), entry(1600), entry(1700)], 4, 0, false).groups).toEqual([
      [0, 1, 2, 3],
    ]);
  });

  test("splitTeams: best + worst vs the middle two", () => {
    expect(splitTeams([1400, 1500, 1520, 1700])).toEqual([
      [1400, 1700],
      [1500, 1520],
    ]);
    expect(splitTeams([1500, 1512])).toEqual([[1500], [1512]]);
  });
});

// ── fakes ──────────────────────────────────────────────────────────────────

interface FakeSocket {
  ws: Socket;
  sent: { t: string; [k: string]: unknown }[];
  /** Messages of one type, newest last. */
  of(t: string): { t: string; [k: string]: unknown }[];
}

const makeSocket = (): FakeSocket => {
  const sent: { t: string; [k: string]: unknown }[] = [];
  const state = { readyState: 1 };
  const ws = {
    data: { roomCode: null, playerId: null, accountId: null } satisfies ClientData,
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

const makeServer = () => {
  const published: { t: string; [k: string]: unknown }[] = [];
  const server = { publish: (_topic: string, json: string) => published.push(JSON.parse(json)) } as unknown as Server<ClientData>;
  return { server, published };
};

const until = async (pred: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await Bun.sleep(5);
  }
};

/** Drive the manager like the wire would. */
const say = (manager: RoomManager, s: FakeSocket, msg: object): void =>
  manager.message(s.ws, JSON.stringify(msg));

const queueJoin = (manager: RoomManager, s: FakeSocket, token: string, name: string, brackets = ["1v1"]): void =>
  say(manager, s, { t: "queueJoin", v: PROTOCOL_VERSION, token, playerName: name, brackets });

// Private-member access for hand-driving beats — tests only.
type Internals = {
  rankedBeat(): void;
  tendRankedRooms(now: number): void;
  rooms: Map<string, import("./room").Room>;
};
const internals = (m: RoomManager): Internals => m as unknown as Internals;

// ── manager flow ───────────────────────────────────────────────────────────

describe("ranked flow", () => {
  let db: Db;
  let manager: RoomManager;
  let published: { t: string }[];
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    await ensureSchema(db);
    tokenA = (await registerPlayer(db)).token;
    tokenB = (await registerPlayer(db)).token;
    // Kill switch off: this suite is about the human flow — honest queue
    // numbers, no bot deadlines. The backfill suite drives its own config.
    manager = new RoomManager(db, { enabled: false, minWaitMs: 15_000, maxWaitMs: 25_000, ratingJitter: 50 });
    const fake = makeServer();
    published = fake.published;
    (manager as unknown as { server: Server<ClientData> }).server = fake.server;
  });

  const queueBoth = async (a: FakeSocket, b: FakeSocket): Promise<void> => {
    queueJoin(manager, a, tokenA, "Alice");
    queueJoin(manager, b, tokenB, "Bob");
    await until(() => a.of("queueStatus").length > 0 && b.of("queueStatus").length > 0);
  };

  test("two queued players get matched, seated, and welcomed", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    expect(a.of("queueStatus")[0]!["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }, { bracket: "2v2", size: 0 }]);

    internals(manager).rankedBeat();
    for (const s of [a, b]) {
      expect(s.of("matchFound")).toHaveLength(1);
      expect(s.of("welcome")).toHaveLength(1);
      expect(s.ws.data.roomCode).not.toBeNull();
    }
    expect(manager.roomCount()).toBe(1);
    expect(a.ws.data.roomCode).toBe(b.ws.data.roomCode);
  });

  test("a bad token is rejected, an unknown bracket too", async () => {
    const a = makeSocket();
    say(manager, a, { t: "queueJoin", v: PROTOCOL_VERSION, token: "forged", playerName: "Mallory", brackets: ["1v1"] });
    await until(() => a.of("reject").length > 0);
    expect(a.of("reject")[0]!["reason"]).toContain("sign-in failed");

    const b = makeSocket();
    say(manager, b, { t: "queueJoin", v: PROTOCOL_VERSION, token: tokenA, playerName: "Alice", brackets: ["5v5"] });
    expect(b.of("reject")[0]!["reason"]).toBe("no such bracket");
  });

  test("ranked rooms are unlisted, unjoinable, and unwatchable from outside", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();
    const code = String(a.of("matchFound")[0]!["code"]);

    const outsider = makeSocket();
    say(manager, outsider, { t: "listRooms" });
    expect(outsider.of("rooms")[0]!["rooms"]).toEqual([]);
    // Tokenless join AND watch both collapse to the code-guesser's reject —
    // a ranked room doesn't exist to outsiders (v28: no oracle, and a
    // watcher's snapshot feed would be live wallhack intel).
    say(manager, outsider, { t: "joinRoom", v: PROTOCOL_VERSION, code, playerName: "Eve" });
    expect(outsider.of("reject")[0]!["reason"]).toBe("no such room");
    say(manager, outsider, { t: "watchRoom", code });
    expect(outsider.of("reject").at(-1)!["reason"]).toBe("no such room");
    expect(outsider.of("watching")).toHaveLength(0);
  });

  test("a mid-match rejoin needs the seat token, and resumes the seat's own identity", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    const code = room.meta.code;
    const seatId = a.ws.data.playerId!;
    const seatToken = String(a.of("welcome")[0]!["seatToken"]);

    // Alice's socket dies mid-match: the body idles, the seat stays reserved.
    room.sim.state.round.phase = "active";
    manager.close(a.ws);
    expect(room.sim.state.players[seatId]!.connected).toBe(false);

    // No token, then a forged one: both read as a guessed code (v28).
    const hijacker = makeSocket();
    say(manager, hijacker, { t: "joinRoom", v: PROTOCOL_VERSION, code, playerName: "Eve" });
    expect(hijacker.of("reject").at(-1)!["reason"]).toBe("no such room");
    say(manager, hijacker, { t: "joinRoom", v: PROTOCOL_VERSION, code, playerName: "Eve", seatToken: "forged" });
    expect(hijacker.of("reject").at(-1)!["reason"]).toBe("no such room");
    expect(hijacker.of("welcome")).toHaveLength(0);
    expect(room.sim.state.players[seatId]!.connected).toBe(false);

    // The real token reclaims the exact seat — and the rejoin's claimed
    // name/title are IGNORED: a ranked rejoin resumes the queue-verified
    // identity, never creates one (the mid-match rename/unearned-title hole).
    const back = makeSocket();
    say(manager, back, {
      t: "joinRoom", v: PROTOCOL_VERSION, code, playerName: "Imposter", title: "the-world-serpent", seatToken,
    });
    expect(back.of("welcome")).toHaveLength(1);
    expect(back.ws.data.playerId).toBe(seatId);
    expect(room.sim.state.players[seatId]!.connected).toBe(true);
    expect(room.sim.state.players[seatId]!.name).toBe("Alice");
    expect(room.sim.state.players[seatId]!.title).toBe("");
  });

  test("one live ranked seat per account: a second queueJoin waits for the settle", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;

    // A second socket on the SAME bearer token while the first match is live
    // — the parallel bot-backfill farm's entry move.
    const twin = makeSocket();
    queueJoin(manager, twin, tokenA, "Alice");
    await until(() => twin.of("reject").length > 0);
    expect(twin.of("reject")[0]!["reason"]).toBe("you're already in a live ranked match");

    // The settle frees the account — the same re-queue now lands in line.
    const winnerTeam = room.sim.state.players[a.ws.data.playerId!]!.team as Team;
    room.onRankedMatchEnd!(winnerTeam);
    await until(() => room.ranked!.settled);
    queueJoin(manager, twin, tokenA, "Alice");
    await until(() => twin.of("queueStatus").length > 0);
    expect(twin.of("queueStatus").at(-1)!["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }, { bracket: "2v2", size: 0 }]);
  });

  test("the arm deadline voids the match and locks the idlers out", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);

    // Nobody armed; blow the deadline.
    internals(manager).tendRankedRooms(performance.now() + ARM_DEADLINE_MS + 1000);
    expect(manager.roomCount()).toBe(0);
    expect(a.of("roomClosed")[0]!["reason"]).toBe("the match was called off");

    // Both were unarmed = both dodged: a re-queue bounces off the lockout.
    queueJoin(manager, a, tokenA, "Alice");
    await until(() => a.of("reject").length > 0);
    expect(a.of("reject")[0]!["reason"]).toContain("lockout");
  });

  test("a lobby leaver is the dodger; the innocent goes straight back in line", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();

    say(manager, b, { t: "leaveRoom" }); // Bob bails during arming
    internals(manager).tendRankedRooms(performance.now());
    expect(manager.roomCount()).toBe(0);

    // Alice is re-queued automatically (a fresh queueStatus followed the void)…
    say(manager, a, { t: "queueInfo" });
    const last = a.of("queueStatus").at(-1)!;
    expect(last["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }, { bracket: "2v2", size: 0 }]);
    // …and Bob is locked out.
    queueJoin(manager, b, tokenB, "Bob");
    await until(() => b.of("reject").length > 0);
    expect(b.of("reject")[0]!["reason"]).toContain("lockout");
  });

  test("matchEnd settles ratings + Glory and broadcasts rankedResult", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    const winnerTeam = room.sim.state.players[a.ws.data.playerId!]!.team as Team;

    room.onRankedMatchEnd!(winnerTeam);
    await until(() => published.some((m) => m.t === "rankedResult"));

    const result = published.find((m) => m.t === "rankedResult") as unknown as {
      results: {
        playerId: number;
        after: number;
        delta: number;
        glory: number;
        tier: string;
        placement: { number: number; of: number } | null;
      }[];
    };
    const mine = result.results.find((r) => r.playerId === a.ws.data.playerId)!;
    expect(mine.after).toBe(1512); // even placement win
    expect(mine.glory).toBe(23);
    expect(mine.tier).toBe("Gladiator");
    expect(mine.placement).toEqual({ number: 1, of: 10 }); // first placement match

    // The ledger and ladder agree.
    const accountA = a.ws.data.accountId!;
    expect(await gloryBalance(db, accountA)).toBe(23);
    expect((await getRating(db, accountA, SEASON, "1v1")).rating).toBe(1512);

    // Settled + ceremony held ⇒ the room closes on the next beat. (A ranked
    // room never returns to lobby — the room stops stepping the sim at the
    // end of matchEnd and the manager closes it; bits-ranked-bots.md.)
    room.ranked!.ended = true;
    room.ceremonyOver = true;
    await until(() => room.ranked!.settled);
    internals(manager).tendRankedRooms(performance.now());
    expect(manager.roomCount()).toBe(0);
    expect(a.of("roomClosed").at(-1)!["reason"]).toBe("match complete");
  });

  test("entering the skirmish flow leaves the queue", async () => {
    const a = makeSocket();
    queueJoin(manager, a, tokenA, "Alice");
    await until(() => a.of("queueStatus").length > 0);
    say(manager, a, { t: "createRoom", v: PROTOCOL_VERSION, playerName: "Alice" });
    say(manager, a, { t: "queueInfo" });
    expect(a.of("queueStatus").at(-1)!["brackets"]).toEqual([{ bracket: "1v1", size: 0 }, { bracket: "2v2", size: 0 }]);
  });
});

// ── ranked bot backfill (bits-ranked-bots.md) ──────────────────────────────

describe("ranked bot backfill", () => {
  let db: Db;
  let manager: RoomManager;
  let published: { t: string; [k: string]: unknown }[];
  let tokenA: string;
  let tokenB: string;

  /** Backfill on with a zero wait: the entry is overdue on the next beat.
   * Jitter 0 keeps the Elo assertions exact (bot rating = human rating). */
  const instantCfg = { enabled: true, minWaitMs: 0, maxWaitMs: 0, ratingJitter: 0 };

  const boot = async (cfg: typeof instantCfg): Promise<void> => {
    db = createDb(":memory:");
    await ensureSchema(db);
    tokenA = (await registerPlayer(db)).token;
    tokenB = (await registerPlayer(db)).token;
    manager = new RoomManager(db, cfg);
    const fake = makeServer();
    published = fake.published;
    (manager as unknown as { server: Server<ClientData> }).server = fake.server;
  };

  const queueOne = async (s: FakeSocket, token: string, name: string): Promise<void> => {
    queueJoin(manager, s, token, name);
    await until(() => s.of("queueStatus").length > 0);
  };

  /** The bot's seat id + account row in the room's ranked context. */
  const botAccountOf = (room: import("./room").Room): { seatId: number; account: { accountId: string; name: string; rating: number } } => {
    for (const [seatId, account] of room.ranked!.accounts) {
      if (account.bot) return { seatId, account };
    }
    throw new Error("no bot account in room");
  };

  test("a lone queuer draws a disguised bot once the deadline passes", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();

    expect(manager.roomCount()).toBe(1);
    expect(a.of("matchFound")).toHaveLength(1);
    expect(a.of("welcome")).toHaveLength(1);

    const room = [...internals(manager).rooms.values()][0]!;
    const bot = botAccountOf(room);
    expect(bot.account.accountId.startsWith("bot:")).toBe(true);
    expect(bot.account.rating).toBe(1500); // jitter 0 mirrors exactly
    expect(bot.account.name.length).toBeLessThanOrEqual(16);

    // The wire never carries a bot marker — scan everything the human got.
    const roster = a.of("roomState").at(-1)!["players"] as { name: string; bot: boolean }[];
    expect(roster).toHaveLength(2);
    for (const p of roster) expect(p.bot).toBe(false);
    expect(JSON.stringify(a.sent)).not.toContain('"bot":true');
  });

  test("the human pairing pass always wins the beat", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    const b = makeSocket();
    await queueOne(a, tokenA, "Alice");
    await queueOne(b, tokenB, "Bob");
    internals(manager).rankedBeat(); // both overdue AND pairable

    expect(manager.roomCount()).toBe(1);
    const room = [...internals(manager).rooms.values()][0]!;
    for (const account of room.ranked!.accounts.values()) expect(account.bot).toBeUndefined();
    expect(a.ws.data.roomCode).toBe(b.ws.data.roomCode);
  });

  test("kill switch off: no bot ever, queue numbers honest", async () => {
    await boot({ ...instantCfg, enabled: false });
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();

    expect(manager.roomCount()).toBe(0);
    expect(a.of("queueStatus").at(-1)!["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }, { bracket: "2v2", size: 0 }]);
  });

  test("before the deadline: no bot, and the displayed size is fuzzed", async () => {
    await boot({ ...instantCfg, minWaitMs: 600_000, maxWaitMs: 600_000 });
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();

    expect(manager.roomCount()).toBe(0);
    const brackets = a.of("queueStatus").at(-1)!["brackets"] as { size: number }[];
    expect(brackets[0]!.size).toBeGreaterThanOrEqual(2); // 1 real + baseline ≥ 1
  });

  test("a human win settles one-sided: real Elo + Glory, no bot rows", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    const humanTeam = room.sim.state.players[a.ws.data.playerId!]!.team as Team;

    room.onRankedMatchEnd!(humanTeam);
    await until(() => published.some((m) => m.t === "rankedResult"));
    const result = published.find((m) => m.t === "rankedResult") as unknown as {
      results: { playerId: number; after: number; delta: number; glory: number; placement: unknown }[];
    };
    const mine = result.results.find((r) => r.playerId === a.ws.data.playerId)!;
    expect(mine.after).toBe(1512); // placement K=24, even ratings
    expect(mine.glory).toBe(23);
    expect(mine.placement).toEqual({ number: 1, of: 10 });

    // The fabricated bot side: settled K, never "in placements".
    const theirs = result.results.find((r) => r.playerId !== a.ws.data.playerId)!;
    expect(theirs.placement).toBeNull();
    expect(theirs.delta).toBe(-7); // K=15 loss at even ratings (half-point rounds up)

    // The DB holds exactly one side of the story.
    const accountA = a.ws.data.accountId!;
    expect(await gloryBalance(db, accountA)).toBe(23);
    expect((await getRating(db, accountA, SEASON, "1v1")).rating).toBe(1512);
    const ratings = await db.execute("SELECT subject_id FROM ranked_ratings");
    expect(ratings.rows.map((r) => String(r["subject_id"]))).toEqual([accountA]);
    const glory = await db.execute("SELECT player_id FROM glory_ledger");
    expect(glory.rows.map((r) => String(r["player_id"]))).toEqual([accountA]);
  });

  test("a bot win settles the loss against the human", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    const humanTeam = room.sim.state.players[a.ws.data.playerId!]!.team as Team;
    const botTeam = (humanTeam === 1 ? 2 : 1) as Team;

    room.onRankedMatchEnd!(botTeam);
    await until(() => published.some((m) => m.t === "rankedResult"));
    const result = published.find((m) => m.t === "rankedResult") as unknown as {
      results: { playerId: number; after: number; glory: number }[];
    };
    const mine = result.results.find((r) => r.playerId === a.ws.data.playerId)!;
    expect(mine.after).toBe(1488);
    expect(mine.glory).toBe(5);
    expect((await getRating(db, a.ws.data.accountId!, SEASON, "1v1")).rating).toBe(1488);
  });

  test("leaving the arming lobby against a bot eats the dodge lockout", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);

    say(manager, a, { t: "leaveRoom" }); // deserts the room — only a bot remains
    expect(manager.roomCount()).toBe(0);

    queueJoin(manager, a, tokenA, "Alice");
    await until(() => a.of("reject").length > 0);
    expect(a.of("reject")[0]!["reason"]).toContain("lockout");
  });

  test("the arm deadline voids a bot match and locks out only the idle human", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);

    internals(manager).tendRankedRooms(performance.now() + ARM_DEADLINE_MS + 1000);
    expect(manager.roomCount()).toBe(0);
    expect(a.of("roomClosed").at(-1)!["reason"]).toBe("the match was called off");

    queueJoin(manager, a, tokenA, "Alice");
    await until(() => a.of("reject").length > 0);
    expect(a.of("reject")[0]!["reason"]).toContain("lockout");
  });

  test("back-to-back matches never repeat a bot name (a later re-match may)", async () => {
    await boot(instantCfg);
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = makeSocket();
      await queueOne(a, tokenA, "Alice");
      internals(manager).rankedBeat();
      const room = [...internals(manager).rooms.values()][0]!;
      names.push(botAccountOf(room).account.name);
      // Finish the match cleanly so no lockout blocks the next queue entry.
      const humanTeam = room.sim.state.players[a.ws.data.playerId!]!.team as Team;
      room.onRankedMatchEnd!(humanTeam);
      await until(() => room.ranked!.settled);
      room.ranked!.ended = true;
      room.ceremonyOver = true;
      internals(manager).tendRankedRooms(performance.now());
      expect(manager.roomCount()).toBe(0);
    }
    // The roster book promises pairwise-adjacent distinctness only — with 4
    // names online, match 3 re-meeting match 1's opponent is by design.
    expect(names[1]).not.toBe(names[0]);
    expect(names[2]).not.toBe(names[1]);
  });

  test("a requeue rolls a fresh bot deadline", async () => {
    await boot({ ...instantCfg, minWaitMs: 60_000, maxWaitMs: 60_000 });
    const requeued = (manager as unknown as { requeued(e: QueueEntry): QueueEntry }).requeued;
    const entry = { ...({} as QueueEntry), botAtMs: 5, joinedMs: 1 } as QueueEntry;
    const fresh = requeued.call(manager, entry);
    expect(fresh.joinedMs).toBe(1); // earned wait survives…
    expect(fresh.botAtMs!).toBeGreaterThanOrEqual(performance.now() + 59_000); // …the deadline doesn't
  });

  test("the ceremony hold: a ranked sim never returns to lobby, then roomClosed lands", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    const botSeatId = botAccountOf(room).seatId;

    // Fast-forward the sim to the last instant of the victory ceremony.
    room.sim.state.round.phase = "matchEnd";
    room.sim.state.round.timer = 0.001;
    room.step(10, performance.now());

    expect(room.ceremonyOver).toBe(true);
    expect(room.sim.state.round.phase).toBe("matchEnd"); // never lobby
    expect(room.sim.state.players[botSeatId]).not.toBeNull(); // the opponent never evaporates
    for (const snap of published.filter((m) => m.t === "snapshot")) {
      expect((snap["round"] as { phase: string }).phase).not.toBe("lobby");
    }

    // Settled + held ⇒ the manager closes it; roomClosed is the leave signal.
    room.ranked!.ended = true;
    room.ranked!.settled = true;
    internals(manager).tendRankedRooms(performance.now());
    expect(manager.roomCount()).toBe(0);
    expect(a.of("roomClosed").at(-1)!["reason"]).toBe("match complete");
  });

  test("the bot arms itself after a delay and its input seq climbs on the wire", async () => {
    await boot(instantCfg);
    const a = makeSocket();
    await queueOne(a, tokenA, "Alice");
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    const botSeatId = botAccountOf(room).seatId;
    const now = performance.now();

    // The human arms through the normal wire; the bot is still choosing.
    say(manager, a, { t: "setWeapon", weapon: "blade" });
    say(manager, a, { t: "setAbilities", abilities: ABILITY_IDS.slice(0, LOADOUT_ABILITY_COUNT) });
    expect(room.sim.state.players[botSeatId]!.weapon).toBeNull();

    // Step past the 2–8s arming delay: the bot drafts, the sim's own
    // countdown runs (5s), the match starts, and the brain begins to think.
    for (let i = 0; i < 400; i++) room.step(1, now + 9_000 + i * 33);
    expect(room.sim.state.players[botSeatId]!.weapon).not.toBeNull();
    expect(room.sim.state.round.phase).not.toBe("lobby");

    const seqs = published
      .filter((m) => m.t === "snapshot")
      .map((s) => (s["players"] as { id: number; lastSeq: number }[]).find((p) => p.id === botSeatId)?.lastSeq ?? 0);
    expect(Math.max(...seqs)).toBeGreaterThan(1); // climbing, not the eternal 0
    expect(JSON.stringify(published)).not.toContain('"bot":true');
  });
});

// ── 2v2 solo queue (bits-ranked.md § 2v2 solo queue) ───────────────────────

describe("2v2 solo queue", () => {
  let db: Db;
  let manager: RoomManager;
  let published: { t: string; [k: string]: unknown }[];
  let tokens: string[];

  /** Backfill ON with a zero wait — the harshest setting for "2v2 never pops
   * a bot": every 1v1 entry would be overdue on the first beat. */
  const instantCfg = { enabled: true, minWaitMs: 0, maxWaitMs: 0, ratingJitter: 0 };

  beforeEach(async () => {
    db = createDb(":memory:");
    await ensureSchema(db);
    tokens = [];
    for (let i = 0; i < 4; i++) tokens.push((await registerPlayer(db)).token);
    manager = new RoomManager(db, instantCfg);
    const fake = makeServer();
    published = fake.published;
    (manager as unknown as { server: Server<ClientData> }).server = fake.server;
  });

  const names = ["Alice", "Bob", "Carol", "Dave"];

  const queueFour = async (brackets = ["2v2"]): Promise<FakeSocket[]> => {
    const socks = names.map(() => makeSocket());
    socks.forEach((s, i) => queueJoin(manager, s, tokens[i]!, names[i]!, brackets));
    await until(() => socks.every((s) => s.of("queueStatus").length > 0));
    return socks;
  };

  const seedRating = async (token: string, rating: number): Promise<void> => {
    const rows = await db.execute({ sql: "SELECT player_id FROM player_tokens", args: [] });
    void rows;
    const id = (await import("@heroic/blood-in-the-sand-persistence")).findPlayerByToken;
    const playerId = await id(db, token);
    await db.execute({
      sql: `INSERT INTO ranked_ratings (subject_id, season, bracket, rating, wins, losses, peak_rating, updated_at)
            VALUES (?, ?, '2v2', ?, 10, 10, ?, 0)`,
      args: [playerId, SEASON, rating, rating],
    });
  };

  test("a lone 2v2 queuer NEVER draws a bot, however overdue; the count is honest", async () => {
    const a = makeSocket();
    queueJoin(manager, a, tokens[0]!, "Alice", ["2v2"]);
    await until(() => a.of("queueStatus").length > 0);
    for (let i = 0; i < 5; i++) internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(0);
    const brackets = a.of("queueStatus").at(-1)!["brackets"] as { bracket: string; size: number }[];
    // 1v1 is fuzzed (backfill bracket); 2v2 shows the real 1.
    expect(brackets.find((b) => b.bracket === "2v2")!.size).toBe(1);
    expect(brackets.find((b) => b.bracket === "1v1")!.size).toBeGreaterThanOrEqual(1);
  });

  test("three queued wait; the fourth completes the match into one 2v2 room", async () => {
    const socks = names.slice(0, 3).map(() => makeSocket());
    socks.forEach((s, i) => queueJoin(manager, s, tokens[i]!, names[i]!, ["2v2"]));
    await until(() => socks.every((s) => s.of("queueStatus").length > 0));
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(0);

    const d = makeSocket();
    queueJoin(manager, d, tokens[3]!, "Dave", ["2v2"]);
    await until(() => d.of("queueStatus").length > 0);
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);
    const all = [...socks, d];
    for (const s of all) {
      expect(s.of("matchFound")).toHaveLength(1);
      expect(s.of("matchFound")[0]!["bracket"]).toBe("2v2");
      expect(s.of("welcome")).toHaveLength(1);
      expect(s.of("welcome")[0]!["teamSize"]).toBe(2);
    }
    const room = [...internals(manager).rooms.values()][0]!;
    expect(room.sim.state.players).toHaveLength(4);
    for (const account of room.ranked!.accounts.values()) expect(account.bot).toBeUndefined();
  });

  test("the matcher dictates the sides: best + worst vs the middle two", async () => {
    await seedRating(tokens[0]!, 1400); // Alice
    await seedRating(tokens[1]!, 1500); // Bob
    await seedRating(tokens[2]!, 1520); // Carol
    await seedRating(tokens[3]!, 1700); // Dave
    const socks = await queueFour();
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);
    const teamOf = (s: FakeSocket) => s.of("welcome")[0]!["team"];
    expect(teamOf(socks[0]!)).toBe(teamOf(socks[3]!)); // Alice + Dave
    expect(teamOf(socks[1]!)).toBe(teamOf(socks[2]!)); // Bob + Carol
    expect(teamOf(socks[0]!)).not.toBe(teamOf(socks[1]!));
  });

  test("matchEnd settles all four: Elo vs the enemy mean, full Glory each, four wire rows", async () => {
    await seedRating(tokens[0]!, 1600); // Alice
    await seedRating(tokens[1]!, 1400); // Bob
    await seedRating(tokens[2]!, 1500); // Carol
    await seedRating(tokens[3]!, 1500); // Dave
    const socks = await queueFour();
    internals(manager).rankedBeat();
    const room = [...internals(manager).rooms.values()][0]!;
    // Sorted 1400 (Bob) 1500 (Carol) 1500 (Dave) 1600 (Alice): Bob + Alice
    // vs Carol + Dave — means 1500 vs 1500.
    const aliceTeam = room.sim.state.players[socks[0]!.ws.data.playerId!]!.team as Team;
    expect(room.sim.state.players[socks[1]!.ws.data.playerId!]!.team).toBe(aliceTeam);

    room.onRankedMatchEnd!(aliceTeam);
    await until(() => published.some((m) => m.t === "rankedResult"));
    const result = published.find((m) => m.t === "rankedResult") as unknown as {
      bracket: string;
      results: { playerId: number; delta: number; glory: number; placement: unknown }[];
    };
    expect(result.bracket).toBe("2v2");
    expect(result.results).toHaveLength(4);
    const rowOf = (s: FakeSocket) => result.results.find((r) => r.playerId === s.ws.data.playerId)!;
    expect(rowOf(socks[0]!).delta).toBe(5); // Alice 1600 vs mean 1500, K=15
    expect(rowOf(socks[1]!).delta).toBe(10); // Bob 1400 vs 1500 — the underdog earns more
    expect(rowOf(socks[2]!).delta).toBe(-7);
    expect(rowOf(socks[3]!).delta).toBe(-7);
    for (const s of socks.slice(0, 2)) expect(rowOf(s).glory).toBe(23);
    for (const s of socks.slice(2)) expect(rowOf(s).glory).toBe(5);
    for (const s of socks) expect(rowOf(s).placement).toBeNull(); // seeded past placements

    // Ladder + ledger agree, per member.
    expect((await getRating(db, socks[0]!.ws.data.accountId!, SEASON, "2v2")).rating).toBe(1605);
    expect((await getRating(db, socks[1]!.ws.data.accountId!, SEASON, "2v2")).rating).toBe(1410);
    expect(await gloryBalance(db, socks[1]!.ws.data.accountId!)).toBe(23);
    expect(await gloryBalance(db, socks[3]!.ws.data.accountId!)).toBe(5);
    const players = await db.execute("SELECT subject_id FROM ranked_match_players");
    expect(players.rows).toHaveLength(4);
  });

  test("a four-seat void: the leaver is locked out, the other three go straight back in line", async () => {
    const socks = await queueFour();
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);

    say(manager, socks[2]!, { t: "leaveRoom" }); // Carol bails during arming
    internals(manager).tendRankedRooms(performance.now());
    expect(manager.roomCount()).toBe(0);

    say(manager, socks[0]!, { t: "queueInfo" });
    const brackets = socks[0]!.of("queueStatus").at(-1)!["brackets"] as { bracket: string; size: number }[];
    expect(brackets.find((b) => b.bracket === "2v2")!.size).toBe(3);
    queueJoin(manager, socks[2]!, tokens[2]!, "Carol", ["2v2"]);
    await until(() => socks[2]!.of("reject").length > 0);
    expect(socks[2]!.of("reject")[0]!["reason"]).toContain("lockout");
  });

  test("multi-queue: 1v1 + 2v2 at once, the first match wins and the other entry evaporates", async () => {
    const a = makeSocket();
    const b = makeSocket();
    queueJoin(manager, a, tokens[0]!, "Alice", ["1v1", "2v2"]);
    queueJoin(manager, b, tokens[1]!, "Bob", ["1v1", "2v2"]);
    await until(() => a.of("queueStatus").length > 0 && b.of("queueStatus").length > 0);
    internals(manager).rankedBeat();
    expect(manager.roomCount()).toBe(1);
    expect(a.of("matchFound")[0]!["bracket"]).toBe("1v1");
    expect(a.ws.data.roomCode).toBe(b.ws.data.roomCode);
    const outsider = makeSocket();
    say(manager, outsider, { t: "queueInfo" });
    const brackets = outsider.of("queueStatus").at(-1)!["brackets"] as { bracket: string; size: number }[];
    expect(brackets.find((b) => b.bracket === "2v2")!.size).toBe(0);
  });

  test("re-sending the bracket set keeps the wait already earned", async () => {
    const a = makeSocket();
    queueJoin(manager, a, tokens[0]!, "Alice", ["1v1"]);
    await until(() => a.of("queueStatus").length > 0);
    const queues = (manager as unknown as { queue: { queues: Map<string, QueueEntry[]> } }).queue.queues;
    // Age the 1v1 entry by hand, then add 2v2 the way the client does — one
    // queueJoin naming both brackets.
    queues.get("1v1")![0]!.joinedMs -= 30_000;
    const earned = queues.get("1v1")![0]!.joinedMs;
    queueJoin(manager, a, tokens[0]!, "Alice", ["1v1", "2v2"]);
    await until(() => a.of("queueStatus").length > 1);
    expect(queues.get("1v1")![0]!.joinedMs).toBe(earned); // not reset
    expect(queues.get("2v2")![0]!.joinedMs).toBeGreaterThan(earned); // fresh line, fresh wait
  });
});

// ── queue bookkeeping ──────────────────────────────────────────────────────

describe("RankedQueue", () => {
  const entry = (accountId: string, ws: Socket, rating = 1500, joinedMs = 0): QueueEntry => ({
    ws,
    accountId,
    name: accountId,
    announcer: "default",
    title: "",
    items: [],
    rating,
    joinedMs,
  });

  test("an account re-queueing replaces its old entry and tells the old socket", () => {
    const q = new RankedQueue(["1v1"]);
    const oldSock = makeSocket();
    const newSock = makeSocket();
    q.enqueue("1v1", entry("acct", oldSock.ws));
    q.enqueue("1v1", entry("acct", newSock.ws));
    expect(q.statusFor(null, 0)).toEqual([{ bracket: "1v1", size: 1 }]);
    expect(oldSock.of("queueLeft")).toHaveLength(1);
  });

  test("first match wins across brackets (multi-queue)", () => {
    const q = new RankedQueue(["1v1", "2v2"]);
    const a = makeSocket();
    const b = makeSocket();
    const c = makeSocket();
    q.enqueue("1v1", entry("a", a.ws));
    q.enqueue("2v2", entry("a", a.ws));
    q.enqueue("1v1", entry("b", b.ws));
    q.enqueue("2v2", entry("c", c.ws));
    const matches = q.match(0, true);
    expect(matches).toHaveLength(1); // a+b in 1v1 (map order)
    expect(matches[0]!.bracket).toBe("1v1");
    // a's 2v2 entry evaporated with the match; c waits alone.
    expect(q.statusFor(null, 0)).toEqual([
      { bracket: "1v1", size: 0 },
      { bracket: "2v2", size: 1 },
    ]);
  });

  test("lockouts expire", () => {
    const q = new RankedQueue(["1v1"]);
    q.lockout("acct", 0);
    expect(q.lockoutLeft("acct", 1_000)).toBe(29);
    expect(q.lockoutLeft("acct", 31_000)).toBe(0);
  });

  test("takeOverdue claims only past-deadline entries", () => {
    const q = new RankedQueue(["1v1"]);
    const a = makeSocket();
    const b = makeSocket();
    const c = makeSocket();
    q.enqueue("1v1", { ...entry("a", a.ws), botAtMs: 1_000 });
    q.enqueue("1v1", { ...entry("b", b.ws), botAtMs: 5_000 });
    q.enqueue("1v1", entry("c", c.ws)); // no deadline — backfill off for this entry
    const taken = q.takeOverdue(2_000, ["1v1"]);
    expect(taken.map((t) => t.entry.accountId)).toEqual(["a"]);
    expect(q.statusFor(null, 0)).toEqual([{ bracket: "1v1", size: 2 }]);
  });

  test("takeOverdue claims the account from every bracket (multi-queue)", () => {
    const q = new RankedQueue(["1v1", "2v2"]);
    const a = makeSocket();
    q.enqueue("1v1", { ...entry("a", a.ws), botAtMs: 1_000 });
    q.enqueue("2v2", { ...entry("a", a.ws), botAtMs: 1_000 });
    const taken = q.takeOverdue(2_000, ["1v1", "2v2"]);
    expect(taken).toHaveLength(1); // one bot match, not two
    expect(taken[0]!.bracket).toBe("1v1");
    expect(q.statusFor(null, 0)).toEqual([
      { bracket: "1v1", size: 0 },
      { bracket: "2v2", size: 0 },
    ]);
  });
});
