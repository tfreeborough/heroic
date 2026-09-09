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
import { SANDS_ATTACKER_ID, TICK_RATE, WINS_TO_TAKE_MATCH, type AbilityId, type WeaponId } from "../config";
import type { ArenaEvent } from "../events";
import type { Team } from "../state";

/** "Within two seconds of each other" — the In Concert window, in ticks. */
export const CONCERT_WINDOW_TICKS = 2 * TICK_RATE;
/** Avenging a fallen partner counts as SWIFT inside this many seconds. */
export const SWIFT_REVENGE_SEC = 5;
/** A body shoved into the Blood Tide that dies inside this window is an
 * Undertow for the shover (bits-sands-deeds.md). */
export const UNDERTOW_WINDOW_SEC = 4;

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

  // ── The Blood Tide (bits-sands-deeds.md). Player-facing name is the
  // Blood Tide; the sim calls it the sands. Every stat here is zero in a
  // round the tide never rose in.
  /** Rounds this player was in when the tide rose. */
  tideRounds: number;
  /** Rounds this player was in, full stop (Watching the Sand Fall reads
   * tideRounds === roundsPlayed). */
  roundsPlayed: number;
  /** Blood ticks taken across the match. */
  tideTicks: number;
  /** Deaths where the killing blow was the tide's. */
  tideDeaths: number;
  /** Killing blows landed AFTER the tide rose that round (the chain). */
  tideKills: number;
  /** Rounds won where this player's blow on the LAST enemy landed while
   * standing in the blood (Baptism). */
  baptisms: number;
  /** Rounds won after taking WAIST_DEEP_TICKS or more blood ticks that
   * round (Waist Deep). */
  waistDeepWins: number;
  /** Rounds won where the last enemy fell to the tide and this player took
   * no blood tick that round (Let the Tide Decide). */
  tideDecidedWins: number;
  /** Rounds won with the closing blow landed after the ring fully closed
   * (The Last Grain). */
  lastGrainWins: number;
  /** Enemies this player put into the tide who died within
   * UNDERTOW_WINDOW_SEC (Undertow). */
  undertows: number;
  /** Times this player already stood inside the final ring at the roll
   * (Dry Feet). */
  eyeOfStorm: number;
  /** The longest round's fight time in seconds — null until a fightStart
   * was clocked (Quicksand reads it; a clockless caller never pops it). */
  longestRoundSec: number | null;

  // ── Skirmish (bits-skirmish-deeds.md). Round-shaped stats the brawl and
  // party-trick deeds read; every one is derived from the per-round scratch
  // and none of them is a ranked counter (the skirmish board's deltas are
  // namespaced — counters.ts).
  /** Most killing blows this player landed in a single round. */
  bestRoundKills: number;
  /** Rounds this player's team won in which they landed NO killing blow
   * (in a brawl: the others did your work, or the Blood Tide did). */
  roundsWonWithoutKilling: number;
  /** Rounds won without taking a single point of damage (tide included). */
  untouchedRoundWins: number;
  /** Rounds in which this player was the second-to-last body standing. */
  runnerUpRounds: number;
  /** Killing blows on a fighter whose team sat on match point while this
   * player's did not (Not Today). */
  matchPointKills: number;
}

/** Blood ticks in one round that make a win Waist Deep (10 s at 0.5 s). */
export const WAIST_DEEP_TICKS = 20;

export interface MatchSummaryPlayer {
  id: number;
  team: Team;
  weapon: WeaponId | null;
  bot: boolean;
  /** Picked hand (Mirror, Mirror reads it) — optional: older callers and
   * ranked tests never supplied it, and no ranked deed needs it. */
  abilities?: readonly AbilityId[];
}

/** Room-level context the SKIRMISH adapter fills (bits-skirmish-deeds.md):
 * everything the friends deeds read that a sim event can't carry. Null on
 * ranked summaries. */
export interface SkirmishRoomContext {
  /** The room was passcode-locked. */
  locked: boolean;
  /** The host's seat at match end. */
  hostSeat: number;
  /** How many consecutive matches this room has played with the SAME set of
   * human accounts, this one included (1 = the first, or the set changed). */
  matchIndex: number;
  /** Seats whose account lost this room's PREVIOUS match to someone now on
   * the losing side (the adapter works it out from account ids). */
  grudgeSeats: readonly number[];
  /** Seats whose account has, over their lifetime, fought both beside and
   * against the same other account (this match included). */
  bothSidesSeats: readonly number[];
}

