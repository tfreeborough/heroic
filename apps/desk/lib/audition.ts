/**
 * The audition set (docs/design/desk-score-variety.md § Hearing it): the
 * same real edit scored for several seeds, a window of each, into one
 * folder with a text file of the labels. Tom listens through them in a
 * row; if two sound alike the labels say which draws they shared. Only
 * the window is rendered (the whole piece is composed, that's quick), so
 * six seeds of a ten-minute score take seconds, not minutes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Score, journey, render, wav } from "@heroic/music";
import type { GameConfig } from "../game";
import { planFor } from "./score";
import { longEdits } from "./scripts";
import { readScript } from "./scriptsStore";
import { readSequence } from "./sequences";

/** The piece between `from` and `from + seconds`, as a score of its own that runs once. */
export const excerpt = (score: Score, from: number, seconds: number): Score => {
  const end = from + seconds;
  return {
    ...score,
    seconds,
    loop: false,
    notes: score.notes.filter((n) => n.t < end && n.t + n.dur + 3 > from).map((n) => ({ ...n, t: n.t - from })),
    cutoff: (t) => score.cutoff(t + from),
    level: (t) => score.level(t + from),
  };
};

export type AuditionOpts = { seeds: number[]; from: number; seconds: number };

/** Seeds to audition: the script's own first, then `count - 1` more fixed by it (so a second run compares the same set). */
export const auditionSeeds = (own: number | undefined, count: number): number[] => {
  const first = own ?? 1;
  const out = [first];
  for (let k = 1; out.length < count; k++) {
    const s = 1 + ((first * 7919 + k * 104729) % 99999);
    if (!out.includes(s)) out.push(s);
  }
  return out;
};

/** Renders the set for the script's newest long edit; returns the folder and the labels. */
export const audition = (g: GameConfig, scriptId: string, o: AuditionOpts, log: (line: string) => void = () => {}): { dir: string; labels: string[] } => {
  const s = readScript(g, scriptId);
  if (!s) throw new Error(`no script ${scriptId}`);
  const seqId = longEdits(s).at(-1)?.id;
  if (!seqId) throw new Error("organise the script first: the score is written for an edit's timings");
  const seq = readSequence(g, seqId);
  if (!seq) throw new Error(`the edit ${seqId} isn't there`);
  const plan = planFor(seq, s);
  if (!plan.sections.length) throw new Error("the edit has no pictures to score");
  const from = Math.max(0, Math.min(o.from, plan.seconds - 5));
  const seconds = Math.max(5, Math.min(o.seconds, plan.seconds - from));
  const dir = join(g.root, "out", "desk", "audition", scriptId.slice(0, 8));
  mkdirSync(dir, { recursive: true });
  const labels: string[] = [];
  o.seeds.forEach((seed, i) => {
    const t0 = performance.now();
    const score = journey(seed, plan);
    const file = `${String(i + 1).padStart(2, "0")}-seed-${seed}.wav`;
    writeFileSync(join(dir, file), wav(render(excerpt(score, from, seconds), seed)));
    const line = `${file}  ${score.label}`;
    labels.push(line);
    log(`${line}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  });
  const head = `${s.title}\nedit ${seqId} · ${plan.seconds.toFixed(0)}s · window ${from}s to ${(from + seconds).toFixed(0)}s · ${new Date().toISOString()}\n`;
  writeFileSync(join(dir, "labels.txt"), `${head}\n${labels.join("\n")}\n`);
  return { dir, labels };
};
