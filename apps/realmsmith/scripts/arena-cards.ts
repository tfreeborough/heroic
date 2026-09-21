// The map picker's card art (docs/design/bits-arenas.md § Picker cards): one
// fully rendered top-down image per registry arena, drawn from the SAME zone
// loader + tileset registry the game renders from — floor, decor, ground
// props, contact shadows, then standing props by baseline — so the card is the
// map, not a painting of it. `bun run arena:cards` after an arena's art
// changes or a new arena lands; it also regenerates the app's id → image map
// (Metro needs static requires, so that file can't be derived at runtime).
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { loadZone, tileSourceRect, TILESETS } from "@heroic/core";
import { ARENAS } from "@heroic/blood-in-the-sand-sim";

const repoRoot = resolve(import.meta.dir, "../../..");
const appRoot = resolve(repoRoot, "apps/blood-in-the-sand");
const outDir = resolve(appRoot, "assets/arenas");
const manifestPath = resolve(appRoot, "src/game/arenaCards.generated.ts");

/** Card image edge, px. The maps are square; a card shows ~110–330 pt wide,
 *  so 512 covers 3× phones at practice size without bundling a poster. */
const CARD_PX = 512;
/** The renderer's flat fallback (render.ts C_FLOOR) for ids off the atlas. */
const FLOOR_FALLBACK = [0xb3, 0x97, 0x63] as const;
/** render.ts CONTACT_SHADOW, minus the corner rounding + interior knock-out —
 *  both vanish at card scale. */
const SHADOW = { tall: { sigma: 10, alpha: 0.55, dy: 0 }, low: { sigma: 5, alpha: 0.45, dy: 4 } } as const;