export interface MatchSummary {
  ranked: boolean;
  bracket: string | null;
  teamSize: number;
  /** Sides in the room — 2 everywhere but the brawl's 6 (bits-brawl.md). */
  teamCount: number;
  /** Skirmish room context, null on ranked summaries. */
  room: SkirmishRoomContext | null;
  winnerTeam: Team;
  /** Indexed team − 1 (length = the room's teamCount; 2 everywhere ranked). */
  roundWins: number[];
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
  tideRounds: 0,
  roundsPlayed: 0,
  tideTicks: 0,
  tideDeaths: 0,
  tideKills: 0,
  baptisms: 0,
  waistDeepWins: 0,
  tideDecidedWins: 0,
  lastGrainWins: 0,
  undertows: 0,
  eyeOfStorm: 0,
  longestRoundSec: null,
  bestRoundKills: 0,
  roundsWonWithoutKilling: 0,
  untouchedRoundWins: 0,
  runnerUpRounds: 0,
  matchPointKills: 0,
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
  /** The tide rose this round. */
  tideLive: boolean;
  /** Blood ticks taken this round, per player. */
  tideTicks: Map<number, number>;
  /** How the round's LAST death happened — the round closers read it. */
  lastDeath: { kind: "tide" } | { kind: "blow"; killer: number; attackerOut: boolean; p: number } | null;
  /** victim → who put them in the tide, and when (the Undertow window). */
  shovedInto: Map<number, { by: number; tick: number }>;
  /** Damage each player took this round, every source (Untouchable). */
  damageTaken: Map<number, number>;
}

const freshScratch = (ids: Iterable<number>): RoundScratch => ({
  alive: new Set(ids),
  damageOn: new Map(),
  killerOf: new Map(),
  deathTick: new Map(),
  kills: new Map(),
  outnumbered: new Set(),
  fightStartTick: null,
  tideLive: false,
  tideTicks: new Map(),
  lastDeath: null,
  shovedInto: new Map(),
  damageTaken: new Map(),
});

export class MatchStatsAccumulator {
  private readonly stats = new Map<number, PlayerMatchStats>();
  private readonly teams = new Map<number, Team>();
  private roundWins: number[] = [0, 0];
  private readonly roundWinners: (Team | 0)[] = [];

  /** Seats are fixed for a room's life — seed them up front so hit targets
   * can be filtered to real players (deployable ids never match). */
  private round: RoundScratch;
  /** Round wins that take the match — match point is one short of it. */
  private readonly winsToTake: number;

