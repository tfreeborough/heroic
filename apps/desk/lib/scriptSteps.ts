/**
 * The Scripts tab's buttons, server side: each reads the script, runs one
 * Claude call (rewrite.ts) in the game's voice with the finished scripts
 * as samples, snapshots the source it ran on, saves, and answers with the
 * whole script. Throws plainly when there's no key or no voice.
 */
import type { GameConfig } from "../game";
import { hasImages, makeSketch } from "./cards";
import * as ai from "./rewrite";
import { matchScript } from "./match";
import { organiseCut } from "./organise";
import { type Beat, type Cut, type Script, cutsOf, isStale, plannedBeats } from "./scripts";
import { readScript, saveScript, voiceSamples } from "./scriptsStore";
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
  const beats = c.beats.map((x) => (x.id === beat ? { ...x, text, from: undefined, changed: true } : x));
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

// ── the visual plan ──

const withBeat = (s: Script, beatId: string, f: (b: Beat) => Beat): Script => {
  const map = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => (b.id === beatId ? f(b) : b)) });
  return { ...s, long: s.long ? map(s.long) : undefined, shorts: s.shorts.map(map) };
};

/** A visual for every beat that hasn't one yet (`all`: every beat again, pictures already made kept where the kind stays sketch). */
export const planVisuals = async (g: GameConfig, id: string, all = false): Promise<Script> => {
  const { s, v } = need(g, id);
  if (!s.long) throw new Error("rewrite the script first");
  const beats = plannedBeats(s);
  const want = beats.map((x, i) => ({ ...x, n: i + 1 })).filter((x) => all || !x.beat.card);
  if (!want.length) return s;
  const plan = await ai.planVisuals(v, want.map((x) => ({ n: x.n, text: x.beat.text })));
  let next = s;
  for (const x of want) {
    const card = plan.get(x.n);
    if (!card) continue;
    next = withBeat(next, x.beat.id, (b) => {
      // A picture already made for the same kind of card stays until the prompt is changed by hand.
      const keep = b.card?.kind === "sketch" && card.kind === "sketch" && b.card.src ? { src: b.card.src, prompt: b.card.prompt } : {};
      return { ...b, card: { ...card, ...keep } };
    });
  }
  return saveScript(g, next);
};

/** Pictures being made right now, by script: the beat ids in flight (the page shows them as making). */
const making = new Map<string, Set<string>>();
export const pendingSketches = (id: string): string[] => [...(making.get(id) ?? [])];

/**
 * Every sketch not yet made (or the beats named), a few at a time in the
 * background. Each lands on its beat as it finishes; the page polls the
 * script. Answers at once with how many it started.
 */
export const makeSketches = (g: GameConfig, id: string, beatIds?: string[]): { started: number } => {
  if (!hasImages()) throw new Error("no OPENAI_API_KEY in apps/desk/.env");
  const { s, v } = need(g, id);
  const style = v.sketch ?? "A simple, clean black ink line sketch on a transparent background, one accent colour, no words.";
  const inFlight = making.get(id) ?? new Set<string>();
  making.set(id, inFlight);
  const todo = plannedBeats(s)
    .map((x) => x.beat)
    .filter((b) => b.card?.kind === "sketch" && b.card.prompt?.trim() && !inFlight.has(b.id) && (beatIds ? beatIds.includes(b.id) : !b.card.src));
  for (const b of todo) inFlight.add(b.id);
  const run = async () => {
    const queue = [...todo];
    const worker = async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        try {
          const src = await makeSketch(g, s, b, style);
          const now = readScript(g, id);
          if (now) saveScript(g, withBeat(now, b.id, (x) => ({ ...x, card: { ...(x.card ?? { kind: "sketch" }), src, check: undefined, error: undefined } })));
        } catch (e) {
          console.warn(`⚠ sketch for ${id}/${b.id}: ${(e as Error).message}`);
          const now = readScript(g, id);
          if (now) saveScript(g, withBeat(now, b.id, (x) => ({ ...x, card: { ...(x.card ?? { kind: "sketch" }), error: (e as Error).message.slice(0, 200) } })));
        } finally {
          inFlight.delete(b.id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  };
  void run();
  return { started: todo.length };
};

// ── organise ──

export type OrganiseResult = { script: Script; made: { cut: string; title: string; id: string; missing: string[]; conflicts: { beat: string; takes: string[] }[] }[] };

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
  cutsOf(s).forEach((cut) => {
    const n = cut.kind === "short" ? s.shorts.indexOf(cut) + 1 : 0;
    const seqId = `${base}-${cut.kind === "long" ? "long" : `short-${n}`}-r${run}`;
    const name = `${s.title} · ${cut.kind === "long" ? "long" : `short ${n}: ${cut.title}`} (run ${run})`;
    const { seq, missing, conflicts } = organiseCut(s, cut, covers, { id: seqId, name });
    writeSequence(g, seq);
    made.push({ cut: cut.id, title: cut.title, id: seqId, missing, conflicts });
    entries.push({ id: seqId, cut: cut.id, run, at: now, missing: missing.length, conflicts: conflicts.length });
  });
  const script = saveScript(g, { ...s, runs: run, sequences: [...(s.sequences ?? []), ...entries] });
  return { script, made };
};
