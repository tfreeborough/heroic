/**
 * Uniform spatial grid (a.k.a. "spatial hash") — the broadphase for crowds.
 *
 * The problem it solves: asking "which entities are near this one?" by scanning
 * every other entity is O(n²), and at a few hundred enemies that dominates the
 * frame (see docs/design/enemy-physics-and-crowds.md). A uniform grid buckets
 * entities into square cells once per step (O(n)); a neighbour query then only
 * has to look at the 3×3 block of cells around a point.
 *
 * The guarantee: if `cellSize ≥ R`, then every entity within distance `R` of a
 * query point lies in that point's 3×3 cell block — because two positions ≤ R
 * apart can differ by at most one cell on each axis. So a caller that wants
 * neighbours within `R` checks the 3×3 candidates and distance-filters them; it
 * can never miss one. Pick `cellSize` = the largest query radius you'll use.
 *
 * Stores item *indices* (into some external array), not positions, so it's
 * agnostic to what the items are. Pure data + arithmetic — no allocation on the
 * query path (it drives a caller-supplied callback), so it's safe to run every
 * fixed step. Deterministic and unit-testable, like the rest of @heroic/core.
 */
import type { Vec2 } from "../math/vec2";

export interface SpatialGrid {
  /** World px per cell (square). Grid origin is world (0, 0). */
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  /**
   * `cells[row * cols + col]` holds the indices of items bucketed into that
   * cell. The arrays are reused across rebuilds (cleared, not reallocated).
   */
  readonly cells: number[][];
}

/**
 * A grid covering `width × height`, all cells empty. Pass only `width` for a
 * square grid — `height` defaults to it.
 */
export const createSpatialGrid = (width: number, cellSize: number, height = width): SpatialGrid => {
  if (cellSize <= 0) throw new Error("SpatialGrid cellSize must be > 0");
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const cells: number[][] = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  return { cellSize, cols, rows, cells };
};

/** Column index for a world x, clamped to the grid (out-of-bounds → edge cell). */
const colOf = (grid: SpatialGrid, x: number): number => {
  const c = Math.floor(x / grid.cellSize);
  return c < 0 ? 0 : c >= grid.cols ? grid.cols - 1 : c;
};

/** Row index for a world y, clamped to the grid (out-of-bounds → edge cell). */
const rowOf = (grid: SpatialGrid, y: number): number => {
  const r = Math.floor(y / grid.cellSize);
  return r < 0 ? 0 : r >= grid.rows ? grid.rows - 1 : r;
};

/** Empty every cell (keeps the arrays for reuse — no reallocation). */
export const clearGrid = (grid: SpatialGrid): void => {
  const { cells } = grid;
  for (let i = 0; i < cells.length; i++) cells[i]!.length = 0;
};

/** Bucket item `index` (located at world `x, y`) into its cell. */
export const insertItem = (grid: SpatialGrid, index: number, x: number, y: number): void => {
  grid.cells[rowOf(grid, y) * grid.cols + colOf(grid, x)]!.push(index);
};

/**
 * Clear and refill the grid for items `0..count-1`, reading each item's position
 * from `positionOf`. Call once per step before any queries. O(count).
 */
export const rebuildGrid = (
  grid: SpatialGrid,
  count: number,
  positionOf: (index: number) => Vec2,
): void => {
  clearGrid(grid);
  for (let i = 0; i < count; i++) {
    const p = positionOf(i);
    insertItem(grid, i, p.x, p.y);
  }
};

/**
 * Invoke `fn` once for every item index in the 3×3 cell block around `(x, y)`.
 * Includes the query point's own cell, so an item inserted at `(x, y)` will be
 * visited (callers that pass their own position skip themselves by index).
 * Allocation-free; `fn` does any distance-filtering it needs.
 */
export const forEachNeighbor = (
  grid: SpatialGrid,
  x: number,
  y: number,
  fn: (index: number) => void,
): void => {
  const col = colOf(grid, x);
  const row = rowOf(grid, y);
  const cMin = col > 0 ? col - 1 : 0;
  const cMax = col < grid.cols - 1 ? col + 1 : grid.cols - 1;
  const rMin = row > 0 ? row - 1 : 0;
  const rMax = row < grid.rows - 1 ? row + 1 : grid.rows - 1;
  const { cells, cols } = grid;
  for (let r = rMin; r <= rMax; r++) {
    const base = r * cols;
    for (let c = cMin; c <= cMax; c++) {
      const cell = cells[base + c]!;
      for (let k = 0; k < cell.length; k++) fn(cell[k]!);
    }
  }
};
