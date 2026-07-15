/**
 * Image post-processing for the Forge (the `sharp` half of the design doc's
 * "sharp for images, ffmpeg for audio"). Generation happens at 1024 for
 * quality; the saved asset is downscaled AND palette-quantized so a full icon
 * set costs kilobytes, not megabytes, of app bundle. Alpha is preserved
 * throughout — transparent backgrounds are the whole point.
 */
import sharp from "sharp";

/**
 * Downscale to size×size and quantize to an 8-bit palette PNG (sharp bundles
 * libimagequant — the pngquant engine — so this is real quantization with
 * alpha-aware dithering, not just deflate). The woodcut icon style hides
 * palette banding well; `quality` is libimagequant's floor — it uses fewer
 * colours when it can, and only ever fails UP to more.
 */
export const processIcon = async (raw: Buffer, size: number): Promise<Buffer> =>
  sharp(raw)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 80, dither: 1.0, effort: 10, compressionLevel: 9 })
    .toBuffer();
