/**
 * Ranked bot backfill (bits-ranked-bots.md): the pure toolbox behind styling
 * server bots as queue opponents — and, in 2v2, teammates — env config +
 * kill switch, the
 * rating→difficulty bands, the advertised-rating mirror, the gamer-tag
 * generator with its repeat-avoidance book, and the queue-size fuzz. No IO,
 * injectable rand throughout; the manager wires it to the queue and rooms.
 *
 * Temporary by design: every dial is env-tunable and RANKED_BOT_BACKFILL=off
 * turns the whole feature (fuzz included) off without a build.
 */
import { randomUUID } from "node:crypto";
import { RATING_FLOOR } from "@heroic/blood-in-the-sand-persistence";
import type { DifficultyId } from "@heroic/blood-in-the-sand-sim";

export interface BotBackfillConfig {
  /** The kill switch — off means no bot matches AND honest queue numbers. */
  enabled: boolean;
  /** Wait before a lone queuer draws a bot, jittered per entry between these
   * two (an always-exactly-20s pop is itself a tell). */
  minWaitMs: number;
  maxWaitMs: number;
  /** The bot's advertised rating sits within ±this of the human's. */
  ratingJitter: number;
}

const DEFAULT_MIN_WAIT_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 25_000;
const DEFAULT_RATING_JITTER = 50;

export const botBackfillConfigFromEnv = (
  env: Record<string, string | undefined> = process.env,
): BotBackfillConfig => {
  const flag = (env["RANKED_BOT_BACKFILL"] ?? "").trim().toLowerCase();
  const num = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const minWaitMs = num(env["RANKED_BOT_MIN_WAIT_MS"], DEFAULT_MIN_WAIT_MS);
  return {
    enabled: !["0", "off", "false"].includes(flag),
    minWaitMs,
    maxWaitMs: Math.max(minWaitMs, num(env["RANKED_BOT_MAX_WAIT_MS"], DEFAULT_MAX_WAIT_MS)),
    ratingJitter: num(env["RANKED_BOT_RATING_JITTER"], DEFAULT_RATING_JITTER),
  };
};

/** When a queue entry becomes bot-eligible — jittered per entry. A re-queue
 * gets a FRESH deadline (a void must never pop an instant bot). */
export const botDeadline = (nowMs: number, cfg: BotBackfillConfig, rand: () => number): number =>
  nowMs + cfg.minWaitMs + rand() * (cfg.maxWaitMs - cfg.minWaitMs);

/**
 * Rating → execution-quality tier. A standalone 8-way split over the Elo
 * range — NOT the six display tiers in elo.ts, though the upper cut points
 * coincide (bits-ranked-bots.md § difficulty). Climbing means fighting
 * harder bots; stats stay even at every band (the ranked seat pins
 * moveFactor to 1 — room.ts seatRankedBot).
 */
export const difficultyForRating = (rating: number): DifficultyId => {
  if (rating < 1200) return "novice";
  if (rating < 1350) return "average";
  if (rating < 1450) return "experienced";
  if (rating < 1600) return "skilled";
  if (rating < 1750) return "adept";
  if (rating < 1900) return "masterful";
  if (rating < 2050) return "inhuman";
  return "godlike";
};

/** The bot's advertised rating: the human's ± jitter, floored like a real
 * rating, frozen at room creation. Elo transfer vs it stays ≈ K/2. */
export const mirrorRating = (humanRating: number, jitter: number, rand: () => number): number =>
  Math.max(RATING_FLOOR, Math.round(humanRating + (rand() * 2 - 1) * jitter));

/** Throwaway settlement subject — lands ONLY in ranked_matches. */
export const botSubjectId = (): string => `bot:${randomUUID()}`;

// ── names ──────────────────────────────────────────────────────────────────
// A fixed 48-name roster, server-side only (the sim ships in the client
// bundle — a datamined list is a receipt) and deliberately unlike the casual
// gladiator pool (room.ts BOT_NAMES) players already read as bot names.
//
// Replaced the procedural generator 2026-08-02 (Tom): infinite fresh
// strangers is itself a tell. Instead the roster rotates like a population —
// 4 names "online" at any moment, 2 clocking off at the top of each hour as
// 2 more log on. Each name works a 2-hour shift, and the ring cycles every
// ROSTER.length/2 hours: at 96 names that's a 48-hour cycle, so each regular
// shows up every OTHER day — real people don't play daily.

