/**
 * The scripts' files: <rendersDir>/scripts/<id>.json (gitignored, like
 * ideas.json was: personal drafts with API output in them). Server only.
 *
 * The first time the folder is looked at, an old ideas.json next to it
 * becomes scripts: each idea's description is the script's source, the
 * ids carry over (edits point at them), and ideas.json is renamed so it
 * is never read twice.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameConfig } from "../game";
import { type Beat, type BeatCard, type Cut, DEFAULT_GAP, type Script, type ScriptPatch, type ScriptSummary, type ScriptTake, cutsOf, emptyScript, summarise } from "./scripts";
import { rendersDir } from "./render";

const dir = (g: GameConfig) => join(rendersDir(g), "scripts");
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");
const pathOf = (g: GameConfig, id: string) => join(dir(g), `${safeId(id)}.json`);

type OldIdea = { id?: string; title?: string; description?: string; text?: string; done?: string; createdAt?: string };

const migrateIdeas = (g: GameConfig) => {
  const old = join(rendersDir(g), "ideas.json");
  if (!existsSync(old)) return;
  try {
    const list = JSON.parse(readFileSync(old, "utf8")) as OldIdea[];
    if (Array.isArray(list)) {
      for (const i of list) {
        const [first = "", ...rest] = (i.text ?? "").split("\n");
        const id = i.id ?? crypto.randomUUID();
        if (existsSync(pathOf(g, id))) continue;
        const s = emptyScript(id, i.title ?? first, (i.description ?? rest.join("\n")).trim(), i.createdAt ?? new Date().toISOString());
        if (i.done) s.done = i.done;
        write(g, s);
      }
    }
  } catch (e) {
    console.warn(`⚠ ${g.id}: couldn't read ideas.json to migrate it: ${(e as Error).message}`);
    return;
  }
  renameSync(old, join(rendersDir(g), "ideas.migrated.json"));
};

const write = (g: GameConfig, s: Script): Script => {
  mkdirSync(dir(g), { recursive: true });
  writeFileSync(pathOf(g, s.id), JSON.stringify(s, null, 2) + "\n");
  return s;
};

const num = (n: unknown, lo: number, hi: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
};

/** Whatever the page sent, made safe to keep. */
const cleanCard = (c: Partial<BeatCard> | undefined): BeatCard | undefined => {
  if (!c || !["text", "sketch", "broll", "none"].includes(String(c.kind))) return undefined;
  return {
    kind: c.kind as BeatCard["kind"],
    ...(c.text !== undefined ? { text: String(c.text).slice(0, 200) } : {}),
    ...(c.prompt !== undefined ? { prompt: String(c.prompt).slice(0, 600) } : {}),
    ...(c.note !== undefined ? { note: String(c.note).slice(0, 400) } : {}),
    ...(c.src ? { src: String(c.src).replace(/(^|\/)\.\.(?=\/|$)/g, "").replace(/^\/+/, "") } : {}),
    ...(c.check ? { check: true } : {}),
    ...(c.error ? { error: String(c.error).slice(0, 200) } : {}),
  };
};
const cleanBeat = (b: Partial<Beat>): Beat | undefined => {
  const text = String(b.text ?? "").trim();
  const id = String(b.id ?? "").trim();
  if (!id) return undefined;
  const card = cleanCard(b.card);
  return { id, text, ...(b.from ? { from: String(b.from) } : {}), ...(b.changed ? { changed: true } : {}), ...(card ? { card } : {}) };
};
const cleanCut = (c: Partial<Cut>, kind: Cut["kind"]): Cut | undefined => {
  const id = String(c.id ?? "").trim();
  if (!id) return undefined;
  const beats = (Array.isArray(c.beats) ? c.beats : []).flatMap((b) => {
    const x = cleanBeat(b as Partial<Beat>);
    return x && (x.text || x.from) ? [x] : [];
  });
  return { id, kind, title: String(c.title ?? "").trim(), ...(c.hook ? { hook: String(c.hook).trim() } : {}), ...(c.why ? { why: String(c.why).trim() } : {}), beats };
};

const cleanTake = (t: Partial<ScriptTake>): ScriptTake | undefined => {
  const file = String(t.file ?? "").replace(/(^|\/)\.\.(?=\/|$)/g, "").replace(/^\/+/, "");
  if (!file) return undefined;
  const seconds = num(t.seconds, 0, 1e6, 0);
  const keep = Array.isArray(t.keep)
    ? t.keep
        .map((k) => ({ start: num(k.start, 0, seconds || 1e6, 0), end: num(k.end, 0, seconds || 1e6, 0) }))
        .filter((k) => k.end - k.start > 0.02)
        .sort((a, b) => a.start - b.start)
    : undefined;
  return {
    file,
    seconds,
    recordedAt: String(t.recordedAt ?? ""),
    words: Array.isArray(t.words) ? t.words.map((w) => ({ text: String(w.text ?? ""), start: num(w.start, 0, 1e6, 0), end: num(w.end, 0, 1e6, 0), ...(w.hidden ? { hidden: true } : {}) })) : [],
    ...(t.transcribed ? { transcribed: true } : {}),
    ...(keep?.length ? { keep } : {}),
  };
};

