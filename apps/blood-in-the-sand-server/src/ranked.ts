/**
 * The ranked queue (bits-ranked.md): per-bracket in-memory arrays beside the
 * in-memory rooms — a queue is exactly as ephemeral as the sockets in it, so
 * a deploy drops both and the client just re-queues. The matcher runs on a
 * slow beat from the manager; the pairing rules are pure and tested here.
 *
 * Season I launches PERMISSIVE (MATCH_ANYONE — population is tiny; a match
 * now beats a fair match never). The widening rating window is built and
 * tested so flipping to fair matching later is a config change, not a build.
 */
import { RANKED_BRACKETS } from "@heroic/blood-in-the-sand-sim";
import type { Socket } from "./room";

/** Server-side season config — bump on rollover (bits-ranked.md § Seasons). */
export const SEASON = 1;
/** Skip the rating window entirely — pair by adjacency alone. */
export const MATCH_ANYONE = true;
/** Rating window at zero wait… */
export const WINDOW_BASE = 100;
/** …widened by this much every 10s of waiting (the longer-waiting player's
 * window is the one that counts). */
export const WINDOW_GROWTH = 50;
/** How often the manager runs the matcher + queueStatus beat. */
export const MATCHER_INTERVAL_MS = 2_000;
/** Arming grace in a ranked room before the match is called off. */
export const ARM_DEADLINE_MS = 60_000;
/** How long a summoned player has to accept a pending match (bits-ranked.md
 * § Queue roaming & match accept). Generous for a phone that may be mid-Armory,
 * short enough that the other side never feels held. */
export const ACCEPT_WINDOW_MS = 15_000;
/** A backfill bot "accepts" this long after the summons — jittered inside
 * [min, max] so an instant 2/2 (or an always-exactly-3s one) isn't a tell. */
export const BOT_ACCEPT_MIN_MS = 1_000;
export const BOT_ACCEPT_MAX_MS = 5_000;
/** Queue lockout for the player who caused a void (never armed / bailed). */
export const DODGE_LOCKOUT_MS = 30_000;

export interface QueueEntry {
  ws: Socket;
  /** The persistent (persistence-package) player id, token-verified. */
  accountId: string;
  name: string;
  announcer: string;
  /** Worn title (deed id, "" = bare) — entitlement-verified before enqueue. */
  title: string;
  /** Owned gated-item entitlements (`weapon:*`/`ability:*`), loaded at the
   * same verify — the seat's pick validation reads these synchronously. */
  items: string[];
  /** This bracket's season rating, loaded at queue entry — the matcher's
   * sort key. Fresh enough: nobody's rating moves while they queue. */
  rating: number;
  /** Queue-entry time; survives a void's re-queue so waiting is never lost. */
  joinedMs: number;
  /** When this entry becomes bot-backfill-eligible (bits-ranked-bots.md) —
   * jittered per entry; a re-queue gets a FRESH deadline (earned wait stays,
   * an instant bot pop never happens). Absent = backfill off. */
  botAtMs?: number;
}

/** How far apart two ratings may be, given how long each has waited. */
export const ratingWindow = (waitedMs: number): number =>
  WINDOW_BASE + WINDOW_GROWTH * Math.floor(Math.max(0, waitedMs) / 10_000);

/** Whether a candidate group may form: with windows on, the group's rating
 * SPREAD (max − min) must fit the longest-waiting member's window — the 1v1
 * pair rule generalised to `2 × teamSize` entries. */
export const canGroup = (
  entries: readonly Pick<QueueEntry, "rating" | "joinedMs">[],
  nowMs: number,
  matchAnyone: boolean,
): boolean => {
  if (matchAnyone) return true;
  let lo = Infinity;
  let hi = -Infinity;
  let window = 0;
  for (const e of entries) {
    lo = Math.min(lo, e.rating);
    hi = Math.max(hi, e.rating);
    window = Math.max(window, ratingWindow(nowMs - e.joinedMs));
  }
  return hi - lo <= window;
};

/** The pair rule, kept as the size-two reading of canGroup. */
export const canPair = (
  a: Pick<QueueEntry, "rating" | "joinedMs">,
  b: Pick<QueueEntry, "rating" | "joinedMs">,
  nowMs: number,
  matchAnyone: boolean,
): boolean => canGroup([a, b], nowMs, matchAnyone);

/**
 * One bracket's matching pass, pure: sort by rating, walk once, take each
 * run of `size` contiguous entries whose spread fits the window. Returns
 * index groups INTO THE SORTED ORDER along with that order, so the caller
 * can map back to live entries. `size` = 2 × teamSize (2 for 1v1, 4 for 2v2).
 */
export const groupBracket = <T extends Pick<QueueEntry, "rating" | "joinedMs">>(
  entries: readonly T[],
  size: number,
  nowMs: number,
  matchAnyone: boolean,
): { sorted: T[]; groups: number[][] } => {
  const sorted = [...entries].sort((a, b) => a.rating - b.rating || a.joinedMs - b.joinedMs);
  const groups: number[][] = [];
  let i = 0;
  while (i + size <= sorted.length) {
    const run = sorted.slice(i, i + size);
    if (canGroup(run, nowMs, matchAnyone)) {
      groups.push(Array.from({ length: size }, (_, k) => i + k));
      i += size;
    } else {
      i += 1;
    }
  }
  return { sorted, groups };
};

