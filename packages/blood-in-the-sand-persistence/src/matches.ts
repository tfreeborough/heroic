/**
 * The match log (hq.md): one row per ONLINE match end, every mode, written
 * by the game server. It answers "how many matches a day, of what shape" —
 * nothing gameplay-facing reads it. Ranked keeps its authoritative rows in
 * ranked_matches; this table is the studio console's cross-mode tally.
 */
import type { Db } from "./db";

export const MATCH_MODES = ["ranked", "skirmish", "brawl"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export interface MatchLogInput {
  /** The server-minted match id — the idempotency root. */
  matchId: string;
  mode: MatchMode;
  /** The ranked bracket key; null for skirmish and brawl. */
  bracket?: string | null;
  teamSize: number;
  teamCount: number;
  /** Seated humans and bots at match end. */
  humans: number;
  bots: number;
  /** Rounds played. */
  rounds: number;
  /** Lobby-exit to match-end, whole seconds; null when unknown. */
  durationS?: number | null;
}

/** Record a finished match. A second call with the same id is a no-op. */
export const recordMatchLog = async (db: Db, input: MatchLogInput): Promise<void> => {
  await db.execute({
    sql: `INSERT OR IGNORE INTO match_log
            (id, mode, bracket, team_size, team_count, humans, bots, rounds, duration_s)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.matchId,
      input.mode,
      input.bracket ?? null,
      input.teamSize,
      input.teamCount,
      input.humans,
      input.bots,
      input.rounds,
      input.durationS === undefined || input.durationS === null ? null : Math.max(0, Math.round(input.durationS)),
    ],
  });
};
