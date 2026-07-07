/**
 * SFX post-processing (docs/design/asset-forge.md): trim silence at both ends,
 * loudness-normalize, encode a game-ready mp3. Runs the `ffmpeg-static` binary —
 * no system ffmpeg needed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const exec = promisify(execFile);

// Trim leading/trailing silence below -50dB, keeping a ~20ms head / ~50ms tail of
// it so the transient isn't clipped. ffmpeg's silenceremove only trims from the
// front, hence the areverse sandwich for the tail.
const TRIM =
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02," +
  "areverse," +
  "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05," +
  "areverse";

const ffmpeg = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform");
  return exec(ffmpegPath, args, { maxBuffer: 64 * 1024 * 1024 });
};

/**
 * Two-pass EBU R128 loudness normalization (`loudnorm`): pass 1 measures, pass 2
 * applies a plain linear gain from the measurements — no dynamic pumping, which
 * matters on sub-second one-shots. If measurement fails (clips can be too short
 * to measure), fall back to single-pass dynamic mode rather than skipping
 * normalization. `-ar 44100` is required: loudnorm internally resamples to 192kHz
 * and would otherwise emit that.
 */
export const processSfx = async (input: Buffer, lufs: number, truePeakDb: number): Promise<Buffer> => {
  const dir = await mkdtemp(join(tmpdir(), "forge-sfx-"));
  try {
    const inFile = join(dir, "in.mp3");
    const outFile = join(dir, "out.mp3");
    await writeFile(inFile, input);
    const target = `I=${lufs}:TP=${truePeakDb}:LRA=11`;

    let norm = `loudnorm=${target}`;
    try {
      // Pass 1: measure post-trim loudness (loudnorm prints a flat JSON block on stderr).
      const { stderr } = await ffmpeg([
        "-hide_banner",
        "-i", inFile,
        "-af", `${TRIM},loudnorm=${target}:print_format=json`,
        "-f", "null", "-",
      ]);
      const m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"))) as Record<string, string>;
      const measured = [m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset];
      // Clips too short/quiet for gated measurement report "-inf" — pass those
      // through to dynamic mode instead of feeding loudnorm an invalid arg.
      if (!measured.every((v) => Number.isFinite(Number(v)))) throw new Error("unmeasurable");
      norm =
        `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
        `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
        `:offset=${m.target_offset}:linear=true`;
    } catch {
      /* dynamic-mode fallback set above */
    }

    await ffmpeg([
      "-hide_banner", "-y",
      "-i", inFile,
      "-af", `${TRIM},${norm}`,
      "-ar", "44100",
      "-codec:a", "libmp3lame", "-b:a", "128k",
      outFile,
    ]);
    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
