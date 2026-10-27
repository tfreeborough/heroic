/**
 * The Scripts tab's buttons, server side: each reads the script, runs one
 * Claude call (rewrite.ts) in the game's voice with the finished scripts
 * as samples, snapshots the source it ran on, saves, and answers with the
 * whole script. Throws plainly when there's no key or no voice.
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { GameConfig } from "../game";
import { youtubeChapters } from "@heroic/ascii-build";
import { PICTURE_STYLE, THUMB_STYLE, cardsDir, hasImages, makePicture, saveOwnPicture } from "./cards";
import * as ai from "./rewrite";
import { matchScript } from "./match";
import { organiseCut } from "./organise";
import { type Beat, type BeatPicture, type Cut, type Script, type ThumbnailIdea, isStale, newId, newLook, picturesWanted, plannedBeats, scriptText, slugify, articlePictures, sourcesList, sourcesMarkdown, withoutSources, youtubeId, type PlanState, type ShortsState, type ShortRender, beatText, excerpt, longEdits, renderableShort, shortBeats, shortLabel } from "./scripts";
import { type Job, startRender } from "./render";
import { sequenceSeconds } from "@heroic/voiceover";
import { exec } from "./exec";
import { listScripts, readScript, saveScript, voiceSamples } from "./scriptsStore";
import { docHeadings } from "./doc";
import { SCORE_LEVEL, type ScoreListing, listScores, makeScore, scoreState, useScore } from "./score";
import { readSequence, seqSlug, sequencePath, trashSequence, writeSequence } from "./sequences";

export const hasClaude = ai.hasClaude;

const need = (g: GameConfig, id: string): { s: Script; v: ai.ScriptVoice; samples: string[] } => {
  if (!ai.hasClaude()) throw new Error("no ANTHROPIC_API_KEY in apps/desk/.env");
  if (!g.script?.ai) throw new Error(`${g.name} has no script voice (script.ai in its desk.config)`);
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  return { s, v: g.script.ai, samples: voiceSamples(g, id) };
};
/** What the cuts were made from (scriptText: the accepted research woven in, Tom's notes out), so the next adjust sees research changes too. */
const snapshot = (s: Script): Script => ({ ...s, sources: [...s.sources, { at: new Date().toISOString(), text: scriptText(s) }] });
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
  const cuts = await ai.rewriteScript(v, scriptText(s), samples);
  return saveScript(g, snapshot({ ...s, ...cuts }));
};

/** The source changed since the cuts were made: the cuts follow the change, the rest stays. */
export const adjustScript = async (g: GameConfig, id: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.long) return rewriteScript(g, id);
  if (!isStale(s)) return s;
  const before = s.sources.at(-1)?.text ?? "";
  const cuts = await ai.adjustScript(v, samples, before, scriptText(s), s.long, s.shorts);
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
  const next = await ai.redoCut(v, samples, scriptText(s), s.long, c, instruction);
  return saveScript(g, putCut(s, next));
};

export const anotherShort = async (g: GameConfig, id: string, instruction: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const c = await ai.anotherShort(v, samples, scriptText(s), s.long, s.shorts, instruction);
  return saveScript(g, { ...s, shorts: [...s.shorts, c] });
};

// ── the shorts inside the long video (docs/design/desk-shorts.md § 1) ──

const finds = new Map<string, ShortsState>();
export const shortsState = (id: string): ShortsState | undefined => finds.get(id);

/** What Tom kept and binned across every script (desk-shorts.md: his calls are the standard), each as its title and beats' first words. */
const shortTaste = (g: GameConfig): ai.ShortTaste => {
  const taste: ai.ShortTaste = { kept: [], binned: [] };
  for (const sum of listScripts(g)) {
    const s = readScript(g, sum.id);
    if (!s?.long) continue;
    for (const c of s.shorts) {
      if (c.state !== "kept" && c.state !== "binned") continue;
      const line = `${c.title} (${s.title}): "${c.beats.map((b) => beatText(s, b)).join(" ").split(/\s+/).slice(0, 25).join(" ")}…"`;
      taste[c.state].push(line);
    }
  }
  return { kept: taste.kept.slice(-30), binned: taste.binned.slice(-30) };
};

/**
 * Find shorts: the long cut's beats timed from the kept takes (the same
 * slicing organise does, nothing written), then two Claude calls in the
 * background: a generous finder and a strict judge (rewrite.ts). Passes
 * land as suggested shorts ranked by score (beats word for word with the
 * long cut, `from` on each); fails land as near misses with their
 * problem, folded away on the page. `more`: shorts not offered before,
 * with everything already offered (kept, binned, suggested) left alone;
 * without it, the suggestions not yet decided on are replaced.
 */