/** The 1v1 pass, kept as groupBracket at size two (index pairs). */
export const pairBracket = <T extends Pick<QueueEntry, "rating" | "joinedMs">>(
  entries: readonly T[],
  nowMs: number,
  matchAnyone: boolean,
): { sorted: T[]; pairs: [number, number][] } => {
  const { sorted, groups } = groupBracket(entries, 2, nowMs, matchAnyone);
  return { sorted, pairs: groups.map(([a, b]) => [a!, b!]) };
};

/**
 * Split a rating-sorted group into two sides with the closest team means:
 * the SNAKE draft — positions 0 and 3 (best + worst) against 1 and 2 (the
 * middle two) for four; for two, one each. Deterministic, no dice
 * (bits-ranked.md § 2v2 solo queue). Pure over the sorted order.
 */
export const splitTeams = <T>(sorted: readonly T[]): [T[], T[]] => {
  const a: T[] = [];
  const b: T[] = [];
  sorted.forEach((e, i) => (i % 4 === 0 || i % 4 === 3 ? a : b).push(e));
  return [a, b];
};

export interface QueueMatch {
  bracket: string;
  /** The two sides the matcher dictated — seated as teams 1 and 2. */
  teams: [QueueEntry[], QueueEntry[]];
}

/**
 * The accept stage between a pairing and a room (bits-ranked.md § Queue
 * roaming & match accept). Pure: the manager owns the clock and the sockets;
 * this just remembers who has said yes. A bot match carries `botAcceptAtMs`
 * — the bot counts as accepted once the clock passes it.
 */
export class PendingMatch {
  private readonly accepted = new Set<string>();
  /** The last accept count broadcast as matchPending (manager bookkeeping). */
  announced = 0;

  constructor(
    readonly bracket: string,
    readonly teams: [QueueEntry[], QueueEntry[]],
    readonly deadlineMs: number,
    readonly botAcceptAtMs: number | null = null,
  ) {}

  /** Every human entry, both sides. */
  get humans(): QueueEntry[] {
    return this.teams.flat();
  }

  /** Seats in the match — humans plus the bot, if any. */
  get players(): number {
    return this.humans.length + (this.botAcceptAtMs === null ? 0 : 1);
  }

  has(ws: Socket): boolean {
    return this.humans.some((e) => e.ws === ws);
  }

  entryOf(ws: Socket): QueueEntry | undefined {
    return this.humans.find((e) => e.ws === ws);
  }

  hasAccount(accountId: string): boolean {
    return this.humans.some((e) => e.accountId === accountId);
  }

  /** Record a yes. Returns true if the count moved (idempotent otherwise). */
  accept(accountId: string): boolean {
    if (!this.hasAccount(accountId) || this.accepted.has(accountId)) return false;
    this.accepted.add(accountId);
    return true;
  }

  botAccepted(nowMs: number): boolean {
    return this.botAcceptAtMs !== null && nowMs >= this.botAcceptAtMs;
  }

  acceptedCount(nowMs: number): number {
    return this.accepted.size + (this.botAccepted(nowMs) ? 1 : 0);
  }

  everyoneIn(nowMs: number): boolean {
    return this.acceptedCount(nowMs) === this.players;
  }

  expired(nowMs: number): boolean {
    return nowMs >= this.deadlineMs;
  }

  /** The humans at fault right now: a dead socket is a dodge whenever it's
   * noticed; not having answered is one only once the window has closed. */
  dodgers(nowMs: number): QueueEntry[] {
    return this.humans.filter(
      (e) => e.ws.readyState !== 1 || (this.expired(nowMs) && !this.accepted.has(e.accountId)),
    );
  }
}

export interface BracketStatus {
  bracket: string;
  size: number;
  waitedSec?: number;
}

export class RankedQueue {
  /** bracket → waiting entries (order irrelevant; the matcher sorts). */
  private readonly queues = new Map<string, QueueEntry[]>();
  /** accountId → lockout expiry (dodge penalty). Entries are pruned lazily. */
  private readonly lockouts = new Map<string, number>();

  constructor(private readonly brackets: readonly string[]) {
    for (const b of brackets) this.queues.set(b, []);
  }

  /** Entries per match for a bracket — 2 × its team size (unknown keys,
   * which only tests construct, read as 1v1). */
  private matchSize(bracket: string): number {
    const spec = (RANKED_BRACKETS as Record<string, { teamSize: number } | undefined>)[bracket];
    return 2 * (spec?.teamSize ?? 1);
  }

  /** Seconds left on an account's dodge lockout; 0 = free to queue. */
  lockoutLeft(accountId: string, nowMs: number): number {
    const until = this.lockouts.get(accountId) ?? 0;
    if (until <= nowMs) {
      this.lockouts.delete(accountId);
      return 0;
    }
    return Math.ceil((until - nowMs) / 1000);
  }

