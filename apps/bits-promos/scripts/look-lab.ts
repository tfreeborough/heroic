/**
 * The look lab (src/experiments/look/LookLab.tsx): renders one Beats picture
 * under several glyph settings, stills and/or short clips, for judging side
 * by side. Bundles once, renders many.
 *   bun scripts/look-lab.ts <out dir> <job.json>
 * job.json: { pictures: string[] (under public/), variants: { name, props }[], still?: seconds, clip?: boolean, seconds?: number },
 * or a list of them (one bundle for all).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const [outDir, jobFile] = process.argv.slice(2);
if (!outDir || !jobFile) throw new Error("usage: bun scripts/look-lab.ts <out dir> <job.json>");
type Job = { pictures: string[]; variants: { name: string; props: Record<string, unknown> }[]; still?: number; clip?: boolean; seconds?: number };
const read = JSON.parse(readFileSync(jobFile, "utf8")) as Job | Job[];
mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: resolve(import.meta.dir, "../src/index.ts"), publicDir: resolve(import.meta.dir, "../public") });
for (const job of Array.isArray(read) ? read : [read])
for (const [i, src] of job.pictures.entries()) {
  for (const v of job.variants) {
    // "DEPTH" stands for the picture's own depth map (made beside it by the Desk).
    const inputProps = { src, seconds: job.seconds ?? 11, seed: 7 + i, ...v.props, ...(v.props.depth === "DEPTH" ? { depth: src.replace(/\.(png|jpe?g|webp)$/i, ".depth.png") } : {}) };
    const composition = await selectComposition({ serveUrl, id: "LookLab", inputProps });
    const base = join(outDir, `p${i + 1}-${v.name}`);
    if (job.still !== undefined) await renderStill({ composition, serveUrl, inputProps, output: `${base}.png`, frame: Math.round(job.still * composition.fps) });
    if (job.clip) await renderMedia({ composition, serveUrl, inputProps, codec: "h264", outputLocation: `${base}.mp4`, concurrency: 4 });
    console.log(`  ${base}`);
  }
}
console.log("done");
