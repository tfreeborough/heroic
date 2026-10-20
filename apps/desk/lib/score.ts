/**
 * The score for an organised edit (docs/design/desk-ascii-scripts.md
 * § The score): the script's beats (mood, intensity, big moment) laid on
 * the edit's real times, plus its chapter cards and pulled words, become a
 * plan for @heroic/music's journey, written to a WAV in its own process
 * (a ten-minute score is a minute of maths) and set as the edit's music
 * bed, quiet. Same seed + same edit = the same file, so asking again is
 * instant; any change to the edit's timing makes a new one from the same
 * seed (the same piece, refitted). Server only.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLD_OPEN, END_CARD } from "@heroic/ascii-build";
import type { JourneyPlan, Mood } from "@heroic/music";
import { type Sequence, audioPieces, placedWords, sequenceSeconds } from "@heroic/voiceover";
import type { GameConfig } from "../game";
import { exec } from "./exec";
import { publicDir } from "./footage";
import { type Script, SCORE_MOODS } from "./scripts";
import { readSequence, writeSequence } from "./sequences";

/** Under the game's music folder (gitignored there). */
const DIR = "generated";
/** The bed's level under the voice: 10% (Tom, 10-11). Beats doesn't duck it by default, it's quiet enough. */
export const SCORE_LEVEL = 0.1;
/** Scores kept per game (newest first); every change to an edit's timing makes a new one. */
const KEEP = 30;
const SCRIPT = join(import.meta.dir, "../../../packages/music/scripts/journey.ts");

const bare = (w: string) => w.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "");
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

/**
 * The plan for an edit, in VIDEO seconds (the Beats template's: the title's
 * cold open first, the end card after). A beat with no mood plays as focus.
 */
export const planFor = (seq: Sequence, s: Pick<Script, "long">): JourneyPlan => {
  const open = COLD_OPEN;
  const body = sequenceSeconds(seq);
  const beats = new Map((s.long?.beats ?? []).map((b) => [b.id, b]));
  const cards = [...(seq.overlay?.cards ?? [])].sort((a, b) => a.at - b.at);
  // One stretch of music per beat (a long beat's two pictures are one).
  const runs: { beat?: string; sec: JourneyPlan["sections"][number] }[] = [];
  for (const c of cards) {
    if (c.kind !== "build") continue;
    const last = runs.at(-1);
    if (last && c.beat && last.beat === c.beat) {
      last.sec.end = open + c.at + c.seconds;
      continue;
    }
    const m = c.beat ? beats.get(c.beat)?.mood : undefined;
    const mood = (m && SCORE_MOODS.includes(m.mood) ? m.mood : "focus") as Mood;
    runs.push({ beat: c.beat, sec: { start: open + c.at, end: open + c.at + c.seconds, mood, intensity: m?.intensity ?? 0.4, ...(m?.lift ? { lift: true } : {}) } });
  }
  const breaks = cards.filter((c) => c.kind === "chapter").map((c) => ({ start: open + c.at, end: open + c.at + c.seconds }));
  const words = seq.takes.length ? placedWords({ takes: seq.takes, captionNudgeMs: seq.voice.captionNudgeMs }, audioPieces(seq)) : [];
  const accents = cards.flatMap((c) =>
    c.kind === "build" ? (c.pulled ?? []).flatMap((p) => words.find((w) => w.start >= c.at && w.start < c.at + c.seconds && bare(w.text) === bare(p))?.start ?? []).map((t) => open + t) : [],
  );
  return {
    seconds: Math.round((open + body + END_CARD) * 1000) / 1000,
    bodyStart: open,
    endCard: Math.round((open + body) * 1000) / 1000,
    sections: runs.map((r) => r.sec),
    breaks,
    accents,
  };
};

/** The file a plan and seed make, under the game's music folder. */
export const scoreFile = (seqId: string, seed: number, plan: JourneyPlan) => `${DIR}/score-${seqId.replace(/[^a-zA-Z0-9_-]/g, "")}-s${seed}-${fnv(JSON.stringify(plan))}.wav`;

const trim = (g: GameConfig) => {
  const dir = join(publicDir(g), "music", DIR);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.startsWith("score-") && f.endsWith(".wav")).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }));
  for (const { f } of files.sort((a, b) => b.t - a.t).slice(KEEP)) {
    rmSync(join(dir, f));
    rmSync(join(dir, `${f}.json`), { force: true });
  }
};

/** One score on disk: the edit it was written for, its seed, and what the seed chose (scores made before 10-19 have no label). */
export type ScoreListing = { file: string; seq: string; seed: number; label?: string; at: string };

