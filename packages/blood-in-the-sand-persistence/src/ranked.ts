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
import { RATING_START, loserGlory, tierFor, updateRating, winnerGlory, type TierName } from "./elo";

export interface RankedRating {
  subjectId: string;
  season: number;
  bracket: string;
  rating: number;
  wins: number;
  losses: number;
}

const freshRating = (subjectId: string, season: number, bracket: string): RankedRating => ({
  subjectId,
  season,
  bracket,
  rating: RATING_START,
  wins: 0,
  losses: 0,
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
    sql: `SELECT rating, wins, losses FROM ranked_ratings
          WHERE subject_id = ? AND season = ? AND bracket = ?`,
    args: [subjectId, season, bracket],
  });
  const row = result.rows[0];
  if (!row) return freshRating(subjectId, season, bracket);
  return {
    subjectId,
    season,
    bracket,
    rating: Number(row["rating"]),
    wins: Number(row["wins"]),
    losses: Number(row["losses"]),
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
  tier: TierName;
  glory: number;
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

  const upsert = (r: RankedRating, after: number, won: boolean) => ({
    sql: `INSERT INTO ranked_ratings (subject_id, season, bracket, rating, wins, losses, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT (subject_id, season, bracket) DO UPDATE SET
            rating = excluded.rating,
            wins = excluded.wins,
            losses = excluded.losses,
            updated_at = excluded.updated_at`,
    args: [r.subjectId, r.season, r.bracket, after, r.wins + (won ? 1 : 0), r.losses + (won ? 0 : 1)],
  });
  const gloryRow = (playerId: string, amount: number) => ({
    sql: `INSERT OR IGNORE INTO glory_ledger (player_id, amount, source, idempotency_key)
          VALUES (?, ?, ?, ?)`,
    args: [playerId, amount, `ranked:${input.matchId}`, `ranked:${input.matchId}:${playerId}`],
  });

  await db.batch(
    [
      upsert(winner, winnerAfter, true),
      upsert(loser, loserAfter, false),
      {
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
          input.winnerId,
          input.loserId,
          winner.rating,
          winnerAfter,
          loser.rating,
          loserAfter,
          input.winnerLoadout === undefined ? null : JSON.stringify(input.winnerLoadout),
          input.loserLoadout === undefined ? null : JSON.stringify(input.loserLoadout),
        ],
      },
      gloryRow(input.winnerId, winnerPay),
      gloryRow(input.loserId, loserPay),
    ],
    "write",
  );

  return {
    matchId: input.matchId,
    winner: {
      subjectId: input.winnerId,
      before: winner.rating,
      after: winnerAfter,
      delta: winnerAfter - winner.rating,
      tier: tierFor(winnerAfter),
      glory: winnerPay,
      matchesPlayed: winner.wins + winner.losses + 1,
    },
    loser: {
      subjectId: input.loserId,
      before: loser.rating,
      after: loserAfter,
      delta: loserAfter - loser.rating,
      tier: tierFor(loserAfter),
      glory: loserPay,
      matchesPlayed: loser.wins + loser.losses + 1,
    },
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
    sql: `SELECT bracket, rating, wins, losses FROM ranked_ratings
          WHERE subject_id = ? AND season = ? ORDER BY bracket`,
    args: [subjectId, season],
  });
  return result.rows.map((row) => ({
    subjectId,
    season,
    bracket: String(row["bracket"]),
    rating: Number(row["rating"]),
    wins: Number(row["wins"]),
    losses: Number(row["losses"]),
  }));
};
