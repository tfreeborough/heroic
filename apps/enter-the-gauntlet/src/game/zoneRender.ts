import { createPicture, Skia, type SkPicture } from "@shopify/react-native-skia";
import type { Zone } from "@heroic/engine";
import { COLORS } from "./constants";

/**
 * Bake each chunk's floor into a reusable `SkPicture`, in world space.
 *
 * The per-chunk bake is the lever that keeps large zones cheap (see
 * docs/design/world-representation.md): the floor is recorded once on zone load
 * and merely *replayed* each frame (with off-screen chunks culled), instead of
 * re-emitting hundreds of tile draws per frame. Void cells (tile id 0) are
 * skipped, so an irregular / L-shaped floor reads as its shape — the void
 * backdrop shows through where there's no tile.
 *
 * Placeholder look: the same light base + dark-checkerboard (by world parity) the
 * arena had, now driven by the floor tile data. When real art lands, swap the draw
 * rule here for `Skia.drawAtlas` against a tileset image keyed by tile id — a
 * change isolated to this function.
 */
export const bakeFloorChunks = (zone: Zone): SkPicture[] => {
  const { tileSize, chunkTiles } = zone;
  const light = Skia.Color(COLORS.tileLight);
  const dark = Skia.Color(COLORS.tileDark);

  return zone.chunks.map((chunk) => {
    // Two paths per chunk (light = every floor cell, dark = odd-parity cells), so
    // the picture is two fills however many tiles — the same batching the static
    // arena used, now per chunk.
    const lightPath = Skia.Path.Make();
    const darkPath = Skia.Path.Make();
    for (let ly = 0; ly < chunkTiles; ly++) {
      for (let lx = 0; lx < chunkTiles; lx++) {
        if (chunk.floor[ly * chunkTiles + lx] === 0) continue; // void → no tile
        const gx = chunk.cx * chunkTiles + lx;
        const gy = chunk.cy * chunkTiles + ly;
        const rect = Skia.XYWHRect(gx * tileSize, gy * tileSize, tileSize, tileSize);
        lightPath.addRect(rect);
        if ((gx + gy) % 2 === 1) darkPath.addRect(rect);
      }
    }
    return createPicture((canvas) => {
      const paint = Skia.Paint();
      paint.setColor(light);
      canvas.drawPath(lightPath, paint);
      paint.setColor(dark);
      canvas.drawPath(darkPath, paint);
    });
  });
};
