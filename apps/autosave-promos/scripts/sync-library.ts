/**
 * What the Desk can offer: every save picture in public/saves (with its
 * sidecar's words) and every track in public/music. Writes
 * src/data/library.json. Run by the Desk on start (`prepare`), after the
 * Saves tab saves one, and by `bun run sync`.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

/** A save's sidecar, public/saves/<name>.json. Every word is Tom's final say. */
export type SaveSidecar = { memory?: string; tagline?: string; title?: string; journal?: string; prompt?: string; /** Before 10-10. */ location?: string };
export type LibrarySave = { file: string; name: string; memory: string; tagline: string; title: string; journal: string; prompt: string; /** The finished glyph picture, saves/ascii/<name>.png, once made. */ ascii: string };

const root = join(import.meta.dir, "..");
const list = (dir: string, exts: string[]) =>
  existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => exts.includes(extname(f).toLowerCase())).sort() : [];
const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const syncLibrary = () => {
  const saves: LibrarySave[] = list("public/saves", [".png", ".jpg", ".jpeg", ".webp"]).map((file) => {
    const name = basename(file, extname(file));
    const side = join(root, "public/saves", `${name}.json`);
    const meta = existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as SaveSidecar) : {};
    const memory = meta.memory ?? meta.location ?? titleCase(name);
    const ascii = existsSync(join(root, "public/saves/ascii", `${name}.png`)) ? `saves/ascii/${name}.png` : "";
    return { file: `saves/${file}`, name, memory, tagline: meta.tagline ?? "", title: meta.title ?? memory, journal: meta.journal ?? "", prompt: meta.prompt ?? "", ascii };
  });
  const music = list("public/music", [".mp3", ".wav", ".m4a", ".aac", ".ogg"]).map((file) => ({ file, name: titleCase(basename(file, extname(file))) }));
  writeFileSync(join(root, "src/data/library.json"), JSON.stringify({ saves, music }, null, 2) + "\n");
  return { saves, music };
};

if (import.meta.main) {
  const { saves, music } = syncLibrary();
  console.log(`autosave library: ${saves.length} saves, ${music.length} tracks`);
}
