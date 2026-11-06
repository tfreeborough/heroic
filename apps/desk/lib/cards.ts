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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { editImage, generateImage } from "@heroic/forge";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { publicDir } from "./footage";
import type { Beat, PictureStyle, Script } from "./scripts";

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
 * The woodcut style (docs/design/desk-ascii-scripts.md): Autosave's
 * chiaroscuro film still as a print, landscape. Glyphs grow where the
 * picture is WHITE, so the subject is carved out by light and the dark
 * builds as nothing. Beat pictures made it until 11-05 (a script with
 * pictures from then stays on it, pictureStyleOf); thumbnails still do.
 * New scripts are conté (CONTE_STYLE).
 */
export const WOODCUT_STYLE =
  "Black ink woodcut / linocut print on plain white paper, framed like a still from a film with a deliberate camera angle. " +
  "Chiaroscuro: one strong light source carves the subject out of darkness, so the lit faces, hands and surfaces are bright white and carry the detail, " +
  "the shadow side falls into solid black. The subject is drawn by light, never as a flat black silhouette. " +
  "The dark scene runs right off every edge of the frame, full bleed, and the edges of the frame fall into solid black shadow: nothing lit touches the border. " +
  "No circle, oval or vignette, no white paper showing. Big simple shapes, high contrast, no mid-grey, no text, no letters, no border. " +
  "One clear subject large in the frame. No fine texture or busy detail: no crowds, no rain, snow, fog or smoke, no nets or mesh, no fields of small objects.";

/**
 * The film style (11-05, off the style test sheet): viewers called the
 * woodcuts generic AI art, and an illustration is the look that reads as
 * generated. A black-and-white frame from a real-feeling film instead, lit
 * by the scene's own lamps and windows; the glyph look's punch and outline
 * (BEATS_LOOK) turn its greys into lit subject and empty dark. The frame's
 * edges stay black for the same flood-fill reason as the woodcut.
 */
export const FILM_STYLE =
  "A black-and-white photograph: a single frame from a feature film shot on 35mm film stock, real actors on a real built set, lit only by practical light sources in the scene. " +
  "Deep true blacks, bright highlights, fine natural film grain, the slight softness and falloff of a vintage lens. A real photograph, not an illustration, drawing, painting or render. " +
  "The frame's edges fall into deep black shadow: nothing brightly lit touches the border. No text, no letters, no numbers, no captions, no border. " +
  "One single picture filling the frame: never a collage, grid, panels, a storyboard or a sheet of sketches.";

/** A cast member's reference: alone on black, seen whole, in the film's look. No writing: lettering on a reference leaks into every picture it's in (the deluxe box's placard, 11-05). */
export const CAST_REF_STYLE =
  "A single black-and-white photograph from a feature film shot on 35mm film: one subject alone against a plain pitch-black backdrop, lit by one strong lamp from the side, seen whole and clearly, neutral pose, nothing else in the picture. " +
  "A real photograph, not an illustration. One picture only: no collage, panels, grid or contact sheet, no other scenes or objects. No writing, lettering, labels, signs or numbers anywhere, on the subject or behind it.";

/**
 * The conté style (11-05, the painter round): Seurat's conté crayon drawings,
 * soft velvety masses of light and dark with no outlines, a pale form
 * glowing out of shadow with a halo where it meets the dark. The glyphs
 * love the halo. The subjects and placement come from the prompt writer's
 * Spilliaert brief (rewrite.ts CONTE_RULES), the drawing from this.
 */
export const CONTE_STYLE =
  "A drawing in the manner of Georges Seurat's conté crayon drawings of the 1880s: soft velvety black conté crayon on textured paper, no outlines, forms built only from masses of light and dark that melt into each other, a pale figure or object glowing out of deep shadow with a soft halo where light meets dark, quiet and mysterious. " +
  "Black and white only. The edges of the picture fall into deep darkness: nothing pale touches the border. No text, no letters, no numbers, no signature, no border, no frame. " +
  "One single picture filling the frame: never a collage, grid, panels, a storyboard or a sheet of sketches.";

