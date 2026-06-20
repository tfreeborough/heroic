/**
 * Chunk culling — which chunks does the camera actually see?
 *
 * A large zone holds many chunks, but only a handful overlap the viewport at any
 * moment. The renderer bakes each chunk's static geometry into a reusable picture
 * (app-side) and, each frame, replays only the chunks this returns — so off-screen
 * geometry costs nothing. Pure arithmetic over the chunk grid; no renderer here.
 */

/** The chunk-grid geometry needed to locate chunks in world space (a `Zone` satisfies it). */
export interface ChunkGrid {
  readonly chunkCols: number;
  readonly chunkRows: number;
  /** Chunk side in world px. */
  readonly chunkSize: number;
}

/**
 * Row-major indices (`cy * chunkCols + cx`, matching `Zone.chunks`) of the chunks
 * whose world bounds overlap the axis-aligned view rect `[minX, maxX] × [minY,
 * maxY]`. Clamped to the grid, so a view partly (or wholly) outside the zone just
 * yields the chunks it does cover — possibly none.
 */
export const chunksInView = (
  grid: ChunkGrid,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[] => {
  const { chunkCols, chunkRows, chunkSize } = grid;
  const c0 = Math.max(0, Math.floor(minX / chunkSize));
  const c1 = Math.min(chunkCols - 1, Math.floor(maxX / chunkSize));
  const r0 = Math.max(0, Math.floor(minY / chunkSize));
  const r1 = Math.min(chunkRows - 1, Math.floor(maxY / chunkSize));
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) out.push(r * chunkCols + c);
  }
  return out;
};
