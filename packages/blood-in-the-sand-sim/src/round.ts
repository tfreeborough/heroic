/**
 * The round/match machine. It lives INSIDE the sim step (not in the server) so
 * the whole match — countdowns, benches, lobby returns — is one deterministic,
 * headless-testable simulation; the server stays pure transport.
 *
 *   lobby ─(host startMatch)─▶ pick ─▶ reveal ─▶ countdown ─▶ active ─(team wiped)─▶ roundEnd
 *     ▲                        (the draft — either phase can be 0s)       │
 *     │                                     countdown ◀─(wins < 3)────────┤
 *     └───────(timer)─── matchEnd ◀───────────────────(wins = 3)──────────┘
 *
 * Nothing is automatic in the lobby: matches start ONLY via startMatch (the
 * host's button), and matchEnd returns everyone to the lobby — no auto-rematch
 * (decided 2026-07-09). Disconnects never touch the machine; a dropped
 * player's body idles and stays killable (see sim.markDisconnected).
 */
import { ATTACK_CYCLE_READY } from "@heroic/core";
import {
  ABILITY_IDS,
  COUNTDOWN_SECONDS,
  LOADOUT_ABILITY_COUNT,
  MATCH_END_SECONDS,
  ROUND_END_SECONDS,
  WEAPON_IDS,
  WINS_TO_TAKE_MATCH,
} from "./config";
import type { ArenaEvent } from "./events";
import { setPlayerWeapon, spawnFacing, type ArenaSim } from "./sim";
import { createDashState, seatedPlayers, type Team } from "./state";

/** Respawn everyone at their team spawn with a clean slate and start the countdown. */
export const resetForRound = (sim: ArenaSim, events: ArenaEvent[]): void => {
  const { state, zone } = sim;
  // Shots don't cross rounds (ids stay monotonic — the client lerps by id).
  state.projectiles.length = 0;
  for (const p of seatedPlayers(state)) {
    const spawn = zone.spawns[p.team - 1]!;
    p.mover.pos.x = spawn.x;
    p.mover.pos.y = spawn.y;
    p.mover.vel.x = 0;
    p.mover.vel.y = 0;
    p.facing = spawnFacing(sim, spawn);
    p.combatant.hp = p.combatant.stats.maxHp;
    p.attack = ATTACK_CYCLE_READY;
    p.targetId = null;
    p.lockedTargetId = null;
    p.lockedFacing = p.facing;
    p.dash = createDashState();
    p.dots.length = 0;
    p.slowLeft = 0;
    p.slowFactor = 1;
    p.alive = true;
  }
  state.round.phase = "countdown";
  state.round.timer = COUNTDOWN_SECONDS;
  state.round.roundNumber += 1;
  events.push({ type: "roundStart", roundNumber: state.round.roundNumber });
};

/** Can the host's start button do anything right now? Picks are NOT required —
 * unpicked seats auto-fill at lock-in (pvp-pick-ceremony.md). */
export const canStartMatch = (sim: ArenaSim): boolean =>
  sim.state.round.phase === "lobby" &&
  sim.state.players.every((p) => p !== null && p.connected);

/** Fresh scoreboard + everyone to spawns + countdown — the ceremony's exit. */
const beginMatch = (sim: ArenaSim, events: ArenaEvent[]): void => {
  sim.state.round.wins = [0, 0];
  sim.state.round.roundNumber = 0;
  sim.state.round.lastWinner = 0;
  resetForRound(sim, events);
};

/** Draft timings; both 0 (the default) = no ceremony at all (practice, tests). */
export interface DraftCeremony {
  /** Blind-pick phase length. 0 = skip it: the lobby was the blind pick (v6 flow). */
  pickSeconds?: number;
  /** Counterpick window after the reveal. 0 = reveal-and-go. */
  adjustSeconds?: number;
}

/**
 * Close a draft phase: incomplete loadouts random-fill from the sim rng
 * (deterministic), every pick snapshots into revealed* (what the enemy team is
 * shown), and the per-phase locks reset for whatever comes next.
 */
const lockAndReveal = (sim: ArenaSim): void => {
  for (const p of seatedPlayers(sim.state)) {
    p.lockedIn = false; // must precede setPlayerWeapon: locks block repicks
    if (p.weapon === null) {
      setPlayerWeapon(sim, p.id, WEAPON_IDS[Math.floor(sim.rng.next() * WEAPON_IDS.length)]!);
    }
    while (p.abilities.length < LOADOUT_ABILITY_COUNT) {
      const pool = ABILITY_IDS.filter((a) => !p.abilities.includes(a));
      p.abilities.push(pool[Math.floor(sim.rng.next() * pool.length)]!);
    }
    p.revealedWeapon = p.weapon;
    p.revealedAbilities = [...p.abilities];
  }
};

/** Every connected player locked = nobody left to wait for (a disconnected
 * body can't lock; the clock covers it). */
