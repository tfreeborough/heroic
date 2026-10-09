/** The stamp drawer: the game's art folders as a list the page can show and place. */
import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GameBrand } from "../games";

export type Stamp = { group: string; name: string; src: string; w: number; h: number };

/** Width/height from a PNG's IHDR, without decoding it. */
const pngSize = (path: string): [number, number] | undefined => {
  try {
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(24);
    readSync(fd, buf, 0, 24, 0);
    closeSync(fd);
    if (buf.toString("ascii", 1, 4) !== "PNG") return undefined;
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  } catch {
    return undefined;
  }
};

export const listStamps = (g: GameBrand): Stamp[] => {
  const out: Stamp[] = [];
  for (const group of g.stamps) {
    if (!existsSync(group.dir)) continue;
    for (const f of readdirSync(group.dir)) {
      if (!f.endsWith(".png")) continue;
      const size = pngSize(join(group.dir, f));
      if (!size) continue;
      out.push({ group: group.id, name: f.slice(0, -4).replace(/^(deed|title)-/, "").replace(/-/g, " "), src: `/stamps/${g.id}/${group.id}/${f}`, w: size[0], h: size[1] });
    }
  }
  return out;
};

export const stampPath = (g: GameBrand, group: string, file: string): string | undefined => {
  const grp = g.stamps.find((s) => s.id === group);
  if (!grp || file.includes("/") || file.includes("..")) return undefined;
  const p = join(grp.dir, file);
  return existsSync(p) ? p : undefined;
};
