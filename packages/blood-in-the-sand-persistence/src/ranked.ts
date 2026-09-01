/**
 * Ranked ladder persistence (bits-ranked.md): per-bracket rating rows and the
 * one writer that settles a match — ratings, history, and Glory in a single
 * atomic batch keyed on the server-minted match id, so a crash-retry can
 * never double-apply.
 *
 * The math lives in elo.ts (pure); this module is the only place it meets
 * the database. Sides are TEAMS (bits-ranked.md § 2v2 solo queue,
 * 2026-08-24): a 1v1 is the size-one case of the same path — every member
 * rates against the enemy team's mean with their own K, and Glory is paid in
 * full to every member, never split.
 */
import type { Db } from "./db";
import {
  RATING_START,
  displayRungFor,
  loserGlory,
  rankChangeBetween,
  teamMean,
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

/** One participant on a side of a match to settle. */
export interface RankedSubjectInput {
  subjectId: string;
  /** Serialized as JSON into the history rows (the pick-rate analytics tap). */
  loadout?: unknown;
  /** Present = a disguised backfill bot (bits-ranked-bots.md): its advertised
   * rating, frozen at room creation. The subject then lands ONLY in the
   * history tables — no ranked_ratings or glory_ledger row (no ladder
   * contamination, nothing for a future leaderboard filter to forget) — but
   * its rating still weighs into the team means every human settles against,
   * and its side of the result is fabricated so the rankedResult broadcast is
   * shaped exactly like a human settlement. */
  botRating?: number;
}

export interface RankedMatchInput {
  /** Server-minted uuid — the idempotency root for the whole settlement. */
  matchId: string;
  season: number;
  bracket: string;
  /** The winning side's members — one for 1v1, two for 2v2. Never empty. */
  winners: RankedSubjectInput[];
  /** The losing side's members. Same size as `winners`. */
  losers: RankedSubjectInput[];
}

/** One participant's settlement, shaped for the `rankedResult` wire rows. */
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
  /** In the order the input sides listed them. */
  winners: RankedSideResult[];
  losers: RankedSideResult[];
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

const loadoutJson = (loadout: unknown): string | null => (loadout === undefined ? null : JSON.stringify(loadout));

/** A side's header-row shape: one subject → its id and loadout verbatim (1v1
 * rows are byte-identical to the pre-team schema); a team → ids comma-joined
 * and loadouts as a JSON array, with the TEAM MEAN in the rating columns
 * (enough to reconstruct the expected score offline). */
const headerSide = (side: { subjectId: string; loadout?: unknown }[]) => ({
  id: side.map((s) => s.subjectId).join(","),
  loadout: side.length === 1 ? loadoutJson(side[0]!.loadout) : JSON.stringify(side.map((s) => s.loadout ?? null)),
});

const matchInsert = (
  input: { matchId: string; season: number; bracket: string },
  winners: { subjectId: string; loadout?: unknown }[],
  losers: { subjectId: string; loadout?: unknown }[],
  winnerBefore: number,
  winnerAfter: number,
  loserBefore: number,
  loserAfter: number,
) => {
  const w = headerSide(winners);
  const l = headerSide(losers);
  return {
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
      w.id,
      l.id,
      Math.round(winnerBefore),
      Math.round(winnerAfter),
      Math.round(loserBefore),
      Math.round(loserAfter),
      w.loadout,
      l.loadout,
    ],
  };
};

/** The per-participant history row (ranked_match_players). `team` is the
 * side's index in the match (1 = winners, 2 = losers) — a settlement
 * convention, not the arena's blue/red. */
