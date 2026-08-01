/**
 * Ranked bot backfill (bits-ranked-bots.md): the pure toolbox behind styling
 * a server bot as a queue opponent — env config + kill switch, the
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
// Parts-based gamer tags, server-side only (the sim ships in the client
// bundle — a datamined list is a receipt) and deliberately unlike the casual
// gladiator pool (room.ts BOT_NAMES) players already read as bot names.

const STEMS = [
  "Vex", "Karv", "Dusk", "Moro", "Ash", "Ryn", "Brack", "Sable", "Torv", "Ferro",
  "Nyx", "Corvo", "Hale", "Grim", "Vanta", "Riven", "Oxen", "Skarn", "Tallow", "Murk",
  "Drav", "Kest", "Ombra", "Pike", "Rook", "Sorrel", "Thane", "Ulric", "Wren", "Yarrow",
  "Basil", "Calder", "Ember", "Fenwick", "Garrick", "Haldor", "Ivar", "Jorah", "Lorcan", "Merek",
] as const;

const TAILS = [
  "wolf", "fox", "hawk", "viper", "jackal", "moth", "crow", "hound",
  "blade", "brand", "mark", "fall", "born", "bane", "shade", "vane",
] as const;

/** One tag: bare stem / digit-suffixed / lowercase compound — ≤16 chars (the
 * wire name cap). */
export const generateBotName = (rand: () => number): string => {
  const stem = STEMS[Math.floor(rand() * STEMS.length)]!;
  const pattern = Math.floor(rand() * 3);
  if (pattern === 0) return stem;
  if (pattern === 1) return `${stem}${Math.floor(rand() * 90) + 10}${rand() < 0.3 ? Math.floor(rand() * 10) : ""}`;
  return `${stem.toLowerCase()}${TAILS[Math.floor(rand() * TAILS.length)]!}`.slice(0, 16);
};

const RECENT_PER_ACCOUNT = 10;
const RECENT_ACCOUNT_CAP = 2_000;

/**
 * No "same stranger twice in 10 minutes": a per-account ring of the last
 * names served, plus a live-rooms in-use set (release on room close).
 */
export class BotIdentityBook {
  /** accountId → the last names this account has faced, oldest first. */
  private readonly recent = new Map<string, string[]>();
  private readonly inUse = new Set<string>();

  constructor(private readonly generate: (rand: () => number) => string = generateBotName) {}

  pick(accountId: string, rand: () => number): string {
    const seen = new Set(this.recent.get(accountId) ?? []);
    let name = this.generate(rand);
    for (let attempt = 0; attempt < 50 && (this.inUse.has(name) || seen.has(name)); attempt++) {
      name = this.generate(rand);
    }
    this.inUse.add(name);
    const ring = this.recent.get(accountId) ?? [];
    ring.push(name);
    while (ring.length > RECENT_PER_ACCOUNT) ring.shift();
    this.recent.delete(accountId); // re-insert = newest in Map order…
    this.recent.set(accountId, ring);
    // …so the lazy cap always evicts the longest-idle account.
    if (this.recent.size > RECENT_ACCOUNT_CAP) {
      const oldest = this.recent.keys().next().value;
      if (oldest !== undefined) this.recent.delete(oldest);
    }
    return name;
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
