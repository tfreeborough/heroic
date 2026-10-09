/**
 * Scenes on disk: one JSON per scene in scenes/<game>/<name>.json, committed
 * (they're small, and a scene is the source of its clip). Exports and
 * recordings go to out/<game>/, which is gitignored.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { type Scene, SCENE_VERSION, newScene } from "./scene";

const ROOT = join(import.meta.dir, "..");
export const scenesDir = (game: string) => join(ROOT, "scenes", game);
export const outDir = (game: string) => join(ROOT, "out", game);

/** A scene name is a file name: no path parts, no extension games. */
export const safeName = (name: string): string => basename(name).replace(/\.json$/i, "").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "untitled";

export type SceneSummary = { name: string; updatedAt: string; elements: number };

export const listScenes = (game: string): SceneSummary[] => {
  const dir = scenesDir(game);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as Scene;
        return { name: f.slice(0, -5), updatedAt: s.updatedAt ?? statSync(join(dir, f)).mtime.toISOString(), elements: s.elements?.length ?? 0 };
      } catch {
        return { name: f.slice(0, -5), updatedAt: statSync(join(dir, f)).mtime.toISOString(), elements: 0 };
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const readScene = async (game: string, name: string): Promise<Scene | undefined> => {
  const p = join(scenesDir(game), `${safeName(name)}.json`);
  if (!existsSync(p)) return undefined;
  const s = (await Bun.file(p).json()) as Scene;
  return { ...newScene(safeName(name)), ...s, version: SCENE_VERSION, name: safeName(name) };
};

/** Written whole, to a temp file then renamed, so a crash mid-write never leaves half a scene. */
export const writeScene = async (game: string, scene: Scene): Promise<Scene> => {
  const name = safeName(scene.name);
  mkdirSync(scenesDir(game), { recursive: true });
  const out: Scene = { ...scene, name, version: SCENE_VERSION, updatedAt: new Date().toISOString() };
  const p = join(scenesDir(game), `${name}.json`);
  await Bun.write(`${p}.partial`, JSON.stringify(out));
  renameSync(`${p}.partial`, p);
  return out;
};

export const removeScene = (game: string, name: string): void => {
  rmSync(join(scenesDir(game), `${safeName(name)}.json`), { force: true });
};

export const renameScene = async (game: string, from: string, to: string): Promise<Scene | undefined> => {
  const s = await readScene(game, from);
  if (!s) return undefined;
  const target = safeName(to);
  if (target === safeName(from)) return s;
  if (existsSync(join(scenesDir(game), `${target}.json`))) throw new Error(`there's already a scene called ${target}`);
  const out = await writeScene(game, { ...s, name: target });
  removeScene(game, from);
  return out;
};

export type OutFile = { file: string; bytes: number; at: string; kind: "clip" | "still" | "recording" };

export const listOut = (game: string): OutFile[] => {
  const dir = outDir(game);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(mp4|mov|png)$/i.test(f) && !f.startsWith("."))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { file: f, bytes: st.size, at: st.mtime.toISOString(), kind: f.endsWith(".png") ? "still" : /\.rec\.mp4$/.test(f) ? "recording" : "clip" } as OutFile;
    })
    .sort((a, b) => b.at.localeCompare(a.at));
};

export const removeOut = (game: string, file: string): void => {
  rmSync(join(outDir(game), basename(file)), { force: true });
};
