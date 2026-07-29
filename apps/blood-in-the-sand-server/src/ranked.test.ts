/**
 * Ranked queue + ranked-room lifecycle tests. The matcher rules are pure and
 * tested directly; the manager flow (queueJoin → verify → match → seat →
 * settle/void) runs against fake sockets, a fake Bun server, and an
 * in-memory database — no network, no timers, beats driven by hand.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { PROTOCOL_VERSION, type Team } from "@heroic/blood-in-the-sand-sim";
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
    manager = new RoomManager(db);
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

    // Settled + back in lobby ⇒ the room closes on the next beat.
    room.ranked!.ended = true;
    await until(() => room.ranked!.settled);
    internals(manager).tendRankedRooms(performance.now());
    expect(manager.roomCount()).toBe(0);
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
});