/** A cast member's reference in the conté style: alone on black, seen whole, drawn the same way. */
export const CONTE_REF_STYLE =
  "A single drawing in the manner of Georges Seurat's conté crayon drawings of the 1880s: soft velvety black conté on textured paper, no outlines, one subject alone in the middle of plain deep darkness, lit from one side, seen whole and clearly, neutral pose, nothing else in the picture. " +
  "One picture only: no collage, panels, grid or sheet of studies, no other scenes, figures or objects. No writing, lettering, labels, signs or numbers anywhere, on the subject or behind it.";

/** A beat picture's style text. A game can set its own in `script.ai.picture` (it wins over all of them). */
export const pictureStyleText = (style: PictureStyle) => (style === "conte" ? CONTE_STYLE : style === "film" ? FILM_STYLE : WOODCUT_STYLE);

/** Added after a thumbnail's prompt (docs/design/desk-thumbnails.md): it has to read at 168px. */
export const THUMB_STYLE = "This is a YouTube thumbnail: ONE subject, close and huge, that reads instantly at a tiny size, no small details.";

/** A cast member's reference picture on disk, named as the prompt names them. */
export type CastRefFile = { name: string; file: string };
/** References per picture: the cast in a shot is two or three, and each counts against OpenAI's per-minute input-image limit. */
const MAX_REFS = 4;

/** OpenAI's per-minute limits (requests and, with references, input images) answer 429: wait and go again rather than fail a picture. */
const rateRetry = async <T>(f: () => Promise<T>): Promise<T> => {
  for (let k = 0; ; k++) {
    try {
      return await f();
    } catch (e) {
      if (k >= 5 || !/ 429\b|rate limit/i.test((e as Error).message)) throw e;
      await Bun.sleep(15_000 + k * 10_000);
    }
  }
};

/** A look line's era: what comes before its first colon ("Science fiction, a far-future colony on Mars: …"), or its first clause, kept short. */
export const eraOf = (look: string): string => {
  const t = look.trim();
  if (!t) return "";
  const head = t.includes(":") ? t.slice(0, t.indexOf(":")) : t.split(/[.;]/)[0]!;
  return head.trim().slice(0, 140);
};

/** A cast member's reference picture: square, alone on black, with the world's era. Returns the path under the public dir. */
export const makeCastRef = async (g: GameConfig, script: Pick<Script, "id">, member: { name: string; look: string }, worldLook = "", style: PictureStyle = "film"): Promise<string> => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  // Only the look's era, not its list of places and things: given the whole list, the model drew a mood board of the world
  // with the subject as one small panel (11-06). The member's own look carries their detail.
  const era = eraOf(worldLook);
  const full = [style === "conte" ? CONTE_REF_STYLE : CAST_REF_STYLE, era ? `The era and world: ${era}.` : "", `The subject: ${member.look.trim()}`].filter(Boolean).join(" ");
  const png = await rateRetry(() => generateImage(key, full, "1024x1024", "opaque"));
  const out = nextFile(g, script.id, `cast-${member.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
  writeFileSync(out, png);
  return relative(publicDir(g), out);
};

/**
 * A beat's picture: the style, the world's look (the image model never sees
 * the theme or the script, so this is how a tower knows it's cyberpunk),
 * then the prompt, landscape, kept as it comes (the glyphs read its
 * brightness). Returns the path under the public dir.
 */
export const makePicture = async (g: GameConfig, script: Pick<Script, "id">, beat: Pick<Beat, "id">, k: number, prompt: string, style: string, look = "", refs: CastRefFile[] = []): Promise<string> => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  if (!prompt.trim()) throw new Error("the picture has no prompt");
  const usable = refs.filter((r) => existsSync(r.file)).slice(0, MAX_REFS);
  // The references are for what the cast look like only: the prompt still decides the shot.
  const lead = usable.length
    ? `Use the reference photographs only for what the cast look like (the same faces, clothes and objects), never for their pose, framing or background. ${usable.map((r, i) => `Reference ${i + 1} is ${r.name}.`).join(" ")}`
    : "";
  const full = [style.trim().replace(/\s*The scene:$/, ""), look.trim() ? `The world: ${look.trim()}` : "", lead, `The scene: ${prompt.trim()}`].filter(Boolean).join(" ");
  const png = await rateRetry(() =>
    usable.length ? editImage(key, full, usable.map((r, i) => ({ name: `ref-${i + 1}.png`, png: readFileSync(r.file) })), "1536x1024") : generateImage(key, full, "1536x1024", "opaque"),
  );
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
