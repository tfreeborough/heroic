/**
 * No ffmpeg install needed: probing uses the ffprobe Remotion ships
 * (`bunx remotion ffprobe`); thumbnails and clip cleanup use the full ffmpeg
 * from the `ffmpeg-static` package — Remotion's own ffmpeg is a stripped
 * build without setpts / xfade / acrossfade, so it can't join segments.
 * Thumbnails are cached under apps/desk/.cache/.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { exec } from "./exec";
import type { CleanupSpec } from "./sidecar";

export const CACHE_DIR = join(import.meta.dir, "../.cache");
mkdirSync(join(CACHE_DIR, "thumbs"), { recursive: true });

const command = (tool: "ffmpeg" | "ffprobe", args: string[]) => (tool === "ffmpeg" && ffmpegPath ? [ffmpegPath, ...args] : ["bunx", "remotion", tool, ...args]);
const CWD = join(import.meta.dir, "..");

/** Quick jobs only (a probe, one frame) — anything that encodes goes through runAsync. */
const run = (tool: "ffmpeg" | "ffprobe", args: string[]) => {
  const p = Bun.spawnSync(command(tool, args), { cwd: CWD, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString(), err: p.stderr.toString() };
};
const runAsync = (tool: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal) => exec(command(tool, args), CWD, signal);

export const ffprobe = (file: string): { seconds: number; width: number; height: number; fps: number } => {
  const r = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "json", file]);
  if (!r.ok) throw new Error(`ffprobe failed for ${basename(file)}: ${r.err.trim()}`);
  // avg_frame_rate, not r_frame_rate: phone screen recorders write variable
  // frame rate, where r_frame_rate is the timebase (90000) rather than a rate.
  const json = JSON.parse(r.out.slice(r.out.indexOf("{"))) as { streams: { width: number; height: number; avg_frame_rate: string }[]; format: { duration: string } };
  const v = json.streams[0];
  if (!v) throw new Error(`no video stream in ${basename(file)}`);
  const [num, den] = v.avg_frame_rate.split("/").map(Number);
  return { seconds: Math.round(Number(json.format.duration) * 100) / 100, width: v.width, height: v.height, fps: Math.round((num ?? 0) / (den || 1)) };
};

/** A JPEG of one frame, cached by file + mtime + time. Returns the cache path. */
export const thumbnail = (file: string, at: number, maxH = 480): string => {
  const key = `${basename(file).replace(/[^a-z0-9]+/gi, "-")}-${statSync(file).mtimeMs | 0}-${at.toFixed(2)}-${maxH}.jpg`;
  const out = join(CACHE_DIR, "thumbs", key);
  if (existsSync(out)) return out;
  const r = run("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `scale=-2:${maxH}`, "-q:v", "4", out]);
  if (!r.ok) throw new Error(`thumbnail failed for ${basename(file)}: ${r.err.trim()}`);
  return out;
};

/** A filmstrip: N evenly spaced frames tiled in one row, for the Cleanup track. Cached. */
export const filmstrip = (file: string, seconds: number, frames = 24, h = 120): string => {
  const key = `${basename(file).replace(/[^a-z0-9]+/gi, "-")}-${statSync(file).mtimeMs | 0}-strip${frames}x${h}.jpg`;
  const out = join(CACHE_DIR, "thumbs", key);
  if (existsSync(out)) return out;
  const fps = frames / Math.max(0.5, seconds);
  const r = run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `fps=${fps.toFixed(5)},scale=-2:${h},tile=${frames}x1`, "-frames:v", "1", "-q:v", "5", out]);
  if (!r.ok) throw new Error(`filmstrip failed for ${basename(file)}: ${r.err.trim()}`);
  return out;
};

export type { CleanupSpec };

/** Seconds a cleanup will produce: the segments, minus the overlap each transition eats. */
export const cleanupSeconds = (spec: CleanupSpec): number => {
  const total = spec.segments.reduce((s, x) => s + Math.max(0, x.end - x.start), 0);
  const joins = Math.max(0, spec.segments.length - 1);
  return Math.max(0.1, total - joins * spec.transitionSeconds);
};

/**
 * Cut + crop a recording into a new file (H.264, faststart). Several kept
 * segments are joined in order with a slide left (xfade "slideleft", the
 * audio crossfading under it). Cropping is by fractions of
 * the height, matching the templates' cropTop/cropBottom, so a cleaned clip
 * needs no crop later. Even-pixel heights keep the encoder happy.
 *
 * Every segment is resampled to a constant rate (the source's average, capped
 * at 60). Screen recorders write variable frame rate with a 90k timebase, and
 * without an fps filter the mp4 muxer treats that as 90000 fps and duplicates
 * frames to match: a one-minute cut becomes millions of frames and never ends.
 */
export const cleanupClip = async (input: string, output: string, spec: CleanupSpec, signal?: AbortSignal) => {
  const segs = spec.segments.filter((s) => s.end - s.start >= 0.1);
  if (!segs.length) throw new Error("nothing to keep — every segment is empty");
  const keep = Math.max(0.2, 1 - spec.cropTop - spec.cropBottom);
  const crop = `crop=iw:floor(ih*${keep.toFixed(4)}/2)*2:0:floor(ih*${spec.cropTop.toFixed(4)}/2)*2`;
  const audio = !spec.muted;
  const fps = Math.min(60, Math.max(1, ffprobe(input).fps || 60));
  const parts: string[] = [];
  segs.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},${crop},format=yuv420p[v${i}]`);
    if (audio) parts.push(`[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  let vOut = "[v0]";
  let aOut = "[a0]";
  if (segs.length > 1) {
    // Each join overlaps the last `d` seconds of what's built so far with the next segment.
    const d = Math.max(0.1, Math.min(spec.transitionSeconds || 0.4, ...segs.map((s) => (s.end - s.start) / 2)));
    let built = segs[0]!.end - segs[0]!.start;
    for (let i = 1; i < segs.length; i++) {
      const offset = Math.max(0, built - d);
      parts.push(`${vOut}[v${i}]xfade=transition=slideleft:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[vx${i}]`);
      if (audio) parts.push(`${aOut}[a${i}]acrossfade=d=${d.toFixed(3)}[ax${i}]`);
      vOut = `[vx${i}]`;
      aOut = `[ax${i}]`;
      built = built + (segs[i]!.end - segs[i]!.start) - d;
    }
  }
  const args = [
    "-y", "-nostdin", "-v", "error", "-i", input,
    "-filter_complex", parts.join(";"),
    "-map", vOut, ...(audio ? ["-map", aOut] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    ...(audio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]),
    "-movflags", "+faststart", "-f", "mp4", output,
  ];
  const r = await runAsync("ffmpeg", args, signal);
  if (signal?.aborted) throw new Error("cleanup cancelled");
  if (!r.ok) throw new Error(`ffmpeg cleanup failed: ${r.err.trim()}`);
};