export const findShorts = (g: GameConfig, id: string, more = false): ShortsState => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  if (!longEdits(s).length) throw new Error("organise the long video first: the shorts are cut from it as recorded");
  const cur = finds.get(id);
  if (cur?.state === "running") return cur;
  const state: ShortsState = { state: "running", startedAt: new Date().toISOString() };
  finds.set(id, state);
  void (async () => {
    const covers = new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));
    const { laid } = organiseCut(s, s.long!, covers, { id: "timing", name: "timing" });
    const secs = new Map(laid.map((l) => [l.beat, l.seconds]));
    const timed = s.long!.beats.map((b, i) => ({ n: i + 1, text: b.text, seconds: secs.get(b.id) }));
    const old = more ? s.shorts : s.shorts.filter((c) => c.state && c.state !== "suggested");
    const offered = old.flatMap((c) => {
      const beats = shortBeats(s, c);
      return beats.length ? [{ beats, title: c.title, state: c.state ?? "suggested" }] : [];
    });
    const verdicts = await ai.findShorts(v, s.long!, timed, offered, shortTaste(g));
    const now = readScript(g, id);
    if (!now?.long) throw new Error("the script went away");
    // The timings onto the long beats (Tom's words on them stay his), so the page can measure a nudge.
    const long: Cut = { ...now.long, beats: now.long.beats.map((b) => ({ ...b, seconds: secs.get(b.id) })) };
    const at = { long };
    const seen = new Set(old.map((c) => shortLabel(shortBeats(s, c))));
    const fresh: Cut[] = [...verdicts]
      .sort((a, b) => (a.verdict === b.verdict ? b.score - a.score : a.verdict === "pass" ? -1 : 1))
      .map(
        (x): Cut => ({
          id: newId(),
          kind: "short",
          title: x.title,
          why: x.why,
          score: x.score,
          ...(x.join ? { join: x.join } : {}),
          ...(x.verdict === "pass" && x.check ? { check: x.check } : {}),
          ...(x.verdict === "fail" ? { problem: x.problem ?? "didn't pass the judge" } : {}),
          state: "suggested",
          beats: excerpt(at, x.beats),
        }),
      )
      .filter((c) => c.beats.length && !seen.has(shortLabel(shortBeats(at, c))));
    const keep = more ? now.shorts : now.shorts.filter((c) => c.state && c.state !== "suggested");
    saveScript(g, { ...now, long, shorts: [...keep, ...fresh] });
  })().then(
    () => finds.delete(id),
    (e: Error) => {
      console.warn(`⚠ shorts ${id}: ${e.message}`);
      finds.set(id, { state: "failed", error: e.message });
    },
  );
  return state;
};

/** Hooks Tom chose before, across every script: the standard for the next drafts (his picks and his own rewrites, never Claude's unchosen ones). */
const hookTaste = (g: GameConfig): string[] => {
  const out: string[] = [];
  for (const sum of listScripts(g)) {
    const s = readScript(g, sum.id);
    for (const c of s?.shorts ?? []) if (c.state === "kept" && c.hook?.trim()) out.push(c.hook.trim());
  }
  return out.slice(-40);
};

/**
 * Hook drafts for the kept shorts that have none (`all`: every kept
 * short again): three a short, in Tom's voice, checked by a second pass
 * (rewrite.ts). Saved as `hookDrafts`; choosing one is the page's
 * (withHook). A short with a hook already keeps it.
 */
export const draftHooks = async (g: GameConfig, id: string, all = false): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const want = s.shorts.filter((c) => c.state === "kept" && (all || !c.hookDrafts?.length));
  if (!want.length) throw new Error(s.shorts.some((c) => c.state === "kept") ? "every kept short has its drafts; Draft again writes them afresh" : "keep a short first");
  const shorts = want.map((c, i) => ({ n: i + 1, title: c.title, beats: c.beats.filter((b) => b.from).map((b) => beatText(s, b)), ...(c.check ? { carry: c.check } : {}) }));
  const drafts = await ai.draftHooks(v, samples, s.long, shorts, hookTaste(g));
  const now = readScript(g, id);
  if (!now) throw new Error("the script went away");
  const byId = new Map(want.map((c, i) => [c.id, drafts.get(i + 1)] as const));
  return saveScript(g, { ...now, shorts: now.shorts.map((c) => (byId.get(c.id)?.length ? { ...c, hookDrafts: byId.get(c.id) } : c)) });
};

export type ShortPreview = {
  /** The take slices in order: the take's file, the seconds of it, and where it sits in the preview. */
  clips: { file: string; start: number; end: number; at: number }[];
  seconds: number;
  /** The long video's bed to go under, quiet: a public path, where to start it, its level in the edit. */
  music?: { path: string; from: number; level: number };
  missing: string[];
  conflicts: number;
};

/**
 * A short heard before it's made: its beats sliced from the takes exactly
 * as organise would lay them (the same matcher and slicer, nothing
 * written), with the long video's music to play under. The newest long
 * edit's song if it has one, else its score if one is ready.
 */
export const previewShort = (g: GameConfig, id: string, shortId: string): ShortPreview => {
  const s = readScript(g, id);
  if (!s?.long) throw new Error(`no script ${id}`);
  const c = s.shorts.find((x) => x.id === shortId);
  if (!c) throw new Error("that short isn't in the script any more");
  const covers = new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));
  const { seq, missing, conflicts } = organiseCut(s, c, covers, { id: "preview", name: "preview" });
  const clips = (seq.audio[0]?.clips ?? []).map((x) => ({ file: s.takes[x.take]!.file, start: x.start, end: x.end, at: x.at }));
  const seconds = clips.reduce((n, x) => Math.max(n, x.at + (x.end - x.start)), 0);
  const lastId = longEdits(s).at(-1)?.id;
  const bed = lastId ? readSequence(g, lastId)?.music : undefined;
  const score = lastId ? scoreState(g, lastId) : undefined;
  const music = bed?.song ? { path: `music/${bed.song}`, from: bed.from, level: bed.level } : score?.state === "ready" ? { path: `music/${score.file}`, from: 0, level: SCORE_LEVEL } : undefined;
  return { clips, seconds, ...(music ? { music } : {}), missing, conflicts: conflicts.length };
};

