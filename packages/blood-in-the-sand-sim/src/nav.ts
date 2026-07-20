/**
 * Bot navigation — the wall-aware layer between "the brain wants to be there"
 * and "which way to actually walk" (docs/design/bot-brains.md). Purely local
 * steering can be baited into concave collision pockets (every step toward
 * the target points back into the rock), so behaviours emit GOAL POINTS and
 * this layer resolves them: straight-line when the way is clear, otherwise a
 * flow field flooded from the goal — all reusing core's pathfinding wholesale.
 *
 * The map is public knowledge (humans see the rocks too), so the grid builds
 * from the statically-imported zone, not from anything a client couldn't know.
 * One BotNav per host process, shared by every bot it runs: the per-target
 * flow-field cache is the gauntlet's crowd trick — bots chasing the same
 * target read the same flood.
 */
import {
  buildNavGrid,
  computeFlowField,
  createFlowField,
  flowAt,
  pathClear,
  worldToCell,
  type FlowField,
  type NavGrid,
  type Vec2,
} from "@heroic/core";
import { PLAYER_RADIUS } from "./config";
import type { ArenaZone } from "./sim";

/** World px per nav cell — coarse enough that the whole arena floods in
 * microseconds, fine enough that no authored gap between blockers closes. */
const NAV_CELL = 32;

/** A field older than this many resolves is re-swept even if the target's
 * cell never changed — staleness backstop; the cell-change check is the
 * primary trigger. At one resolve per chasing bot per 30Hz tick this is
 * roughly the doc's ~200ms cadence for a lone pursuer. */
const RESWEEP_RESOLVES = 6;

interface TargetField {
  field: FlowField;
  /** Cell the last flood ran from — re-sweep when the target leaves it. */
  cellX: number;
  cellY: number;
  resolvesSince: number;
}

export interface BotNav {
  readonly grid: NavGrid;
  /** Flood radius covering the whole arena — fields answer from anywhere. */
  readonly floodRadius: number;
  /** One cached flood per goal, keyed by target player id. */
  readonly fields: Map<number, TargetField>;
}

/** Build once per arena per host — static geometry, shared by all bots. */
export const createBotNav = (zone: Pick<ArenaZone, "size" | "collision">): BotNav => ({
  grid: buildNavGrid(zone.size.x, NAV_CELL, zone.collision, PLAYER_RADIUS, zone.size.y),
  floodRadius: zone.size.x + zone.size.y,
  fields: new Map(),
});

/**
 * The walk direction from `from` toward `goal` (a unit vector, or {0,0} at
 * the goal). Straight line when nothing blocks it — one grid raycast — else
 * the flow field flooded from the goal, which routes around any pocket. The
 * field caches under `targetId` (the goal's player id) so a team chasing one
 * player shares a single flood; re-swept when the target changes cell or the
 * staleness backstop trips. An unreached cell (shouldn't happen inside one
 * arena) falls back to the straight direction — motion beats freezing.
 */
export const navDirection = (nav: BotNav, targetId: number, from: Vec2, goal: Vec2): Vec2 => {
  const dx = goal.x - from.x;
  const dy = goal.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: 0, y: 0 };
  const straight = { x: dx / dist, y: dy / dist };
  if (pathClear(nav.grid, from, goal)) return straight;

  let cached = nav.fields.get(targetId);
  if (!cached) {
    cached = { field: createFlowField(nav.grid), cellX: -1, cellY: -1, resolvesSince: 0 };
    nav.fields.set(targetId, cached);
  }
  const cell = worldToCell(nav.grid, goal);
  cached.resolvesSince += 1;
  if (cell.x !== cached.cellX || cell.y !== cached.cellY || cached.resolvesSince >= RESWEEP_RESOLVES) {
    computeFlowField(cached.field, nav.grid, goal, nav.floodRadius);
    cached.cellX = cell.x;
    cached.cellY = cell.y;
    cached.resolvesSince = 0;
  }
  const flow = flowAt(cached.field, from);
  return flow.x === 0 && flow.y === 0 ? straight : flow;
};

/** How far ahead a movement intent is probed for walls before it's walked. */
const PROBE_DIST = 48;

/**
 * A probe is open only if the way is clear AND its endpoint cell is standable.
 * Core's pathClear deliberately skips both endpoint cells (a wall-hugging
 * mover legitimately stands in an inflated cell) — correct for "can I walk to
 * that target", wrong for short intent probes: a probe pointing straight out
 * of the arena ends in an out-of-bounds cell, which the skip waves through.
 * The arena edge exists ONLY as grid bounds (the physics edge is a clamp, not
 * collision boxes), so this endpoint check is what makes a kiting bot slide
 * along the boundary instead of grinding against it.
 */
const probeOpen = (nav: BotNav, from: Vec2, to: Vec2): boolean => {
  if (!pathClear(nav.grid, from, to)) return false;
  const c = worldToCell(nav.grid, to);
  return nav.grid.grid.isWalkable(c.x, c.y);
};

// Candidate rotations off the desired direction, nearest-first — the "slide
// along the wall" scan. 180° last: walking straight back is the resort, not
// the reflex.
const ROTATIONS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, (2 * Math.PI) / 3, (-2 * Math.PI) / 3, (5 * Math.PI) / 6, (-5 * Math.PI) / 6, Math.PI];

/**
 * Resolve a movement intent against nearby geometry: keep `desired` when its
 * short forward probe is clear, otherwise the nearest rotation whose probe
 * is — a strafing or retreating bot slides along a wall instead of grinding
 * into it (the other half of the bait: luring a kiter to back into a
 * pocket). All probes blocked (fully enclosed — not authorable in a sane
 * arena) returns `desired` unchanged.
 */
export const openDirection = (nav: BotNav, from: Vec2, desired: Vec2): Vec2 => {
  const mag = Math.hypot(desired.x, desired.y);
  if (mag < 0.01) return desired;
  const baseAngle = Math.atan2(desired.y, desired.x);
  for (const rot of ROTATIONS) {
    const a = baseAngle + rot;
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const probe = { x: from.x + dir.x * PROBE_DIST, y: from.y + dir.y * PROBE_DIST };
    if (probeOpen(nav, from, probe)) return rot === 0 ? desired : { x: dir.x * mag, y: dir.y * mag };
  }
  return desired;
};

/** Is a committed straight move (a dash) clear the whole way — including a
 * standable landing? Brains check this before spending a dash so the hop
 * never wastes itself on a rock or the arena edge. */
export const dashClear = (nav: BotNav, from: Vec2, dir: Vec2, distance: number): boolean =>
  probeOpen(nav, from, {
    x: from.x + dir.x * (distance + PLAYER_RADIUS),
    y: from.y + dir.y * (distance + PLAYER_RADIUS),
  });
