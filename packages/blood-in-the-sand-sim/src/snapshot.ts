/**
 * State → wire. Pure projections from ArenaState to the protocol shapes; the
 * server stringifies the result, the client's SnapshotBuffer consumes it.
 */
import { COUNTDOWN_SECONDS, DASH, PLAYER_RADIUS, TICK_RATE, WINS_TO_TAKE_MATCH } from "./config";
import { isDashing } from "./dash";
import type { ArenaEvent } from "./events";
import type {
  ArenaClientConfig,
  PlayerSnapshot,
  ProjectileSnapshot,
  RoomStatePlayer,
  RoundSnapshot,
  SnapshotMsg,
} from "./protocol";
import { seatedPlayers, type ArenaPlayer, type ArenaProjectile, type ArenaState } from "./state";

export const makeClientConfig = (): ArenaClientConfig => ({
  tickRate: TICK_RATE,
  playerRadius: PLAYER_RADIUS,
  dashCooldown: DASH.cooldown,
  winsToTake: WINS_TO_TAKE_MATCH,
  countdownSeconds: COUNTDOWN_SECONDS,
});

const toPlayerSnapshot = (p: ArenaPlayer): PlayerSnapshot => ({
  id: p.id,
  team: p.team,
  name: p.name,
  weapon: p.weapon,
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

const toProjectileSnapshot = (p: ArenaProjectile): ProjectileSnapshot => ({
  id: p.id,
  x: p.pos.x,
  y: p.pos.y,
  angle: Math.atan2(p.dir.y, p.dir.x),
  weapon: p.weapon,
});

export const toSnapshot = (state: ArenaState, events: ArenaEvent[]): SnapshotMsg => ({
  t: "snapshot",
  tick: state.tick,
  round: toRoundSnapshot(state),
  players: seatedPlayers(state).map(toPlayerSnapshot),
  projectiles: state.projectiles.map(toProjectileSnapshot),
  events,
});

export const toRoomStatePlayers = (state: ArenaState): RoomStatePlayer[] =>
  seatedPlayers(state).map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    connected: p.connected,
    weapon: p.weapon,
  }));
