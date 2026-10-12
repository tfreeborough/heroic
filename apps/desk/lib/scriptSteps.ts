/**
 * The Scripts tab's buttons, server side: each reads the script, runs one
 * Claude call (rewrite.ts) in the game's voice with the finished scripts
 * as samples, snapshots the source it ran on, saves, and answers with the
 * whole script. Throws plainly when there's no key or no voice.
 */
import type { GameConfig } from "../game";
import { youtubeChapters } from "@heroic/ascii-build";
import { PICTURE_STYLE, hasImages, makePicture, saveOwnPicture } from "./cards";
import * as ai from "./rewrite";
import { matchScript } from "./match";
import { organiseCut } from "./organise";
import { type Beat, type BeatPicture, type Cut, type Script, isStale, newLook, picturesWanted, plannedBeats } from "./scripts";
import { readScript, saveScript, voiceSamples } from "./scriptsStore";
import { makeScore } from "./score";
import { seqSlug, writeSequence } from "./sequences";

export const hasClaude = ai.hasClaude;

const need = (g: GameConfig, id: string): { s: Script; v: ai.ScriptVoice; samples: string[] } => {
  if (!ai.hasClaude()) throw new Error("no ANTHROPIC_API_KEY in apps/desk/.env");
  if (!g.script?.ai) throw new Error(`${g.name} has no script voice (script.ai in its desk.config)`);
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  return { s, v: g.script.ai, samples: voiceSamples(g, id) };
};
const snapshot = (s: Script): Script => ({ ...s, sources: [...s.sources, { at: new Date().toISOString(), text: s.source }] });
const findCut = (s: Script, cut: string): Cut => {
  const c = s.long?.id === cut ? s.long : s.shorts.find((x) => x.id === cut);
  if (!c) throw new Error("that cut isn't in the script any more");
  return c;
};
const putCut = (s: Script, c: Cut): Script => (c.kind === "long" ? { ...s, long: c } : { ...s, shorts: s.shorts.map((x) => (x.id === c.id ? c : x)) });

export const voiceSamplesFor = (g: GameConfig, id: string): string[] => voiceSamples(g, id);

/** Source → long cut + shorts. Runs again from scratch if pressed again. */
export const rewriteScript = async (g: GameConfig, id: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.source.trim()) throw new Error("paste the script first");
  const cuts = await ai.rewriteScript(v, s.source, samples);
  return saveScript(g, snapshot({ ...s, ...cuts }));
};

/** The source changed since the cuts were made: the cuts follow the change, the rest stays. */
export const adjustScript = async (g: GameConfig, id: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.long) return rewriteScript(g, id);
  if (!isStale(s)) return s;
  const before = s.sources.at(-1)?.text ?? "";
  const cuts = await ai.adjustScript(v, samples, before, s.source, s.long, s.shorts);
  return saveScript(g, snapshot({ ...s, ...cuts }));
};

export const redoBeat = async (g: GameConfig, id: string, cut: string, beat: string, instruction: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  const c = findCut(s, cut);
  const b = c.beats.find((x) => x.id === beat);
  if (!b) throw new Error("that beat isn't in the cut any more");
  const text = await ai.redoBeat(v, samples, c, b, instruction);
  // A short's beat that was the long beat word for word is its own words now.
  const beats = c.beats.map((x) => (x.id === beat ? { ...x, text, from: undefined, changed: true, ...(x.pictures ? { pictures: x.pictures.map((p) => ({ ...p, check: true })) } : {}) } : x));
  return saveScript(g, putCut(s, { ...c, beats }));
};

export const redoCut = async (g: GameConfig, id: string, cut: string, instruction: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  const c = findCut(s, cut);
  const next = await ai.redoCut(v, samples, s.source, s.long, c, instruction);
  return saveScript(g, putCut(s, next));
};

export const anotherShort = async (g: GameConfig, id: string, instruction: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const c = await ai.anotherShort(v, samples, s.source, s.long, s.shorts, instruction);
  return saveScript(g, { ...s, shorts: [...s.shorts, c] });
};

// ── the pictures (docs/design/desk-ascii-scripts.md) ──

