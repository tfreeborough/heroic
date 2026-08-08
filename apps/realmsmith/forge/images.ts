/**
 * Image post-processing for the Forge (the `sharp` half of the design doc's
 * "sharp for images, ffmpeg for audio" — see docs/design/asset-forge.md).
 * Generation happens at 1024 for quality; the saved asset is snapped to the
 * style's true pixel grid, crushed to a hard palette budget and quantized so
 * a full icon set costs kilobytes, not megabytes, of app bundle.
 *
 * THE GRID SNAP + PALETTE CRUSH (bits-art-style.md): the early-90s pixel-art
 * style needs every asset on the exact same pixel grid AND under a hard
 * colour budget — gpt-image-1 fakes the grid and shades with thousands of
 * colours, which reads "too clean" (Tom, 2026-08-07). So each save:
 *   1. downscales to the true grid resolution (destroys the model's
 *      inconsistent pseudo-pixels, resamples honest ones);
 *   2. quantizes to the family's palette budget with our OWN median-cut +
 *      4×4 Bayer ORDERED dithering — the authentic VGA checkerboard, where
 *      libimagequant's error-diffusion looks organic/modern (and its
 *      quality-floor semantics silently skip quantization when the floor
 *      can't be met within a colour cap — learned the hard way);
 *   3. hard-thresholds alpha (a pixel is in or out — crisp retro
 *      silhouettes, no fringe);
 *   4. nearest-neighbour upscales to the saved size (blocks baked into the
 *      PNG because RN's Image can't be trusted to nearest-neighbour
 *      upscale; runs of identical pixels cost almost nothing after
 *      deflate).
 */
import sharp from "sharp";

/** 4×4 Bayer ordered-dither threshold matrix — the checkerboard shading of
 * early-90s VGA/Amiga art. Indexed by [y & 3][x & 3]. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Ordered-dither strength in 8-bit channel units — how far the Bayer matrix
 * pushes a pixel before palette lookup. ~28 gives honest checkerboarding in
 * gradients at a 32-colour budget without dissolving flat fills. */
const DITHER_SPREAD = 28;

/** A pixel is opaque or it isn't — hard retro silhouettes, no soft fringe. */
const ALPHA_CUT = 128;

/** Median-cut palette: recursively split the widest-range box at its median
 * until we have `colours` boxes; each box's average is a palette entry.
 * Deterministic, alpha handled by the caller (only opaque pixels arrive). */
const medianCut = (pixels: number[][], colours: number): number[][] => {
  const boxes: number[][][] = [pixels];
  while (boxes.length < colours) {
    let boxIdx = -1;
    let channel = 0;
    let widest = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const p of box) {
          if (p[c]! < min) min = p[c]!;
          if (p[c]! > max) max = p[c]!;
        }
        if (max - min > widest) {
          widest = max - min;
          boxIdx = i;
          channel = c;
        }
      }
    }
    if (boxIdx < 0 || widest === 0) break; // nothing left worth splitting
    const box = boxes[boxIdx]!;
    box.sort((a, b) => a[channel]! - b[channel]!);
    const mid = box.length >> 1;
    boxes.splice(boxIdx, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    const sum = [0, 0, 0];
    for (const p of box) {
      sum[0]! += p[0]!;
      sum[1]! += p[1]!;
      sum[2]! += p[2]!;
    }
    return sum.map((v) => Math.round(v / box.length));
  });
};

/** Crush a grid-resolution image to `colours` with Bayer dithering and hard
 * alpha. Runs at grid scale on purpose: the dither pattern must live on the
 * pixel grid (per-block), never inside upscaled blocks. */
const retroQuantize = async (grid: Buffer, colours: number): Promise<Buffer> => {
  const { data, info } = await sharp(grid).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const opaque: number[][] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! >= ALPHA_CUT) opaque.push([data[i]!, data[i + 1]!, data[i + 2]!]);
  }
  if (opaque.length === 0) return grid; // fully transparent candidate — nothing to crush
  const palette = medianCut(opaque, colours);
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! < ALPHA_CUT) continue; // stays fully transparent zeros
      const push = (BAYER4[y & 3]![x & 3]! / 16 - 0.5) * DITHER_SPREAD;
      const r = data[i]! + push;
      const g = data[i + 1]! + push;
      const b = data[i + 2]! + push;
      let best = 0;
      let bestDist = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const dr = palette[p]![0]! - r;
        const dg = palette[p]![1]! - g;
        const db = palette[p]![2]! - b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      out[i] = palette[best]![0]!;
      out[i + 1] = palette[best]![1]!;
      out[i + 2] = palette[best]![2]!;
      out[i + 3] = 255;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
};

/** Bake the crushed grid up to the saved size with crisp blocks. The final
 * palette encode is safe from the libimagequant fallback trap: the input
 * already has ≤ budget+1 colours, so quality 100 is trivially met and the
 * indexed PNG just buys byte size. */
const snapAndBake = async (grid: Buffer, colours: number, width: number, height: number): Promise<Buffer> => {
  const crushed = await retroQuantize(grid, colours);
  return sharp(crushed)
    .resize(width, height, { kernel: "nearest" })
    .png({ palette: true, quality: 100, dither: 0, effort: 10, compressionLevel: 9 })
    .toBuffer();
};

/** Cut-outs (icons, deeds, badges, sprites): letterbox into a square grid,
 * crush, bake. */
export const processIcon = async (raw: Buffer, size: number, pixelGrid: number, colours: number): Promise<Buffer> => {
  const grid = await sharp(raw)
    .resize(pixelGrid, pixelGrid, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return snapAndBake(grid, colours, size, size);
};

/** Full-bleed scene art (mode cards): centre cover-crop to the grid frame —
 * no letterboxing, the game renders these edge-to-edge — then the same
 * crush and bake. Scenes get a bigger palette budget than cut-outs (skies
 * need more ramp steps), set per-spec in the style bible. */
export const processScene = async (
  raw: Buffer,
  width: number,
  height: number,
  pixelGridWidth: number,
  pixelGridHeight: number,
  colours: number,
): Promise<Buffer> => {
  const grid = await sharp(raw)
    .resize(pixelGridWidth, pixelGridHeight, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return snapAndBake(grid, colours, width, height);
};
