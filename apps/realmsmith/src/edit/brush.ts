import { setDecor, setFloor } from "./zoneEdits";
import type { TileGrid } from "@heroic/core";
import type { ZoneFile } from "@heroic/core";

/**
 * What a tile brush paints: one explicit atlas id, or a terrain (autotile)
 * whose ids are solved from the neighbourhood. Floor and decor each remember
 * their own brush.
 */
export type Brush = { kind: "tile"; id: number } | { kind: "terrain"; name: string };

/** A tile layer of the authored zone as the grid the terrain solver paints —
 *  writes go through setFloor/setDecor so their floor↔collision rules still hold. */
export const layerGrid = (z: ZoneFile, layer: "floor" | "decor"): TileGrid => ({
  cols: z.size.cols,
  rows: z.size.rows,
  get:
    layer === "floor"
      ? (col, row) => z.layers.floor[row]?.[col] ?? 0
      : (col, row) => z.layers.decor?.[row]?.[col] ?? 0,
  set: layer === "floor" ? (col, row, id) => setFloor(z, col, row, id) : (col, row, id) => setDecor(z, col, row, id),
});