// ── the pictures (docs/design/desk-ascii-scripts.md) ──

const withBeat =(s: Script, beatId: string, f: (b: Beat) => Beat): Script => {
  const map = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => (b.id === beatId ? f(b) : b)) });
  return { ...s, long: s.long ? map(s.long) : undefined, shorts: s.shorts.map(map) };
};
const withPicture = (s: Script, beatId: string, k: number, f: (p: BeatPicture) => BeatPicture): Script =>
  withBeat(s, beatId, (b) => ({ ...b, pictures: (b.pictures ?? []).map((p, i) => (i === k ? f(p) : p)) }));

const worldOf = (s: Script): ai.World => ({ theme: s.theme ?? "", look: s.look ?? "", cast: s.cast ?? [] });

/**
 * A picture plan for every beat that hasn't one (`all`: every beat again).
 * A re-plan keeps every picture already made and its look seed; a prompt
 * that changed under a made picture marks it check. Mood, pulled word and
 * chapter are Claude's again.
 */
/** Beats whose prompts are written per call: about 20 keeps the reply (two prompts for a long beat) well inside the cap. */
const PLAN_BATCH = 20;

const plans = new Map<string, PlanState>();
/** How a script's story or prompts run is going (nothing once it's finished and saved; the failure until the next press). */
export const planState = (id: string): PlanState | undefined => plans.get(id);

/** A background run over the script with the page polling planState: the state while it goes, gone when done, the failure kept. */
const background = (id: string, state: PlanState & { state: "running" }, run: () => Promise<void>): PlanState => {
  plans.set(id, state);
  void run().then(
    () => plans.delete(id),
    (e: Error) => {
      console.warn(`⚠ ${state.stage} ${id}: ${e.message}`);
      plans.set(id, { state: "failed", stage: state.stage, error: e.message, done: plans.get(id)?.done ?? 0, total: state.total });
    },
  );
  return state;
};

/**
 * The story (docs/design/desk-ascii-scripts.md § Pictures): one call over
 * every beat decides the world, its cast, the chapters and what each
 * picture shows (a scene line a beat, with the mood and pulled word), so the
 * prompts can then be written a batch at a time with nothing left to choose.
 * Runs in the background and lands on the script in one go. A story again
 * keeps the world Tom has set (and its look and cast) and writes new lines;
 * the prompts already written stay until they're written again.
 */
export const planStory = (g: GameConfig, id: string): PlanState => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const cur = plans.get(id);
  if (cur?.state === "running") return cur;
  const every = s.long.beats.map((b, i) => ({ n: i + 1, text: b.text, id: b.id }));
  const headings = docHeadings(scriptText(s));
  return background(id, { state: "running", stage: "story", done: 0, total: every.length, startedAt: new Date().toISOString() }, async () => {
    const { world, lines } = await ai.planStory(v, s.long!.title, every, headings, worldOf(s));
    // The script as it is now (Tom may have edited while this ran), the story on it.
    const now = readScript(g, id);
    if (!now) throw new Error("the script went away");
    let next: Script = { ...now, theme: world.theme, look: world.look || undefined, cast: world.cast.length ? world.cast : undefined };
    for (const x of every) {
      const l = lines.get(x.n);
      if (!l) continue;
      next = withBeat(next, x.id, (b) => ({ ...b, scene: l.scene, mood: l.mood, pulled: l.pulled.length ? l.pulled : undefined, chapter: l.chapter }));
    }
    saveScript(g, next);
    plans.set(id, { state: "running", stage: "story", done: every.length, total: every.length, startedAt: new Date().toISOString() });
  });
};

/**
 * The prompts, from the story: every beat with a scene line and no prompt
 * yet (`all`: every beat again), a batch of beats a call, each batch saved
 * to the script as it lands so the page fills in as it goes. A rewrite
 * keeps every picture already made and its look seed; a prompt that
 * changed under a made picture marks it check.
 */
