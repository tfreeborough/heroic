/**
 * Collision polygons (docs/design/world-representation.md § Polygons): an
 * authored outline that becomes ordinary box collision at load.
 *
 * Everything downstream of `loadZone` — `stepCrowd`, the nav grid, the PvP
 * server, the wire — understands only axis-aligned boxes, and none of it needs
 * to change: a polygon is rasterised onto a grid (half a tile by default) by
 * sampling each cell's centre with an even-odd point-in-polygon test, and the
 * filled cells are greedy-meshed into strips. A diagonal edge becomes a
 * half-tile staircase — invisible for the hidden barriers this exists for.
 */
import type { Vec2 } from "../math/vec2";
import type { Aabb } from "../physics/crowd";
import { greedyMesh } from "./mesh";

/** Even-odd (crossing-number) point-in-polygon; concave and self-touching fine. */
export const pointInPolygon = (p: Vec2, poly: readonly Vec2[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/**
 * Rasterise `poly` (world px) onto a `cellSize` grid covering `cols × rows`
 * cells, then mesh the filled cells into as few boxes as possible. Fewer than
 * three points, or a polygon entirely off-grid, yields nothing.
 */
export const rasterizePolygon = (poly: readonly Vec2[], cellSize: number, cols: number, rows: number): Aabb[] => {
  if (poly.length < 3 || cellSize <= 0 || cols <= 0 || rows <= 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const c0 = Math.max(0, Math.floor(minX / cellSize));
  const c1 = Math.min(cols - 1, Math.ceil(maxX / cellSize));
  const r0 = Math.max(0, Math.floor(minY / cellSize));
  const r1 = Math.min(rows - 1, Math.ceil(maxY / cellSize));
  if (c1 < c0 || r1 < r0) return [];
  // Only the polygon's bounding rows/cols are sampled; the mesh runs on that
  // window and is offset back afterwards.
  const w = c1 - c0 + 1;
  const h = r1 - r0 + 1;
  const cells: number[][] = [];
  let any = false;
  for (let r = 0; r < h; r++) {
    const row = new Array<number>(w).fill(0);
    const y = (r0 + r + 0.5) * cellSize;
    for (let c = 0; c < w; c++) {
      if (pointInPolygon({ x: (c0 + c + 0.5) * cellSize, y }, poly)) {
        row[c] = 1;
        any = true;
      }
    }
    cells.push(row);
  }
  if (!any) return [];
  return greedyMesh(cells, cellSize).map((b) => ({ ...b, x: b.x + c0 * cellSize, y: b.y + r0 * cellSize }));
};