export const readScript = (g: GameConfig, id: string): Script | undefined => {
  migrateIdeas(g);
  const p = pathOf(g, id);
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<Script>;
    if (!raw || typeof raw !== "object" || !raw.id) return undefined;
    return {
      ...emptyScript(raw.id, raw.title ?? "", raw.source ?? "", raw.createdAt),
      ...raw,
      sources: Array.isArray(raw.sources) ? raw.sources : [],
      shorts: Array.isArray(raw.shorts) ? raw.shorts : [],
      takes: Array.isArray(raw.takes) ? raw.takes.flatMap((t) => cleanTake(t) ?? []) : [],
      gap: num(raw.gap, 0, 3, DEFAULT_GAP),
    };
  } catch {
    return undefined;
  }
};

/** Newest first. */
export const listScripts = (g: GameConfig): ScriptSummary[] => {
  migrateIdeas(g);
  if (!existsSync(dir(g))) return [];
  return readdirSync(dir(g))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const s = readScript(g, f.replace(/\.json$/, ""));
      return s ? [summarise(s)] : [];
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

export const addScript = (g: GameConfig, title: string, source = ""): Script => {
  const t = title.trim() || "Untitled";
  return write(g, emptyScript(crypto.randomUUID(), t, source.trim()));
};

export const updateScript = (g: GameConfig, id: string, patch: ScriptPatch): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  if (patch.title !== undefined && patch.title.trim()) s.title = patch.title.trim();
  if (patch.source !== undefined) s.source = String(patch.source);
  if (patch.gap !== undefined) s.gap = num(patch.gap, 0, 3, s.gap);
  // A picture lands on a beat from the background (makeSketches) while the page may be mid-edit: a src only
  // ever comes from the server, so one the page doesn't know about yet is kept.
  const known = new Map(cutsOf(s).flatMap((c) => c.beats.map((b) => [b.id, b.card] as const)));
  const keepSrc = (c: Cut): Cut => ({ ...c, beats: c.beats.map((b) => (b.card && !b.card.src && known.get(b.id)?.src && known.get(b.id)?.kind === "sketch" && b.card.kind === "sketch" && known.get(b.id)?.prompt === b.card.prompt ? { ...b, card: { ...b.card, src: known.get(b.id)!.src } } : b)) });
  if (patch.long !== undefined) s.long = patch.long ? keepSrc(cleanCut(patch.long, "long")!) : undefined;
  if (patch.shorts !== undefined) s.shorts = (Array.isArray(patch.shorts) ? patch.shorts : []).flatMap((c) => cleanCut(c, "short") ?? []).map(keepSrc);
  if (patch.takes !== undefined) {
    // The page only ever changes a take's kept regions and its words: the files are the server's.
    const mine = new Map(s.takes.map((t) => [t.file, t]));
    s.takes = (Array.isArray(patch.takes) ? patch.takes : []).flatMap((t) => {
      const c = cleanTake(t);
      const was = c && mine.get(c.file);
      return c && was ? [{ ...was, words: c.words.length ? c.words : was.words, ...(c.keep ? { keep: c.keep } : {}) }] : [];
    });
    // A take the page didn't send is not deleted this way (that's the DELETE route): it stays.
    for (const t of s.takes.length < mine.size ? [...mine.values()].filter((t) => !s.takes.some((x) => x.file === t.file)) : []) s.takes.push(t);
  }
  if (patch.done === true && !s.done) s.done = new Date().toISOString();
  if (patch.done === false) delete s.done;
  s.updatedAt = new Date().toISOString();
  return write(g, s);
};

/** The store's own write, for the rewrite steps (already clean). */
export const saveScript = (g: GameConfig, s: Script): Script => write(g, { ...s, updatedAt: new Date().toISOString() });

export const removeScript = (g: GameConfig, id: string): void => {
  const p = pathOf(g, id);
  if (existsSync(p)) unlinkSync(p);
};

/**
 * Tom's own scripts, in full, as the voice for Claude to match: every
 * script with a source except the one being rewritten, done or not,
 * newest first, until `maxWords` words are in. That is the one signal
 * that is actually his; nothing invented stands in for it.
 */
export const voiceSamples = (g: GameConfig, except: string, maxWords = 20000): string[] => {
  const out: string[] = [];
  let words = 0;
  for (const s of listScripts(g)
    .filter((s) => s.hasSource && s.id !== except)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))) {
    const full = readScript(g, s.id);
    const text = full?.source.trim();
    if (!text) continue;
    const n = text.split(/\s+/).length;
    if (words + n > maxWords && out.length) break;
    out.push(text);
    words += n;
  }
  return out;
};

export const addTakeToScript = (g: GameConfig, id: string, take: ScriptTake): Script => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  return saveScript(g, { ...s, takes: [...s.takes, take] });
};
export const removeTakeFromScript = (g: GameConfig, id: string, file: string): { script: Script; take?: ScriptTake } => {
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const take = s.takes.find((t) => t.file === file);
  return { script: saveScript(g, { ...s, takes: s.takes.filter((t) => t.file !== file) }), take };
};