// Curated 2026-08-02 from the texture of real EU ladder top-500 handles
// (Tom: the invented stems didn't sell): accent-marked tags, spelled-number
// suffixes, confident plain words. Generic ones lifted near-verbatim,
// distinctive ones mutated; no famous-player references, no real-name
// lookalikes, no WoW-class suffixes, no Cyrillic (device font risk).
// Flavours interleaved around the ring so any 4-name online window reads as
// a mixed crowd.
export const ROSTER: readonly string[] = [
  "Krôna", "Melan", "Drakesha", "Fokkus", "Nølo", "Totemfear",
  "Xerwothree", "Velux", "Béndie", "Swiftkicks", "Rycntwo", "Khiro",
  "Síbz", "Shadowviper", "Streaq", "Motrax", "Doînk", "Lonecrusader",
  "Zeock", "Borreas", "Mistå", "Spongeman", "Vooksar", "Khoron",
  "Børe", "Anix", "Trokthar", "Viklund", "Arnéa", "Calvas",
  "Nycteus", "Elianos", "Zahó", "Yoelus", "Barotz", "Rotkar",
  "Túrè", "Tweeq", "Cerlidh", "Adonk", "Mogiz", "Jestern",
  "Kushr", "Vyo", "Joopla", "Buffx", "Canexx", "Starstrike",
  "Spâlter", "Ralek", "Spookx", "Revves", "Skarìs", "Saltblind",
  "Waitless", "Ruffneck", "Chämpion", "Boneshox", "Sanshee", "Draze",
  "Stòrm", "Waspx", "Scarado", "Barawr", "Wiltzú", "Lyzerd",
  "Swaazy", "Kwepp", "Nyjâh", "Fjanti", "Spudbag", "Sunfirez",
  "Zòót", "Cyntos", "Gorkamungus", "Faramond", "Nébu", "Mortaxx",
  "Yoloalpha", "Zorandor", "Dùnk", "Fjore", "Xanrath", "Zaneon",
  "Icytröll", "Chronii", "Rilla", "Calith", "Wassabî", "Exoticz",
  "Kovax", "Vudax", "Xaíl", "Critex", "Trizter", "Kreedze",
] as const;

/** Names "online" at any moment. */
export const ONLINE_COUNT = 4;
/** Names that clock off (and on) at the top of each hour. */
const SHIFT_PER_HOUR = 2;
const HOUR_MS = 3_600_000;
/** One name's shift — how long it stays online, and how long its anchored
 * rating stays coherent before it re-anchors as a fresh session. */
const SHIFT_MS = (ONLINE_COUNT / SHIFT_PER_HOUR) * HOUR_MS;

/** The roster window online at wall-clock `nowMs` — a pure function of the
 * hour (restarts never reshuffle who's on), sliding SHIFT_PER_HOUR names
 * along the ring each hour. */
export const onlineNames = (nowMs: number): string[] => {
  const start = (Math.floor(nowMs / HOUR_MS) * SHIFT_PER_HOUR) % ROSTER.length;
  return Array.from({ length: ONLINE_COUNT }, (_, i) => ROSTER[(start + i) % ROSTER.length]!);
};

/** A recurring name whose advertised rating tracked a different player's
 * would be a tell — beyond this gap the book leaves the anchored name alone
 * and "someone new logs on" instead. */
const PLAUSIBLE_RATING_GAP = 100;
/** Re-serving a session re-nudges its rating by ±this — the name has
 * plausibly been playing since you last met. */
const SESSION_NUDGE = 8;
const LAST_FACED_CAP = 2_000;

/** What a pick hands the manager: the identity AND the rating it advertises
 * (session-anchored — see pick()). */
export interface BotIdentity {
  name: string;
  rating: number;
}

