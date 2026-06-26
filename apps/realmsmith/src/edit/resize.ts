import type { ZoneFile } from "@heroic/core";

/**
 * Resizing a zone. The authored grids (`layers.floor`, optional `layers.decor`,
 * and `collision.cells`) must match the declared `size.cols × size.rows`, or the
 * game's `loadZone` rejects the file. Growing a zone adds **void** (floor id 0 /
 * no collision) in the new area — you then paint floor where the zone extends;
 * shrinking crops the excess. Free collision rects and objects/breakables are world
 * -positioned, so they're untouched (anything now out of bounds is flagged by
 * `validateZone`, not silently deleted).
 */

/** Pad or crop a `[row][col]` grid to `rows × cols`; new cells get `fill`. */
const fitGrid = (grid: number[][], rows: number, cols: number, fill = 0): number[][] => {
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const src = grid[r] ?? [];
    const row = new Array<number>(cols);
    for (let c = 0; c < cols; c++) row[c] = src[c] ?? fill;
    out.push(row);
  }
  return out;
};

/**
 * Make the authored grids match the declared `size` — pad new rows/cols with void
 * and crop any excess. Idempotent. The editor runs this **on open**, so a file
 * whose `size` was hand-edited (or drifted) loads cleanly and is paintable; the
 * game's `loadZone` stays strict, with the editor guaranteeing well-formed files.
 */
export const normalizeZoneFile = (file: ZoneFile): ZoneFile => {
  const { cols, rows } = file.size;
  file.layers.floor = fitGrid(file.layers.floor ?? [], rows, cols);
  if (file.layers.decor) file.layers.decor = fitGrid(file.layers.decor, rows, cols);
  if (file.collision.cells) file.collision.cells = fitGrid(file.collision.cells, rows, cols);
  return file;
};

/**
 * Resize the zone to `cols × rows` tiles (each clamped ≥ 1), padding/cropping every
 * authored grid to match. Returns whether anything changed.
 */
export const resizeZone = (file: ZoneFile, cols: number, rows: number): boolean => {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  if (file.size.cols === c && file.size.rows === r) return false;
  file.size = { cols: c, rows: r };
  normalizeZoneFile(file);
  return true;
};
