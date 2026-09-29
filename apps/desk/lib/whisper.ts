/**
 * Speech → words with times, on this machine. whisper.cpp is cloned and
 * built under apps/desk/.cache/whisper on first use (needs git, make and
 * cmake: `brew install cmake`), and the model is downloaded next to it
 * (about 1.6 GB, once). Nothing is sent anywhere.
 *
 * `bun lib/whisper.ts install` does the install from a terminal, with output.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type WhisperModel, downloadWhisperModel, installWhisperCpp } from "@remotion/install-whisper-cpp";
import ffmpegPath from "ffmpeg-static";
import { type WhisperItem, type Word, pcmOfWav, placeWords, speechOf, wordsFromWhisper } from "@heroic/voiceover";
import { exec } from "./exec";
import { CACHE_DIR } from "./ffmpeg";

const WHISPER_DIR = join(CACHE_DIR, "whisper");
/** 1.7.4 and later build with cmake and name the binary whisper-cli. */
const WHISPER_VERSION = "1.7.6";
/** Near the large model's accuracy at several times its speed; multilingual, so it copes with accents. */
const MODEL: WhisperModel = (process.env.DESK_WHISPER_MODEL as WhisperModel | undefined) ?? "large-v3-turbo";

export type WhisperStatus = {
  /** Built and the model is on disk: transcribing will work. */
  ready: boolean;
  built: boolean;
  model: string;
  modelOnDisk: boolean;
  /** An install is running now; `progress` is the model download, 0–1. */
  installing: boolean;
  step?: "building" | "downloading";
  progress?: number;
  error?: string;
};

let installing: Promise<void> | null = null;
let step: WhisperStatus["step"];
let progress = 0;
let lastError: string | undefined;

// Where the wrapper looks for them (it exports neither path).
const binary = join(WHISPER_DIR, "build", "bin", "whisper-cli");
const modelFile = join(WHISPER_DIR, `ggml-${MODEL}.bin`);
const built = () => existsSync(binary);
const modelOnDisk = () => existsSync(modelFile);

export const whisperStatus = (): WhisperStatus => ({
  ready: built() && modelOnDisk(),
  built: built(),
  model: MODEL,
  modelOnDisk: modelOnDisk(),
  installing: installing !== null,
  step: installing ? step : undefined,
  progress: installing ? progress : undefined,
  error: lastError,
});

/** Build whisper.cpp and fetch the model, whichever is missing. Safe to call twice: the second call joins the first. */
export const installWhisper = (printOutput = false): Promise<void> => {
  if (installing) return installing;
  lastError = undefined;
  installing = (async () => {
    try {
      if (!built()) {
        step = "building";
        // A folder without the binary is a build that died part-way; the installer refuses to reuse it.
        if (existsSync(WHISPER_DIR) && !modelOnDisk()) rmSync(WHISPER_DIR, { recursive: true, force: true });
        if (existsSync(WHISPER_DIR)) {
          // Keep a model that's already down: build beside it, then swap the model across.
          const keep = join(CACHE_DIR, `whisper-model-${MODEL}.bin`);
          await exec(["mv", modelFile, keep]);
          rmSync(WHISPER_DIR, { recursive: true, force: true });
          await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput });
          await exec(["mv", keep, modelFile]);
        } else {
          mkdirSync(CACHE_DIR, { recursive: true });
          await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput });
        }
        if (!built()) throw new Error("whisper.cpp didn't build. It needs git, make and cmake (brew install cmake); run `bun lib/whisper.ts install` in apps/desk to see why.");
      }
      if (!modelOnDisk()) {
        step = "downloading";
        progress = 0;
        await downloadWhisperModel({ model: MODEL, folder: WHISPER_DIR, printOutput, onProgress: (done, total) => (progress = total ? done / total : 0) });
      }
    } catch (e) {
      lastError = (e as Error).message;
      throw e;
    } finally {
      installing = null;
      step = undefined;
    }
  })();
  return installing;
};

let queue: Promise<unknown> = Promise.resolve();

/**
 * The words in an audio file, timed against it. `vocabulary` is a hint:
 * names Whisper wouldn't otherwise know how to spell. Runs whisper-cli
 * itself rather than through the wrapper, which waits on the process long
 * after the answer is written. One at a time: it takes the whole GPU.
 */
export const transcribeFile = (file: string, vocabulary: string[] = [], signal?: AbortSignal): Promise<Word[]> => {
  const run = async (): Promise<Word[]> => {
    if (!built() || !modelOnDisk()) throw new Error("Whisper isn't installed yet");
    if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this machine");
    const stem = join(CACHE_DIR, `whisper-${statSync(file).mtimeMs | 0}-${Math.random().toString(36).slice(2, 8)}`);
    const wav = `${stem}.wav`;
    try {
      // Whisper wants 16 kHz mono.
      const conv = await exec([ffmpegPath, "-y", "-nostdin", "-v", "error", "-i", file, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], undefined, signal);
      if (!conv.ok) throw new Error(`couldn't prepare the take for Whisper: ${conv.err.trim()}`);
      const prompt = vocabulary.length ? `British English. ${vocabulary.join(", ")}.` : "British English.";
      // One word per item (--max-len 1 on word boundaries), full JSON with each token's aligned time (--dtw).
      const args = ["-f", wav, "-m", modelFile, "--output-file", stem, "--output-json-full", "--max-len", "1", "--split-on-word", "true", "--dtw", MODEL.replace(/-/g, "."), "-l", "en", "--prompt", prompt];
      const r = await exec([binary, ...args], WHISPER_DIR, signal);
      if (signal?.aborted) throw new Error("transcription cancelled");
      if (!existsSync(`${stem}.json`)) throw new Error(`Whisper wrote nothing (exit ${r.exitCode}): ${r.err.trim().split("\n").slice(-3).join(" ")}`);
      const json = JSON.parse(readFileSync(`${stem}.json`, "utf8")) as { transcription: WhisperItem[] };
      const { samples, rate } = pcmOfWav(new Uint8Array(readFileSync(wav)));
      return placeWords(wordsFromWhisper(json.transcription), speechOf(samples, rate));
    } finally {
      rmSync(wav, { force: true });
      rmSync(`${stem}.json`, { force: true });
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
};

if (import.meta.main) {
  const cmd = process.argv[2];
  if (cmd === "install") {
    await installWhisper(true);
    console.log(whisperStatus());
  } else if (cmd && existsSync(cmd)) {
    console.log(JSON.stringify(await transcribeFile(cmd, process.argv.slice(3)), null, 1));
  } else {
    console.log(whisperStatus());
    console.log("usage: bun lib/whisper.ts install | <audio file> [vocabulary…]");
  }
}
