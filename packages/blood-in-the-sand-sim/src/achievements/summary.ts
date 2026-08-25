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
import { TICK_RATE, type AbilityId, type WeaponId } from "../config";
import type { ArenaEvent } from "../events";
import type { Team } from "../state";

/** "Within two seconds of each other" — the In Concert window, in ticks. */
export const CONCERT_WINDOW_TICKS = 2 * TICK_RATE;
/** Avenging a fallen partner counts as SWIFT inside this many seconds. */
export const SWIFT_REVENGE_SEC = 5;

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

  // ── Wave 3: the partnership stats (achievements.md § Wave-3, the 2v2
  // board). All derived from the ordered event stream within a round —
  // every one of them is structurally zero in a 1v1 (no teammate, one
  // enemy), which is what keeps the 2v2 board's milestone gate sound.
  /** A TEAMMATE landed the lethal blow on an enemy this player had damaged
   * in the same round. */
  assists: number;
  /** Rounds in which this player landed the lethal blow on two or more
   * enemies — both of them, in a 2v2. */
  doubleKills: number;
  /** Rounds this player won after being left ALONE against a full enemy
   * side (the teammate fell while every enemy still stood). */
  clutchRounds: number;
  /** The last ingested round was a clutch for this player — after the
   * final round, "won the decider alone against both". */
  lastRoundClutch: boolean;
  /** Lethal blows on the enemy who killed this player's teammate earlier in
   * the same round. */
  revengeKills: number;
  /** Revenge kills landed within SWIFT_REVENGE_SEC of the teammate's death. */
  swiftRevenges: number;
  /** Enemy deaths where this player AND a teammate each landed a lethal blow
   * within CONCERT_WINDOW_TICKS of each other (credited to both). */
  concertKills: number;
  /** Seconds from the fight starting to this player's fastest lethal blow,
   * across every round — null if they never killed. */
  fastestKillSec: number | null;
  /** Healing this player dealt to TEAMMATES (never self). */
  alliedHealing: number;
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
  assists: 0,
  doubleKills: 0,
  clutchRounds: 0,
  lastRoundClutch: false,
  revengeKills: 0,
  swiftRevenges: 0,
  concertKills: 0,
  fastestKillSec: null,
  alliedHealing: 0,
});

/** The per-round scratch state the partnership stats are derived from —
 * reset on every roundStart. */
interface RoundScratch {
  alive: Set<number>;
  /** target → attacker → damage this round (the assist ledger). */
  damageOn: Map<number, Map<number, number>>;
  /** victim → killer this round (from the lethal hit). */
  killerOf: Map<number, number>;
  /** victim → tick of death (the swift-revenge clock, the concert window). */
  deathTick: Map<number, number>;
  kills: Map<number, number>;
  /** Players left alone against a full enemy side this round. */
  outnumbered: Set<number>;
  fightStartTick: number | null;
}

const freshScratch = (ids: Iterable<number>): RoundScratch => ({
  alive: new Set(ids),
  damageOn: new Map(),
  killerOf: new Map(),
  deathTick: new Map(),
  kills: new Map(),
  outnumbered: new Set(),
  fightStartTick: null,
});

export class MatchStatsAccumulator {
  private readonly stats = new Map<number, PlayerMatchStats>();
  private readonly teams = new Map<number, Team>();
  private roundWins: [number, number] = [0, 0];
  private readonly roundWinners: (Team | 0)[] = [];

  /** Seats are fixed for a room's life — seed them up front so hit targets
   * can be filtered to real players (deployable ids never match). */
  private round: RoundScratch;

  constructor(players: readonly { id: number; team: Team }[]) {
    for (const p of players) {
      this.stats.set(p.id, freshStats());
      this.teams.set(p.id, p.team);
    }
    this.round = freshScratch(this.stats.keys());
  }

  private teammatesOf(id: number): number[] {
    const team = this.teams.get(id);
    return [...this.teams].filter(([other, t]) => other !== id && t === team).map(([other]) => other);
  }

  private enemiesOf(id: number): number[] {
    const team = this.teams.get(id);
    return [...this.teams].filter(([, t]) => t !== team).map(([other]) => other);
  }

