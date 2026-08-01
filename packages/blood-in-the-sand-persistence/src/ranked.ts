/**
 * Ranked ladder persistence (bits-ranked.md): per-bracket rating rows and the
 * one writer that settles a match — ratings, history, and Glory in a single
 * atomic batch keyed on the server-minted match id, so a crash-retry can
 * never double-apply.
 *
 * The math lives in elo.ts (pure); this module is the only place it meets
 * the database.
 */
import type { Db } from "./db";
import {
  RATING_START,
  displayRungFor,
  loserGlory,
  rankChangeBetween,
  tierFor,
  updateRating,
  winnerGlory,
  type TierName,
} from "./elo";

export interface RankedRating {
  subjectId: string;
  season: number;
  bracket: string;
  rating: number;
  wins: number;
  losses: number;
  /** Season-high rating — monotonic (bits-ranked.md § display v2). Stored
   * peak_rating 0 means "predates the column"; readers fall back to the live
   * rating so the peak can never read below it. */
  peak: number;
}

const freshRating = (subjectId: string, season: number, bracket: string): RankedRating => ({
  subjectId,
  season,
  bracket,
  rating: RATING_START,
  wins: 0,
  losses: 0,
  peak: RATING_START,
});

/** The subject's ladder row, or the unwritten 1500 default — reads never
 * create rows; the first recorded match does. */
export const getRating = async (
  db: Db,
  subjectId: string,
  season: number,
  bracket: string,
): Promise<RankedRating> => {
  const result = await db.execute({
    sql: `SELECT rating, wins, losses, peak_rating FROM ranked_ratings
          WHERE subject_id = ? AND season = ? AND bracket = ?`,
    args: [subjectId, season, bracket],
  });
  const row = result.rows[0];
  if (!row) return freshRating(subjectId, season, bracket);
  const rating = Number(row["rating"]);
  return {
    subjectId,
    season,
    bracket,
    rating,
    wins: Number(row["wins"]),
    losses: Number(row["losses"]),
    peak: Math.max(rating, Number(row["peak_rating"])),
  };
};

export interface RankedMatchInput {
  /** Server-minted uuid — the idempotency root for the whole settlement. */
  matchId: string;
  season: number;
  bracket: string;
  winnerId: string;
  loserId: string;
  /** Serialized as JSON into ranked_matches (the pick-rate analytics tap). */
  winnerLoadout?: unknown;
  loserLoadout?: unknown;
}

/** One side's settlement, shaped for the `rankedResult` wire message. */
export interface RankedSideResult {
  subjectId: string;
  before: number;
  after: number;
  delta: number;
  /** Display tier WITH the sticky-badge grace applied (displayRungFor) —
   * the client renders titles, never re-implements the bands. */
  tier: TierName;
  /** Division inside the tier (3 = entry, 1 = top); null in the single-rung
   * end tiers (Initiate, Immortal). */
  division: 1 | 2 | 3 | null;
  /** The DISPLAYED rank moved this match (grace included — a dip a sticky
   * badge absorbs is null). Drives the rank_up / rank_down audio moment. */
  rankChange: "up" | "down" | null;
  glory: number;
  /** Season peak after this match settled. */
  peak: number;
  /** This match set a new season peak — the ceremony's celebration hook. */
  newBest: boolean;
  /** Season matches in this bracket AFTER this one settled — callers derive
   * placement presentation from it (≤ PLACEMENT_MATCHES = still placing,
   * where rank and rating stay hidden client-side). */
  matchesPlayed: number;
}

export interface RankedMatchResult {
  matchId: string;
  winner: RankedSideResult;
  loser: RankedSideResult;
}

const ratingUpsert = (r: RankedRating, after: number, peak: number, won: boolean) => ({
  sql: `INSERT INTO ranked_ratings (subject_id, season, bracket, rating, wins, losses, peak_rating, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT (subject_id, season, bracket) DO UPDATE SET
          rating = excluded.rating,
          wins = excluded.wins,
          losses = excluded.losses,
          peak_rating = excluded.peak_rating,
          updated_at = excluded.updated_at`,
  args: [r.subjectId, r.season, r.bracket, after, r.wins + (won ? 1 : 0), r.losses + (won ? 0 : 1), peak],
});