/**
 * The roster's front desk. Serves identities from the online window with
 * three rules: never the same stranger twice IN A ROW for one account (a
 * re-match after a game apart is exactly what a small population feels
 * like), never a name already fighting in a live room (release on room
 * close), and never an implausible rating jump — a name keeps the rating it
 * anchored for its whole 2-hour shift (first serve anchors at the human's
 * ±jitter, later serves drift a few points), so a recurring regular reads as
 * one coherent player. When the online window can't serve (all mid-match or
 * anchored too far away), the next names on the ring come online early.
 */
export class BotIdentityBook {
  /** accountId → the one name it faced last. */
  private readonly lastFaced = new Map<string, string>();
  private readonly inUse = new Set<string>();
  /** name → the shift-scoped rating anchor. */
  private readonly sessions = new Map<string, { rating: number; anchoredMs: number }>();

  constructor(private readonly roster: readonly string[] = ROSTER) {}

  pick(accountId: string, humanRating: number, jitter: number, nowMs: number, rand: () => number): BotIdentity {
    const start = (Math.floor(nowMs / HOUR_MS) * SHIFT_PER_HOUR) % this.roster.length;
    const last = this.lastFaced.get(accountId);
    const session = (name: string): { rating: number; anchoredMs: number } | null => {
      const s = this.sessions.get(name);
      return s && nowMs - s.anchoredMs < SHIFT_MS ? s : null;
    };
    // Walk the ring from the online window; stepping past ONLINE_COUNT is
    // the "comes online early" fallback, so exhaustion is impossible.
    let name: string | null = null;
    for (let i = 0; i < this.roster.length; i++) {
      const candidate = this.roster[(start + i) % this.roster.length]!;
      if (this.inUse.has(candidate) || candidate === last) continue;
      const s = session(candidate);
      if (s && Math.abs(s.rating - humanRating) > PLAUSIBLE_RATING_GAP) continue;
      name = candidate;
      break;
    }
    // Whole ring implausible or busy (needs ~48 live bot matches): take the
    // freest online name and re-anchor — a wrong-looking rating beats a hang.
    name ??= this.roster.find((n) => !this.inUse.has(n)) ?? this.roster[start]!;

    const s = session(name);
    const rating = s
      ? this.nudge(s, rand)
      : this.anchor(name, mirrorRating(humanRating, jitter, rand), nowMs);
    this.inUse.add(name);
    this.lastFaced.delete(accountId); // re-insert = newest in Map order…
    this.lastFaced.set(accountId, name);
    // …so the lazy cap always evicts the longest-idle account.
    if (this.lastFaced.size > LAST_FACED_CAP) {
      const oldest = this.lastFaced.keys().next().value;
      if (oldest !== undefined) this.lastFaced.delete(oldest);
    }
    return { name, rating };
  }

  private anchor(name: string, rating: number, nowMs: number): number {
    this.sessions.set(name, { rating, anchoredMs: nowMs });
    return rating;
  }

  private nudge(s: { rating: number; anchoredMs: number }, rand: () => number): number {
    s.rating = Math.max(RATING_FLOOR, s.rating + Math.round((rand() * 2 - 1) * SESSION_NUDGE));
    return s.rating;
  }

  release(name: string): void {
    this.inUse.delete(name);
  }
}

// ── queue-size fuzz ────────────────────────────────────────────────────────

/** Fuzz period — slow enough to read as a population, not a random number. */
const FUZZ_PERIOD_MS = 7 * 60_000;

/**
 * The displayed queue size while backfill is on: real size plus a
 * slow-varying plausible baseline (never below real+1, so "1 in queue →
 * match found" can't appear). Pure in (size, bracket, now) — queueStatus and
 * queueInfo call the same function and always agree. Reverses
 * bits-ranked.md's "honest numbers only" rule while the kill switch is on;
 * the caller gates on cfg.enabled, so honest numbers return with the switch.
 */
export const fuzzedQueueSize = (realSize: number, bracket: string, nowMs: number): number => {
  let phase = 0;
  for (const ch of bracket) phase += ch.charCodeAt(0);
  const wave = Math.sin((nowMs / FUZZ_PERIOD_MS) * 2 * Math.PI + phase);
  const baseline = 3 + Math.round(2 * wave);
  return realSize + Math.max(1, baseline);
};
