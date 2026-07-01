/**
 * Fog of war: a coarse "have I ever seen this?" grid over the world.
 *
 * Line of sight ([[visibility]]) answers *what can I see right now*; fog of war
 * adds memory — areas you've seen before stay faintly known (their static
 * geometry) even after you look away, while never-seen areas stay black. This
 * module owns only the memory grid and how the live sight polygon writes into
 * it; the renderer decides how the three states (visible / explored / unseen)
 * actually look.
 *
 * Pure data + arithmetic, no renderer: the grid is a flat Uint8Array, marked by
 * rasterising the visibility polygon into it each frame.
 */
import type { Vec2 } from "../math/vec2";

export interface FogGrid {
  readonly cols: number;
  readonly rows: number;
  /** World px per cell (square). Grid origin is world (0, 0). */
  readonly cellSize: number;
  /** `seen[row * cols + col]` is 1 once that cell has ever been visible. */
  readonly seen: Uint8Array;
}

/**
 * A fog grid covering `width × height` (world px), initially all unseen. Pass
 * only `width` for a square grid — `height` defaults to it.
 */
export const createFogGrid = (width: number, cellSize: number, height = width): FogGrid => {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  return { cols, rows, cellSize, seen: new Uint8Array(cols * rows) };
};

/** Forget everything — back to fully unexplored (e.g. on a new arena). */
export const resetFog = (fog: FogGrid): void => {
  fog.seen.fill(0);
};

/**
 * Mark cells as seen where they lie inside `poly` AND within `maxRadius` of
 * `origin`. Passing the line-of-sight polygon as `poly` means discovery respects
 * walls (you never reveal what you couldn't actually see), while `maxRadius`
 * bounds it to a sight/discover range. The polygon is scanline-rasterised with
 * the even-odd rule, so the concave sight shapes that form around obstacles fill
 * correctly. Returns true if any previously-unseen cell became seen, so a caller
 * can skip rebuilding cached render data on the (common) frames where the
 * explored area didn't actually grow.
 *
 * `newlySeen`, if given, is cleared and filled with the flat indices (`r*cols+c`)
 * of the cells that became seen this call — so a renderer can update its cached
 * fog geometry *incrementally* (punch out only the new cells) instead of
 * rescanning the whole grid, which matters while the player is moving/exploring.
 */
export const markVisible = (
  fog: FogGrid,
  poly: Vec2[],
  origin: Vec2,
  maxRadius: number,
  newlySeen?: number[],
): boolean => {
  if (newlySeen) newlySeen.length = 0;
  if (poly.length < 3) return false;
  const { cols, rows, cellSize, seen } = fog;
  const r2 = maxRadius * maxRadius;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Scan only rows the polygon AND the radius can both reach.
  const r0 = Math.max(0, Math.floor(Math.max(minY, origin.y - maxRadius) / cellSize));
  const r1 = Math.min(rows - 1, Math.floor(Math.min(maxY, origin.y + maxRadius) / cellSize));

  let changed = false;
  const crossings: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const cy = (r + 0.5) * cellSize; // scanline through this row's cell centres
    const dy = cy - origin.y;
    crossings.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > cy !== b.y > cy) {
        crossings.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((m, n) => m - n);
    // Fill the cells whose centre falls inside each [entry, exit] x-span and
    // within the radius.
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(crossings[k]! / cellSize - 0.5));
      const c1 = Math.min(cols - 1, Math.floor(crossings[k + 1]! / cellSize - 0.5));
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * cellSize - origin.x;
        if (dx * dx + dy * dy > r2) continue;
        const idx = r * cols + c;
        if (seen[idx] === 0) {
          seen[idx] = 1;
          changed = true;
          if (newlySeen) newlySeen.push(idx);
        }
      }
    }
  }
  return changed;
};

/**
 * Mark every cell within `radius` of `origin` as seen — a plain proximity reveal that
 * ignores walls. This is the cheap exploration-fog discovery for games without a
 * line-of-sight polygon: O(cells in the radius box), no visibility solve. Returns true
 * if any previously-unseen cell became seen (so callers can skip cached-render rebuilds
 * on frames that didn't grow the explored area).
 */
export const markVisibleCircle = (fog: FogGrid, origin: Vec2, radius: number): boolean => {
  const { cols, rows, cellSize, seen } = fog;
  const r2 = radius * radius;
  const r0 = Math.max(0, Math.floor((origin.y - radius) / cellSize));
  const r1 = Math.min(rows - 1, Math.floor((origin.y + radius) / cellSize));
  const c0 = Math.max(0, Math.floor((origin.x - radius) / cellSize));
  const c1 = Math.min(cols - 1, Math.floor((origin.x + radius) / cellSize));
  let changed = false;
  for (let r = r0; r <= r1; r++) {
    const dy = (r + 0.5) * cellSize - origin.y;
    const base = r * cols;
    for (let c = c0; c <= c1; c++) {
      const dx = (c + 0.5) * cellSize - origin.x;
      if (dx * dx + dy * dy > r2) continue;
      const idx = base + c;
      if (seen[idx] === 0) {
        seen[idx] = 1;
        changed = true;
      }
    }
  }
  return changed;
};