const playerInsert = (
  matchId: string,
  subjectId: string,
  team: 1 | 2,
  won: boolean,
  before: number,
  after: number,
  loadout: unknown,
) => ({
  sql: `INSERT OR IGNORE INTO ranked_match_players
          (match_id, subject_id, team, won, rating_before, rating_after, loadout)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
  args: [matchId, subjectId, team, won ? 1 : 0, before, after, loadoutJson(loadout)],
});

/** One member's post-match numbers against the enemy team's mean. */
const settleMember = (prior: RankedRating, enemyMean: number, won: boolean) => {
  const after = updateRating({
    rating: prior.rating,
    opponent: enemyMean,
    matchesPlayed: prior.wins + prior.losses,
    won,
  });
  return { prior, after, peak: Math.max(prior.peak, after) };
};

/** A backfill bot's fictional prior: 19 games (settled K, matchesPlayed 20
 * after this one — never renders as "in placements") at the advertised
 * rating, with peak = advertised. */
const botPrior = (s: RankedSubjectInput, season: number, bracket: string): RankedRating => ({
  subjectId: s.subjectId,
  season,
  bracket,
  rating: s.botRating!,
  wins: 10,
  losses: 9,
  peak: s.botRating!,
});

/**
 * Settle a ranked match: every member's Elo update, the history rows, and
 * every member's Glory in ONE write batch (a libsql batch is a transaction).
 * Returns null if the match id was already settled — the retry-after-crash
 * no-op. Single-writer by design (the one game server process); the
 * existence check is not a cross-process lock.
 *
 * Team math (bits-ranked.md § 2v2 solo queue): each member's expected score
 * is against the ENEMY team's mean rating, updated with their own K and
 * their own placement count; Glory is the full payout per member — winners
 * get `winnerGlory(winnerMean, loserMean)` each, losers the participation
 * floor each. A 1v1 is the size-one case and settles exactly as before.
 *
 * A member with `botRating` is a disguised backfill bot: its fabricated
 * prior stands in wherever a human's ladder row would (the means, the
 * history rows, its fabricated result side), but the persistent writes —
 * rating upsert and Glory — land for humans only. A 1v1 against a bot and a
 * 2v2 with bots in any seats are the same path.
 */
export const recordRankedMatch = async (db: Db, input: RankedMatchInput): Promise<RankedMatchResult | null> => {
  if (input.winners.length === 0 || input.winners.length !== input.losers.length) {
    throw new Error(`ranked settle: malformed sides (${input.winners.length} vs ${input.losers.length})`);
  }
  const already = await db.execute({
    sql: "SELECT 1 FROM ranked_matches WHERE id = ?",
    args: [input.matchId],
  });
  if (already.rows.length > 0) return null;

  const priorOf = async (s: RankedSubjectInput): Promise<RankedRating> =>
    s.botRating !== undefined ? botPrior(s, input.season, input.bracket) : getRating(db, s.subjectId, input.season, input.bracket);
  const winnerPriors: RankedRating[] = [];
  for (const s of input.winners) winnerPriors.push(await priorOf(s));
  const loserPriors: RankedRating[] = [];
  for (const s of input.losers) loserPriors.push(await priorOf(s));
  const winnerMean = teamMean(winnerPriors.map((r) => r.rating));
  const loserMean = teamMean(loserPriors.map((r) => r.rating));

  const human = (i: number, side: RankedSubjectInput[]): boolean => side[i]!.botRating === undefined;
  const winners = winnerPriors.map((prior) => settleMember(prior, loserMean, true));
  const losers = loserPriors.map((prior) => settleMember(prior, winnerMean, false));
  const winnerPay = winnerGlory(winnerMean, loserMean);
  const loserPay = loserGlory();

  await db.batch(
    [
      ...winners.filter((_, i) => human(i, input.winners)).map((m) => ratingUpsert(m.prior, m.after, m.peak, true)),
      ...losers.filter((_, i) => human(i, input.losers)).map((m) => ratingUpsert(m.prior, m.after, m.peak, false)),
      matchInsert(
        input,
        input.winners,
        input.losers,
        winnerMean,
        teamMean(winners.map((m) => m.after)),
        loserMean,
        teamMean(losers.map((m) => m.after)),
      ),
      ...winners.map((m, i) =>
        playerInsert(input.matchId, m.prior.subjectId, 1, true, m.prior.rating, m.after, input.winners[i]!.loadout),
      ),
      ...losers.map((m, i) =>
        playerInsert(input.matchId, m.prior.subjectId, 2, false, m.prior.rating, m.after, input.losers[i]!.loadout),
      ),
      ...winners.filter((_, i) => human(i, input.winners)).map((m) => gloryInsert(input.matchId, m.prior.subjectId, winnerPay)),
      ...losers.filter((_, i) => human(i, input.losers)).map((m) => gloryInsert(input.matchId, m.prior.subjectId, loserPay)),
    ],
    "write",
  );

  return {
    matchId: input.matchId,
    winners: winners.map((m) => sideOf(m.prior.subjectId, m.prior, m.after, m.peak, winnerPay)),
    losers: losers.map((m) => sideOf(m.prior.subjectId, m.prior, m.after, m.peak, loserPay)),
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
 * order for the form-dots row) — true = won. Off the per-participant table
 * (every bracket writes it; pre-table 1v1 rows were backfilled at schema
 * time); rowid breaks created_at's whole-second ties in insertion order.
 */
export const recentForm = async (
  db: Db,
  subjectId: string,
  season: number,
  bracket: string,
  limit = 10,
): Promise<boolean[]> => {
  const result = await db.execute({
    sql: `SELECT p.won FROM ranked_match_players p
          JOIN ranked_matches m ON m.id = p.match_id
          WHERE m.season = ? AND m.bracket = ? AND p.subject_id = ?
          ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
    args: [season, bracket, subjectId, limit],
  });
  return result.rows.map((row) => Number(row["won"]) === 1).reverse();
};
