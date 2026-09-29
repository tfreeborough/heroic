/**
 * A game's voice-overs: <voiceDir>/<id>.json is the edit (pieces + words,
 * committed), <voiceDir>/takes/ holds the recordings (ignored). For a take
 * `x-1`: `x-1.raw.*` is what the mic gave us (never touched again), and
 * beside it one WAV per way it's been asked for: `x-1.wav` tidied,
 * `x-1.plain.wav` as recorded, `x-1.n2v1.wav` tidied with the noise turned
 * down at strength 2, and so on. Videos play whichever the take's `file`
 * names. Nothing is ever rewritten in place: a browser that has a file open
 * keeps playing it.
 *
 * The folder sits inside the game's public dir, so a template reaches a
 * take with staticFile() like any clip.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { NOISE_LEVELS, type Take, type VoiceOver, denoise, emptyVoiceOver, pausesOf, speechOf, voiceId } from "@heroic/voiceover";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { publicDir } from "./footage";
import { transcribeFile } from "./whisper";

export const voiceDir = (g: GameConfig) => join(g.root, g.voiceDir ?? join(g.publicDir, "voice"));
const takesDir = (g: GameConfig) => join(voiceDir(g), "takes");
const trashDir = (g: GameConfig) => join(voiceDir(g), ".trash");
const ensure = (g: GameConfig) => mkdirSync(takesDir(g), { recursive: true });

const pathOf = (g: GameConfig, id: string) => join(voiceDir(g), `${voiceId(id)}.json`);
/** The path a template uses for a voice-over, under the public dir. */
export const voicePath = (g: GameConfig, id: string) => relative(publicDir(g), pathOf(g, id));

export const readVoice = (g: GameConfig, id: string): VoiceOver | undefined => {
  const p = pathOf(g, id);
  if (!existsSync(p)) return undefined;
  try {
    const v = JSON.parse(readFileSync(p, "utf8")) as VoiceOver;
    return Array.isArray(v.pieces) && Array.isArray(v.takes) ? v : undefined;
  } catch {
    return undefined;
  }
};

export const writeVoice = (g: GameConfig, voice: VoiceOver): VoiceOver => {
  ensure(g);
  const clean: VoiceOver = { ...voice, id: voiceId(voice.id) };
  writeFileSync(pathOf(g, clean.id), JSON.stringify(clean, null, 1) + "\n");
  return clean;
};

export type VoiceSummary = { id: string; clip: string; path: string; pieces: number; takes: number; seconds: number; savedAt: string };

export const listVoices = (g: GameConfig): VoiceSummary[] => {
  if (!existsSync(voiceDir(g))) return [];
  return readdirSync(voiceDir(g))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const v = readVoice(g, f);
      if (!v) return [];
      const seconds = v.pieces.reduce((s, p) => s + (p.end - p.start), 0);
      return [{ id: v.id, clip: v.clip, path: voicePath(g, v.id), pieces: v.pieces.length, takes: v.takes.length, seconds: Math.round(seconds * 10) / 10, savedAt: statSync(join(voiceDir(g), f)).mtime.toISOString() }];
    })
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
};

const takeFile = (g: GameConfig, take: Take) => join(publicDir(g), take.file);
/** Bumped when the noise reduction changes what it does, so takes made the old way are made again. */
const NOISE_V = 1;
export type Sound = { tidy: boolean; denoise: number };
const strength = (n: unknown) => Math.max(0, Math.min(NOISE_LEVELS.length - 1, Math.round(Number(n) || 0)));
/** "x-1" for voice/takes/x-1.wav, x-1.plain.wav, x-1.n2v1.wav… */
const stemOf = (take: Take) => basename(take.file).replace(/(\.plain)?(\.n\d+v\d+)?\.wav$/, "");
const soundOf = (g: GameConfig, stem: string, sound: Sound) => join(takesDir(g), `${stem}${sound.tidy ? "" : ".plain"}${sound.denoise ? `.n${sound.denoise}v${NOISE_V}` : ""}.wav`);
/** The untouched recording that sits beside a take. */
const rawOf = (g: GameConfig, take: Take): string | undefined =>
  readdirSync(takesDir(g))
    .filter((f) => f.startsWith(`${stemOf(take)}.raw.`))
    .map((f) => join(takesDir(g), f))[0];

