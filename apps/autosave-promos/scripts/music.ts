#!/usr/bin/env bun
/**
 * Generates a save's music from its seed and memory (src/music/).
 *
 *   bun scripts/music.ts --memory "The quiet hours" --seed 7      one track
 *   bun scripts/music.ts --memory "…" --variants 6                six to choose from
 *   bun scripts/music.ts --save mirror-check --styles             one save, every style
 *     (a save's music comes from its slot: --slot N, default the next free
 *     slot; --take 1, 2… for a different tune in the same slot)
 *   bun scripts/music.ts --samples                                every style, twice
 *   bun scripts/music.ts --props '<Save props JSON>' --out <file> what the Desk runs (src/music/tune.ts)
 *     --style lofi    force a style    --mood night    force a mood
 *     --stems         print each instrument's level (for balancing)
 *
 * Writes out/music/<…>-preview.wav (two loops with the save chime in, as a
 * viewer hears it) and out/music/loops/<…>.wav (one loop, the video's length).
 */
import { mkdirSync, readFileSync, readdirSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { STYLE_NAMES, type StyleName, compose, musicSeed, stylesFor } from "@heroic/music";
import { MOODS, type Mood, readMood, type SaveWords } from "@heroic/music";
import { SR, type Stereo, render, stemLevels, wav } from "@heroic/music";
import { timeline } from "../src/timeline";
import { type TuneProps, tuneFor } from "../src/music/tune";

const root = join(import.meta.dir, "..");
const OUT = join(root, "out/music");

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "true" : process.argv[++i]!);
}

/** The save chime as mono samples, so the preview has it where the video does. */
const chime = (() => {
  const r = spawnSync(ffmpegPath!, ["-v", "error", "-i", join(root, "public/sfx/chime.mp3"), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
})();

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "save";

const make = (words: SaveWords, seed: number, seconds: number, force: { style?: StyleName; mood?: Mood } = {}, dir = OUT) => {
  const tl = timeline(seconds, words.memory);
  const reading = readMood(words, seed);
  const mood = force.mood ?? reading.mood;
  const score = compose(seed, mood, { seconds, buildEnd: tl.buildEnd, saved: tl.saved, exitStart: tl.exit.start }, force.style);
  const loop = render(score, seed);
  const name = `${score.style}-${slug(words.memory)}-s${seed}`;
  mkdirSync(join(dir, "loops"), { recursive: true });
  writeFileSync(join(dir, "loops", `${name}.wav`), wav(loop));

  // The preview: twice round, music at the template's 0.7, chime at its 0.8
  // moved into this key (the video will play it at the same rate).
  const n = loop.l.length;
  const prev: Stereo = { l: new Float32Array(2 * n), r: new Float32Array(2 * n) };
  const rate = 2 ** (score.chimeShift / 12);
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < n; i++) {
      prev.l[k * n + i] = loop.l[i]! * 0.7;
      prev.r[k * n + i] = loop.r[i]! * 0.7;
    }
    const at = k * n + Math.round(tl.saved * SR);
    for (let i = 0; at + i < 2 * n; i++) {
      const p = i * rate;
      const a = Math.floor(p);
      if (a + 1 >= chime.length) break;
      const s = (chime[a]! * (1 - (p - a)) + chime[a + 1]! * (p - a)) * 0.8;
      prev.l[at + i] = prev.l[at + i]! + s;
      prev.r[at + i] = prev.r[at + i]! + s;
    }
  }
  writeFileSync(join(dir, `${name}-preview.wav`), wav(prev));
  console.log(`${name}\n  ${score.label}${force.mood ? "" : `\n  words: ${reading.why.join(", ") || "–"}`}`);
  if (args.has("stems")) {
    const levels = stemLevels(score, seed);
    console.log(`  levels: ${Object.entries(levels).sort((a, b) => b[1]! - a[1]!).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
};

if (!args.has("props")) mkdirSync(join(OUT, "loops"), { recursive: true });
const seconds = Number(args.get("seconds") ?? 16);
const force = { style: args.get("style") as StyleName | undefined, mood: args.get("mood") as Mood | undefined };
if (force.style && !STYLE_NAMES.includes(force.style)) throw new Error(`styles: ${STYLE_NAMES.join(", ")}`);
if (force.mood && !MOODS.includes(force.mood)) throw new Error(`moods: ${MOODS.join(", ")}`);

if (args.has("props")) {
  // The Desk's call (desk.server.ts "tune"): one loop, written where it says
  // (via a .part file, so a half-written tune is never played).
  const { score, seed } = tuneFor(JSON.parse(args.get("props")!) as TuneProps);
  const out = args.get("out")!;
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(`${out}.part`, wav(render(score, seed)));
  renameSync(`${out}.part`, out);
  console.log(score.label);
} else if (args.has("samples")) {
  // A tour: every style twice, each time on a memory whose mood suits it.
  // Memories are Tom's old saves (retired/, kept locally) plus a few to cover the moods.
  const retired = join(root, "retired");
  const saves: SaveWords[] = existsSync(retired)
    ? readdirSync(retired).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(retired, f), "utf8")) as SaveWords)
    : [];
  saves.push({ memory: "The last bus home in the rain" }, { memory: "Holding her for the first time" }, { memory: "Sunday mornings in the kitchen" }, { memory: "Our first go on the arcade" }, { memory: "The stars over the campsite" });
  let seed = 100;
  const used = new Map<string, number>();
  for (const style of STYLE_NAMES) {
    for (let k = 0; k < 2; k++) {
      // Next memory (round the list) whose mood this style suits.
      const fits = saves.filter((w) => stylesFor(readMood(w, seed).mood).includes(style));
      const pool = fits.length ? fits : saves;
      const w = pool.sort((a, b) => (used.get(a.memory) ?? 0) - (used.get(b.memory) ?? 0))[0]!;
      used.set(w.memory, (used.get(w.memory) ?? 0) + 1);
      make(w, seed++, seconds, { style });
    }
  }
} else if (args.has("save")) {
  // A real save's words (public/saves/<name>.json); --styles plays its seed in every style.
  const words = JSON.parse(readFileSync(join(root, "public/saves", `${args.get("save")}.json`), "utf8")) as SaveWords;
  const ledger = JSON.parse(readFileSync(join(root, "public/slots.json"), "utf8")) as { slots: unknown[] };
  const slot = Number(args.get("slot") ?? ledger.slots.length + 1);
  const take = Number(args.get("take") ?? 0);
  const seed = musicSeed(slot, take);
  const dir = join(OUT, `${args.get("save")}-slot${slot}${take ? `-take${take}` : ""}`);
  mkdirSync(dir, { recursive: true });
  for (const style of args.has("styles") ? STYLE_NAMES : [force.style]) make(words, seed, seconds, { ...force, style }, dir);
} else {
  const words = { memory: args.get("memory") ?? "", title: args.get("title"), tagline: args.get("tagline") };
  const first = Number(args.get("seed") ?? 1);
  const count = Number(args.get("variants") ?? 1);
  for (let s = first; s < first + count; s++) make(words, s, seconds, force);
}
if (!args.has("props")) console.log(`→ ${OUT}`);
