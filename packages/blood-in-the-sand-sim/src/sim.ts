/**
 * ArenaSim — the runtime wrapper around the serialisable ArenaState: everything
 * derived-once or non-serialisable lives here (zone geometry, LOS occluders,
 * the spatial grid scratch, the live Rng). Rebuildable from (zoneFile, state)
 * alone, which is what makes snapshots/replays possible.
 */
import {
  angleTo,
  createRng,
  createSpatialGrid,
  loadZone,
  makeCombatant,
  rectEdges,
  type Aabb,
  type Rng,
  type SpatialGrid,
  type Vec2,
  type VisionSegment,
  type ZoneFile,
} from "@heroic/core";
import { ABILITIES, LOADOUT_ABILITY_COUNT, PLAYER_STATS, WEAPONS, type AbilityId, type WeaponId } from "./config";
import { createArenaState, createPlayer, type ArenaPlayer, type ArenaState, type RoundPhase, type Team } from "./state";

const GRID_CELL = 64;

export interface ArenaZone {
  id: string;
  size: Vec2;
  /** Every movement blocker (walls ∪ voids) → stepCrowd's walls. */
  collision: Aabb[];
  /** LOS occluders: the edges of sight-blocking walls only. */
  occluders: VisionSegment[];
  /** Team spawn points, indexed team − 1. */
  spawns: [Vec2, Vec2];
}

export interface ArenaSim {
  state: ArenaState;
  zone: ArenaZone;
  /** Scratch for stepCrowd's push-apart broadphase; rebuilt inside each step. */
  grid: SpatialGrid;
  /** Counting shim over createRng(state.seed) — every draw bumps state.rngDraws. */
  rng: Rng;
}

const countingRng = (inner: Rng, state: ArenaState): Rng => ({
  next() {
    state.rngDraws += 1;
    return inner.next();
  },
});

/** Rebuild the RNG stream at a known position — tests and (later) replays/restores. */
export const restoreRng = (seed: number, draws: number): Rng => {
  const rng = createRng(seed);
  for (let i = 0; i < draws; i++) rng.next();
  return rng;
};

export const deriveArenaZone = (file: ZoneFile): ArenaZone => {
  const zone = loadZone(file);
  const spawnOf = (team: Team): Vec2 => {
    const obj = zone.objects.find((o) => o.kind === "playerSpawn" && Number(o.props.team) === team);
    if (!obj) throw new Error(`zone ${zone.id}: no playerSpawn with props.team = ${team}`);
    return { x: obj.x, y: obj.y };
  };
  return {
    id: zone.id,
    size: zone.size,
    collision: zone.collision,
    // Sight-blockers: drawn walls plus occluding prop footprints (solid rocks —
    // hidden collision whose sprite is the visual; docs/design/tilesets.md).
    occluders: [...zone.walls, ...zone.propOccluders].flatMap((w) => rectEdges(w.x, w.y, w.w, w.h)),
    spawns: [spawnOf(1), spawnOf(2)],
  };
};

export const createSim = (zoneFile: ZoneFile, seed: number): ArenaSim => {
  const zone = deriveArenaZone(zoneFile);
  const state = createArenaState(seed);
  return {
    state,
    zone,
    grid: createSpatialGrid(zone.size.x, GRID_CELL, zone.size.y),
    rng: countingRng(restoreRng(seed, state.rngDraws), state),
  };
};

/** Spawn facing the arena centre — reads as "facing your opponent" on any map. */
export const spawnFacing = (sim: ArenaSim, spawn: Vec2): number =>
  angleTo(spawn, { x: sim.zone.size.x / 2, y: sim.zone.size.y / 2 });

/**
 * Seat a new player in the first free seat (lobby only — mid-match the seats
 * are the match roster). Returns null when no seat is free or a match is on.
 * Seat index = id = team − 1, stable until the seat is freed.
 */