export const writePrompts = (g: GameConfig, id: string, all = false): PlanState => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  if (!s.long.beats.some((b) => b.scene?.trim())) throw new Error("plan the story first");
  const cur = plans.get(id);
  if (cur?.state === "running") return cur;
  const want = s.long.beats.map((b, i) => ({ n: i + 1, beat: b })).filter((x) => all || !x.beat.pictures?.length);
  const state: PlanState = { state: "running", stage: "prompts", done: 0, total: want.length, startedAt: new Date().toISOString() };
  if (!want.length) return state;
  return background(id, state, async () => {
    for (let i = 0; i < want.length; i += PLAN_BATCH) {
      const batch = want.slice(i, i + PLAN_BATCH);
      // The story as it stands now, prompts included, so this batch sits beside what's written already.
      const at = readScript(g, id);
      if (!at?.long) throw new Error("the script went away");
      const every = at.long.beats.map((b, j) => ({ n: j + 1, text: b.text, scene: b.scene ?? "", prompts: (b.pictures ?? []).map((p) => p.prompt) }));
      const plan = await ai.writePrompts(v, at.long.title, batch.map((x) => ({ n: x.n, text: every[x.n - 1]?.text ?? x.beat.text, scene: every[x.n - 1]?.scene ?? "" })), every, worldOf(at));
      const now = readScript(g, id);
      if (!now) throw new Error("the script went away");
      let next: Script = now;
      for (const x of batch) {
        const prompts = plan.get(x.n);
        if (!prompts) continue;
        next = withBeat(next, x.beat.id, (b) => {
          const had = b.pictures ?? [];
          const pictures = prompts.map((prompt, k): BeatPicture => {
            const h = had[k];
            if (!h) return { prompt, candidates: [], look: newLook() };
            return { ...h, prompt, ...(h.candidates.length && h.prompt.trim() !== prompt.trim() ? { check: true } : {}) };
          });
          return { ...b, pictures };
        });
      }
      saveScript(g, next);
      plans.set(id, { ...state, done: Math.min(want.length, i + batch.length) });
    }
  });
};

/** One picture's prompt written again by Claude (to Tom's instruction, if any). A picture already made is marked check; the next Again makes it from the new prompt. */
export const redoPicturePrompt = async (g: GameConfig, id: string, beatId: string, k: number, instruction: string): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const beats = s.long.beats.map((b, i) => ({ n: i + 1, text: b.text, scene: b.scene ?? "", prompts: (b.pictures ?? []).map((p) => p.prompt), id: b.id }));
  const beat = beats.find((b) => b.id === beatId);
  if (!beat) throw new Error("that beat isn't in the script any more");
  const prompt = await ai.redoPicturePrompt(v, s.long.title, beats, beat.n, k, instruction, worldOf(s));
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
          const src = await makePicture(g, s, t.beat, t.k, t.prompt, style, s.look);
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

// ── the thumbnail (docs/design/desk-thumbnails.md) ──

const withIdea = (s: Script, ideaId: string, f: (t: ThumbnailIdea) => ThumbnailIdea): Script => ({ ...s, thumbnails: (s.thumbnails ?? []).map((t) => (t.id === ideaId ? f(t) : t)) });
/** A thumbnail's pictures sit with the beats' in cards/<script>/, named thumb-<idea>-<n>.png. */
const thumbFile = (ideaId: string) => ({ id: `thumb-${ideaId}` });
const thumbKey = (ideaId: string) => `thumb:${ideaId}`;

/** Three more thumbnail ideas (to Tom's instruction, if any), after the ones already there. Nothing is made yet. */
export const planThumbnails = async (g: GameConfig, id: string, instruction: string): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const beats = s.long.beats.map((b) => ({ text: b.text, prompts: (b.pictures ?? []).map((p) => p.prompt) }));
  const had = (s.thumbnails ?? []).map((t) => ({ prompt: t.prompt, words: t.words }));
  const ideas = await ai.planThumbnails(v, s.long.title, beats, had, instruction);
  const fresh = ideas.map((t): ThumbnailIdea => ({ id: newId(), prompt: t.prompt, words: t.words, accent: t.accent, why: t.why, candidates: [] }));
  // Read again: a picture may have landed on an older idea while Claude was thinking.
  const now = readScript(g, id) ?? s;
  return saveScript(g, { ...now, thumbnails: [...(now.thumbnails ?? []), ...fresh] });
};

/** Three more YouTube titles to test (to Tom's instruction, if any), after the ones already there. */
export const planTitles = async (g: GameConfig, id: string, instruction: string): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const chapters = s.long.beats.flatMap((b) => (b.chapter?.trim() ? [b.chapter.trim()] : []));
  const words = [...new Set((s.thumbnails ?? []).map((t) => t.words.trim()).filter(Boolean))];
  const titles = await ai.planTitles(v, s.long.title, s.long.beats.map((b) => b.text), chapters, words, (s.titles ?? []).map((t) => t.text), instruction);
  const now = readScript(g, id) ?? s;
  return saveScript(g, { ...now, titles: [...(now.titles ?? []), ...titles.map((t) => ({ id: newId(), ...t }))] });
};

/** The top of the long video's YouTube description and its tags, written again (to Tom's instruction, if any). */
export const writeYouTube = async (g: GameConfig, id: string, instruction: string): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const chapters = s.long.beats.flatMap((b) => (b.chapter?.trim() ? [b.chapter.trim()] : []));
  const youtube = await ai.writeYouTube(v, g.name, s.long.title, s.long.beats.map((b) => b.text), chapters, s.youtube, instruction);
  return saveScript(g, { ...(readScript(g, id) ?? s), youtube });
};

/**
 * Thumbnail pictures in the background, like the beats' (`only`: another
 * try at exactly these ideas; otherwise every idea with nothing made yet).
 * The page polls; each lands as the chosen one.
 */
