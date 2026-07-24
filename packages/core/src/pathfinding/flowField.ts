/**
 * Flow-field pathfinding — one shared "which way to the player, around walls?"
 * answer for the whole crowd (see docs/design/flow-field-pathfinding.md).
 *
 * A per-enemy A* (`pursue`) computes the route to the player one search at a time,
 * so its cost scales with enemy count. But a horde all chases the SAME target, so
 * we flood once from the player over the nav cells and let every enemy read its cell
 * in O(1): an **integration field** (wall-aware distance to the player per cell) plus
 * a **flow field** (unit direction toward the player per cell). The flood is bounded
 * to an active radius and reused between throttled re-sweeps.
 *
 * Pure + deterministic, like the rest of the pathfinding: same (nav, source, radius)
 * in → same field out; no renderer, no allocation on the read path.
 */
import type { Vec2 } from "../math/vec2";
import { nearestWalkable, worldToCell, type NavGrid } from "./navgrid";

export interface FlowField {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  /**
   * Wall-aware step-distance from the source per cell (row-major, Manhattan). A cell
   * left at `Infinity` was never reached: a wall, or beyond the flood radius — the
   * signal a reader uses to fall back (straight-line steering / A*).
   */
  readonly cost: Float32Array;
  /**
   * Unit direction toward the source per cell (row-major, flat `[dx, dy]` pairs).
   * `{0, 0}` at the source itself and at unreached cells.
   */
  readonly dir: Float32Array;
  /** Cell indices written by the last compute (first `touchedCount` entries) —
   *  reset only these next time, so a re-sweep is O(cells flooded), not
   *  O(whole grid). (Same trick as SpatialGrid.) Preallocated Int32Array, NOT
   *  a number[]: dynamic arrays truncated with `length = 0` can shed their
   *  backing store in Hermes, so every sweep re-grew them element by element —
   *  ~90% of a bot match's total JS allocation (2026-07-24 heap profile). */
  readonly touched: Int32Array;
  touchedCount: number;
}

/** Allocate a field sized to a nav grid (all cells unreached). Reused across sweeps. */
export const createFlowField = (nav: NavGrid): FlowField => {
  const n = nav.cols * nav.rows;
  const cost = new Float32Array(n);
  cost.fill(Infinity);
  return {
    cols: nav.cols,
    rows: nav.rows,
    cellSize: nav.cellSize,
    cost,
    dir: new Float32Array(n * 2),
    touched: new Int32Array(n),
    touchedCount: 0,
  };
};

// Module-scratch BFS frontiers, reused across computes (floods run sequentially —
// ground then flying — so sharing is safe). Preallocated typed arrays sized to
// the largest grid seen, for the same Hermes reason as `touched` above: these
// buffers can never allocate mid-sweep.
let frontier = new Int32Array(0);
let nextFrontier = new Int32Array(0);

// 8-neighbour offsets for the direction pass (orthogonals first, then diagonals).
const N8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

const INV_SQRT2 = 0.7071067811865476;

/**
 * (Re)compute `field` in place: flood the wall-aware distance from `source` over the
 * nav grid's walkable cells, out to `maxRadius` world px, setting each cell's toward-
 * player direction as it's reached. Cells outside the radius or behind walls stay
 * `Infinity`/`{0,0}`.
 *
 * One 8-connected wavefront (uniform cost → Chebyshev distance, no priority queue).
 * A cell's direction points back at the cell that reached it — which, in wave order,
 * is a step *toward the source* — so the whole flow field falls out of the flood with
 * NO second pass (that pass, an 8-neighbour scan per cell, was the bulk of the cost).
 * A diagonal step is only taken when both its orthogonal cells are open, so flow never
 * cuts a wall corner.
 */
