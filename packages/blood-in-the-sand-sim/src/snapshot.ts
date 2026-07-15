/**
 * State → wire. Pure projections from ArenaState to the protocol shapes; the
 * server stringifies the result, the client's SnapshotBuffer consumes it.
 */
import { COUNTDOWN_SECONDS, PLAYER_RADIUS, TICK_RATE, WINS_TO_TAKE_MATCH } from "./config";
import { isDashing, reelingTargetOf } from "./abilities";
import type { ArenaEvent } from "./events";
import type {
  ArenaClientConfig,
  DeployableSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  RoomStatePlayer,
  RoundSnapshot,
  SnapshotMsg,
} from "./protocol";
import {
  loadoutComplete,
  seatedPlayers,
  type ArenaPlayer,
  type ArenaProjectile,
  type ArenaState,
  type Deployable,
  type Team,
} from "./state";

export const makeClientConfig = (): ArenaClientConfig => ({
  tickRate: TICK_RATE,
  playerRadius: PLAYER_RADIUS,
  winsToTake: WINS_TO_TAKE_MATCH,
  countdownSeconds: COUNTDOWN_SECONDS,
});

/** Seconds until a player's LAST pending bleed tick (0 = no active dots). */
const bleedRemaining = (p: ArenaPlayer): number => {
  let left = 0;
  for (const d of p.dots) left = Math.max(left, d.tLeft + (d.ticksLeft - 1) * d.interval);
  return left;
};

const toPlayerSnapshot = (p: ArenaPlayer, hidePicks: boolean): PlayerSnapshot => ({
  id: p.id,
  team: p.team,
  name: p.name,
  weapon: hidePicks ? null : p.weapon,
  x: p.mover.pos.x,
  y: p.mover.pos.y,
  hp: p.combatant.hp,
  maxHp: p.combatant.stats.maxHp,
  alive: p.alive,
  facing: p.facing,
  atk: p.attack.phase,
  atkLeft: p.attack.remaining,
  lockedFacing: p.lockedFacing,
  dashing: isDashing(p),
  slowLeft: p.slowLeft,
  bleedLeft: bleedRemaining(p),
  abilities: hidePicks
    ? []
    : p.slots.map((s) => ({
        id: s.id,
        cd: s.ability.cooldownRemaining,
        active: s.ability.activeRemaining,
        charges: s.chargesLeft,
      })),
  reeling: reelingTargetOf(p),
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
  kind: p.kind,
});

const toDeployableSnapshot = (d: Deployable): DeployableSnapshot => ({
  id: d.id,
  kind: d.kind,
  team: d.team,
  x: d.pos.x,
  y: d.pos.y,
  armLeft: d.armLeft,
  lifeLeft: d.lifeLeft,
  hp: d.hp,
});

export const toSnapshot = (state: ArenaState, events: ArenaEvent[]): SnapshotMsg => {
  // Snapshots are ONE broadcast for the whole room, so the lobby scrubs the
  // loadout for everyone (nothing renders picks before countdown; in-match,
  // ability picks reveal through play via cast events — the cast flash).
  const hidePicks = state.round.phase === "lobby";
  return {
    t: "snapshot",
    tick: state.tick,
    round: toRoundSnapshot(state),
    players: seatedPlayers(state).map((p) => toPlayerSnapshot(p, hidePicks)),
    projectiles: state.projectiles.map(toProjectileSnapshot),
    deployables: state.deployables.map(toDeployableSnapshot),
    events,
  };
};

/**
 * The room roster AS SEEN BY one team — live picks are team secrets, forever
 * (pvp-loadout-flow.md: no reveal, ever; in-match the cast flash is the only
 * intel). `viewerTeam` 0 is the neutral (watcher) view: no picks, flags only.
 */
export const toRoomStatePlayers = (state: ArenaState, viewerTeam: Team | 0): RoomStatePlayer[] =>
  seatedPlayers(state).map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    connected: p.connected,
    weapon: p.team === viewerTeam ? p.weapon : null,
    abilities: p.team === viewerTeam ? [...p.abilities] : null,
    armed: loadoutComplete(p),
  }));