export const makeThumbnails = (g: GameConfig, id: string, only?: string[]): { started: number } => {
  if (!hasImages()) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  const { s, v } = need(g, id);
  const style = v.picture ?? PICTURE_STYLE;
  const inFlight = making.get(id) ?? new Set<string>();
  making.set(id, inFlight);
  const todo = (s.thumbnails ?? []).filter((t) => t.prompt.trim() && !inFlight.has(thumbKey(t.id)) && (only ? only.includes(t.id) : !t.candidates.length));
  for (const t of todo) inFlight.add(thumbKey(t.id));
  void Promise.all(
    todo.map(async (t) => {
      try {
        const src = await makePicture(g, s, thumbFile(t.id), 0, `${t.prompt.trim()} ${THUMB_STYLE}`, style);
        const now = readScript(g, id);
        if (now) saveScript(g, withIdea(now, t.id, (x) => ({ ...x, candidates: [...x.candidates, src], chosen: src, error: undefined })));
      } catch (e) {
        console.warn(`⚠ thumbnail for ${id}/${t.id}: ${(e as Error).message}`);
        const now = readScript(g, id);
        if (now) saveScript(g, withIdea(now, t.id, (x) => ({ ...x, error: (e as Error).message.slice(0, 200) })));
      } finally {
        inFlight.delete(thumbKey(t.id));
      }
    }),
  );
  return { started: todo.length };
};

/** Tom's own image as a thumbnail picture: onto an idea (the chosen try), or a new idea of its own with no words. */
export const ownThumbnail = (g: GameConfig, id: string, ideaId: string, bytes: Uint8Array, ext: string): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const idea = (s.thumbnails ?? []).find((t) => t.id === ideaId) ?? { id: newId(), prompt: "", words: "", accent: "red" as const, candidates: [] };
  const src = saveOwnPicture(g, s, thumbFile(idea.id), 0, bytes, ext);
  const next: ThumbnailIdea = { ...idea, candidates: [...idea.candidates, src], chosen: src, error: undefined };
  const had = (s.thumbnails ?? []).some((t) => t.id === idea.id);
  return saveScript(g, { ...s, thumbnails: had ? (s.thumbnails ?? []).map((t) => (t.id === idea.id ? next : t)) : [...(s.thumbnails ?? []), next] });
};

// ── organise ──

export type OrganiseResult = { script: Script; made: { cut: string; title: string; id: string; missing: string[]; conflicts: { beat: string; takes: string[] }[]; youtube: string }[] };

/**
 * The takes → one fresh sequence per cut (never touching an earlier one). Needs no key: it's all maths.
 * The music isn't made here (Tom, 10-19: organising again kept bringing a new song): the newest edit's bed
 * comes across as it is, and the score panel's buttons make or refit it.
 */
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
  const lastId = longEdits(s).at(-1)?.id;
  const music = lastId ? readSequence(g, lastId)?.music : undefined;
  // The long cut only: shorts are parked (desk-ascii-scripts.md decision 1).
  [s.long].forEach((cut) => {
    const n = cut.kind === "short" ? s.shorts.indexOf(cut) + 1 : 0;
    const seqId = `${base}-${cut.kind === "long" ? "long" : `short-${n}`}-r${run}`;
    const name = `${s.title} · ${cut.kind === "long" ? "long" : `short ${n}: ${cut.title}`} (run ${run})`;
    const { seq, missing, conflicts, chapters } = organiseCut(s, cut, covers, { id: seqId, name });
    writeSequence(g, music ? { ...seq, music } : seq);
    // The chapter list for the YouTube description (empty when YouTube wouldn't take it).
    const youtube = youtubeChapters(chapters);
    made.push({ cut: cut.id, title: cut.title, id: seqId, missing, conflicts, youtube });
    entries.push({ id: seqId, cut: cut.id, run, at: now, missing: missing.length, conflicts: conflicts.length, ...(youtube ? { youtube } : {}) });
  });
  const script = saveScript(g, { ...s, runs: run, sequences: [...(s.sequences ?? []), ...entries] });
  return { script, made };
};

/** One of the script's edits into the sequences' .trash, and off its list (the script's takes stay: trashTakes never bins a script's). */
export const binEdit = (g: GameConfig, id: string, seqId: string): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  if (!(s.sequences ?? []).some((x) => x.id === seqId)) throw new Error("that edit isn't one of this script's");
  trashSequence(g, seqId);
  return saveScript(g, { ...s, sequences: (s.sequences ?? []).filter((x) => x.id !== seqId) });
};

// ── the score ──

/** Every score made for the script's edits that's still on disk, newest first. */
export const scriptScores = (g: GameConfig, id: string): ScoreListing[] => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  return listScores(g, (s.sequences ?? []).map((x) => x.id));
};

/**
 * An earlier score back on the newest edit, and its seed made the script's,
 * so Fit to the edit refits that one. It was written for its own edit's
 * timings: Fit to the edit lines it up with this one.
 */
export const chooseScore = (g: GameConfig, id: string, file: string): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const seqId = longEdits(s).at(-1)?.id;
  if (!seqId) throw new Error("organise the script first");
  const st = useScore(g, seqId, file);
  return st.seed && st.seed !== s.scoreSeed ? saveScript(g, { ...s, scoreSeed: st.seed }) : s;
};

