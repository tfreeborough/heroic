/**
 * Rendering = Remotion, nothing else. A game's templates are bundled once
 * per server run (re-bundled if its src changed), then each job renders a
 * composition with the props the Desk sent, reporting progress for the UI.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { GameConfig } from "../game";
import { thumbnail } from "./ffmpeg";

export const rendersDir = (g: GameConfig) => {
  const d = join(g.root, g.rendersDir);
  mkdirSync(d, { recursive: true });
  return d;
};

const bundles = new Map<string, { serveUrl: string; at: number }>();
const bundling = new Map<string, Promise<string>>();
const newestMtime = (dir: string): number => {
  let newest = 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    newest = Math.max(newest, f.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
};
const getBundle = (g: GameConfig, onProgress: (p: number) => void): Promise<string> => {
  const entry = join(g.root, g.remotionEntry);
  const have = bundles.get(g.id);
  if (have && have.at >= newestMtime(dirname(entry))) return Promise.resolve(have.serveUrl);
  // Several formats of one video start together — share the one bundle.
  let inflight = bundling.get(g.id);
  if (!inflight) {
    inflight = bundle({ entryPoint: entry, publicDir: join(g.root, g.publicDir), onProgress: (p) => onProgress(p / 100) })
      .then((serveUrl) => {
        bundles.set(g.id, { serveUrl, at: Date.now() });
        return serveUrl;
      })
      .finally(() => bundling.delete(g.id));
    bundling.set(g.id, inflight);
  }
  return inflight;
};

export type RenderManifest = {
  /** Output basename (no extension) under the game's renders dir. */
  slug: string;
  /** The formats rendered together from one Make press share a batch id —
   * the Renders screen shows a batch as one card. Manifests from before
   * batches have none; the library groups those by name. */
  batch?: string;
  /** The name you typed in Make, before the format suffix. */
  name?: string;
  template: string;
  props: Record<string, unknown>;
  format: string;
  width: number;
  height: number;
  seconds: number;
  renderedAt: string;
  uploadedAt?: string;
};

export type Job = {
  id: string;
  game: string;
  slug: string;
  template: string;
  format: string;
  /** "bundling" | "rendering" | "done" | "failed" */
  state: string;
  progress: number;
  error?: string;
  startedAt: number;
};
export const jobs = new Map<string, Job>();

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "video";

/** Kick off a render; returns the job to poll. */
export const startRender = (g: GameConfig, req: { template: string; props: Record<string, unknown>; format: string; name: string; batch: string }): Job => {
  const dir = rendersDir(g);
  const base = slugify(`${req.name}-${req.format}`);
  let slug = base;
  for (let i = 2; existsSync(join(dir, `${slug}.mp4`)); i++) slug = `${base}-${i}`;
  const job: Job = { id: crypto.randomUUID(), game: g.id, slug, template: req.template, format: req.format, state: "bundling", progress: 0, startedAt: Date.now() };
  jobs.set(job.id, job);
  void (async () => {
    try {
      const serveUrl = await getBundle(g, (p) => (job.progress = p * 0.2));
      job.state = "rendering";
      const inputProps = { ...req.props, format: req.format };
      const composition = await selectComposition({ serveUrl, id: req.template, inputProps });
      const out = join(dir, `${slug}.mp4`);
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: out,
        inputProps,
        imageFormat: "jpeg",
        onProgress: ({ progress }) => (job.progress = 0.2 + progress * 0.8),
      });
      const manifest: RenderManifest = {
        slug,
        batch: req.batch,
        name: req.name,
        template: req.template,
        props: req.props,
        format: req.format,
        width: composition.width,
        height: composition.height,
        seconds: composition.durationInFrames / composition.fps,
        renderedAt: new Date().toISOString(),
      };
      writeFileSync(join(dir, `${slug}.json`), JSON.stringify(manifest, null, 2) + "\n");
      thumbnail(out, Math.min(1.5, manifest.seconds * 0.2)); // early in the body: footage + banner, never the outro
      job.progress = 1;
      job.state = "done";
    } catch (e) {
      job.state = "failed";
      job.error = (e as Error).message;
    }
  })();
  return job;
};

/** One PNG frame of a template — a thumbnail or a Reddit image. */
export const renderStillTo = async (g: GameConfig, req: { template: string; props: Record<string, unknown>; format: string; frame: number; out: string }) => {
  const serveUrl = await getBundle(g, () => {});
  const inputProps = { ...req.props, format: req.format };
  const composition = await selectComposition({ serveUrl, id: req.template, inputProps });
  await renderStill({ composition, serveUrl, output: req.out, inputProps, frame: Math.min(req.frame, composition.durationInFrames - 1) });
};