export const computeFlowField = (
  field: FlowField,
  nav: NavGrid,
  source: Vec2,
  maxRadius: number,
): void => {
  const { cols, rows, cellSize, cost, dir, touched } = field;
  const matrix = nav.matrix;
  const n = cols * rows;
  if (frontier.length < n) {
    frontier = new Int32Array(n);
    nextFrontier = new Int32Array(n);
  }

  // Reset only the cells the last flood wrote.
  for (let i = 0; i < field.touchedCount; i++) {
    const idx = touched[i]!;
    cost[idx] = Infinity;
    dir[idx * 2] = 0;
    dir[idx * 2 + 1] = 0;
  }
  field.touchedCount = 0;

  // Source cell, nudged to the nearest walkable one (the player may stand in a cell
  // that's inflated-blocked, or off the grid). No walkable source → empty field.
  const src = nearestWalkable(nav, worldToCell(nav, source));
  if (!src) return;

  const maxCost = maxRadius / cellSize;
  const startIdx = src.y * cols + src.x;
  cost[startIdx] = 0;
  let tc = 0;
  touched[tc++] = startIdx;
  let curLen = 0;
  frontier[curLen++] = startIdx;

  while (curLen > 0) {
    let nextLen = 0;
    for (let f = 0; f < curLen; f++) {
      const idx = frontier[f]!;
      const nc = cost[idx]! + 1;
      if (nc > maxCost) continue;
      const cx = idx % cols;
      const cy = (idx - cx) / cols;
      const rowC = matrix[cy]!;
      for (let k = 0; k < 8; k++) {
        const dx = N8[k]![0];
        const dy = N8[k]![1];
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const nIdx = ny * cols + nx;
        if (cost[nIdx] !== Infinity) continue; // already reached (shortest, wave order)
        const rowN = matrix[ny]!;
        if (!rowN[nx]) continue; // wall
        if (dx !== 0 && dy !== 0 && (!rowC[nx] || !rowN[cx])) continue; // no corner-cut
        cost[nIdx] = nc;
        // Direction toward the reaching cell (source-ward) = −(dx, dy).
        if (dx !== 0 && dy !== 0) {
          dir[nIdx * 2] = -dx * INV_SQRT2;
          dir[nIdx * 2 + 1] = -dy * INV_SQRT2;
        } else {
          dir[nIdx * 2] = -dx;
          dir[nIdx * 2 + 1] = -dy;
        }
        touched[tc++] = nIdx;
        nextFrontier[nextLen++] = nIdx;
      }
    }
    const tmp = frontier;
    frontier = nextFrontier;
    nextFrontier = tmp;
    curLen = nextLen;
  }
  field.touchedCount = tc;
};

/** The cell index for a world point, or -1 if outside the grid. */
const cellIndex = (field: FlowField, p: Vec2): number => {
  const c = Math.floor(p.x / field.cellSize);
  const r = Math.floor(p.y / field.cellSize);
  if (c < 0 || c >= field.cols || r < 0 || r >= field.rows) return -1;
  return r * field.cols + c;
};

/**
 * The flow direction (unit vector toward the player) at a world point, or `{0, 0}`
 * when the point is off the grid or in an unreached cell (wall / beyond the flood) —
 * the caller's cue to fall back to straight-line steering or A*.
 */
export const flowAt = (field: FlowField, p: Vec2): Vec2 => {
  const idx = cellIndex(field, p);
  if (idx < 0 || field.cost[idx] === Infinity) return { x: 0, y: 0 };
  return { x: field.dir[idx * 2]!, y: field.dir[idx * 2 + 1]! };
};

/**
 * Whether the field actually covers a world point (reached by the flood). Readers use
 * it to choose the field vs a fallback: a far, off-screen enemy gets `false` and steers
 * straight until the leash brings it into range.
 */
export const flowCovers = (field: FlowField, p: Vec2): boolean => {
  const idx = cellIndex(field, p);
  return idx >= 0 && field.cost[idx] !== Infinity;
};

/**
 * Wall-aware distance (world px, approximate) from a world point to the player along
 * the field, or `Infinity` if unreached. For flee/avoid reads (Phase 2): a kiter
 * retreats toward a neighbour cell with a *greater* value.
 */
export const flowCostAt = (field: FlowField, p: Vec2): number => {
  const idx = cellIndex(field, p);
  if (idx < 0) return Infinity;
  return field.cost[idx]! * field.cellSize;
};