/**
 * The score for the script's newest edit, made again: for the edit as it
 * is now (after moving things in the editor), or with `another` a new seed
 * (a whole new soundtrack). Answers at once; the score makes itself.
 */
export const remakeScore = (g: GameConfig, id: string, another: boolean): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const seqId = longEdits(s).at(-1)?.id;
  if (!seqId) throw new Error("organise the script first: the score is written for an edit's timings");
  const seed = another || !s.scoreSeed ? 1 + Math.floor(Math.random() * 99999) : s.scoreSeed;
  const next = seed === s.scoreSeed ? s : saveScript(g, { ...s, scoreSeed: seed });
  void makeScore(g, next, seqId, seed);
  return next;
};

// ── render the shorts (docs/design/desk-shorts.md § 3–4) ──

type ShortRun = Omit<ShortRender, "state" | "progress" | "error" | "slug"> & { state: ShortRender["state"]; error?: string; job?: Job; slug?: string };
/** By script id, then short id: what each short's render is up to (this Desk run). */
const shortRuns = new Map<string, Map<string, ShortRun>>();
const asRender = (r: ShortRun): ShortRender =>
  r.job ? { state: r.job.state as ShortRender["state"], progress: r.job.progress, ...(r.job.error ? { error: r.job.error } : {}), seq: r.seq, slug: r.job.slug } : { state: r.state, progress: 0, ...(r.error ? { error: r.error } : {}), seq: r.seq, ...(r.slug ? { slug: r.slug } : {}) };
export const shortRenderState = (id: string): Record<string, ShortRender> => Object.fromEntries([...(shortRuns.get(id) ?? [])].map(([k, r]) => [k, asRender(r)]));

export type RenderShortsResult = { started: string[]; left: { short: string; reason: string }[] };

/** Seconds the hook's words stay up: as long as they're said, a touch after, three at most. */
const hookUp = (spoken: number) => Math.min(3, Math.max(1, spoken + 0.3));

/**
 * The kept shorts asked for, each organised afresh into its own edit (the
 * long beats' pictures and moods looked through, the hook in front, one
 * build under the hook and the first beat), scored as a loop, and rendered
 * vertical by the Beats template's short mode: one batch a short, two
 * renders at a time. Answers at once; the page asks after them. A short
 * with no hook, or a beat not recorded or read twice, is left out and said
 * so, never rendered with a hole.
 */
export const renderShorts = (g: GameConfig, id: string, shortIds: string[]): RenderShortsResult => {
  const s = readScript(g, id);
  if (!s?.long) throw new Error(`no script ${id}`);
  if (!longEdits(s).length) throw new Error("organise the long video first");
  const covers = new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));
  const run = s.runs ?? 1;
  const base = seqSlug(s.title);
  const now = new Date().toISOString();
  const runs = shortRuns.get(id) ?? new Map<string, ShortRun>();
  shortRuns.set(id, runs);
  // One seed for the whole video: every short's score is recognisably the same piece.
  const seed = s.scoreSeed ?? 1 + Math.floor(Math.random() * 99999);
  const started: string[] = [];
  const left: RenderShortsResult["left"] = [];
  const todo: { c: Cut; n: number; cut: Cut; seqId: string; hookFor: number; seconds: number }[] = [];
  let next: Script = seed === s.scoreSeed ? s : { ...s, scoreSeed: seed };
  for (const shortId of shortIds) {
    const c = s.shorts.find((x) => x.id === shortId);
    if (!c || c.state !== "kept") {
      left.push({ short: shortId, reason: "not a kept short" });
      continue;
    }
    const going = runs.get(c.id);
    if (going && !["done", "failed"].includes(asRender(going).state)) {
      left.push({ short: c.id, reason: "already on its way" });
      continue;
    }
    const own = c.beats.find((b) => !b.from);
    if (!c.hook?.trim() || !own) {
      left.push({ short: c.id, reason: "no hook yet: pick or write one, then read it" });
      continue;
    }
    const n = s.shorts.indexOf(c) + 1;
    const seqId = `${base}-short-${n}-r${run}`;
    const cut = renderableShort(s, c);
    const { seq, missing, conflicts, laid } = organiseCut(s, cut, covers, { id: seqId, name: `${s.title} · short ${n}: ${c.title} (run ${run})` });
    if (missing.length || conflicts.length) {
      const what = missing.includes(own.id) ? "the hook isn't recorded yet" : missing.length ? `${missing.length} beat${missing.length === 1 ? "" : "s"} not recorded` : `${conflicts.length} beat${conflicts.length === 1 ? "" : "s"} read in two takes`;
      left.push({ short: c.id, reason: what });
      continue;
    }
    // Written fresh each time (never merged into an edited one); the score lands on it next.
    writeSequence(g, seq);
    next = { ...next, sequences: [...(next.sequences ?? []).filter((x) => x.id !== seqId), { id: seqId, cut: c.id, run, at: now, missing: 0, conflicts: 0, short: c.id }] };
    runs.set(c.id, { state: "scoring", seq: seqId });
    todo.push({ c, n, cut, seqId, hookFor: hookUp(laid.find((l) => l.beat === own.id)?.seconds ?? 2), seconds: sequenceSeconds(seq) });
    started.push(c.id);
  }
  if (next !== s) saveScript(g, next);
  // Their words for the platforms (desk-shorts.md § 5), written while they render; the Queue reads them off the script.
  if (ai.hasClaude() && g.script?.ai) void writeMissingShortPosts(g, id, started);
  const mark = (seqId: string, slug: string) => {
    const cur = readScript(g, id);
    if (cur) saveScript(g, { ...cur, sequences: (cur.sequences ?? []).map((x) => (x.id === seqId ? { ...x, render: slug } : x)) });
  };
  void (async () => {
    for (const x of todo) {
      const sc = await makeScore(g, { long: x.cut }, x.seqId, seed, { loop: true });
      if (sc.state !== "ready") {
        runs.set(x.c.id, { state: "failed", seq: x.seqId, error: `the score didn't make: ${sc.error ?? "no reason given"}` });
        continue;
      }
      const props = { clip: sequencePath(g, x.seqId), title: "", durationSeconds: x.seconds, startFrom: 0, opening: "none", ending: "loop", hook: x.c.hook!.trim(), hookFor: x.hookFor, palette: "matrix", captions: "terminal" };
      const job = startRender(g, { template: "Beats", props, format: "vertical", name: `${base}-short-${x.n}`, batch: crypto.randomUUID(), onDone: (m) => mark(x.seqId, m.slug) });
      runs.set(x.c.id, { state: "queued", seq: x.seqId, job });
    }
  })();
  return { started, left };
};