const withBeat = (s: Script, beatId: string, f: (b: Beat) => Beat): Script => {
  const map = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => (b.id === beatId ? f(b) : b)) });
  return { ...s, long: s.long ? map(s.long) : undefined, shorts: s.shorts.map(map) };
};
const withPicture = (s: Script, beatId: string, k: number, f: (p: BeatPicture) => BeatPicture): Script =>
  withBeat(s, beatId, (b) => ({ ...b, pictures: (b.pictures ?? []).map((p, i) => (i === k ? f(p) : p)) }));

/**
 * A picture plan for every beat that hasn't one (`all`: every beat again).
 * A re-plan keeps every picture already made and its look seed; a prompt
 * that changed under a made picture marks it check. Mood, pulled word and
 * chapter are Claude's again.
 */
export const planPictures = async (g: GameConfig, id: string, all = false): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const every = s.long.beats.map((b, i) => ({ n: i + 1, text: b.text, beat: b }));
  const want = every.filter((x) => all || !x.beat.pictures?.length);
  if (!want.length) return s;
  const plan = await ai.planPictures(v, s.long.title, want, every);
  let next = s;
  for (const x of want) {
    const p = plan.get(x.n);
    if (!p) continue;
    next = withBeat(next, x.beat.id, (b) => {
      const had = b.pictures ?? [];
      const pictures = p.prompts.map((prompt, k): BeatPicture => {
        const h = had[k];
        if (!h) return { prompt, candidates: [], look: newLook() };
        return { ...h, prompt, ...(h.candidates.length && h.prompt.trim() !== prompt.trim() ? { check: true } : {}) };
      });
      return { ...b, pictures, mood: p.mood, pulled: p.pulled.length ? p.pulled : undefined, chapter: p.chapter };
    });
  }
  return saveScript(g, next);
};

/** One picture's prompt written again by Claude (to Tom's instruction, if any). A picture already made is marked check; the next Again makes it from the new prompt. */
export const redoPicturePrompt = async (g: GameConfig, id: string, beatId: string, k: number, instruction: string): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const beats = s.long.beats.map((b, i) => ({ n: i + 1, text: b.text, prompts: (b.pictures ?? []).map((p) => p.prompt), id: b.id }));
  const beat = beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("that beat isn't in the script any more");
  const prompt = await ai.redoPicturePrompt(v, s.long.title, beats, beat.n, k, instruction);
  return saveScript(
    g,
    withBeat(s, beatId, (b) => {
      const pictures = [...(b.pictures ?? [])];
      while (pictures.length <= k) pictures.push({ prompt: "", candidates: [], look: newLook() });
      pictures[k] = { ...pictures[k]!, prompt, ...(pictures[k]!.candidates.length ? { check: true } : {}) };
      return { ...b, pictures };
    }),
  );
};

/** Pictures being made right now, by script: "<beat>:<k>" keys (the page shows them as making). */
const making = new Map<string, Set<string>>();
export const pendingPictures = (id: string): string[] => [...(making.get(id) ?? [])];

/**
 * Every picture with a prompt and nothing made yet (or exactly the ones
 * named: another candidate each), a few at a time in the background. Each
 * lands on its beat as it finishes and becomes the chosen one; the page
 * polls the script. Answers at once with how many it started.
 */
export const makePictures = (g: GameConfig, id: string, only?: { beat: string; k: number }[]): { started: number } => {
  if (!hasImages()) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  const { s, v } = need(g, id);
  const style = v.picture ?? PICTURE_STYLE;
  const inFlight = making.get(id) ?? new Set<string>();
  making.set(id, inFlight);
  const todo = plannedBeats(s).flatMap(({ beat }) =>
    (beat.pictures ?? []).flatMap((p, k) => {
      const key = `${beat.id}:${k}`;
      if (!p.prompt.trim() || inFlight.has(key)) return [];
      const wanted = only ? only.some((o) => o.beat === beat.id && o.k === k) : !p.candidates.length;
      return wanted ? [{ beat, k, prompt: p.prompt, key }] : [];
    }),
  );
  for (const t of todo) inFlight.add(t.key);
  const run = async () => {
    const queue = [...todo];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          const src = await makePicture(g, s, t.beat, t.k, t.prompt, style);
          const now = readScript(g, id);
          // The newest try is the one on screen; the older ones stay to pick from.
          if (now) saveScript(g, withPicture(now, t.beat.id, t.k, (p) => ({ ...p, candidates: [...p.candidates, src], chosen: src, approved: false, check: undefined, error: undefined })));
        } catch (e) {
          console.warn(`⚠ picture for ${id}/${t.key}: ${(e as Error).message}`);
          const now = readScript(g, id);
          if (now) saveScript(g, withPicture(now, t.beat.id, t.k, (p) => ({ ...p, error: (e as Error).message.slice(0, 200) })));
        } finally {
          inFlight.delete(t.key);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  };
  void run();
  return { started: todo.length };
};