  constructor(players: readonly { id: number; team: Team }[], opts: { winsToTake?: number } = {}) {
    this.winsToTake = opts.winsToTake ?? WINS_TO_TAKE_MATCH;
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
          this.round.damageTaken.set(e.targetId, (this.round.damageTaken.get(e.targetId) ?? 0) + e.damage);
          if (e.attackerId === SANDS_ATTACKER_ID) {
            // The Blood Tide's tick: nobody's damage dealt, but the victim's
            // blood-seconds — and, if lethal, the round's last death.
            target.tideTicks += 1;
            this.round.tideTicks.set(e.targetId, (this.round.tideTicks.get(e.targetId) ?? 0) + 1);
            if (e.lethal) {
              target.tideDeaths += 1;
              this.round.lastDeath = { kind: "tide" };
              this.undertow(e.targetId, tick);
            }
            break;
          }
          const attacker = this.stats.get(e.attackerId);
          if (attacker && e.attackerId !== e.targetId) {
            attacker.damageDealt += e.damage;
            if (e.crit) attacker.crits += 1;
            if (this.teams.get(e.attackerId) !== this.teams.get(e.targetId)) {
              const ledger = this.round.damageOn.get(e.targetId) ?? new Map<number, number>();
              ledger.set(e.attackerId, (ledger.get(e.attackerId) ?? 0) + e.damage);
              this.round.damageOn.set(e.targetId, ledger);
            }
            if (e.lethal) {
              this.lethal(e.attackerId, e.targetId, tick);
              if (this.teams.get(e.attackerId) !== this.teams.get(e.targetId)) {
                if (this.round.tideLive) attacker.tideKills += 1;
                this.round.lastDeath = {
                  kind: "blow",
                  killer: e.attackerId,
                  attackerOut: e.tide?.attackerOut ?? false,
                  p: e.tide?.p ?? 0,
                };
                this.undertow(e.targetId, tick);
              }
            }
          }
          break;
        }
        case "sandsStart": {
          this.round.tideLive = true;
          for (const [, s] of this.stats) s.tideRounds += 1;
          for (const id of e.inside) {
            const s = this.stats.get(id);
            if (s) s.eyeOfStorm += 1;
          }
          break;
        }
        case "sandsShove": {
          // Only an ENEMY's shove is an Undertow — a teammate's sinkhole
          // dragging you out is your own problem.
          if (this.teams.get(e.byId) !== this.teams.get(e.victimId) && this.stats.has(e.byId)) {
            this.round.shovedInto.set(e.victimId, { by: e.byId, tick });
          }
          break;
        }
        case "death": {
          this.stats.get(e.playerId)!.deaths += 1;
          this.round.alive.delete(e.playerId);
          this.round.deathTick.set(e.playerId, tick);
          // Second-to-last standing: exactly one body left after this fall.
          if (this.round.alive.size === 1) this.stats.get(e.playerId)!.runnerUpRounds += 1;
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
          // The Blood Tide's round closers (bits-sands-deeds.md).
          const last = this.round.lastDeath;
          for (const [id, s] of this.stats) {
            s.roundsPlayed += 1;
            if (this.round.fightStartTick !== null) {
              const sec = (tick - this.round.fightStartTick) / TICK_RATE;
              if (s.longestRoundSec === null || sec > s.longestRoundSec) s.longestRoundSec = sec;
            }
            if (e.winnerTeam === 0 || this.teams.get(id) !== e.winnerTeam) continue;
            const ticks = this.round.tideTicks.get(id) ?? 0;
            if (ticks >= WAIST_DEEP_TICKS) s.waistDeepWins += 1;
            if (last?.kind === "tide" && ticks === 0) s.tideDecidedWins += 1;
            if (last?.kind === "blow" && last.killer === id) {
              if (last.attackerOut) s.baptisms += 1;
              if (last.p >= 1) s.lastGrainWins += 1;
            }
          }
          // Skirmish round closers (bits-skirmish-deeds.md): best single
          // round, the kill-less win, the untouched win.
          for (const [id, s] of this.stats) {
            const kills = this.round.kills.get(id) ?? 0;
            if (kills > s.bestRoundKills) s.bestRoundKills = kills;
            if (e.winnerTeam === 0 || this.teams.get(id) !== e.winnerTeam) continue;
            if (kills === 0) s.roundsWonWithoutKilling += 1;
            if ((this.round.damageTaken.get(id) ?? 0) === 0) s.untouchedRoundWins += 1;
          }
          break;
        }
      }
    }
  }

  /** `victim` just died — if an enemy put them in the tide inside the
   * window, that's the shover's Undertow (any cause of death counts: the
   * blood, or a blow landed while they flailed in it). */
  private undertow(victim: number, tick: number): void {
    const shove = this.round.shovedInto.get(victim);
    if (!shove) return;
    this.round.shovedInto.delete(victim);
    if (tick - shove.tick <= UNDERTOW_WINDOW_SEC * TICK_RATE) this.stats.get(shove.by)!.undertows += 1;
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

    // Not Today: the victim's side sat on match point (wins as of the last
    // roundEnd) and the killer's did not.
    const victimTeam = this.teams.get(victim);
    const killerTeam = this.teams.get(killer);
    if (victimTeam !== undefined && killerTeam !== undefined && victimTeam !== killerTeam) {
      const matchPoint = this.winsToTake - 1;
      if ((this.roundWins[victimTeam - 1] ?? 0) >= matchPoint && (this.roundWins[killerTeam - 1] ?? 0) < matchPoint) {
        stats.matchPointKills += 1;
      }
    }

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
    /** Defaults to 2 — only brawl rooms pass more. */
    teamCount?: number;
    /** Skirmish only; absent = ranked (null). */
    room?: SkirmishRoomContext | null;
    winnerTeam: Team;
    players: readonly MatchSummaryPlayer[];
  }): MatchSummary {
    const stats: Record<number, PlayerMatchStats> = {};
    for (const [id, s] of this.stats) stats[id] = s;
    return {
      ranked: ctx.ranked,
      bracket: ctx.bracket,
      teamSize: ctx.teamSize,
      teamCount: ctx.teamCount ?? 2,
      room: ctx.room ?? null,
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
