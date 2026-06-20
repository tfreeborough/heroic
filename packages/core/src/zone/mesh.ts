/**
 * Greedy meshing — collapse a grid of solid cells into a small set of rectangles.
 *
 * Painting collision as cells is the natural authoring tool for organic/curved
 * regions (see docs/design/world-representation.md), but a cell-per-blocker would
 * flood the collision/nav/line-of-sight systems with thousands of tiny boxes. The
 * classic fix is *greedy meshing*: walk the grid, and for each unconsumed solid
 * cell grow a rectangle as wide as it can go, then as tall as that full width
 * stays solid, emit it, and mark those cells consumed. A long wall becomes one
 * rect instead of forty.
 *
 * Not the theoretically-minimal cover, but cheap, deterministic, and good enough
 * that downstream systems see a handful of `Aabb`s. Pure arithmetic — runs at load.
 */
import type { Aabb } from "../physics/crowd";

/** True when cell `(r, c)` exists and is solid (non-zero). */
const solid = (cells: readonly (readonly number[])[], r: number, c: number): boolean =>
  cells[r] !== undefined && (cells[r]![c] ?? 0) !== 0;

/**
 * Merge solid cells of `cells` (`[row][col]`, non-zero = solid) into `Aabb`s
 * (centre + size, world px) at `cellSize` px per cell. Grid origin is world (0, 0):
 * cell `(r, c)` covers `[c·cellSize, r·cellSize]`. Rows may be ragged; missing or
 * `0` entries are treated as empty. Returns `[]` for an empty grid.
 */
export const greedyMesh = (cells: readonly (readonly number[])[], cellSize: number): Aabb[] => {
  if (cellSize <= 0) throw new Error("greedyMesh cellSize must be > 0");
  const rows = cells.length;
  if (rows === 0) return [];
  let cols = 0;
  for (let r = 0; r < rows; r++) cols = Math.max(cols, cells[r]!.length);

  // consumed[r * cols + c] — cells already absorbed into an emitted rectangle.
  const consumed = new Uint8Array(rows * cols);
  const out: Aabb[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (consumed[r * cols + c] || !solid(cells, r, c)) continue;

      // Grow right along this row while solid and unconsumed.
      let w = 1;
      while (c + w < cols && !consumed[r * cols + c + w] && solid(cells, r, c + w)) w++;

      // Grow down while the entire [c, c+w) span of the next row is solid+free.
      let h = 1;
      growDown: while (r + h < rows) {
        for (let cc = c; cc < c + w; cc++) {
          if (consumed[(r + h) * cols + cc] || !solid(cells, r + h, cc)) break growDown;
        }
        h++;
      }

      for (let rr = r; rr < r + h; rr++) {
        for (let cc = c; cc < c + w; cc++) consumed[rr * cols + cc] = 1;
      }

      out.push({
        x: (c + w / 2) * cellSize,
        y: (r + h / 2) * cellSize,
        w: w * cellSize,
        h: h * cellSize,
      });
    }
  }

  return out;
};
