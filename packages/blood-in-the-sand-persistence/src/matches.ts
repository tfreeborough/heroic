/**
 * The match log (hq.md): one row per ONLINE match end, every mode, written
 * by the game server. It answers "how many matches a day, of what shape" —
 * nothing gameplay-facing reads it. Ranked keeps its authoritative rows in
 * ranked_matches; this table is the studio console's cross-mode tally.
 */
import type { Db } from "./db";

export const MATCH_MODES = ["ranked", "skirmish", "brawl"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** One human seat's row (hq-v2.md § Stage 2). */
export interface MatchPlayerInput {
  playerId: string;
  team: number;
  won: boolean;
  weapon?: string | null;
  abilities?: readonly string[] | null;
  kills?: number;
  deaths?: number;
  damageDealt?: number;
  damageTaken?: number;
  /** The seat's median server-measured round trip, whole ms; null = unknown. */
  rttMs?: number | null;
}

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
  /** The zone id the room played (bits-arenas.md); null when unknown. */
  arena?: string | null;
  winnerTeam?: number | null;
  /** The human seats with a resolved account — bots never ride along. */
  players?: readonly MatchPlayerInput[];
}

const whole = (v: number | undefined): number => (v === undefined || !Number.isFinite(v) ? 0 : Math.max(0, Math.round(v)));

/** Record a finished match and its human seats. A second call with the
 * same id is a no-op for every row (both tables key on the match id). */
export const recordMatchLog = async (db: Db, input: MatchLogInput): Promise<void> => {
  const head = {
    sql: `INSERT OR IGNORE INTO match_log
            (id, mode, bracket, team_size, team_count, humans, bots, rounds, duration_s, arena, winner_team)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.arena ?? null,
      input.winnerTeam ?? null,
    ],
  };
  const seats = (input.players ?? []).map((p) => ({
    sql: `INSERT OR IGNORE INTO match_players
            (match_id, player_id, team, won, weapon, abilities, kills, deaths, damage_dealt, damage_taken, rtt_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.matchId,
      p.playerId,
      p.team,
      p.won ? 1 : 0,
      p.weapon ?? null,
      p.abilities === undefined || p.abilities === null ? null : JSON.stringify(p.abilities),
      whole(p.kills),
      whole(p.deaths),
      whole(p.damageDealt),
      whole(p.damageTaken),
      p.rttMs === undefined || p.rttMs === null ? null : Math.round(p.rttMs),
    ],
  }));
  await db.batch([head, ...seats], "write");
};
