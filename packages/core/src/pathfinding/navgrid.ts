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
  return { grid: gridFromMatrix(matrix), cellSize, cols, rows };
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
