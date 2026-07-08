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
  rectEdges,
  type Aabb,
  type Rng,
  type SpatialGrid,
  type Vec2,
  type VisionSegment,
  type ZoneFile,
} from "@heroic/core";
import { createArenaState, createPlayer, type ArenaPlayer, type ArenaState, type Team } from "./state";

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
    occluders: zone.walls.flatMap((w) => rectEdges(w.x, w.y, w.w, w.h)),
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
 * Claim the next free slot (0 then 1). Returns null when the room is full.
 * Slot = id = team − 1, stable for the whole match.
 */
export const addPlayer = (sim: ArenaSim, name: string): ArenaPlayer | null => {
  const id = sim.state.players.length;
  if (id >= 2) return null;
  const team = (id + 1) as Team;
  const spawn = sim.zone.spawns[id]!;
  const player = createPlayer(id, name, team, spawn, spawnFacing(sim, spawn));
  sim.state.players.push(player);
  return player;
};

/** Drop to "waiting" (sim freezes, wins preserved); the slot stays reserved. */
export const markDisconnected = (sim: ArenaSim, id: number): void => {
  const player = sim.state.players.find((p) => p.id === id);
  if (!player) return;
  player.connected = false;
  sim.state.round.phase = "waiting";
  sim.state.round.timer = 0;
};

/** A reserved slot's owner came back — the round machine resumes from "waiting". */
export const reconnectPlayer = (sim: ArenaSim, id: number, name: string): void => {
  const player = sim.state.players.find((p) => p.id === id);
  if (!player) return;
  player.connected = true;
  player.name = name;
};
