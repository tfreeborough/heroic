/**
 * Footage that starts on the Mac (screen recordings: code, the editors)
 * rather than the phone: dropped on the Desk's Clips page, uploaded to the
 * server, converted, filed in the footage dir like any synced recording.
 *
 * The convert matters. macOS screen recordings are huge (Retina resolution,
 * often a variable frame rate), which makes the preview stutter and a
 * render drift. The copy the Desk uses is at most 1440 tall (a 9:16 box cut
 * from it still has 810 × 1440 of real pixels for a 1080 × 1920 video, so
 * code stays sharp) at the game's frame rate. The original is kept beside
 * it, in footage/originals/, and never touched.
 *
 * Imports aren't on Drive (Sync only brings Drive's files down), so
 * backupImports() puts the converted copies there.
 */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { ffprobe } from "./ffmpeg";
import { footageDir, listClips, writeSidecar } from "./footage";
import { freshSidecar } from "./sidecar";

/** The tallest a converted import is. */
export const IMPORT_MAX_H = 1440;

export type ImportJob = { id: string; game: string; name: string; file?: string; /** The shelf it's filed on ("" = unshelved). */ shelf?: string; state: "uploaded" | "converting" | "done" | "failed"; progress: number; error?: string; startedAt: number };
export const importJobs = new Map<string, ImportJob>();

const originalsDir = (g: GameConfig) => join(footageDir(g), "originals");
const stem = (name: string) => name.replace(/\.[^.]+$/, "");
/** When it was recorded: macOS names screen recordings "Screen Recording 2026-10-02 at 14.10.00"; otherwise the file's own date. */
const recordedAt = (name: string, mtime: Date) => {
  const m = /(\d{4})-(\d{2})-(\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})/.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]!.padStart(2, "0")}:${m[5]}:${m[6]}` : mtime.toISOString().slice(0, 19);
};
const safe = (name: string) => stem(name).replace(/[\\/:*?"<>|]+/g, "-").trim() || "import";

/** A name in the footage dir nothing else has. */
const freeName = (g: GameConfig, name: string) => {
  let out = `${safe(name)}.mp4`;
  for (let n = 2; existsSync(join(footageDir(g), out)); n++) out = `${safe(name)} ${n}.mp4`;
  return out;
};

/** The request body (the file) to disk, then convert it in the background. Answers at once with the job. `shelf` is where the library files it. */
export const startImport = async (g: GameConfig, name: string, req: Request, shelf = ""): Promise<ImportJob> => {
  mkdirSync(originalsDir(g), { recursive: true });
  const id = crypto.randomUUID();
  const ext = /\.[a-z0-9]+$/i.exec(name)?.[0] ?? ".mov";
  const original = join(originalsDir(g), `${safe(name)}-${id.slice(0, 8)}${ext}`);
  // Streamed to disk: a screen recording can be gigabytes. (Chunk by chunk:
  // Bun.write of the body wrapped in a new Response never finishes.)
  if (!req.body) throw new Error("no file");
  const out = Bun.file(original).writer();
  for await (const chunk of req.body) out.write(chunk);
  await out.end();
  if (statSync(original).size < 1000) {
    rmSync(original, { force: true });
    throw new Error(`${name} arrived empty`);
  }
  const job: ImportJob = { id, game: g.id, name, ...(shelf ? { shelf } : {}), state: "uploaded", progress: 0, startedAt: Date.now() };
  importJobs.set(id, job);
  void convert(g, job, original).catch((e) => {
    job.state = "failed";
    job.error = (e as Error).message;
  });
  return job;
};

const convert = async (g: GameConfig, job: ImportJob, original: string) => {
  job.state = "converting";
  const src = ffprobe(original);
  const out = freeName(g, job.name);
  const tmp = join(footageDir(g), `.${out}.partial`);
  const args = [
    "-y", "-nostdin", "-v", "error", "-i", original,
    // Constant frame rate, even dimensions, never taller than IMPORT_MAX_H.
    "-vf", `fps=${g.fps},scale=-2:'min(${IMPORT_MAX_H},ih)':flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart", "-progress", "pipe:1", "-f", "mp4", tmp,
  ];
  const p = Bun.spawn([ffmpegPath ?? "ffmpeg", ...args], { stdout: "pipe", stderr: "pipe" });
  // -progress writes key=value lines; out_time_us is how far it's got.
  const reader = p.stdout.getReader();
  const text = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += text.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      const m = /^out_time_us=(\d+)/.exec(l);
      if (m && src.seconds > 0) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / src.seconds);
    }
  }
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  if (code !== 0) {
    rmSync(tmp, { force: true });
    throw new Error(`the convert failed: ${err.trim().split("\n").slice(-3).join(" ") || `ffmpeg exit ${code}`}`);
  }
  const facts = ffprobe(tmp);
  // The sidecar first, so a sync that runs meanwhile never gives it a phone's crop.
  writeSidecar(g, { ...freshSidecar(out, { ...facts, recordedAt: recordedAt(job.name, statSync(original).mtime), bytes: statSync(tmp).size }), cropTop: 0, cropBottom: 0, note: "", imported: original.slice(footageDir(g).length + 1), ...(job.shelf ? { shelf: job.shelf } : {}) });
  renameSync(tmp, join(footageDir(g), out));
  job.file = out;
  job.progress = 1;
  job.state = "done";
};

/** The converted imports up to Drive (they only exist on this Mac until
 * then), each into its shelf's folder under footage-imports/ so Drive reads
 * like the library does. */
export const backupImports = async (g: GameConfig): Promise<{ ok: boolean; log: string }> => {
  const byShelf = new Map<string, string[]>();
  for (const c of listClips(g)) if (c.imported) byShelf.set(c.shelf ?? "", [...(byShelf.get(c.shelf ?? "") ?? []), c.file]);
  if (!byShelf.size) return { ok: true, log: "No imports to back up." };
  const list = join(footageDir(g), ".imports-to-backup.txt");
  const lines: string[] = [];
  let ok = true;
  let n = 0;
  try {
    for (const [shelf, files] of byShelf) {
      await Bun.write(list, files.join("\n") + "\n");
      const target = `${g.drive.uploadTarget.replace(/\/+$/, "")}/footage-imports${shelf ? `/${shelf}` : ""}`;
      const p = await exec(["rclone", "copy", footageDir(g), target, "--files-from", list, "--stats-one-line"]);
      lines.push(...`${p.out}${p.err}`.split("\n").filter((l) => l && !l.includes("shared Google Drive client_id")));
      if (!p.ok) {
        ok = false;
        lines.push(`✖ ${shelf || "unshelved"}: rclone exit ${p.exitCode}`);
      } else n += files.length;
    }
  } finally {
    rmSync(list, { force: true });
  }
  if (ok) lines.push(`${n} import${n === 1 ? "" : "s"} on Drive, in footage-imports/${byShelf.size > 1 || !byShelf.has("") ? "<shelf>/" : ""}`);
  return { ok, log: lines.join("\n") };
};