/** Every score still on disk for these edits, newest first (only the newest KEEP per game are kept). */
export const listScores = (g: GameConfig, seqIds: string[]): ScoreListing[] => {
  const dir = join(publicDir(g), "music", DIR);
  if (!existsSync(dir)) return [];
  const prefixes = seqIds.map((id) => ({ id, prefix: `score-${id.replace(/[^a-zA-Z0-9_-]/g, "")}-s` }));
  const out: ScoreListing[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".wav")) continue;
    const of = prefixes.find((p) => f.startsWith(p.prefix) && /^\d+-/.test(f.slice(p.prefix.length)));
    if (!of) continue;
    const side = join(dir, `${f}.json`);
    const label = existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as { label?: string }).label : undefined;
    out.push({ file: `${DIR}/${f}`, seq: of.id, seed: Number(/-s(\d+)-/.exec(f)?.[1] ?? 0), ...(label ? { label } : {}), at: statSync(join(dir, f)).mtime.toISOString() });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
};

/** A score from the list onto an edit as its bed (at the bed's level), whatever was there. */
export const useScore = (g: GameConfig, seqId: string, file: string): ScoreState => {
  const seq = readSequence(g, seqId);
  if (!seq) throw new Error("that edit isn't there any more");
  if (!file.startsWith(`${DIR}/score-`) || file.includes("..") || !existsSync(join(publicDir(g), "music", file))) throw new Error("that score isn't there any more");
  writeSequence(g, { ...seq, music: { song: file, from: 0, level: seq.music?.level ?? SCORE_LEVEL } });
  const side = join(publicDir(g), "music", `${file}.json`);
  const label = existsSync(side) ? (JSON.parse(readFileSync(side, "utf8")) as { label?: string }).label : undefined;
  const st: ScoreState = { seq: seqId, file, seed: Number(/-s(\d+)-/.exec(file)?.[1] ?? 0), state: "ready", ...(label ? { label } : {}) };
  states.set(seqId, st);
  return st;
};

export type ScoreState = { seq: string; file: string; seed: number; state: "making" | "ready" | "failed"; label?: string; error?: string };

/** Scores in hand, by edit id: what's making, made, or failed (this Desk run). */
const states = new Map<string, ScoreState>();
const jobs = new Map<string, Promise<ScoreState>>();
/** The edit's score: the one this Desk run is making or made, else the one already on the edit (carried over by organise, or from before a restart). */
export const scoreState = (g: GameConfig, seqId: string): ScoreState | undefined => {
  const st = states.get(seqId);
  if (st) return st;
  const song = readSequence(g, seqId)?.music?.song;
  if (!song?.startsWith(`${DIR}/score-`) || !existsSync(join(publicDir(g), "music", song))) return undefined;
  return { seq: seqId, file: song, seed: Number(/-s(\d+)-/.exec(song)?.[1] ?? 0), state: "ready" };
};

/**
 * The edit's score: made if it isn't there yet (in the background: the
 * promise is for whoever wants to wait), then set as the edit's music bed
 * unless Tom has put a song of his own on it.
 */
export const makeScore = (g: GameConfig, s: Pick<Script, "long">, seqId: string, seed: number): Promise<ScoreState> => {
  const seq = readSequence(g, seqId);
  if (!seq) return Promise.resolve({ seq: seqId, file: "", seed, state: "failed", error: "that edit isn't there any more" });
  const plan = planFor(seq, s);
  if (!plan.sections.length) return Promise.resolve({ seq: seqId, file: "", seed, state: "failed", error: "the edit has no pictures to score" });
  const file = scoreFile(seqId, seed, plan);
  const out = join(publicDir(g), "music", file);
  const place = (st: ScoreState): ScoreState => {
    const now = readSequence(g, seqId);
    // Tom's own song stays: only an empty bed or one of ours is replaced.
    if (now && st.state === "ready" && (!now.music?.song || now.music.song.startsWith(`${DIR}/score-`)) && now.music?.song !== file) writeSequence(g, { ...now, music: { song: file, from: 0, level: now.music?.level ?? SCORE_LEVEL } });
    states.set(seqId, st);
    return st;
  };
  if (existsSync(out)) return Promise.resolve(place({ seq: seqId, file, seed, state: "ready", label: states.get(seqId)?.file === file ? states.get(seqId)?.label : undefined }));
  const running = jobs.get(file);
  if (running) return running;
  states.set(seqId, { seq: seqId, file, seed, state: "making" });
  mkdirSync(join(publicDir(g), "music", DIR), { recursive: true });
  const planPath = join(tmpdir(), `desk-score-${fnv(file)}.json`);
  writeFileSync(planPath, JSON.stringify(plan));
  const job = exec(["bun", SCRIPT, "--plan", planPath, "--seed", String(seed), "--out", out])
    .then((r) => {
      rmSync(planPath, { force: true });
      if (!r.ok) return place({ seq: seqId, file, seed, state: "failed", error: r.err.trim().split("\n").pop() || "the score didn't make" });
      const label = r.out.trim().split("\n")[0];
      // Beside the file, so the list of past scores can say what each one is after a restart.
      writeFileSync(`${out}.json`, JSON.stringify({ label, seed, seq: seqId }));
      trim(g);
      return place({ seq: seqId, file, seed, state: "ready", label });
    })
    .finally(() => jobs.delete(file));
  jobs.set(file, job);
  return job;
};
