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

export const canPair = (
  a: Pick<QueueEntry, "rating" | "joinedMs">,
  b: Pick<QueueEntry, "rating" | "joinedMs">,
  nowMs: number,
  matchAnyone: boolean,
): boolean => {
  if (matchAnyone) return true;
  const window = Math.max(ratingWindow(nowMs - a.joinedMs), ratingWindow(nowMs - b.joinedMs));
  return Math.abs(a.rating - b.rating) <= window;
};

/**
 * One bracket's pairing pass, pure: sort by rating, walk once, pair adjacent
 * entries whose gap fits the window. Returns index pairs INTO THE SORTED
 * ORDER along with that order, so the caller can map back to live entries.
 */
export const pairBracket = <T extends Pick<QueueEntry, "rating" | "joinedMs">>(
  entries: readonly T[],
  nowMs: number,
  matchAnyone: boolean,
): { sorted: T[]; pairs: [number, number][] } => {
  const sorted = [...entries].sort((a, b) => a.rating - b.rating || a.joinedMs - b.joinedMs);
  const pairs: [number, number][] = [];
  let i = 0;
  while (i + 1 < sorted.length) {
    if (canPair(sorted[i]!, sorted[i + 1]!, nowMs, matchAnyone)) {
      pairs.push([i, i + 1]);
      i += 2;
    } else {
      i += 1;
    }
  }
  return { sorted, pairs };
};

export interface QueueMatch {
  bracket: string;
  a: QueueEntry;
  b: QueueEntry;
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
   * second device) REPLACES its old entry — one seat in line per account,
   * and the superseded socket is told it left. */
  enqueue(bracket: string, entry: QueueEntry): void {
    const queue = this.queues.get(bracket);
    if (!queue) return;
    const stale = queue.findIndex((e) => e.accountId === entry.accountId);
    if (stale >= 0) {
      const old = queue[stale]!;
      queue.splice(stale, 1);
      if (old.ws !== entry.ws) safeSend(old.ws, JSON.stringify({ t: "queueLeft" }));
    }
    queue.push(entry);
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
   * The matcher beat: pair every bracket, REMOVING matched entries — and,
   * multi-queue's first-match-wins rule, removing the matched accounts from
   * every other bracket they were waiting in.
   */
  match(nowMs: number, matchAnyone = MATCH_ANYONE): QueueMatch[] {
    const matches: QueueMatch[] = [];
    for (const [bracket, queue] of this.queues) {
      const { sorted, pairs } = pairBracket(queue, nowMs, matchAnyone);
      for (const [i, j] of pairs) {
        const m: QueueMatch = { bracket, a: sorted[i]!, b: sorted[j]! };
        matches.push(m);
        // Claim both accounts IMMEDIATELY — before the next bracket pairs —
        // or a multi-queued account could land two matches in one beat.
        this.removeAccount(m.a.accountId);
        this.removeAccount(m.b.accountId);
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
