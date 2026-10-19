/**
 * A script's pictures (one or two per beat, docs/design/desk-ascii-scripts.md)
 * and, on older scripts, the sketches the old visual plan asked for: GPT
 * Image (the shared forge) in the game's one fixed style, saved under the game's public dir
 * as cards/<script>/<beat>-<n>.png (gitignored; backed up to Drive with
 * the takes), so a card on an edit can point at one. Server only.
 *
 * The key is OPENAI_API_KEY in apps/desk/.env (the same one Realmsmith's
 * forge uses). A batch runs in the background a few at a time: each
 * picture is saved onto its beat as it lands, and the page polls.
 *
 * The model draws its natural sketch, black ink on white paper (asked for
 * light ink on a transparent ground it paints neon glows instead). The
 * cards sit on the dark brand backdrop, so the paper is then turned into
 * alpha: how dark a pixel is becomes how opaque it is, every pixel the
 * ink colour. Cream lines on nothing, the backdrop showing through.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { generateImage } from "@heroic/forge";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { publicDir } from "./footage";
import type { Beat, Script } from "./scripts";

/** The ink the lines come out in (the brand's bone). */
const INK = { r: 242, g: 233, b: 212 };

/** White paper → transparency, black ink → INK, in place. */
const inkToAlpha = async (file: string): Promise<void> => {
  if (!ffmpegPath) throw new Error("ffmpeg-static isn't installed");
  const tmp = `${file}.ink.png`;
  // geq reads the source pixel's channels: the darker the ink (its luminance), the more opaque the pixel.
  const lum = "(0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y))";
  const r = await exec([ffmpegPath, "-y", "-v", "error", "-i", file, "-vf", `format=rgba,geq=r='${INK.r}':g='${INK.g}':b='${INK.b}':a='255-${lum}'`, "-frames:v", "1", tmp]);
  if (!r.ok) throw new Error(`ffmpeg couldn't lift the ink: ${r.err.trim().slice(0, 200)}`);
  rmSync(file);
  await Bun.write(file, Bun.file(tmp));
  rmSync(tmp);
};

export const hasImages = (): boolean => Boolean(process.env.OPENAI_API_KEY);

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "");
export const cardsDir = (g: GameConfig, script?: string) => (script ? join(publicDir(g), "cards", safe(script)) : join(publicDir(g), "cards"));

/** The next free file for a beat's picture: <beat>-1.png, -2, … (an earlier try is kept beside it). */
const nextFile = (g: GameConfig, script: string, beat: string, ext = "png"): string => {
  const dir = cardsDir(g, script);
  mkdirSync(dir, { recursive: true });
  const taken = new Set(readdirSync(dir));
  for (let n = 1; ; n++) {
    const f = `${safe(beat)}-${n}.${ext}`;
    if (!taken.has(f)) return join(dir, f);
  }
};

/** One sketch for a beat: the style prefix, then the plan's prompt. Returns the path under the public dir. */
export const makeSketch = async (g: GameConfig, script: Pick<Script, "id">, beat: Beat, style: string): Promise<string> => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  const prompt = beat.card?.prompt?.trim();
  if (!prompt) throw new Error("the beat has no sketch prompt");
  const png = await generateImage(key, `${style.trim()} ${prompt}`, "1024x1024", "opaque");
  const out = nextFile(g, script.id, beat.id);
  writeFileSync(out, png);
  await inkToAlpha(out);
  return relative(publicDir(g), out);
};

/**
 * The picture style (docs/design/desk-ascii-scripts.md): Autosave's
 * chiaroscuro film still, landscape. Glyphs grow where the picture is
 * WHITE, so the subject is carved out by light and the dark builds as
 * nothing. A game can set its own in `script.ai.picture`.
 */
export const PICTURE_STYLE =
  "Black ink woodcut / linocut print on plain white paper, framed like a still from a film with a deliberate camera angle. " +
  "Chiaroscuro: one strong light source carves the subject out of darkness, so the lit faces, hands and surfaces are bright white and carry the detail, " +
  "the shadow side falls into solid black. The subject is drawn by light, never as a flat black silhouette. " +
  "The dark scene runs right off every edge of the frame, full bleed, and the edges of the frame fall into solid black shadow: nothing lit touches the border. " +
  "No circle, oval or vignette, no white paper showing. Big simple shapes, high contrast, no mid-grey, no text, no letters, no border. " +
  "One clear subject large in the frame. No fine texture or busy detail: no crowds, no rain, snow, fog or smoke, no nets or mesh, no fields of small objects.";

/** Added after a thumbnail's prompt (docs/design/desk-thumbnails.md): it has to read at 168px. */
export const THUMB_STYLE = "This is a YouTube thumbnail: ONE subject, close and huge, that reads instantly at a tiny size, no small details.";

/**
 * A beat's picture: the style, the world's look (the image model never sees
 * the theme or the script, so this is how a tower knows it's cyberpunk),
 * then the prompt, landscape, kept as it comes (the glyphs read its
 * brightness). Returns the path under the public dir.
 */
export const makePicture = async (g: GameConfig, script: Pick<Script, "id">, beat: Pick<Beat, "id">, k: number, prompt: string, style: string, look = ""): Promise<string> => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  if (!prompt.trim()) throw new Error("the picture has no prompt");
  const full = [style.trim().replace(/\s*The scene:$/, ""), look.trim() ? `The world: ${look.trim()}` : "", `The scene: ${prompt.trim()}`].filter(Boolean).join(" ");
  const png = await generateImage(key, full, "1536x1024", "opaque");
  const out = nextFile(g, script.id, k ? `${beat.id}-p${k + 1}` : beat.id);
  writeFileSync(out, png);
  return relative(publicDir(g), out);
};

/** Tom's own picture for a beat (dropped or picked on the page): saved beside the made ones. */
export const saveOwnPicture = (g: GameConfig, script: Pick<Script, "id">, beat: Pick<Beat, "id">, k: number, bytes: Uint8Array, ext: string): string => {
  const e = ["png", "jpg", "jpeg", "webp"].includes(ext.toLowerCase()) ? ext.toLowerCase() : "png";
  const out = nextFile(g, script.id, `${k ? `${beat.id}-p${k + 1}` : beat.id}-own`, e);
  writeFileSync(out, bytes);
  return relative(publicDir(g), out);
};

/** Does a picture the plan points at still exist on disk? */
export const sketchExists = (g: GameConfig, src: string): boolean => existsSync(join(publicDir(g), src));