const allLocked = (sim: ArenaSim): boolean =>
  seatedPlayers(sim.state).every((p) => p.lockedIn || !p.connected);

/**
 * The host pressed start: begin the draft (docs/design/pvp-abilities.md).
 * With pickSeconds > 0 the blind-pick phase opens first (LOCK IN or the clock
 * closes it); otherwise lock-in happens immediately from the lobby picks (the
 * v6 ceremony). With adjustSeconds > 0 the reveal/counterpick window follows;
 * otherwise the countdown starts at once. Returns false (and does nothing)
 * unless the lobby is full and connected.
 */
export const startMatch = (sim: ArenaSim, events: ArenaEvent[], ceremony: DraftCeremony = {}): boolean => {
  if (!canStartMatch(sim)) return false;
  const pickSeconds = ceremony.pickSeconds ?? 0;
  const adjustSeconds = ceremony.adjustSeconds ?? 0;
  sim.state.round.adjustSeconds = adjustSeconds;
  if (pickSeconds > 0) {
    for (const p of seatedPlayers(sim.state)) p.lockedIn = false;
    sim.state.round.phase = "pick";
    sim.state.round.timer = pickSeconds;
    return true;
  }
  lockAndReveal(sim);
  if (adjustSeconds > 0) {
    sim.state.round.phase = "reveal";
    sim.state.round.timer = adjustSeconds;
  } else {
    beginMatch(sim, events);
  }
  return true;
};

/**
 * Advance the non-combat side of the machine by one tick. Returns true when
 * the fight itself should run this tick (phase is "active").
 */
export const tickRoundMachine = (sim: ArenaSim, dt: number, events: ArenaEvent[]): boolean => {
  const round = sim.state.round;
  switch (round.phase) {
    case "lobby":
      return false; // host-driven only — nothing ticks here
    case "pick": {
      // The blind pick: everyone drafting, enemy rows show lock states only.
      round.timer -= dt;
      if (round.timer <= 0 || allLocked(sim)) {
        lockAndReveal(sim);
        if (round.adjustSeconds > 0) {
          round.phase = "reveal";
          round.timer = round.adjustSeconds;
        } else {
          beginMatch(sim, events);
        }
      }
      return false;
    }
    case "reveal": {
      // The counterpick window: repicks land via setPlayer*; locks end it early.
      round.timer -= dt;
      if (round.timer <= 0 || allLocked(sim)) beginMatch(sim, events);
      return false;
    }
    case "countdown": {
      round.timer -= dt;
      if (round.timer <= 0) {
        round.phase = "active";
        round.timer = 0;
        events.push({ type: "fightStart" });
      }
      return round.phase === "active";
    }
    case "active":
      return true;
    case "roundEnd": {
      round.timer -= dt;
      if (round.timer <= 0) {
        const best = Math.max(round.wins[0], round.wins[1]);
        if (best >= WINS_TO_TAKE_MATCH) {
          round.phase = "matchEnd";
          round.timer = MATCH_END_SECONDS;
          events.push({ type: "matchEnd", winnerTeam: (round.wins[0] > round.wins[1] ? 1 : 2) as Team });
        } else {
          resetForRound(sim, events);
        }
      }
      return false;
    }
    case "matchEnd": {
      round.timer -= dt;
      if (round.timer <= 0) {
        // Back to the lobby. Wins/lastWinner survive for the lobby's "last
        // match" line (cleared by the next startMatch). Seats whose players
        // never reconnected are freed — they can rejoin the lobby normally.
        round.phase = "lobby";
        round.timer = 0;
        for (let i = 0; i < sim.state.players.length; i++) {
          const p = sim.state.players[i];
          if (p && !p.connected) sim.state.players[i] = null;
          // Last draft's reveal and locks are stale once repicking opens again.
          else if (p) {
            p.revealedWeapon = null;
            p.revealedAbilities = null;
            p.lockedIn = false;
          }
        }
      }
      return false;
    }
  }
};

/** After combat: if a team has been wiped, close the round and score it. */
export const checkRoundOver = (sim: ArenaSim, events: ArenaEvent[]): void => {
  const round = sim.state.round;
  if (round.phase !== "active") return;
  const seated = seatedPlayers(sim.state);
  const alive1 = seated.some((p) => p.team === 1 && p.alive);
  const alive2 = seated.some((p) => p.team === 2 && p.alive);
  if (alive1 && alive2) return;

  // Both wiped on the same tick can't happen 1v1 (a dead player never swings),
  // but guard it for the 5v5 future: nobody scores, the round replays.
  const winner: Team | 0 = alive1 ? 1 : alive2 ? 2 : 0;
  if (winner === 1) round.wins[0] += 1;
  else if (winner === 2) round.wins[1] += 1;
  round.lastWinner = winner;
  round.phase = "roundEnd";
  round.timer = ROUND_END_SECONDS;
  events.push({ type: "roundEnd", winnerTeam: winner, wins: [round.wins[0], round.wins[1]] });
};