// ── a short's post copy (docs/design/desk-shorts.md § 5) ──

/** A short's title, description and tags, written by Claude (to Tom's instruction, if any). Re-reads the script before saving so a render landing meanwhile isn't lost. */
export const writeShortPost = async (g: GameConfig, id: string, shortId: string, instruction = ""): Promise<Script> => {
  const { s, v } = need(g, id);
  const c = s.shorts.find((x) => x.id === shortId);
  if (!c) throw new Error(`no short ${shortId}`);
  if (!s.long) throw new Error("rewrite the script first");
  const beats = c.beats.filter((b) => b.from).map((b) => beatText(s, b));
  const post = await ai.writeShortPost(v, g.name, s.long.title, { title: c.title, hook: c.hook?.trim() ?? "", why: c.why, beats }, c.post, instruction);
  const cur = readScript(g, id) ?? s;
  return saveScript(g, { ...cur, shorts: cur.shorts.map((x) => (x.id === shortId ? { ...x, post } : x)) });
};

/** Words for every one of these shorts that has none yet, one call after another in the background. A failure is logged, not thrown: the Queue falls back to the title and hook. */
const writeMissingShortPosts = async (g: GameConfig, id: string, shortIds: string[]) => {
  for (const shortId of shortIds) {
    const c = readScript(g, id)?.shorts.find((x) => x.id === shortId);
    if (!c || c.post) continue;
    try {
      await writeShortPost(g, id, shortId);
    } catch (e) {
      console.warn(`⚠ post copy for short ${shortId} of ${id}: ${(e as Error).message}`);
    }
  }
};

// ── the write-up (docs/design/desk-writeup.md) ──

/** The long cut as an article for the site's dev log (to Tom's instruction, if any). His pasted video id and where it was last saved stay. */
export const writeArticle = async (g: GameConfig, id: string, instruction: string): Promise<Script> => {
  const { s, v, samples } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const chapters = s.long.beats.flatMap((b) => (b.chapter?.trim() ? [b.chapter.trim()] : []));
  const a = await ai.writeArticle(v, g.name, samples, s.long.title, s.long.beats.map((b) => b.text), chapters, s.writeup, instruction);
  const now = readScript(g, id) ?? s;
  const slug = slugify(a.slug) || slugify(a.title) || slugify(now.title) || `post-${now.id}`;
  // The author's sources go on the end, as links (his notes and the accepted research), never Claude's.
  const sources = sourcesMarkdown(sourcesList(now));
  const body = [withoutSources(a.body), ...(sources ? ["", sources] : [])].join("\n");
  return saveScript(g, { ...now, writeup: { ...a, body, slug, youtube: now.writeup?.youtube, writtenAt: new Date().toISOString(), saved: now.writeup?.saved } });
};

/**
 * The glyph stills the page draws for the article (docs/design/desk-writeup.md):
 * a beat's picture as the video shows it, or the thumbnail picture with no
 * words as the cover. The server can't draw them (the engine is canvas), so
 * the Site stage draws and sends each one just before Save to the site. Kept
 * beside the script's pictures as cards/<script>/site-<key>.png.
 */
const siteStillFile = (g: GameConfig, script: string, key: string) => join(cardsDir(g, script), `site-${key.replace(/[^a-z0-9_-]/gi, "")}.png`);
export const ownSiteStill = (g: GameConfig, id: string, key: string, bytes: Uint8Array): void => {
  if (!readScript(g, id)) throw new Error(`no script ${id}`);
  if (!key.replace(/[^a-z0-9_-]/gi, "")) throw new Error("the still needs a key");
  mkdirSync(cardsDir(g, id), { recursive: true });
  writeFileSync(siteStillFile(g, id, key), bytes);
};

