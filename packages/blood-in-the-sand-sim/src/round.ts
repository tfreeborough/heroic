/**
 * The round/match machine. It lives INSIDE the sim step (not in the server) so
 * the whole match — countdowns, benches, lobby returns — is one deterministic,
 * headless-testable simulation; the server stays pure transport.
 *
 *   lobby ─(room full & all armed → 5s arming countdown)─▶ countdown ─▶ active ─(team wiped)─▶ roundEnd
 *     ▲    (joins/leaves cancel it; the host's force-start                               │
 *     │     fills stragglers and passes the gate on a partial room) countdown ◀─(wins < 3)┤
 *     └───────(timer)─── matchEnd ◀─────────────────────────────────────────(wins = 3)───┘
 *
 * Nobody presses START (pvp-loadout-flow.md): the machine watches the lobby
 * and starts the match itself once every seat is armed — an AFK host can't
 * block anything. matchEnd returns everyone to the lobby UNARMED (loadouts
 * clear), so a rematch re-runs the arming wizard — no auto-rematch, exactly
 * as decided 2026-07-09, now enforced by the flow itself. Disconnects never
 * touch the machine mid-match; a dropped player's body idles and stays
 * killable (see sim.markDisconnected).
 */
import { ATTACK_CYCLE_READY } from "@heroic/core";
import {
  ABILITY_IDS,
  COUNTDOWN_SECONDS,
  LOBBY_COUNTDOWN_SECONDS,
  LOADOUT_ABILITY_COUNT,
  MATCH_END_SECONDS,
  ROUND_END_SECONDS,
  WEAPON_IDS,
  WINS_TO_TAKE_MATCH,
} from "./config";
import type { ArenaEvent } from "./events";
import {
  setPlayerAbilities,
  setPlayerWeapon,
  spawnFacing,
  spawnSlotPos,
  teamSlotOf,
  type ArenaSim,
} from "./sim";
import { createAbilitySlots, loadoutComplete, seatedPlayers, type Team } from "./state";

/** Respawn everyone at their team spawn with a clean slate and start the countdown. */
export const resetForRound = (sim: ArenaSim, events: ArenaEvent[]): void => {
  const { state } = sim;
  // Shots and placed things don't cross rounds (ids stay monotonic — the
  // client keys both by id).
  state.projectiles.length = 0;
  state.deployables.length = 0;
  for (const p of seatedPlayers(state)) {
    const spawn = spawnSlotPos(sim, p.team, teamSlotOf(state, p));
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
    p.tauntLeft = 0;
    p.tauntTargetId = null;
    p.slots = createAbilitySlots(p.abilities); // every cooldown clean each round
    p.dots.length = 0;
    p.slowLeft = 0;
    p.slowFactor = 1;
    p.respawnLeft = 0; // a dummy mid-respawn is simply alive again
    p.alive = true;
  }
  state.round.phase = "countdown";
  state.round.timer = COUNTDOWN_SECONDS;
  state.round.roundNumber += 1;
  events.push({ type: "roundStart", roundNumber: state.round.roundNumber });
};

/** Programmatic start (tests, tools): full, connected lobby. Loadout gaps are
 * the caller's business — an unarmed player just fights with defaults. */
export const canStartMatch = (sim: ArenaSim): boolean =>
  sim.state.round.phase === "lobby" &&
  sim.state.players.every((p) => p !== null && p.connected);

/** Fresh scoreboard + everyone to spawns + countdown. */
const beginMatch = (sim: ArenaSim, events: ArenaEvent[]): void => {
  sim.state.round.wins = [0, 0];
  sim.state.round.roundNumber = 0;
  sim.state.round.lastWinner = 0;
  sim.state.round.forced = false; // the override did its job — spent
  resetForRound(sim, events);
};

/**
 * The arming gate (pvp-loadout-flow.md): a FULL room (or the host's force-
 * start override on a partial one), everyone connected, every loadout
 * complete. While this holds in the lobby the round machine runs the arming
 * countdown; the moment it stops holding (a join or leave — picks replace and
 * never clear, so nothing else can break it; both also clear `forced`) the
 * countdown cancels.
 */
export const armingComplete = (sim: ArenaSim): boolean => {
  const seated = seatedPlayers(sim.state);
  return (
    sim.state.round.phase === "lobby" &&
    seated.length >= 2 &&
    (seated.length === sim.state.players.length || sim.state.round.forced) &&
    seated.every((p) => p.connected && loadoutComplete(p))
  );
};

