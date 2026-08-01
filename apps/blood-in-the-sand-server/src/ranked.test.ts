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
  canPair,
  pairBracket,
  ratingWindow,
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

const queueJoin = (manager: RoomManager, s: FakeSocket, token: string, name: string): void =>
  say(manager, s, { t: "queueJoin", v: PROTOCOL_VERSION, token, playerName: name, brackets: ["1v1"] });

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
    expect(a.of("queueStatus")[0]!["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }]);

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

  test("ranked rooms are unlisted and unjoinable from outside", async () => {
    const a = makeSocket();
    const b = makeSocket();
    await queueBoth(a, b);
    internals(manager).rankedBeat();
    const code = String(a.of("matchFound")[0]!["code"]);

    const outsider = makeSocket();
    say(manager, outsider, { t: "listRooms" });
    expect(outsider.of("rooms")[0]!["rooms"]).toEqual([]);
    say(manager, outsider, { t: "joinRoom", v: PROTOCOL_VERSION, code, playerName: "Eve" });
    expect(outsider.of("reject")[0]!["reason"]).toBe("that match can't be joined");
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
    expect(last["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }]);
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
    expect(mine.after).toBe(1520); // even placement win
    expect(mine.glory).toBe(23);
    expect(mine.tier).toBe("Gladiator");
    expect(mine.placement).toEqual({ number: 1, of: 10 }); // first placement match

    // The ledger and ladder agree.
    const accountA = a.ws.data.accountId!;
    expect(await gloryBalance(db, accountA)).toBe(23);
    expect((await getRating(db, accountA, SEASON, "1v1")).rating).toBe(1520);

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
    expect(a.of("queueStatus").at(-1)!["brackets"]).toEqual([{ bracket: "1v1", size: 0 }]);
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
    expect(a.of("queueStatus").at(-1)!["brackets"]).toEqual([{ bracket: "1v1", size: 1, waitedSec: 0 }]);
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
    expect(mine.after).toBe(1520); // placement K=40, even ratings
    expect(mine.glory).toBe(23);
    expect(mine.placement).toEqual({ number: 1, of: 10 });

    // The fabricated bot side: settled K, never "in placements".
    const theirs = result.results.find((r) => r.playerId !== a.ws.data.playerId)!;
    expect(theirs.placement).toBeNull();
    expect(theirs.delta).toBe(-10); // K=20 loss at even ratings

    // The DB holds exactly one side of the story.
    const accountA = a.ws.data.accountId!;
    expect(await gloryBalance(db, accountA)).toBe(23);
    expect((await getRating(db, accountA, SEASON, "1v1")).rating).toBe(1520);
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
    expect(mine.after).toBe(1480);
    expect(mine.glory).toBe(5);
    expect((await getRating(db, a.ws.data.accountId!, SEASON, "1v1")).rating).toBe(1480);
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

  test("consecutive matches draw different bot names", async () => {
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
    expect(new Set(names).size).toBe(3);
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

// ── queue bookkeeping ──────────────────────────────────────────────────────

describe("RankedQueue", () => {
  const entry = (accountId: string, ws: Socket, rating = 1500, joinedMs = 0): QueueEntry => ({
    ws,
    accountId,
    name: accountId,
    announcer: "default",
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
