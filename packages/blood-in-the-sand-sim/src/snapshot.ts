/**
 * State → wire. Pure projections from ArenaState to the protocol shapes; the
 * server stringifies the result, the client's SnapshotBuffer consumes it.
 */
import {
  COUNTDOWN_SECONDS,
  DASH,
  PLAYER_RADIUS,
  SWORD,
  SWORD_ARC_WIDTH,
  TICK_RATE,
  WINS_TO_TAKE_MATCH,
} from "./config";
import { isDashing } from "./dash";
import type { ArenaEvent } from "./events";
import type { ArenaClientConfig, LobbyPlayer, PlayerSnapshot, RoundSnapshot, SnapshotMsg } from "./protocol";
import type { ArenaState } from "./state";

export const makeClientConfig = (): ArenaClientConfig => ({
  tickRate: TICK_RATE,
  playerRadius: PLAYER_RADIUS,
  reach: SWORD.reach,
  arcWidth: SWORD_ARC_WIDTH,
  windup: SWORD.windup,
  dashCooldown: DASH.cooldown,
  winsToTake: WINS_TO_TAKE_MATCH,
  countdownSeconds: COUNTDOWN_SECONDS,
});

const toPlayerSnapshot = (p: ArenaState["players"][number]): PlayerSnapshot => ({
  id: p.id,
  team: p.team,
  name: p.name,
  x: p.mover.pos.x,
  y: p.mover.pos.y,
  hp: p.combatant.hp,
  maxHp: p.combatant.stats.maxHp,
  alive: p.alive,
  facing: p.facing,
  atk: p.attack.phase,
  atkLeft: p.attack.remaining,
  lockedFacing: p.lockedFacing,
  dashing: isDashing(p.dash),
  dashCd: p.dash.ability.cooldownRemaining,
  lastSeq: p.lastSeq,
});

const toRoundSnapshot = (state: ArenaState): RoundSnapshot => ({
  phase: state.round.phase,
  timer: state.round.timer,
  roundNumber: state.round.roundNumber,
  wins: [state.round.wins[0], state.round.wins[1]],
  lastWinner: state.round.lastWinner,
});

export const toSnapshot = (state: ArenaState, events: ArenaEvent[]): SnapshotMsg => ({
  t: "snapshot",
  tick: state.tick,
  round: toRoundSnapshot(state),
  players: state.players.map(toPlayerSnapshot),
  events,
});

export const toLobby = (state: ArenaState): LobbyPlayer[] =>
  state.players.map((p) => ({ id: p.id, name: p.name, team: p.team, connected: p.connected }));