export const addPlayer = (sim: ArenaSim, name: string): ArenaPlayer | null => {
  if (sim.state.round.phase !== "lobby") return null;
  const id = sim.state.players.indexOf(null);
  if (id === -1) return null;
  const team = (id + 1) as Team;
  const spawn = sim.zone.spawns[id]!;
  const player = createPlayer(id, name, team, spawn, spawnFacing(sim, spawn));
  sim.state.players[id] = player;
  return player;
};

/** Every phase where loadouts may still change: the lobby, the draft's blind
 * pick, and the counterpick window. Locked everywhere else. */
const repickPhase = (phase: RoundPhase): boolean =>
  phase === "lobby" || phase === "pick" || phase === "reveal";

/**
 * A weapon pick (duplicates allowed — variety by choice, not by rule).
 * Rebuilds the combatant so the weapon's stat overlay lands. Rejected once
 * this draft phase is locked in (lockInPlayer) — repicking means unlocking
 * was never offered: a lock is a lock.
 */
export const setPlayerWeapon = (sim: ArenaSim, id: number, weapon: WeaponId): boolean => {
  const player = sim.state.players[id];
  if (!player || !repickPhase(sim.state.round.phase) || player.lockedIn) return false;
  player.weapon = weapon;
  player.combatant = makeCombatant({ ...PLAYER_STATS, ...WEAPONS[weapon].stats });
  return true;
};

/**
 * The ability draft: up to LOADOUT_ABILITY_COUNT distinct ids, order = the
 * in-match button order. The client sends the whole list each change
 * (idempotent, no add/remove protocol). Same phase/lock gate as the weapon.
 */
export const setPlayerAbilities = (sim: ArenaSim, id: number, abilities: AbilityId[]): boolean => {
  const player = sim.state.players[id];
  if (!player || !repickPhase(sim.state.round.phase) || player.lockedIn) return false;
  if (!Array.isArray(abilities) || abilities.length > LOADOUT_ABILITY_COUNT) return false;
  if (abilities.some((a) => !(a in ABILITIES))) return false;
  if (new Set(abilities).size !== abilities.length) return false;
  player.abilities = [...abilities];
  return true;
};

/** A loadout that can lock: a weapon plus a full ability hand. */
export const loadoutComplete = (p: ArenaPlayer): boolean =>
  p.weapon !== null && p.abilities.length === LOADOUT_ABILITY_COUNT;

/**
 * LOCK IN — commits the loadout for this draft phase (pick or counterpick).
 * Requires a complete loadout; incomplete players are auto-filled when the
 * clock closes the phase instead. Once every connected player is locked the
 * round machine ends the phase early.
 */
export const lockInPlayer = (sim: ArenaSim, id: number): boolean => {
  const phase = sim.state.round.phase;
  if (phase !== "pick" && phase !== "reveal") return false;
  const player = sim.state.players[id];
  if (!player || !loadoutComplete(player)) return false;
  player.lockedIn = true;
  return true;
};

/** Free a seat (lobby only — mid-match a leaver becomes a disconnected body). */
export const removePlayer = (sim: ArenaSim, id: number): boolean => {
  if (sim.state.round.phase !== "lobby") return false;
  if (!sim.state.players[id]) return false;
  sim.state.players[id] = null;
  return true;
};

/**
 * Mid-match disconnect: the match NEVER pauses (decided 2026-07-09). The body
 * idles in place (missing input = IDLE_INPUT), stays killable, and the seat is
 * reserved so a rejoin resumes control of the live character.
 */
export const markDisconnected = (sim: ArenaSim, id: number): void => {
  const player = sim.state.players[id];
  if (player) player.connected = false;
};

/** Claim a disconnected seat — the rejoiner takes over its live character. */
export const reconnectPlayer = (sim: ArenaSim, id: number, name: string): void => {
  const player = sim.state.players[id];
  if (!player) return;
  player.connected = true;
  player.name = name;
};
