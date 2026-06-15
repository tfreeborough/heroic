/**
 * Path-following pursuit: move toward a goal, routing around walls when the
 * straight line is blocked (see docs/design/enemy-behaviour.md, "Pathing").
 *
 * Steering is local and cheap; A* is global and expensive. So this only
 * pathfinds when asked (the runtime calls it when line of sight is blocked) and
 * re-paths on a throttle, steering along the cached waypoints in between. When
 * there's no route it falls back to a straight seek, so a mover never freezes.
 */
import { distance, length, scale, sub, type Vec2 } from "../math/vec2";
import { findPath } from "../pathfinding/astar";
import { cellCentre, nearestWalkable, worldToCell, type NavGrid } from "../pathfinding/navgrid";

/** Per-mover routing cache, owned by the brain runtime. */
export interface PathState {
  /** Cached route as world points (cell centres), goal-ward; empty = none. */
  waypoints: Vec2[];
  /** Index of the next waypoint to head for. */
  index: number;
  /** Seconds until the next allowed re-path (A* is throttled). */
  cooldown: number;
}

export const initPathState = (): PathState => ({ waypoints: [], index: 0, cooldown: 0 });

/** Seconds between A* re-paths while pursuing out of sight. */
const REPATH_INTERVAL = 0.35;

/**
 * Desired velocity (magnitude `speed`) toward `goal`, routed around walls via
 * the nav grid. Mutates `path` (the per-mover cache). Re-paths to the goal's
 * *live* cell on a throttle, so the mover keeps coming as the target moves.
 */
export const pursue = (
  self: Vec2,
  goal: Vec2,
  speed: number,
  nav: NavGrid,
  path: PathState,
  dt: number,
): Vec2 => {
  path.cooldown -= dt;
  if (path.cooldown <= 0) {
    path.cooldown = REPATH_INTERVAL;
    const start = nearestWalkable(nav, worldToCell(nav, self));
    const goalCell = nearestWalkable(nav, worldToCell(nav, goal));
    if (start && goalCell) {
      // Drop the start cell (we're already there) and steer the rest as world points.
      path.waypoints = findPath(nav.grid, start, goalCell, { diagonal: true })
        .slice(1)
        .map((c) => cellCentre(nav, c));
      path.index = 0;
    }
  }

  // Skip waypoints we've effectively reached.
  while (
    path.index < path.waypoints.length &&
    distance(self, path.waypoints[path.index]!) < nav.cellSize * 0.5
  ) {
    path.index += 1;
  }

  // Head for the next waypoint; with no route, seek the goal directly (never freeze).
  const target = path.waypoints[path.index] ?? goal;
  const dir = sub(target, self);
  const d = length(dir);
  return d === 0 ? { x: 0, y: 0 } : scale(dir, speed / d);
};