/**
 * Out of the library, not off the disk: the edit goes to .trash/, and so do
 * its recordings unless another voice-over uses them (a clip saved under a
 * new name takes its voice-over's recordings with it) or `keepTakes` says
 * the edit has only moved.
 */
export const deleteVoice = (g: GameConfig, id: string, keepTakes = false) => {
  const v = readVoice(g, id);
  if (!v) return;
  ensure(g);
  mkdirSync(trashDir(g), { recursive: true });
  if (!keepTakes) {
    const others = listVoices(g)
      .filter((o) => o.id !== v.id)
      .flatMap((o) => readVoice(g, o.id)?.takes ?? [])
      .map(stemOf);
    for (const t of v.takes) {
      if (others.includes(stemOf(t))) continue;
      for (const f of readdirSync(takesDir(g)).filter((f) => f.startsWith(`${stemOf(t)}.`))) renameSync(join(takesDir(g), f), join(trashDir(g), f));
    }
  }
  renameSync(pathOf(g, id), join(trashDir(g), basename(pathOf(g, id))));
};

const seconds = async (file: string): Promise<number> => {
  const r = await exec(["bunx", "remotion", "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], join(import.meta.dir, ".."));
  const n = Number(r.out.trim().split("\n").pop());
  if (!r.ok || !Number.isFinite(n)) throw new Error(`couldn't measure ${basename(file)}: ${r.err.trim()}`);
  return Math.round(n * 1000) / 1000;
};

/** Spoken-word loudness for phones: −16 LUFS, peaks kept under −1.5 dB. */
const LOUDNESS = { I: -16, TP: -1.5, LRA: 11 };
/** Below the voice there's only desk thumps and mains hum. */
const RUMBLE = "highpass=f=80";

/** Steeper than the tidy's rumble cut: on real takes most of the "background noise" was below 80 Hz, and this alone took 17 dB off it. */
const DEEP_CUT = "highpass=f=90:poles=2,highpass=f=90:poles=2";

/** The recording with its background turned down, as raw 32-bit samples at 48 kHz in a temp file for ffmpeg to pick up. */
const quieten = async (raw: string, level: number, tmp: string, signal?: AbortSignal) => {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this machine");
  const pcm = `${tmp}.in`;
  const r = await exec([ffmpegPath, "-y", "-nostdin", "-v", "error", "-i", raw, "-af", DEEP_CUT, "-ar", "48000", "-ac", "1", "-f", "f32le", pcm], undefined, signal);
  try {
    if (!r.ok) throw new Error(`couldn't read the take: ${r.err.trim()}`);
    const bytes = readFileSync(pcm);
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
    const out = denoise(samples, 48000, pausesOf(speechOf(samples, 48000), samples.length / 48000), { reduce: NOISE_LEVELS[level]?.reduce ?? 0 });
    writeFileSync(tmp, new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
  } finally {
    rmSync(pcm, { force: true });
  }
};

/**
 * Raw recording → the WAV a video plays (48 kHz mono 16-bit).
 *
 * `denoise` first: the rumble cut, then the background turned down where
 * nobody's speaking (before the levelling, which would turn the noise up
 * with the voice). `tidy` then levels the loudness in two passes: the
 * first measures, the second applies one fixed gain (`linear`), so the
 * voice is never pumped up and down the way a one-pass leveller does it.
 */
const makeWav = async (raw: string, out: string, sound: Sound, signal?: AbortSignal) => {
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this machine");
  const tail = ["-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav"];
  const tmp = `${out}.partial`;
  const quiet = `${out}.quiet.partial`;
  try {
    if (sound.denoise) await quieten(raw, sound.denoise, quiet, signal);
    const from = sound.denoise ? ["-f", "f32le", "-ar", "48000", "-ac", "1", "-i", quiet] : ["-i", raw];
    let filter: string | undefined;
    if (sound.tidy) {
      const base = `${RUMBLE},loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
      const measure = await exec([ffmpegPath, "-nostdin", "-hide_banner", ...from, "-af", `${base}:print_format=json`, "-f", "null", "-"], undefined, signal);
      const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(measure.err);
      const got = m ? (JSON.parse(m[0]) as Record<string, string>) : undefined;
      const usable = got && [got.input_i, got.input_tp, got.input_lra, got.input_thresh].every((v) => Number.isFinite(Number(v)));
      // Silence measures as -inf: nothing to level, so just filter it.
      filter = usable ? `${base}:measured_I=${got.input_i}:measured_TP=${got.input_tp}:measured_LRA=${got.input_lra}:measured_thresh=${got.input_thresh}:offset=${got.target_offset}:linear=true` : RUMBLE;
    }
    const r = await exec([ffmpegPath, "-y", "-nostdin", "-v", "error", ...from, ...(filter ? ["-af", filter] : []), ...tail, tmp], undefined, signal);
    if (!r.ok) throw new Error(`couldn't convert the take: ${r.err.trim()}`);
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, { force: true });
    rmSync(quiet, { force: true });
  }
};

/**
 * A recording off the mic (or any audio file ffmpeg reads) becomes the
 * voice-over's next take. Returns the take; the caller lays it on the row.
 */
export const saveTake = async (g: GameConfig, id: string, bytes: Uint8Array, opts: { ext?: string; tidy?: boolean; denoise?: number; signal?: AbortSignal } = {}): Promise<Take> => {
  ensure(g);
  const stem = voiceId(id);
  const ext = (opts.ext ?? "wav").replace(/[^a-z0-9]/gi, "").toLowerCase() || "wav";
  let n = 1;
  while (readdirSync(takesDir(g)).some((f) => f.startsWith(`${stem}-${n}.`))) n++;
  const raw = join(takesDir(g), `${stem}-${n}.raw.${ext}`);
  const sound: Sound = { tidy: opts.tidy ?? true, denoise: strength(opts.denoise) };
  const out = soundOf(g, `${stem}-${n}`, sound);
  writeFileSync(raw, bytes);
  try {
    await makeWav(raw, out, sound, opts.signal);
    return { file: relative(publicDir(g), out), seconds: await seconds(out), recordedAt: new Date().toISOString(), words: [] };
  } catch (e) {
    rmSync(raw, { force: true });
    rmSync(out, { force: true });
    throw e;
  }
};

/** Point every take at its sound made this way (tidied or not, the noise down or not), making the file the first time it's asked for. Lengths don't change, so the edit stands. */
export const resound = async (g: GameConfig, voice: VoiceOver, want: Partial<Sound>, signal?: AbortSignal): Promise<VoiceOver> => {
  const sound: Sound = { tidy: want.tidy ?? voice.tidy, denoise: strength(want.denoise ?? voice.denoise) };
  const takes: Take[] = [];
  for (const t of voice.takes) {
    const raw = rawOf(g, t);
    const out = soundOf(g, stemOf(t), sound);
    if (!existsSync(out) && raw) await makeWav(raw, out, sound, signal);
    takes.push(existsSync(out) ? { ...t, file: relative(publicDir(g), out) } : t);
  }
  return { ...voice, takes, ...sound };
};

/** The words of one take. Reads the raw recording when there is one: levelling changes nothing Whisper cares about. */
export const transcribeTake = async (g: GameConfig, take: Take, signal?: AbortSignal): Promise<Take> => {
  const file = existsSync(takeFile(g, take)) ? takeFile(g, take) : rawOf(g, take);
  if (!file) throw new Error(`${take.file} isn't on this machine`);
  const words = await transcribeFile(file, g.voice?.vocabulary ?? [], signal);
  return { ...take, words, transcribed: true };
};

/** Every take and its raw recording → Drive, beside the finished videos. Additive. */
export const backupTakes = async (g: GameConfig): Promise<{ ok: boolean; log: string }> => {
  ensure(g);
  const target = `${g.drive.uploadTarget.replace(/\/+$/, "")}/voice-takes`;
  const p = await exec(["rclone", "copy", takesDir(g), target, "--exclude", "*.partial", "--stats-one-line"]);
  const log = `${p.out}${p.err}`.split("\n").filter((l) => l && !l.includes("shared Google Drive client_id")).join("\n");
  const count = readdirSync(takesDir(g)).filter((f) => !f.endsWith(".partial")).length;
  return { ok: p.exitCode === 0, log: log || (p.exitCode === 0 ? `${count} file${count === 1 ? "" : "s"} on Drive` : `rclone exit ${p.exitCode}`) };
};

/** A voice-over by id, or a fresh one for `clip` if there's none yet. */
export const openVoice = (g: GameConfig, id: string, clip: string): VoiceOver => readVoice(g, id) ?? emptyVoiceOver(voiceId(id), clip);