/** Tom's own image as a beat's picture (a candidate like any other, and the chosen one). A beat with no picture plan yet gets one. */
export const ownPicture = (g: GameConfig, id: string, beatId: string, k: number, bytes: Uint8Array, ext: string): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const beat = s.long?.beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("that beat isn't in the script any more");
  if (k < 0 || k >= Math.max(picturesWanted(beat.text), beat.pictures?.length ?? 0, 1) || k > 1) throw new Error("no such picture on that beat");
  const src = saveOwnPicture(g, s, beat, k, bytes, ext);
  return saveScript(
    g,
    withBeat(s, beatId, (b) => {
      const pictures = [...(b.pictures ?? [])];
      while (pictures.length <= k) pictures.push({ prompt: "", candidates: [], look: newLook() });
      pictures[k] = { ...pictures[k]!, candidates: [...pictures[k]!.candidates, src], chosen: src, approved: true, check: undefined, error: undefined };
      return { ...b, pictures };
    }),
  );
};

// ── organise ──

export type OrganiseResult = { script: Script; made: { cut: string; title: string; id: string; missing: string[]; conflicts: { beat: string; takes: string[] }[]; youtube: string }[] };

/** The takes → one fresh sequence per cut (never touching an earlier one). Needs no key: it's all maths. */
export const organise = (g: GameConfig, id: string): OrganiseResult => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  if (!s.long) throw new Error("rewrite the script first");
  if (!s.takes.length) throw new Error("record the script first");
  const covers = new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));
  const run = (s.runs ?? 0) + 1;
  const base = seqSlug(s.title);
  const now = new Date().toISOString();
  const made: OrganiseResult["made"] = [];
  const entries: NonNullable<Script["sequences"]> = [];
  // The long cut only: shorts are parked (desk-ascii-scripts.md decision 1).
  [s.long].forEach((cut) => {
    const n = cut.kind === "short" ? s.shorts.indexOf(cut) + 1 : 0;
    const seqId = `${base}-${cut.kind === "long" ? "long" : `short-${n}`}-r${run}`;
    const name = `${s.title} · ${cut.kind === "long" ? "long" : `short ${n}: ${cut.title}`} (run ${run})`;
    const { seq, missing, conflicts, chapters } = organiseCut(s, cut, covers, { id: seqId, name });
    writeSequence(g, seq);
    // The chapter list for the YouTube description (empty when YouTube wouldn't take it).
    const youtube = youtubeChapters(chapters);
    made.push({ cut: cut.id, title: cut.title, id: seqId, missing, conflicts, youtube });
    entries.push({ id: seqId, cut: cut.id, run, at: now, missing: missing.length, conflicts: conflicts.length, ...(youtube ? { youtube } : {}) });
  });
  const scoreSeed = s.scoreSeed ?? 1 + Math.floor(Math.random() * 99999);
  const script = saveScript(g, { ...s, scoreSeed, runs: run, sequences: [...(s.sequences ?? []), ...entries] });
  // The score makes itself in the background (a minute or so); the page shows it when it's in.
  for (const m of made) void makeScore(g, script, m.id, scoreSeed);
  return { script, made };
};

// ── the score ──

/**
 * The score for the script's newest edit, made again: for the edit as it
 * is now (after moving things in the editor), or with `another` a new seed
 * (a whole new soundtrack). Answers at once; the score makes itself.
 */
export const remakeScore = (g: GameConfig, id: string, another: boolean): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const seqId = s.sequences?.at(-1)?.id;
  if (!seqId) throw new Error("organise the script first: the score is written for an edit's timings");
  const seed = another || !s.scoreSeed ? 1 + Math.floor(Math.random() * 99999) : s.scoreSeed;
  const next = seed === s.scoreSeed ? s : saveScript(g, { ...s, scoreSeed: seed });
  void makeScore(g, next, seqId, seed);
  return next;
};