const gloryInsert = (matchId: string, playerId: string, amount: number) => ({
  sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
        VALUES (?, ?, ?, ?)`,
  args: [playerId, amount, `ranked:${matchId}`, `ranked:${matchId}:${playerId}`],
});

const matchInsert = (
  input: { matchId: string; season: number; bracket: string; winnerLoadout?: unknown; loserLoadout?: unknown },
  winnerId: string,
  loserId: string,
  winnerBefore: number,
  winnerAfter: number,
  loserBefore: number,
  loserAfter: number,
) => ({
  sql: `INSERT OR IGNORE INTO ranked_matches (
          id, season, bracket, winner_id, loser_id,
          winner_rating_before, winner_rating_after,
          loser_rating_before, loser_rating_after,
          winner_loadout, loser_loadout)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    input.matchId,
    input.season,
    input.bracket,
    winnerId,
    loserId,
    winnerBefore,
    winnerAfter,
    loserBefore,
    loserAfter,
    input.winnerLoadout === undefined ? null : JSON.stringify(input.winnerLoadout),
    input.loserLoadout === undefined ? null : JSON.stringify(input.loserLoadout),
  ],
});

/**
 * Settle a ranked match: both Elo updates, the history row, and both Glory
 * ledger rows in ONE write batch (a libsql batch is a transaction). Returns
 * null if the match id was already settled — the retry-after-crash no-op.
 * Single-writer by design (the one game server process); the existence check
 * is not a cross-process lock.
 */
export const recordRankedMatch = async (db: Db, input: RankedMatchInput): Promise<RankedMatchResult | null> => {
  const already = await db.execute({
    sql: "SELECT 1 FROM ranked_matches WHERE id = ?",
    args: [input.matchId],
  });
  if (already.rows.length > 0) return null;

  const winner = await getRating(db, input.winnerId, input.season, input.bracket);
  const loser = await getRating(db, input.loserId, input.season, input.bracket);

  const winnerAfter = updateRating({
    rating: winner.rating,
    opponent: loser.rating,
    matchesPlayed: winner.wins + winner.losses,
    won: true,
  });
  const loserAfter = updateRating({
    rating: loser.rating,
    opponent: winner.rating,
    matchesPlayed: loser.wins + loser.losses,
    won: false,
  });
  const winnerPay = winnerGlory(winner.rating, loser.rating);
  const loserPay = loserGlory();
  const winnerPeak = Math.max(winner.peak, winnerAfter);
  const loserPeak = Math.max(loser.peak, loserAfter);

  await db.batch(
    [
      ratingUpsert(winner, winnerAfter, winnerPeak, true),
      ratingUpsert(loser, loserAfter, loserPeak, false),
      matchInsert(input, input.winnerId, input.loserId, winner.rating, winnerAfter, loser.rating, loserAfter),
      gloryInsert(input.matchId, input.winnerId, winnerPay),
      gloryInsert(input.matchId, input.loserId, loserPay),
    ],
    "write",
  );

  return {
    matchId: input.matchId,
    winner: sideOf(input.winnerId, winner, winnerAfter, winnerPeak, winnerPay),
    loser: sideOf(input.loserId, loser, loserAfter, loserPeak, loserPay),
  };
};

export interface RankedBotMatchInput {
  /** Server-minted uuid — the idempotency root, exactly like a human match. */
  matchId: string;
  season: number;
  bracket: string;
  humanId: string;
  humanWon: boolean;
  /** Throwaway `bot:<uuid>` subject — lands ONLY in ranked_matches. */
  botId: string;
  /** The bot's advertised rating, frozen at room creation. */
  botRating: number;
  humanLoadout?: unknown;
  botLoadout?: unknown;
}

/**
 * Settle a ranked match against a backfill bot (bits-ranked-bots.md): the
 * HUMAN's side only — their rating upsert, the history row, and their Glory —
 * in one batch. The bot never gets a ranked_ratings or glory_ledger row (no
 * ladder contamination, nothing for a future leaderboard filter to forget);
 * its side of the result is fabricated purely so the rankedResult broadcast
 * is shaped exactly like a human settlement. The fictional prior is 19 games
 * (settled K, matchesPlayed 20 after this one — never renders as "in
 * placements") with peak = advertised rating.
 */
