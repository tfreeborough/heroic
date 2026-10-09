/**
 * Clips out of the board. The page renders the replay itself, one frame at
 * a time, exactly as it would draw it on screen, and posts each frame here;
 * `finish` stitches them with ffmpeg. Deterministic (no dropped frames, any
 * size) — the other road, MediaRecorder on the live canvas, is `record()`.
 *
 * Opaque clips are H.264 mp4 (what the Desk and every editor take).
 * Transparent clips are ProRes 4444 .mov with alpha, to lay over footage.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { exec } from "./exec";
import { outDir } from "./store";

export type ExportSpec = { name: string; width: number; height: number; fps: number; transparent: boolean };
export type ExportJob = ExportSpec & { id: string; game: string; dir: string; frames: number; state: "open" | "encoding" | "done" | "failed"; file?: string; error?: string; startedAt: number };

export const exports = new Map<string, ExportJob>();

const safe = (name: string) => basename(name).replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "clip";

/** A file name in out/ nothing else has. */
const freeName = (game: string, stem: string, ext: string): string => {
  let out = `${stem}${ext}`;
  for (let n = 2; existsSync(join(outDir(game), out)); n++) out = `${stem} ${n}${ext}`;
  return out;
};

export const startExport = (game: string, spec: ExportSpec): ExportJob => {
  const id = crypto.randomUUID();
  const dir = join(outDir(game), `.frames-${id.slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  const job: ExportJob = { ...spec, name: safe(spec.name), id, game, dir, frames: 0, state: "open", startedAt: Date.now() };
  exports.set(id, job);
  return job;
};

export const frameExt = (job: ExportSpec) => (job.transparent ? "png" : "jpg");

/** A request body to disk, chunk by chunk. (`Bun.write(path, new Response(body))` never finishes.) */
const streamToFile = async (body: ReadableStream<Uint8Array>, path: string): Promise<number> => {
  const w = Bun.file(path).writer();
  let n = 0;
  for await (const chunk of body) {
    n += chunk.byteLength;
    w.write(chunk);
  }
  await w.end();
  return n;
};

export const addFrame = async (job: ExportJob, n: number, body: ReadableStream<Uint8Array> | null): Promise<void> => {
  if (!body) throw new Error("no frame");
  const p = join(job.dir, `${String(n).padStart(6, "0")}.${frameExt(job)}`);
  await streamToFile(body, p);
  job.frames = Math.max(job.frames, n + 1);
};

export const finishExport = async (job: ExportJob): Promise<ExportJob> => {
  job.state = "encoding";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const ext = job.transparent ? ".mov" : ".mp4";
  const file = freeName(job.game, `${job.name} ${stamp}`, ext);
  const out = join(outDir(job.game), file);
  const codec = job.transparent
    ? ["-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  const r = await exec([ffmpegPath ?? "ffmpeg", "-y", "-nostdin", "-v", "error", "-framerate", String(job.fps), "-i", join(job.dir, `%06d.${frameExt(job)}`), ...codec, "-r", String(job.fps), out]);
  rmSync(job.dir, { recursive: true, force: true });
  if (!r.ok) {
    job.state = "failed";
    job.error = r.err.trim().split("\n").slice(-3).join(" ") || `ffmpeg exit ${r.exitCode}`;
    throw new Error(job.error);
  }
  job.state = "done";
  job.file = file;
  return job;
};

export const abandonExport = (job: ExportJob): void => {
  rmSync(job.dir, { recursive: true, force: true });
  exports.delete(job.id);
};

/** A live recording (webm from the browser's MediaRecorder) → an mp4 the Desk can take. */
export const record = async (game: string, name: string, body: ReadableStream<Uint8Array> | null, signal?: AbortSignal): Promise<string> => {
  if (!body) throw new Error("no recording");
  mkdirSync(outDir(game), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const tmp = join(outDir(game), `.${safe(name)}-${Date.now()}.webm`);
  if ((await streamToFile(body, tmp)) < 1000) {
    rmSync(tmp, { force: true });
    throw new Error("the recording arrived empty");
  }
  const file = freeName(game, `${safe(name)} ${stamp}`, ".rec.mp4");
  const r = await exec([ffmpegPath ?? "ffmpeg", "-y", "-nostdin", "-v", "error", "-i", tmp, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", join(outDir(game), file)], undefined, signal);
  rmSync(tmp, { force: true });
  if (!r.ok) throw new Error(r.err.trim().split("\n").slice(-3).join(" ") || `ffmpeg exit ${r.exitCode}`);
  return file;
};

/** A still (png from the browser) straight into out/. */
export const still = async (game: string, name: string, body: ReadableStream<Uint8Array> | null): Promise<string> => {
  if (!body) throw new Error("no image");
  mkdirSync(outDir(game), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
  const file = freeName(game, `${safe(name)} ${stamp}`, ".png");
  await streamToFile(body, join(outDir(game), file));
  return file;
};

/** Hand a finished clip to the Desk (its import route), onto its own shelf. */
export const sendToDesk = async (game: string, deskGame: string, file: string, deskUrl = process.env.DESK_URL ?? "http://localhost:3400"): Promise<unknown> => {
  const p = join(outDir(game), basename(file));
  if (!existsSync(p)) throw new Error(`${file} isn't here any more`);
  const url = `${deskUrl}/api/${deskGame}/imports?name=${encodeURIComponent(basename(file))}&shelf=${encodeURIComponent("SAND TABLE")}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: Bun.file(p), headers: { "content-type": "application/octet-stream" } });
  } catch {
    throw new Error("the Desk isn't running (bun run desk)");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `the Desk said ${res.status}`);
  return data;
};
