/**
 * A navigation grid: the bridge between continuous world space and the uniform
 * [[grid]] that [[findPath]] (A*) walks. Build one once from the level's static
 * blockers; the AI runtime converts world positions to cells, routes, and
 * converts the waypoints back to world space to steer along.
 *
 * Pure geometry — no renderer, no physics. The arena boundary is handled by the
 * grid's own bounds (A* never leaves it), so only interior obstacles are passed.
 */
import type { Vec2 } from "../math/vec2";
import { gridFromMatrix, type Grid, type GridCell } from "./grid";

export interface NavGrid {
  grid: Grid;
  /** World px per cell (square). Grid origin is world (0, 0). */
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /**
   * Row-major walkability backing `grid` (`grid.isWalkable` reads it live). Exposed
   * so a destroyed blocker can reopen just its own footprint in place — see
   * [[releaseNavBlocker]] — instead of rebuilding the whole grid.
   */
  matrix: boolean[][];
}

/** A centre-based axis-aligned rectangle, matching how walls/pillars are stored. */
export interface NavBlocker {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inInflatedRect = (x: number, y: number, b: NavBlocker, inflate: number): boolean =>
  Math.abs(x - b.x) <= b.w / 2 + inflate && Math.abs(y - b.y) <= b.h / 2 + inflate;

/**
 * Build a nav grid over `[0, width] × [0, height]` at `cellSize` (pass only
 * `width` for a square world — `height` defaults to it). A cell is unwalkable
 * when its centre lies within `inflate` of any blocker — inflating by the agent's
 * radius keeps routed paths a body-width clear of walls, so movers don't clip
 * corners. Blockers are centre-based rects (like the arena's `PILLARS`).
 */
export const buildNavGrid = (
  width: number,
  cellSize: number,
  blockers: readonly NavBlocker[],
  inflate: number,
  height = width,
): NavGrid => {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const matrix: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const cy = (r + 0.5) * cellSize;
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellSize;
      row.push(!blockers.some((b) => inInflatedRect(cx, cy, b, inflate)));
    }
    matrix.push(row);
  }
  return { grid: gridFromMatrix(matrix), cellSize, cols, rows, matrix };
};

/**
 * Reopen the cells a now-removed blocker occupied — without rebuilding the grid.
 * Only cells whose centre lies within `inflate` of `removed` can change; each is
 * recomputed against the REMAINING `blockers` (another may still cover it — e.g. a
 * crate flush against a wall, or a breakable straddling a void). O(cells under the
 * blocker), not O(whole grid), so destroying a breakable on a large zone doesn't
 * hitch on a full rebuild. Mutates the grid's backing matrix in place; `nav.grid`
 * reads it live, so the change is visible to pathfinding immediately.
 *
 * `blockers` must be the post-removal set (i.e. NOT include `removed`).
 */
export const releaseNavBlocker = (
  nav: NavGrid,
  removed: NavBlocker,
  inflate: number,
  blockers: readonly NavBlocker[],
): void => {
  const cs = nav.cellSize;
  const c0 = Math.max(0, Math.floor((removed.x - removed.w / 2 - inflate) / cs));
  const c1 = Math.min(nav.cols - 1, Math.floor((removed.x + removed.w / 2 + inflate) / cs));
  const r0 = Math.max(0, Math.floor((removed.y - removed.h / 2 - inflate) / cs));
  const r1 = Math.min(nav.rows - 1, Math.floor((removed.y + removed.h / 2 + inflate) / cs));
  for (let r = r0; r <= r1; r++) {
    const cy = (r + 0.5) * cs;
    for (let c = c0; c <= c1; c++) {
      const cx = (c + 0.5) * cs;
      nav.matrix[r]![c] = !blockers.some((b) => inInflatedRect(cx, cy, b, inflate));
    }
  }
};

/** World point → the grid cell containing it (may be out of bounds; callers clamp). */
export const worldToCell = (nav: NavGrid, p: Vec2): GridCell => ({
  x: Math.floor(p.x / nav.cellSize),
  y: Math.floor(p.y / nav.cellSize),
});

/** Centre of a grid cell in world space — the point a mover steers toward. */
export const cellCentre = (nav: NavGrid, c: GridCell): Vec2 => ({
  x: (c.x + 0.5) * nav.cellSize,
  y: (c.y + 0.5) * nav.cellSize,
});

/**
 * The nearest walkable cell to `c` (itself if already walkable), searched in
 * expanding rings up to `maxRadius` cells. Handles a mover whose own cell is
 * inside an inflated wall — without this, A* would refuse to start and the
 * enemy would freeze against the wall.
 */
export const nearestWalkable = (nav: NavGrid, c: GridCell, maxRadius = 4): GridCell | null => {
  if (nav.grid.isWalkable(c.x, c.y)) return c;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring perimeter only
        if (nav.grid.isWalkable(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy };
      }
    }
  }
  return null;
};

/**
 * Is the straight segment `from`→`to` clear of unwalkable cells? An
 * Amanatides–Woo grid line-walk — O(cells crossed), so it's cheap no matter how
 * many obstacles exist (they're already baked into the grid, inflated by the
 * agent radius). Both ENDPOINT cells are skipped: a mover or its target may
 * legitimately stand in an inflated cell (hugging a wall), and we only care
 * whether something blocks the way *between* them.
 *
 * The AI runtime uses this to decide steer-straight vs. route-around. Unlike a
 * sight raycast (which only sees occluders — walls), this sees *every* movement
 * blocker the grid was built from — walls, voids, breakables, spawner nests — so
 * a mover paths around a barrel or a pit instead of grinding against it even
 * though it can "see" the player straight through it.
 */
export const pathClear = (nav: NavGrid, from: Vec2, to: Vec2): boolean => {
  const cs = nav.cellSize;
  const start = worldToCell(nav, from);
  const goal = worldToCell(nav, to);
  if (start.x === goal.x && start.y === goal.y) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  // t (fraction along the segment) to the first cell boundary on each axis, and
  // the t-increment per whole cell crossed.
  const tDeltaX = dx !== 0 ? cs / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? cs / Math.abs(dy) : Infinity;
  const firstBoundX = (stepX > 0 ? start.x + 1 : start.x) * cs;
  const firstBoundY = (stepY > 0 ? start.y + 1 : start.y) * cs;
  let tMaxX = dx !== 0 ? Math.abs(firstBoundX - from.x) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? Math.abs(firstBoundY - from.y) / Math.abs(dy) : Infinity;
  let cx = start.x;
  let cy = start.y;
  // Two in-bounds cells are at most cols+rows boundary crossings apart.
  for (let guard = nav.cols + nav.rows + 2; guard > 0; guard--) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (cx === goal.x && cy === goal.y) return true; // reached the target cell — all clear
    if (!nav.grid.isWalkable(cx, cy)) return false;
  }
  return true;
};