interface Raw {
  data: Buffer;
  w: number;
  h: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Nearest-neighbour scaled, source-over blit — the bake's FilterMode.Nearest. */
const blit = (dst: Raw, src: Raw, s: Rect, d: Rect): void => {
  const x0 = Math.max(0, Math.floor(d.x));
  const y0 = Math.max(0, Math.floor(d.y));
  const x1 = Math.min(dst.w, Math.ceil(d.x + d.w));
  const y1 = Math.min(dst.h, Math.ceil(d.y + d.h));
  for (let y = y0; y < y1; y++) {
    const sy = s.y + Math.min(s.h - 1, Math.floor(((y + 0.5 - d.y) / d.h) * s.h));
    if (sy < 0 || sy >= src.h) continue;
    for (let x = x0; x < x1; x++) {
      const sx = s.x + Math.min(s.w - 1, Math.floor(((x + 0.5 - d.x) / d.w) * s.w));
      if (sx < 0 || sx >= src.w) continue;
      const si = (sy * src.w + sx) * 4;
      const a = src.data[si + 3]! / 255;
      if (a === 0) continue;
      const di = (y * dst.w + x) * 4;
      for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round(src.data[si + c]! * a + dst.data[di + c]! * (1 - a));
      dst.data[di + 3] = 255;
    }
  }
};

const fill = (dst: Raw, d: Rect, rgb: readonly [number, number, number]): void => {
  for (let y = Math.max(0, d.y); y < Math.min(dst.h, d.y + d.h); y++) {
    for (let x = Math.max(0, d.x); x < Math.min(dst.w, d.x + d.w); x++) {
      const di = (y * dst.w + x) * 4;
      dst.data[di] = rgb[0];
      dst.data[di + 1] = rgb[1];
      dst.data[di + 2] = rgb[2];
      dst.data[di + 3] = 255;
    }
  }
};

/** Blurred black boxes as one SVG layer (centre-anchored boxes, world px). */
const shadowSvg = (w: number, h: number, groups: { boxes: readonly Rect[]; look: { sigma: number; alpha: number; dy: number } }[]): Buffer => {
  const parts = groups.map(
    ({ boxes, look }, i) =>
      `<filter id="f${i}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${look.sigma}"/></filter>` +
      `<g filter="url(#f${i})" opacity="${look.alpha}" transform="translate(0 ${look.dy})">` +
      boxes.map((b) => `<rect x="${b.x - b.w / 2}" y="${b.y - b.h / 2}" width="${b.w}" height="${b.h}"/>`).join("") +
      `</g>`,
  );
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${parts.join("")}</svg>`);
};

const renderArena = async (id: string): Promise<boolean> => {
  const zone = loadZone(ARENAS[id]!);
  const tileset = TILESETS[zone.tileset];
  const atlasFile = Bun.file(resolve(appRoot, `assets/tilesets/${zone.tileset}.png`));
  if (!tileset || !(await atlasFile.exists())) {
    console.warn(`  ${id}: no atlas for tileset "${zone.tileset}" — skipped (the card falls back to its name)`);
    return false;
  }
  const decoded = await sharp(await atlasFile.arrayBuffer()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const atlas: Raw = { data: decoded.data, w: decoded.info.width, h: decoded.info.height };

  const W = zone.size.x;
  const H = zone.size.y;
  const ground: Raw = { data: Buffer.alloc(W * H * 4), w: W, h: H };
  const t = zone.tileSize;
  const ct = zone.chunkTiles;
  for (const chunk of zone.chunks) {
    for (const [layer, fallback] of [[chunk.floor, true], [chunk.decor, false]] as const) {
      if (!layer) continue;
      for (let ly = 0; ly < ct; ly++) {
        for (let lx = 0; lx < ct; lx++) {
          const tileId = layer[ly * ct + lx]!;
          if (tileId === 0) continue;
          const d = { x: (chunk.cx * ct + lx) * t, y: (chunk.cy * ct + ly) * t, w: t, h: t };
          const src = tileSourceRect(tileset, tileId);
          if (src) blit(ground, atlas, src, d);
          else if (fallback) fill(ground, d, FLOOR_FALLBACK);
        }
      }
    }
  }
  const dstOf = (p: { x: number; y: number; w: number; h: number }): Rect => ({ x: p.x - p.w / 2, y: p.y - p.h, w: p.w, h: p.h });
  for (const g of zone.props.filter((p) => p.ground)) blit(ground, atlas, g.src, dstOf(g));

  const tallFeet = zone.props.filter((p) => p.foot && p.occludes).map((p) => p.foot!);
  const lowFeet = zone.props.filter((p) => p.foot && !p.occludes).map((p) => p.foot!);
  const shaded = await sharp(ground.data, { raw: { width: W, height: H, channels: 4 } })
    .composite([
      {
        input: shadowSvg(W, H, [
          { boxes: [...zone.solid, ...tallFeet], look: SHADOW.tall },
          { boxes: [...zone.low, ...lowFeet], look: SHADOW.low },
        ]),
      },
    ])
    .raw()
    .toBuffer();

  const scene: Raw = { data: shaded, w: W, h: H };
  for (const p of zone.props.filter((q) => !q.ground).sort((a, b) => a.y - b.y)) blit(scene, atlas, p.src, dstOf(p));

  await sharp(scene.data, { raw: { width: W, height: H, channels: 4 } })
    .resize(CARD_PX, Math.round((CARD_PX * H) / W), { kernel: "lanczos3" })
    .removeAlpha()
    .png({ palette: true, quality: 90, effort: 10 })
    .toFile(resolve(outDir, `${id}.png`));
  return true;
};

await mkdir(outDir, { recursive: true });
const done: string[] = [];
for (const id of Object.keys(ARENAS)) {
  if (await renderArena(id)) {
    done.push(id);
    const kb = Math.round(Bun.file(resolve(outDir, `${id}.png`)).size / 1024);
    console.log(`  ${id} (${ARENAS[id]!.name}) → assets/arenas/${id}.png, ${kb} KB`);
  }
}

await writeFile(
  manifestPath,
  `// GENERATED by \`bun run arena:cards\` (apps/realmsmith/scripts/arena-cards.ts)
// — one require per rendered card in assets/arenas. Don't hand-edit; re-run the
// script after an arena's art changes or a new arena lands.
export const ARENA_CARD_IMAGES: Record<string, number> = {
${done.map((id) => `  ${JSON.stringify(id)}: require("../../assets/arenas/${id}.png") as number,`).join("\n")}
};
`,
);
console.log(`arenaCards.generated.ts: ${done.length} cards`);
