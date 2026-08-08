/**
 * The match-stats accumulator (achievements.md § MatchSummary): fed the
 * ArenaEvent stream tick by tick, it tallies per-player totals; at match end
 * the adapter assembles the finished MatchSummary that feat predicates and
 * counter deltas read. Pure and sim-agnostic about transport — anything that
 * steps a sim and produces ArenaEvents can feed one (the server today, a
 * skirmish room or another game's adapter later).
 *
 * Feat predicates never see raw events — when a feat needs a stat that isn't
 * here (a kill window, an HP sample), THIS class grows it, keeping the
 * summary the single audited surface.
 */
import type { AbilityId, WeaponId } from "../config";
import type { ArenaEvent } from "../events";
import type { Team } from "../state";

export interface PlayerMatchStats {
  /** Lethal blows dealt to enemy PLAYERS (straw men and other deployables
   * never count). */
  kills: number;
  deaths: number;
  /** Damage landed on players (bleed ticks credit their source). Deployable
   * soaks don't count — pumping a straw man is not "dealing damage". */
  damageDealt: number;
  damageTaken: number;
  healingReceived: number;
  /** Healing this player's fonts DEALT (Wave 2: heal events carry their
   * caster) — the healing_done counter's source. Self-heals count: they're
   * real healing output. */
  healingDealt: number;
  /** Shots turned around by this player's Mirror Guard (Wave 2). */
  reflects: number;
  /** Critical hits landed on players (the hit event's crit flag). */
  crits: number;
  casts: Partial<Record<AbilityId, number>>;
  /** Rounds this player's TEAM took (loadouts are per-match, so per-weapon
   * round counters read straight off this). */
  roundsWon: number;
  /** HP fraction when the LAST ingested round closed — null if dead at the
   * close (Wave 2 roundEnd.standing). After the final round it's the
   * decider sample feats like "win the decider under 10%" read. */
  lastRoundHpFrac: number | null;
}

export interface MatchSummaryPlayer {
  id: number;
  team: Team;
  weapon: WeaponId | null;
  bot: boolean;
}

export interface MatchSummary {
  ranked: boolean;
  bracket: string | null;
  teamSize: number;
  winnerTeam: Team;
  roundWins: [number, number];
  /** Each round's winner in play order (0 = a double-wipe draw) — comeback
   * feats read the opening entries. */
  roundWinners: (Team | 0)[];
  players: MatchSummaryPlayer[];
  stats: Record<number, PlayerMatchStats>;
}

const freshStats = (): PlayerMatchStats => ({
  kills: 0,
  deaths: 0,
  damageDealt: 0,
  damageTaken: 0,
  healingReceived: 0,
  healingDealt: 0,
  reflects: 0,
  crits: 0,
  casts: {},
  roundsWon: 0,
  lastRoundHpFrac: null,
});

export class MatchStatsAccumulator {
  private readonly stats = new Map<number, PlayerMatchStats>();
  private readonly teams = new Map<number, Team>();
  private roundWins: [number, number] = [0, 0];
  private readonly roundWinners: (Team | 0)[] = [];

  /** Seats are fixed for a room's life — seed them up front so hit targets
   * can be filtered to real players (deployable ids never match). */
  constructor(players: readonly { id: number; team: Team }[]) {
    for (const p of players) {
      this.stats.set(p.id, freshStats());
      this.teams.set(p.id, p.team);
    }
  }

  /** Feed the events of ONE step batch, exactly once each — the caller hands
   * over what stepSim just returned, never the room's persistent buffer
   * (which lives on across steps until the snapshot flush). */
  ingest(events: readonly ArenaEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case "hit": {
          const target = this.stats.get(e.targetId);
          if (!target) break; // a deployable soaked it
          target.damageTaken += e.damage;
          const attacker = this.stats.get(e.attackerId);
          if (attacker && e.attackerId !== e.targetId) {
            attacker.damageDealt += e.damage;
            if (e.crit) attacker.crits += 1;
            if (e.lethal) attacker.kills += 1;
          }
          break;
        }
        case "death":
          this.stats.get(e.playerId)!.deaths += 1;
          break;
        case "heal": {
          const target = this.stats.get(e.targetId);
          if (target) target.healingReceived += e.amount;
          const caster = this.stats.get(e.casterId);
          if (caster) caster.healingDealt += e.amount;
          break;
        }
        case "reflect": {
          const reflector = this.stats.get(e.playerId);
          if (reflector) reflector.reflects += 1;
          break;
        }
        case "cast": {
          const caster = this.stats.get(e.playerId);
          if (caster) caster.casts[e.ability] = (caster.casts[e.ability] ?? 0) + 1;
          break;
        }
        case "roundEnd": {
          this.roundWins = e.wins;
          this.roundWinners.push(e.winnerTeam);
          if (e.winnerTeam !== 0) {
            for (const [id, team] of this.teams) {
              if (team === e.winnerTeam) this.stats.get(id)!.roundsWon += 1;
            }
          }
          // The close-of-round HP sample: overwritten every round, so after
          // the final ingest it holds the decider's numbers. Dead → null.
          for (const [id, s] of this.stats) s.lastRoundHpFrac = null;
          for (const row of e.standing) {
            const s = this.stats.get(row.id);
            if (s) s.lastRoundHpFrac = row.hpFrac;
          }
          break;
        }
      }
    }
  }

  /** Assemble the finished summary. Weapon/bot metadata arrives here (picks
   * land mid-lobby, after construction); teams must match the seeding. */
  summary(ctx: {
    ranked: boolean;
    bracket: string | null;
    teamSize: number;
    winnerTeam: Team;
    players: readonly MatchSummaryPlayer[];
  }): MatchSummary {
    const stats: Record<number, PlayerMatchStats> = {};
    for (const [id, s] of this.stats) stats[id] = s;
    return {
      ranked: ctx.ranked,
      bracket: ctx.bracket,
      teamSize: ctx.teamSize,
      winnerTeam: ctx.winnerTeam,
      roundWins: this.roundWins,
      roundWinners: [...this.roundWinners],
      players: [...ctx.players],
      stats,
    };
  }
}

/** The summary-side team lookup feat predicates lean on. */
export const summaryTeamOf = (summary: MatchSummary, playerId: number): Team | null =>
  summary.players.find((p) => p.id === playerId)?.team ?? null;

export const wonMatch = (summary: MatchSummary, playerId: number): boolean =>
  summaryTeamOf(summary, playerId) === summary.winnerTeam;
