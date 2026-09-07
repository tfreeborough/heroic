/**
 * Stable Audio 3 Small-SFX, run LOCALLY (docs/design/asset-forge.md § Stable
 * Audio). One call = one batch of takes: the CLI in the sibling
 * `stable-audio-3` checkout is spawned once with the prompt repeated N times,
 * so the model loads once per generation and writes `take_0..N-1.wav`.
 * Returns raw 44.1kHz stereo WAV bytes per take; the save path's ffmpeg
 * sniffs the container, so the mp3-named temp file downstream is fine.
 *
 * Why a CLI spawn and not a sidecar: the small model loads in a few seconds
 * on an M-series CPU, and the Forge generates in bursts of one bank at a time.
 * A resident Python process is the upgrade if the load ever dominates.
 *
 * Weights are gated on Hugging Face (accept the Stability AI Community License
 * on the model page, then an `HF_TOKEN` read token) — the first run downloads
 * them into `~/.cache/huggingface`; `weightsCached` gates the panel's ready
 * light on that cache so a half-set-up machine fails loud in the status box
 * rather than in a 401 mid-generation.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const exec = promisify(execFile);

export const STABLE_AUDIO_MODEL = "small-sfx";
const HF_REPO_DIR = "models--stabilityai--stable-audio-3-small-sfx";
/** The prompting guide's AudioSparx tag — "tends to produce more semantically
 * reasonable sound effects". Prepended server-side so the style-bible briefs
 * stay provider-neutral. */
const SFX_TAG = "TrackType: SFX. ";
/** SFX tip from the guide: keep durations short. Used when the panel leaves
 * duration blank (ElevenLabs picks a natural length; this model needs one). */
export const DEFAULT_SFX_SECONDS = 4;

export interface StableAudioEnv {
  /** The `stable-audio-3` checkout (has `.venv` from `uv sync`). */
  dir: string;
  /** `uv` binary. */
  uv: string;
  /** Hugging Face read token for the gated first download; optional once cached. */
  hfToken?: string;
  /** torch device: cpu (default, always works) / mps. */
  device?: string;
}

/** Everything present to generate: the checkout, its venv, uv, and either
 * cached weights or a token that can fetch them (the FIRST generation does
 * the download — so a token alone must light the panel up, or nothing ever
 * downloads). */
export const stableAudioStatus = (env: StableAudioEnv): { ready: boolean; missing: string[] } => {
  const missing: string[] = [];
  if (!existsSync(env.dir)) missing.push(`checkout at ${env.dir}`);
  else if (!existsSync(join(env.dir, ".venv"))) missing.push("`uv sync` in the checkout");
  if (!existsSync(env.uv)) missing.push(`uv at ${env.uv}`);
  if (!weightsCached() && !env.hfToken)
    missing.push("weights — accept the licence on Hugging Face and set HF_TOKEN; the first generation downloads them");
  return { ready: missing.length === 0, missing };
};

export const weightsCached = (): boolean =>
  existsSync(join(homedir(), ".cache", "huggingface", "hub", HF_REPO_DIR, "snapshots"));

export interface LocalSfxCall {
  text: string;
  durationSeconds?: number;
  takes: number;
}

/** Generate `takes` candidates in one model load. Rejects with the CLI's
 * stderr tail on failure (a gated 401 reads clearly there). */
export const generateSfxLocal = async (env: StableAudioEnv, call: LocalSfxCall): Promise<Buffer[]> => {
  const dir = await mkdtemp(join(tmpdir(), "forge-sa3-"));
  try {
    const out = join(dir, "take.wav");
    const prompt = SFX_TAG + call.text;
    const duration = String(call.durationSeconds ?? DEFAULT_SFX_SECONDS);
    const args = [
      "run", "--project", env.dir, "stable-audio",
      "--model", STABLE_AUDIO_MODEL,
      "--device", env.device ?? "cpu",
      "--steps", "8",
      "--cfg-scale", "1.0",
      "--duration", duration,
      "-o", out,
      "-p", ...Array.from({ length: call.takes }, () => prompt),
    ];
    try {
      await exec(env.uv, args, {
        cwd: env.dir,
        env: { ...process.env, ...(env.hfToken ? { HF_TOKEN: env.hfToken } : {}) },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 10 * 60_000, // the first run downloads ~1GB of weights
      });
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      const tail = (err.stderr ?? err.message ?? "").trim().split("\n").slice(-3).join(" ");
      throw new Error(`Stable Audio: ${tail.slice(0, 400)}`);
    }
    // One prompt → `take.wav`; a batch → `take_0.wav` … (cli._save_output).
    const files =
      call.takes === 1 ? [out] : Array.from({ length: call.takes }, (_, i) => join(dir, `take_${i}.wav`));
    return Promise.all(files.map((f) => readFile(f)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