  lockout(accountId: string, nowMs: number): void {
    this.lockouts.set(accountId, nowMs + DODGE_LOCKOUT_MS);
  }

  /** Enter a bracket's queue. The same account re-queueing (a reconnect, a
   * second device, adding a bracket to a multi-queue) REPLACES its old entry
   * — one seat in line per account — but KEEPS the wait it had already
   * earned in this bracket: re-sending the bracket set to add 2v2 must not
   * send the 1v1 wait back to zero. A superseded socket is told it left. */
  enqueue(bracket: string, entry: QueueEntry): void {
    const queue = this.queues.get(bracket);
    if (!queue) return;
    const stale = queue.findIndex((e) => e.accountId === entry.accountId);
    if (stale >= 0) {
      const old = queue[stale]!;
      queue.splice(stale, 1);
      if (old.ws !== entry.ws) safeSend(old.ws, JSON.stringify({ t: "queueLeft" }));
      entry = { ...entry, joinedMs: Math.min(entry.joinedMs, old.joinedMs) };
    }
    queue.push(entry);
  }

  /** The socket's queue-entry times per bracket — snapshotted BEFORE a
   * re-send's cleanup drops its entries, so the re-enqueue can hand the
   * earned wait back (adding 2v2 to a 1v1 wait must not reset the 1v1). */
  waitsOf(ws: Socket): Map<string, number> {
    const waits = new Map<string, number>();
    for (const [bracket, queue] of this.queues) {
      const mine = queue.find((e) => e.ws === ws);
      if (mine) waits.set(bracket, mine.joinedMs);
    }
    return waits;
  }

  /** Drop a socket from every bracket (close, queueLeave, entering a room).
   * Returns true if it was queued anywhere. */
  removeSocket(ws: Socket): boolean {
    let removed = false;
    for (const queue of this.queues.values()) {
      const i = queue.findIndex((e) => e.ws === ws);
      if (i >= 0) {
        queue.splice(i, 1);
        removed = true;
      }
    }
    return removed;
  }

  /**
   * The matcher beat: group every bracket (2 × teamSize entries a match),
   * REMOVING matched entries — and, multi-queue's first-match-wins rule,
   * removing the matched accounts from every other bracket they were
   * waiting in. Sides come out of splitTeams over the rating order.
   */
  match(nowMs: number, matchAnyone = MATCH_ANYONE): QueueMatch[] {
    const matches: QueueMatch[] = [];
    for (const [bracket, queue] of this.queues) {
      const { sorted, groups } = groupBracket(queue, this.matchSize(bracket), nowMs, matchAnyone);
      for (const group of groups) {
        const m: QueueMatch = { bracket, teams: splitTeams(group.map((i) => sorted[i]!)) };
        matches.push(m);
        // Claim every account IMMEDIATELY — before the next bracket groups —
        // or a multi-queued account could land two matches in one beat.
        for (const side of m.teams) for (const e of side) this.removeAccount(e.accountId);
      }
    }
    return matches;
  }

  private removeAccount(accountId: string): void {
    for (const queue of this.queues.values()) {
      const i = queue.findIndex((e) => e.accountId === accountId);
      if (i >= 0) queue.splice(i, 1);
    }
  }

  /**
   * Entries whose bot deadline has passed (bits-ranked-bots.md) — runs AFTER
   * the pairing pass each beat, so a human match always wins. Claims each
   * taken account from every bracket, mirroring match()'s
   * first-match-wins rule for the multi-queued.
   */
  takeOverdue(nowMs: number, brackets: readonly string[]): { bracket: string; entry: QueueEntry }[] {
    const taken: { bracket: string; entry: QueueEntry }[] = [];
    for (const bracket of brackets) {
      const queue = this.queues.get(bracket);
      if (!queue) continue;
      // Iterate a snapshot — the claim splices the live arrays under us.
      for (const entry of [...queue]) {
        if (entry.botAtMs === undefined || entry.botAtMs > nowMs) continue;
        if (!queue.includes(entry)) continue; // claimed via another bracket this pass
        taken.push({ bracket, entry });
        this.removeAccount(entry.accountId);
      }
    }
    return taken;
  }

  /** Every socket with at least one live queue entry (the status audience). */
  queuedSockets(): Set<Socket> {
    const sockets = new Set<Socket>();
    for (const queue of this.queues.values()) for (const e of queue) sockets.add(e.ws);
    return sockets;
  }

  /** The queueStatus payload for one viewer: every bracket's population,
   * plus the viewer's own wait where they're queued. */
  statusFor(ws: Socket | null, nowMs: number): BracketStatus[] {
    return this.brackets.map((bracket) => {
      const queue = this.queues.get(bracket)!;
      const mine = ws === null ? undefined : queue.find((e) => e.ws === ws);
      return {
        bracket,
        size: queue.length,
        ...(mine ? { waitedSec: Math.floor((nowMs - mine.joinedMs) / 1000) } : {}),
      };
    });
  }
}

/** A queue send must never throw the matcher off its beat — a socket can die
 * between any two beats. */
const safeSend = (ws: Socket, json: string): void => {
  try {
    ws.send(json);
  } catch {
    // the close handler will reap it
  }
};
