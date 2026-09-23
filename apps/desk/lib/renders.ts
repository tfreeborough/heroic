/**
 * A game's finished-video library: <rendersDir>/<slug>.mp4 + <slug>.json
 * manifests, shown as BATCHES — the formats rendered together from one Make
 * press. Upload, re-open and delete work on the batch.
 */
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { type RenderManifest, rendersDir } from "./render";

export type Render = RenderManifest & { bytes: number };
export type Batch = {
  id: string;
  name: string;
  template: string;
  /** Newest render in the batch. */
  renderedAt: string;
  /** One per format, in the game's format order as rendered. */
  renders: Render[];
};

export const listRenders = (g: GameConfig): Render[] => {
  const dir = rendersDir(g);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        const m = JSON.parse(readFileSync(join(dir, f), "utf8")) as RenderManifest;
        const mp4 = join(dir, `${m.slug}.mp4`);
        return existsSync(mp4) ? [{ ...m, bytes: statSync(mp4).size }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => (a.renderedAt < b.renderedAt ? 1 : -1));
};

/** A manifest from before batches: `<name>-<format>[-n]` → group by name (+ the
 * re-render number, so a second press of the same name is its own batch). */
const legacyBatch = (g: GameConfig, r: RenderManifest): { id: string; name: string } => {
  const m = new RegExp(`^(.*)-(${Object.keys(g.formats).join("|")})(?:-(\\d+))?$`).exec(r.slug);
  const name = m?.[1] ?? r.slug;
  return { id: `legacy:${name}${m?.[3] ? `#${m[3]}` : ""}`, name };
};

export const listBatches = (g: GameConfig): Batch[] => {
  const by = new Map<string, Batch>();
  for (const r of listRenders(g)) {
    const { id, name } = r.batch ? { id: r.batch, name: r.name ?? legacyBatch(g, r).name } : legacyBatch(g, r);
    const b = by.get(id);
    if (b) {
      b.renders.push(r);
      if (r.renderedAt > b.renderedAt) b.renderedAt = r.renderedAt;
    } else by.set(id, { id, name, template: r.template, renderedAt: r.renderedAt, renders: [r] });
  }
  const order = Object.keys(g.formats);
  for (const b of by.values()) b.renders.sort((a, z) => order.indexOf(a.format) - order.indexOf(z.format));
  return [...by.values()].sort((a, b) => (a.renderedAt < b.renderedAt ? 1 : -1));
};

export const deleteRender = (g: GameConfig, slug: string) => {
  for (const ext of [".mp4", ".json"]) {
    const p = join(rendersDir(g), `${slug}${ext}`);
    if (existsSync(p)) unlinkSync(p);
  }
};

export const deleteBatch = (g: GameConfig, id: string) => {
  const b = listBatches(g).find((x) => x.id === id);
  for (const r of b?.renders ?? []) deleteRender(g, r.slug);
  return b?.renders.length ?? 0;
};

/** One rclone run copies every named render to the game's Drive target
 * (transfers run in parallel); each manifest that made it is marked. */
export const uploadRenders = async (g: GameConfig, slugs: string[]): Promise<{ ok: boolean; log: string; uploaded: string[] }> => {
  const dir = rendersDir(g);
  const have = slugs.filter((s) => existsSync(join(dir, `${s}.mp4`)));
  if (!have.length) return { ok: false, log: "nothing to upload", uploaded: [] };
  const p = await exec(["rclone", "copy", dir, g.drive.uploadTarget, ...have.flatMap((s) => ["--include", `/${s}.mp4`]), "--stats-one-line"]);
  const log = `${p.out}${p.err}`.split("\n").filter((l) => l && !l.includes("shared Google Drive client_id")).join("\n");
  if (p.exitCode !== 0) return { ok: false, log: log || `rclone exit ${p.exitCode}`, uploaded: [] };
  const at = new Date().toISOString();
  for (const s of have) {
    const mp = join(dir, `${s}.json`);
    if (!existsSync(mp)) continue;
    const m = JSON.parse(readFileSync(mp, "utf8")) as RenderManifest;
    m.uploadedAt = at;
    writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");
  }
  return { ok: true, log: log || `uploaded ${have.length}`, uploaded: have };
};
