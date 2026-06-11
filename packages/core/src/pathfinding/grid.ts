/**
 * A simple uniform-cost tile grid. The renderer/physics layer maps these tile
 * coordinates to world/pixel space; the grid itself knows nothing about either.
 */
export interface Grid {
  readonly width: number;
  readonly height: number;
  /** True if a unit may stand on / move through this tile. */
  isWalkable(x: number, y: number): boolean;
}

export interface GridCell {
  x: number;
  y: number;
}

/** Builds a Grid from a row-major array where `true` (or 1) means walkable. */
export const gridFromMatrix = (rows: ReadonlyArray<ReadonlyArray<boolean | number>>): Grid => {
  const height = rows.length;
  const width = height > 0 ? rows[0]!.length : 0;
  return {
    width,
    height,
    isWalkable(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      return Boolean(rows[y]![x]);
    },
  };
};

export const cellKey = (x: number, y: number): number => y * 100000 + x;