export const recordRankedBotMatch = async (db: Db, input: RankedBotMatchInput): Promise<RankedMatchResult | null> => {
  const already = await db.execute({
    sql: "SELECT 1 FROM ranked_matches WHERE id = ?",
    args: [input.matchId],
  });
  if (already.rows.length > 0) return null;

  const human = await getRating(db, input.humanId, input.season, input.bracket);
  const humanAfter = updateRating({
    rating: human.rating,
    opponent: input.botRating,
    matchesPlayed: human.wins + human.losses,
    won: input.humanWon,
  });
  const humanPeak = Math.max(human.peak, humanAfter);
  const humanPay = input.humanWon ? winnerGlory(human.rating, input.botRating) : loserGlory();

  const bot: RankedRating = {
    subjectId: input.botId,
    season: input.season,
    bracket: input.bracket,
    rating: input.botRating,
    wins: 10,
    losses: 9,
    peak: input.botRating,
  };
  const botAfter = updateRating({
    rating: input.botRating,
    opponent: human.rating,
    matchesPlayed: bot.wins + bot.losses,
    won: !input.humanWon,
  });
  const botPeak = Math.max(bot.peak, botAfter);
  const botPay = input.humanWon ? loserGlory() : winnerGlory(input.botRating, human.rating);

  const winnerId = input.humanWon ? input.humanId : input.botId;
  const loserId = input.humanWon ? input.botId : input.humanId;
  await db.batch(
    [
      ratingUpsert(human, humanAfter, humanPeak, input.humanWon),
      matchInsert(
        {
          matchId: input.matchId,
          season: input.season,
          bracket: input.bracket,
          winnerLoadout: input.humanWon ? input.humanLoadout : input.botLoadout,
          loserLoadout: input.humanWon ? input.botLoadout : input.humanLoadout,
        },
        winnerId,
        loserId,
        input.humanWon ? human.rating : input.botRating,
        input.humanWon ? humanAfter : botAfter,
        input.humanWon ? input.botRating : human.rating,
        input.humanWon ? botAfter : humanAfter,
      ),
      gloryInsert(input.matchId, input.humanId, humanPay),
    ],
    "write",
  );

  const humanSide = sideOf(input.humanId, human, humanAfter, humanPeak, humanPay);
  const botSide = sideOf(input.botId, bot, botAfter, botPeak, botPay);
  return {
    matchId: input.matchId,
    winner: input.humanWon ? humanSide : botSide,
    loser: input.humanWon ? botSide : humanSide,
  };
};

const sideOf = (
  subjectId: string,
  prior: RankedRating,
  after: number,
  peak: number,
  glory: number,
): RankedSideResult => {
  const rung = displayRungFor(after, peak);
  return {
    subjectId,
    before: prior.rating,
    after,
    delta: after - prior.rating,
    tier: rung.tier,
    division: rung.division,
    rankChange: rankChangeBetween({ rating: prior.rating, peak: prior.peak }, { rating: after, peak }),
    glory,
    peak,
    newBest: after > prior.peak,
    matchesPlayed: prior.wins + prior.losses + 1,
  };
};

export interface LeaderboardEntry {
  subjectId: string;
  rating: number;
  tier: TierName;
  wins: number;
  losses: number;
}

export const leaderboard = async (
  db: Db,
  season: number,
  bracket: string,
  limit = 50,
): Promise<LeaderboardEntry[]> => {
  const result = await db.execute({
    sql: `SELECT subject_id, rating, wins, losses FROM ranked_ratings
          WHERE season = ? AND bracket = ?
          ORDER BY rating DESC, wins DESC LIMIT ?`,
    args: [season, bracket, limit],
  });
  return result.rows.map((row) => ({
    subjectId: String(row["subject_id"]),
    rating: Number(row["rating"]),
    tier: tierFor(Number(row["rating"])),
    wins: Number(row["wins"]),
    losses: Number(row["losses"]),
  }));
};

/** Every bracket the subject has rows in this season — the /ranked/me read. */
export const rankedSummary = async (db: Db, subjectId: string, season: number): Promise<RankedRating[]> => {
  const result = await db.execute({
    sql: `SELECT bracket, rating, wins, losses, peak_rating FROM ranked_ratings
          WHERE subject_id = ? AND season = ? ORDER BY bracket`,
    args: [subjectId, season],
  });
  return result.rows.map((row) => {
    const rating = Number(row["rating"]);
    return {
      subjectId,
      season,
      bracket: String(row["bracket"]),
      rating,
      wins: Number(row["wins"]),
      losses: Number(row["losses"]),
      peak: Math.max(rating, Number(row["peak_rating"])),
    };
  });
};

/**
 * The subject's last `limit` results in a bracket, oldest → newest (reading
 * order for the form-dots row) — true = won. Straight off ranked_matches;
 * rowid breaks created_at's whole-second ties in insertion order.
 */
export const recentForm = async (
  db: Db,
  subjectId: string,
  season: number,
  bracket: string,
  limit = 10,
): Promise<boolean[]> => {
  const result = await db.execute({
    sql: `SELECT winner_id FROM ranked_matches
          WHERE season = ? AND bracket = ? AND (winner_id = ? OR loser_id = ?)
          ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    args: [season, bracket, subjectId, subjectId, limit],
  });
  return result.rows.map((row) => String(row["winner_id"]) === subjectId).reverse();
};
