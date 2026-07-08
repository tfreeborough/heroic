/**
 * The round/match machine. It lives INSIDE the sim step (not in the server) so
 * the whole match — countdowns, benches, rematches — is one deterministic,
 * headless-testable simulation; the server stays pure transport.
 *
 *   waiting ──(both connected)──▶ countdown ──▶ active ──(team wiped)──▶ roundEnd
 *      ▲                                                                  │
 *      └── disconnect (any phase)          countdown ◀─(wins < 3)─────────┤
 *                                          matchEnd  ◀─(wins = 3)─────────┘
 *                                              └──(timer)──▶ fresh match → countdown
 */
import { ATTACK_CYCLE_READY } from "@heroic/core";
import {
  COUNTDOWN_SECONDS,
  MATCH_END_SECONDS,
  ROUND_END_SECONDS,
  WINS_TO_TAKE_MATCH,
} from "./config";
import type { ArenaEvent } from "./events";
import { spawnFacing, type ArenaSim } from "./sim";
import { createDashState, type Team } from "./state";

/** Respawn everyone at their team spawn with a clean slate and start the countdown. */
export const resetForRound = (sim: ArenaSim, events: ArenaEvent[]): void => {
  const { state, zone } = sim;
  for (const p of state.players) {
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
    p.alive = true;
  }
  state.round.phase = "countdown";
  state.round.timer = COUNTDOWN_SECONDS;
  state.round.roundNumber += 1;
  events.push({ type: "roundStart", roundNumber: state.round.roundNumber });
};

const everyoneReady = (sim: ArenaSim): boolean =>
  sim.state.players.length === 2 && sim.state.players.every((p) => p.connected);

/**
 * Advance the non-combat side of the machine by one tick. Returns true when
 * the fight itself should run this tick (phase is "active").
 */
export const tickRoundMachine = (sim: ArenaSim, dt: number, events: ArenaEvent[]): boolean => {
  const round = sim.state.round;
  switch (round.phase) {
    case "waiting": {
      if (everyoneReady(sim)) resetForRound(sim, events);
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
        // Rematch: same players, fresh scoreboard.
        round.wins = [0, 0];
        round.roundNumber = 0;
        round.lastWinner = 0;
        resetForRound(sim, events);
      }
      return false;
    }
  }
};

/** After combat: if a team has been wiped, close the round and score it. */
export const checkRoundOver = (sim: ArenaSim, events: ArenaEvent[]): void => {
  const round = sim.state.round;
  if (round.phase !== "active") return;
  const alive1 = sim.state.players.some((p) => p.team === 1 && p.alive);
  const alive2 = sim.state.players.some((p) => p.team === 2 && p.alive);
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
