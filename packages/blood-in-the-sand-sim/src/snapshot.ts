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
import { seatedPlayers, type ArenaPlayer, type ArenaProjectile, type ArenaState, type Team } from "./state";

export const makeClientConfig = (): ArenaClientConfig => ({
  tickRate: TICK_RATE,
  playerRadius: PLAYER_RADIUS,
  dashCooldown: DASH.cooldown,
  winsToTake: WINS_TO_TAKE_MATCH,
  countdownSeconds: COUNTDOWN_SECONDS,
});

/** Seconds until a player's LAST pending bleed tick (0 = no active dots). */
const bleedRemaining = (p: ArenaPlayer): number => {
  let left = 0;
  for (const d of p.dots) left = Math.max(left, d.tLeft + (d.ticksLeft - 1) * d.interval);
  return left;
};

const toPlayerSnapshot = (p: ArenaPlayer, hideWeapon: boolean): PlayerSnapshot => ({
  id: p.id,
  team: p.team,
  name: p.name,
  weapon: hideWeapon ? null : p.weapon,
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
  slowLeft: p.slowLeft,
  bleedLeft: bleedRemaining(p),
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

export const toSnapshot = (state: ArenaState, events: ArenaEvent[]): SnapshotMsg => {
  // Snapshots are ONE broadcast for the whole room, so hidden-pick phases
  // scrub the weapon for everyone (nothing renders weapons before countdown).
  const hideWeapon =
    state.round.phase === "lobby" || state.round.phase === "pick" || state.round.phase === "reveal";
  return {
    t: "snapshot",
    tick: state.tick,
    round: toRoundSnapshot(state),
    players: seatedPlayers(state).map((p) => toPlayerSnapshot(p, hideWeapon)),
    projectiles: state.projectiles.map(toProjectileSnapshot),
    events,
  };
};

/**
 * The room roster AS SEEN BY one team — live picks are team secrets until the
 * match starts (pvp-pick-ceremony.md). `viewerTeam` 0 is the neutral (watcher)
 * view: no live picks at all, just the public flags + the lock-in reveal.
 */
export const toRoomStatePlayers = (state: ArenaState, viewerTeam: Team | 0): RoomStatePlayer[] =>
  seatedPlayers(state).map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    connected: p.connected,
    weapon: p.team === viewerTeam ? p.weapon : null,
    abilities: p.team === viewerTeam ? [...p.abilities] : null,
    // Weapon-only until the loadout sheet makes abilities draftable in the UI —
    // loadoutComplete(p) here would read "choosing…" forever to the enemy.
    picked: p.weapon !== null,
    locked: p.lockedIn,
    revealed: p.revealedWeapon,
    revealedAbilities: p.revealedAbilities === null ? null : [...p.revealedAbilities],
  }));