/**
 * When a YouTube video went live, as a YYYY-MM-DD in the UK, read off its
 * watch page (the `publishDate` in the page's data; no API key needed), or
 * "" if the page doesn't say. The dev log orders posts by this date.
 */
export const videoPublishDate = async (videoId: string): Promise<string> => {
  const id = youtubeId(videoId);
  if (!id) return "";
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "user-agent": "Mozilla/5.0", "accept-language": "en-GB" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "";
    const html = await res.text();
    const iso = html.match(/"publishDate":"([^"]+)"/)?.[1] ?? html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1];
    if (!iso) return "";
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  } catch {
    return "";
  }
};

const yamlString = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());

/**
 * Write the post into the site as ONE FOLDER, `<site.content>/<slug>/`:
 * `index.md` with its frontmatter, the cover as `cover.jpg` (1280×720) and
 * the pictures as `1.jpg`, `2.jpg`… beside it, so deleting the folder deletes
 * the post. The page's date is the first save's; a later save on another day
 * adds `updated`. A save under a new slug removes the old folder. Tom
 * commits and pushes; Render builds the site. Answers with the script.
 */
export const saveArticle = async (g: GameConfig, id: string, signal?: AbortSignal): Promise<Script> => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const w = s.writeup;
  if (!w) throw new Error("write the article first");
  if (!g.site) throw new Error(`${g.name} has no site to save to (site in its desk.config)`);
  const slug = slugify(w.slug);
  if (!slug) throw new Error("the article needs a slug (its URL)");
  if (!w.title.trim()) throw new Error("the article needs a title");
  if (!w.body.trim()) throw new Error("the article has no words");
  const repo = resolve(g.root, "../..");
  const finalDir = resolve(g.root, g.site.content, slug);
  // The stills the page drew (siteStillFile) must all be there before anything is written.
  const pics = articlePictures(s, w.body.trim());
  const missing = pics.filter((p) => !existsSync(siteStillFile(g, s.id, p.beat)));
  if (missing.length) throw new Error(`${missing.length} picture${missing.length === 1 ? " wasn't" : "s weren't"} drawn as glyphs (the page draws them just before saving); try again`);
  const coverStill = siteStillFile(g, s.id, "cover");
  const wantCover = w.cover ?? (s.thumbnails ?? []).find((t) => t.chosen)?.chosen;
  const hasCover = Boolean(wantCover && existsSync(coverStill));

  // Built beside the post and renamed into place in one go: the site's dev server watches this folder, and a
  // folder written file by file can be read half-made (a cover.jpg named in the frontmatter that isn't there yet).
  const dir = `${finalDir}.writing`;
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const convert = async (from: string, to: string, vf: string) => {
    const r = await exec(["ffmpeg", "-y", "-loglevel", "error", "-i", from, "-vf", vf, "-q:v", "4", to], undefined, signal);
    if (!r.ok) throw new Error(`a picture didn't convert: ${r.err.trim().split("\n").at(-1) ?? "ffmpeg failed"}`);
  };
  if (hasCover) await convert(coverStill, join(dir, "cover.jpg"), "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720");
  // One picture per heading, as a markdown image beside the file (Astro sizes it and adds width and height).
  const lines = w.body.trim().split("\n");
  const inserts = new Map<number, string>();
  for (const [n, p] of pics.entries()) {
    await convert(siteStillFile(g, s.id, p.beat), join(dir, `${n + 1}.jpg`), "scale='min(1280,iw)':-2");
    inserts.set(p.line, `\n\n![${p.alt.replace(/[[\]]/g, "")}](./${n + 1}.jpg)`);
  }
  const body = lines.map((l, i) => (inserts.has(i) ? `${l}${inserts.get(i)}` : l)).join("\n");

  // The page's date: the video's (Tom's field), else the first save's. A re-save on a later day marks it updated.
  const today = new Date().toISOString().slice(0, 10);
  const date = w.date ?? w.saved?.date ?? today;
  const front = [
    "---",
    `title: ${yamlString(w.title)}`,
    `description: ${yamlString(w.description)}`,
    `date: ${date}`,
    ...(w.saved && date !== today ? [`updated: ${today}`] : []),
    ...(w.youtube ? [`youtube: ${yamlString(w.youtube)}`] : []),
    ...(hasCover ? ["cover: ./cover.jpg"] : []),
    "---",
    "",
  ].join("\n");
  writeFileSync(join(dir, "index.md"), `${front}${body}\n`);
  // A fresh folder every save (pictures no longer used don't linger): the old one goes, the new one takes its name.
  if (existsSync(finalDir)) rmSync(finalDir, { recursive: true });
  renameSync(dir, finalDir);
  // Saved before under another slug: that folder is ours to remove (older saves wrote a loose file; that goes too).
  const file = relative(repo, finalDir);
  if (w.saved && w.saved.file !== file) {
    const old = join(repo, w.saved.file);
    if (existsSync(old)) rmSync(old, { recursive: true });
  }
  return saveScript(g, { ...s, writeup: { ...w, slug, saved: { at: new Date().toISOString(), date, file, ...(hasCover ? { cover: "cover.jpg" } : {}) } } });
};
