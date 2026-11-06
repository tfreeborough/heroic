/**
 * Depth for a picture (the parallax prototype, docs/design/desk-ascii-scripts.md
 * § Film stills): Depth Anything V2 Small run locally through transformers.js,
 * about a second a picture, no image spend. Writes a greyscale PNG beside the
 * picture (`<name>.depth.png`, near = white) that the glyph builds read to
 * split the picture into layers or warp it as the camera moves. Server only.
 * The model downloads once (~100 MB) into the Hugging Face cache.
 */
import { existsSync } from "node:fs";

const MODEL = "onnx-community/depth-anything-v2-small";

type DepthPipe = (img: unknown) => Promise<{ depth: { save: (path: string) => Promise<void> } }>;
let pipe: Promise<DepthPipe> | null = null;
const depthPipe = (): Promise<DepthPipe> => {
  pipe ??= import("@huggingface/transformers").then(({ pipeline }) => pipeline("depth-estimation", MODEL, { dtype: "fp32" }) as unknown as Promise<DepthPipe>);
  return pipe;
};

/** The depth map's path for a picture's path. */
export const depthPath = (picture: string) => picture.replace(/\.(png|jpe?g|webp)$/i, ".depth.png");

/** Make (or keep) a picture's depth map; returns its path. */
export const makeDepth = async (picture: string, again = false): Promise<string> => {
  const out = depthPath(picture);
  if (existsSync(out) && !again) return out;
  const { RawImage } = await import("@huggingface/transformers");
  const img = await RawImage.read(picture);
  const { depth } = await (await depthPipe())(img);
  await depth.save(out);
  return out;
};

if (import.meta.main) {
  for (const p of process.argv.slice(2)) console.log(await makeDepth(p, true));
}
