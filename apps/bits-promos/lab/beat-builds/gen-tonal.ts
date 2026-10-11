/**
 * Bold tonal versions of the script's sketch prompts: the line-art cards are
 * too thin for ASCII / text portraits to read, so this tests whether a
 * filled, high-contrast source fixes it. Writes img/<beat>-tonal.png.
 * `bun gen-tonal.ts [beatId…]` regenerates just those.
 */
import { generateImage } from "../../../../packages/forge/src/index";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = readFileSync(join(import.meta.dir, "../../../desk/.env"), "utf8");
const key = env.match(/^OPENAI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!key) throw new Error("no OPENAI_API_KEY in apps/desk/.env");

const STYLE =
  "Bold high-contrast black ink illustration on a plain pure white background. Strong solid black silhouettes and big filled shadow shapes, " +
  "chunky woodcut / linocut feel, clear light and dark masses, subject large and centred filling most of the frame, no text, no border, no grey haze.";

const only = process.argv.slice(2);
const all: Record<string, string> = {
  // Was "A sprawling fantasy world map…": too busy to read as ASCII (10-09).
  "2iloy1ut": "A lone castle on a hill with a single road winding away into the distance, one or two big mountains behind it.",
  t9znpi32: "A small child sitting across a chessboard from a stern old grandmaster.",
  b5f8kgov: "A desktop computer with a keyboard and mouse on a desk.",
  h1np6gam: "A parent holding a phone in one hand with a sleeping baby on their shoulder.",
};

const beats = only.length ? Object.fromEntries(Object.entries(all).filter(([id]) => only.includes(id))) : all;

await Promise.all(
  Object.entries(beats).map(async ([id, prompt]) => {
    const png = await generateImage(key, `${prompt} ${STYLE}`, "1024x1024", "opaque");
    writeFileSync(join(import.meta.dir, "img", `${id}-tonal.png`), png);
    console.log("✓", id);
  }),
);