  /** Feed the events of ONE step batch, exactly once each — the caller hands
   * over what stepSim just returned, never the room's persistent buffer
   * (which lives on across steps until the snapshot flush). `tick` is the
   * sim tick the batch was stepped at (Wave 3: the timed partnership stats —
   * a caller without a clock may omit it and the timed stats stay silent). */
  ingest(events: readonly ArenaEvent[], tick = 0): void {
    for (const e of events) {
      switch (e.type) {
        case "roundStart":
          this.round = freshScratch(this.stats.keys());
          break;
        case "fightStart":
          this.round.fightStartTick = tick;
          break;
        case "hit": {
          const target = this.stats.get(e.targetId);
          if (!target) break; // a deployable soaked it
          target.damageTaken += e.damage;
          const attacker = this.stats.get(e.attackerId);
          if (attacker && e.attackerId !== e.targetId) {
            attacker.damageDealt += e.damage;
            if (e.crit) attacker.crits += 1;
            if (this.teams.get(e.attackerId) !== this.teams.get(e.targetId)) {
              const ledger = this.round.damageOn.get(e.targetId) ?? new Map<number, number>();
              ledger.set(e.attackerId, (ledger.get(e.attackerId) ?? 0) + e.damage);
              this.round.damageOn.set(e.targetId, ledger);
            }
            if (e.lethal) this.lethal(e.attackerId, e.targetId, tick);
          }
          break;
        }
        case "death": {
          this.stats.get(e.playerId)!.deaths += 1;
          this.round.alive.delete(e.playerId);
          this.round.deathTick.set(e.playerId, tick);
          // The fallen's teammates who still stand, against a full enemy
          // side: outnumbered from here — a round win now is a clutch.
          const enemies = this.enemiesOf(e.playerId);
          if (enemies.length > 0 && enemies.every((id) => this.round.alive.has(id))) {
            for (const mate of this.teammatesOf(e.playerId)) {
              if (this.round.alive.has(mate)) this.round.outnumbered.add(mate);
            }
          }
          break;
        }
        case "heal": {
          const target = this.stats.get(e.targetId);
          if (target) target.healingReceived += e.amount;
          const caster = this.stats.get(e.casterId);
          if (caster) {
            caster.healingDealt += e.amount;
            if (target && e.casterId !== e.targetId && this.teams.get(e.casterId) === this.teams.get(e.targetId)) {
              caster.alliedHealing += e.amount;
            }
          }
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
          // Wave 3 round closers: the double kill, and the clutch — won the
          // round, alone against a full side, and still standing at the close.
          const standing = new Set(e.standing.map((row) => row.id));
          for (const [id, s] of this.stats) {
            if ((this.round.kills.get(id) ?? 0) >= 2) s.doubleKills += 1;
            const clutch =
              e.winnerTeam !== 0 &&
              this.teams.get(id) === e.winnerTeam &&
              this.round.outnumbered.has(id) &&
              standing.has(id);
            s.lastRoundClutch = clutch;
            if (clutch) s.clutchRounds += 1;
          }
          break;
        }
      }
    }
  }

  /** A lethal blow by `killer` on `victim` at `tick`: the kill itself, the
   * assist for any teammate who softened the victim, the double-kill tally,
   * the revenge check (did the victim kill one of ours this round?), the
   * concert check (did a teammate fell the OTHER enemy just now?), and the
   * fastest-kill clock. */
  private lethal(killer: number, victim: number, tick: number): void {
    const stats = this.stats.get(killer)!;
    stats.kills += 1;
    this.round.kills.set(killer, (this.round.kills.get(killer) ?? 0) + 1);
    this.round.killerOf.set(victim, killer);

    const ledger = this.round.damageOn.get(victim);
    for (const mate of this.teammatesOf(killer)) {
      if ((ledger?.get(mate) ?? 0) > 0) this.stats.get(mate)!.assists += 1;
    }

    // Revenge: the victim had killed one of the killer's teammates this round.
    for (const [fallen, byWhom] of this.round.killerOf) {
      if (byWhom !== victim || fallen === killer) continue;
      if (this.teams.get(fallen) !== this.teams.get(killer)) continue;
      stats.revengeKills += 1;
      const fell = this.round.deathTick.get(fallen);
      if (fell !== undefined && tick - fell <= SWIFT_REVENGE_SEC * TICK_RATE) stats.swiftRevenges += 1;
      break; // one revenge per lethal blow, however many it avenges
    }

    // In concert: a teammate felled another enemy within the window (the
    // teammate's kill is already on the books; credit both now).
    for (const [other, otherKiller] of this.round.killerOf) {
      if (other === victim || otherKiller === killer) continue;
      if (this.teams.get(otherKiller) !== this.teams.get(killer)) continue;
      const when = this.round.deathTick.get(other);
      if (when !== undefined && tick - when <= CONCERT_WINDOW_TICKS) {
        stats.concertKills += 1;
        this.stats.get(otherKiller)!.concertKills += 1;
      }
    }

    if (this.round.fightStartTick !== null) {
      const sec = (tick - this.round.fightStartTick) / TICK_RATE;
      if (stats.fastestKillSec === null || sec < stats.fastestKillSec) stats.fastestKillSec = sec;
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