/**
 * The host's start-early control, two jobs in one button: random-fill every
 * incomplete loadout from the sim rng (deterministic — the AFK backstop) AND
 * set the `forced` override so the arming gate passes with empty seats (the
 * partial-room launcher; empty seats simply don't spawn). Either way the SAME
 * 5s countdown runs — a force-start is never instant (Tom 2026-07-14), so
 * the auto-armed straggler gets a beat to see what they were dealt. Needs a
 * body on each team: lobby leave-churn can strand everyone on one side, and
 * forcing that match would be an instant walkover.
 */
export const forceStartMatch = (sim: ArenaSim): boolean => {
  const seated = seatedPlayers(sim.state);
  if (sim.state.round.phase !== "lobby" || seated.length < 2) return false;
  if (!seated.every((p) => p.connected)) return false;
  if (!seated.some((p) => p.team === 1) || !seated.some((p) => p.team === 2)) return false;
  if (armingComplete(sim)) return false; // nothing to do — it's already counting
  for (const p of seated) {
    if (p.weapon === null) {
      setPlayerWeapon(sim, p.id, WEAPON_IDS[Math.floor(sim.rng.next() * WEAPON_IDS.length)]!);
    }
    const hand = [...p.abilities];
    while (hand.length < LOADOUT_ABILITY_COUNT) {
      const pool = ABILITY_IDS.filter((a) => !hand.includes(a));
      hand.push(pool[Math.floor(sim.rng.next() * pool.length)]!);
    }
    setPlayerAbilities(sim, p.id, hand);
  }
  sim.state.round.forced = true;
  return true;
};

/**
 * Any seated player's veto on a bot-filled start (bits-bot-backfill.md): you
 * joined to fight PEOPLE, and a force-start changes what match you're getting
 * — so during its 5s countdown anyone may cancel. Only a countdown with bots
 * in it is cancellable (a full room of humans counting down has no cancel,
 * exactly as before): the bots are dismissed, the countdown stops, and the
 * lobby returns to its partial state with every human loadout intact.
 */
export const cancelStart = (sim: ArenaSim): boolean => {
  const { round } = sim.state;
  if (round.phase !== "lobby" || round.timer <= 0) return false;
  const bots = seatedPlayers(sim.state).filter((p) => p.bot);
  if (bots.length === 0) return false;
  for (const b of bots) sim.state.players[b.id] = null;
  round.timer = 0;
  round.forced = false;
  return true;
};

/**
 * Programmatic match start — tests and tools that don't want to wait out the
 * arming countdown. The live flow never calls this: the lobby case of
 * tickRoundMachine starts the match itself.
 */
export const startMatch = (sim: ArenaSim, events: ArenaEvent[]): boolean => {
  if (!canStartMatch(sim)) return false;
  beginMatch(sim, events);
  return true;
};

/**
 * Advance the non-combat side of the machine by one tick. Returns true when
 * the fight itself should run this tick (phase is "active").
 */
export const tickRoundMachine = (sim: ArenaSim, dt: number, events: ArenaEvent[]): boolean => {
  const round = sim.state.round;
  switch (round.phase) {
    case "lobby": {
      // The arming countdown: nobody presses START. All armed → 5s, shown to
      // every client (it rides round.timer through ordinary snapshots), then
      // the match starts itself. Joins/leaves cancel via addPlayer/removePlayer
      // zeroing the timer; picks can't un-arm anyone (replace, never clear).
      if (!armingComplete(sim)) {
        round.timer = 0;
        return false;
      }
      if (round.timer <= 0) {
        round.timer = LOBBY_COUNTDOWN_SECONDS;
        events.push({ type: "armingComplete" });
        return false;
      }
      round.timer -= dt;
      if (round.timer <= 0) beginMatch(sim, events);
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
        // match" line (cleared by the next match start). Seats whose players
        // never reconnected are freed — they can rejoin the lobby normally —
        // and backfill bots are dismissed with them: their seats open up for
        // real players, and a rematch's force-start seats fresh ones.
        // Everyone returns UNARMED: loadouts clear so the arming countdown
        // can't fire an instant auto-rematch — the wizard reopens (with
        // run-it-back one tap away) and a rematch is a deliberate re-arm.
        round.phase = "lobby";
        round.timer = 0;
        for (let i = 0; i < sim.state.players.length; i++) {
          const p = sim.state.players[i];
          if (p && (!p.connected || p.bot)) sim.state.players[i] = null;
          else if (p) {
            p.weapon = null;
            p.abilities = [];
            p.slots = [];
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
  // Training (the target-dummy range): the round runs until the player leaves —
  // a wiped dummy line is respawnDummies' business, never a round win.
  if (sim.state.training) return;
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
