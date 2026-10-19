import type { Take } from "@heroic/voiceover";
import { type ScriptResearch, wovenSource } from "./research";
import { type ScriptDoc, forRewrite } from "./doc";

/**
 * A SCRIPT: a video's words, as a project on the Scripts tab (what Ideas
 * was, grown up). Tom pastes what he wrote, Claude turns it into a long
 * cut and some short cuts, each a list of BEATS, and everything after
 * (cards, takes, organise) hangs off a beat's id. Design:
 * docs/design/desk-scripts.md.
 *
 * This is the pure half (types and the maths): the page imports it too.
 * The file store is scriptsStore.ts, the Claude calls rewrite.ts.
 */

/**
 * What's on screen while a beat is said (the visual plan): a few words, a
 * sketch (a prompt, and the picture once made), a b-roll slot (what to
 * film), or nothing (the card before stays up). Organise turns it into a
 * card on the edit's overlay track.
 */
export type BeatCard = {
  kind: "text" | "sketch" | "broll" | "none";
  /** text: the words on screen. */
  text?: string;
  /** sketch: what to draw (the style prefix is the game's, added when it's made). */
  prompt?: string;
  /** broll: what to film. */
  note?: string;
  /** sketch: the picture, under the game's public dir, once made. */
  src?: string;
  /** The words or the prompt changed since the picture was made (or the beat did). */
  check?: boolean;
  /** The last try at the picture failed: why. */
  error?: string;
};

/**
 * A picture on a beat (docs/design/desk-ascii-scripts.md): what it's of,
 * every try at it, the one chosen, and its LOOK SEED (how its glyphs
 * arrive and fill in: same seed, same build). A long beat has two.
 */
export type BeatPicture = {
  /** What the picture is of (the game's style is added when it's made). */
  prompt: string;
  /** Every try, oldest first, under the game's public dir (generated or Tom's own). */
  candidates: string[];
  /** The one the video uses (one of the candidates). */
  chosen?: string;
  /** Tom's tick. Organise warns about a beat without one but uses it anyway. */
  approved?: boolean;
  /** The beat's words (or the prompt) changed since the picture was made. */
  check?: boolean;
  /** The last try failed: why. */
  error?: string;
  /** The look seed. */
  look: number;
};

/**
 * A thumbnail idea for the long video (docs/design/desk-thumbnails.md): a
 * fresh picture made for the thumbnail, built out of green glyphs, and up
 * to four words built out of glyphs in an accent colour on its dark side.
 * Several ideas, so YouTube's Test & compare can pick between three.
 */
export type ThumbnailIdea = {
  id: string;
  /** What the picture is of (the game's picture style and the thumbnail rules are added when it's made). */
  prompt: string;
  /** The words on it, "" for none; set in capitals, a new line breaks a line. */
  words: string;
  accent: "red" | "white";
  /** Which side the words go; unset = the picture's darker side. */
  side?: "left" | "right";
  /** Claude's one line on why someone scrolling would stop for it. */
  why?: string;
  /** Every try, oldest first, under the game's public dir (generated or Tom's own). */
  candidates: string[];
  /** The one in use. */
  chosen?: string;
  /** The last try failed: why. */
  error?: string;
};

/** A YouTube title to try against the working one (Test & compare takes titles as well as thumbnails). Not the title the video builds on screen: that's the long cut's. */
export type TitleIdea = {
  id: string;
  text: string;
  /** Claude's one line on why it gets the click. */
  why?: string;
};

/** What the score should feel like under a beat. The six Autosave moods, then the seven for telling a story. */
export const SCORE_MOODS = ["cosy", "wistful", "wonder", "night", "playful", "tender", "focus", "curious", "tense", "eerie", "driving", "melancholy", "triumph"] as const;
export type ScoreMood = (typeof SCORE_MOODS)[number];
export type BeatMood = {
  mood: ScoreMood;
  /** 0 (bare) to 1 (everything playing). */
  intensity: number;
  /** The turn of the video: the music steps up a key here. One or two a video at most. */
  lift?: boolean;
};

/** One thought, a few sentences, ten to twenty seconds spoken. */
export type Beat = {
  /** Stable through edits; what a take match and a card refer to. */
  id: string;
  text: string;
  /** A short's beat that is the same words as a long beat: that beat's id (one recording serves both). */
  from?: string;
  /** The words changed since the last rewrite (a re-paste, or Tom's hand): its match and card want checking. */
  changed?: boolean;
  /** The old visual plan (desk-scripts.md), left on older scripts; organise only falls back to it. */
  card?: BeatCard;
  /** Its picture, or two for a long beat. */
  pictures?: BeatPicture[];
  /** What the score does under it. */
  mood?: BeatMood;
  /** Key words (as written in the beat) the picture's glyphs fly out to spell as they're said. */
  pulled?: string[];
  /** A chapter starts at this beat: its name. */
  chapter?: string;
};

/** One video's worth: the long cut, or a short. */
export type Cut = {
  id: string;
  kind: "long" | "short";
  title: string;
  /** A short: its first line, on screen from frame one. */
  hook?: string;
  /** Claude's one line on why this works as a video. */
  why?: string;
  beats: Beat[];
};

/** A source the cuts were made from, kept: every rewrite or adjust snapshots the text it ran on. */
export type SourceVersion = { at: string; text: string };

/**
 * A recording of Tom reading the script, with its words and the parts of it
 * he's kept (no `keep` = all of it). `assign`: the beats Tom says it reads
 * (ids, in order), for when the matcher didn't hear them: it then reads
 * those and only those.
 */
export type ScriptTake = Take & { keep?: { start: number; end: number }[]; assign?: string[] };

export type Script = {
  id: string;
  title: string;
  /** What Tom pasted, live (saves as it changes), or the markdown of the Google Doc it was pulled from. */
  source: string;
  /** The Google Doc it comes from (docs/design/desk-docs.md): the box is then read only, and Pull the latest replaces re-pasting. */
  doc?: ScriptDoc;
  /** The texts the cuts were rewritten from, oldest first. The last is what the current cuts came from. */
  sources: SourceVersion[];
  long?: Cut;
  shorts: Cut[];
  /** The takes recorded against the prompter (files under public/voice/takes, like an edit's). */
  takes: ScriptTake[];
  /** Seconds of silence organise leaves between beats. */
  gap: number;
  /** The score's seed (desk-ascii-scripts.md): set at the first organise; Another soundtrack draws a new one. */
  scoreSeed?: number;
  /** How many times organise has run (each run names its sequences by it). */
  runs?: number;
  /** The sequences organise wrote, newest last: the cut each is, which run, when. */
  sequences?: { id: string; cut: string; run: number; at: string; missing: number; conflicts: number; youtube?: string }[];
  /** Facts from real sources, pinned after Tom's sentences (docs/design/desk-research.md). The accepted ones are woven into what the rewrite reads. */
  research?: ScriptResearch;
  /** The long video's thumbnail ideas (docs/design/desk-thumbnails.md). */
  thumbnails?: ThumbnailIdea[];
  /** YouTube titles to test, beside the long cut's title (docs/design/desk-thumbnails.md). */
  titles?: TitleIdea[];
  /** The top of the long video's YouTube description and its tags, written by Claude, Tom's to change. The chapters go under it. */
  youtube?: { description: string; tags: string };
  /** The world every picture lives in (a submarine crew, a lighthouse winter…): Claude picks it at the first plan, Tom can write his own. */
  theme?: string;
  /** What that world LOOKS like, in literal words: sent to the image model with every picture (it never sees the theme). Claude writes it at the plan; Tom's to change. */
  look?: string;
  /** The world's recurring characters, places and objects, each with one fixed look that's written out in every prompt they're in. */
  cast?: { name: string; look: string }[];
  /** ISO timestamp once the video's made. */
  done?: string;
  createdAt: string;
  updatedAt: string;
};

/** What the list shows. */
export type ScriptSummary = Pick<Script, "id" | "title" | "done" | "createdAt" | "updatedAt"> & { hasSource: boolean; hasCuts: boolean; shorts: number; stale: boolean };

export type ScriptPatch = Partial<Pick<Script, "title" | "source" | "long" | "shorts" | "gap" | "takes" | "thumbnails" | "titles" | "youtube" | "theme" | "look" | "cast">> & { done?: boolean };

export const DEFAULT_GAP = 0.3;

export const newId = (): string => Math.random().toString(36).slice(2, 10);

export const emptyScript = (id: string, title: string, source = "", now = new Date().toISOString()): Script => ({
  id,
  title,
  source,
  sources: [],
  shorts: [],
  takes: [],
  gap: DEFAULT_GAP,
  createdAt: now,
  updatedAt: now,
});

/** What the rewrite reads: the box (or the Doc), with the research Tom's accepted woven in and his notes (a Sources section) left out. */
export const scriptText = (s: Pick<Script, "source" | "research">): string => forRewrite(wovenSource(s));

/** The cuts were made from an older script than the one there now. Spacing alone (blank lines, a trailing space) isn't a change. */
export const isStale = (s: Pick<Script, "source" | "sources" | "long" | "research">): boolean => {
  const flat = (t: string) => t.replace(/\s+/g, " ").trim();
  return Boolean(s.long) && flat(s.sources.at(-1)?.text ?? "") !== flat(scriptText(s));
};

export const summarise = (s: Script): ScriptSummary => ({
  id: s.id,
  title: s.title,
  done: s.done,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  hasSource: Boolean(s.source.trim()),
  hasCuts: Boolean(s.long),
  shorts: s.shorts.length,
  stale: isStale(s),
});

/** Every cut, long first. */
export const cutsOf = (s: Pick<Script, "long" | "shorts">): Cut[] => [...(s.long ? [s.long] : []), ...s.shorts];

/** A beat's own words: its text, or (a short's shared beat) the long beat's. */
export const beatText = (s: Pick<Script, "long">, b: Beat): string => (b.from && s.long?.beats.find((x) => x.id === b.from)?.text) || b.text;

// ── words ──

/** Spelled numbers as digits: the script says "three", Whisper hears "3". */
const NUMBERS: Record<string, string> = Object.fromEntries(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ").map((w, i) => [w, String(i)]),
);

/** Words as the matcher and the diff see them: lower case, no punctuation, numbers as digits. */
export const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => NUMBERS[t] ?? t);

/** Words with their original spelling, for showing a diff. */
export const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);
const norm = (w: string) => tokens(w).join("") || w;

export type DiffOp = { kind: "same" | "added" | "removed"; text: string };

/** The word-level difference from `a` to `b` (an LCS), for lighting up what changed. Punctuation and case don't count as a change. */
export const wordDiff = (a: string, b: string): DiffOp[] => {
  const A = words(a);
  const B = words(b);
  const an = A.map(norm);
  const bn = B.map(norm);
  const n = A.length;
  const m = B.length;
  // lcs[i][j] = longest common subsequence of A[i..] and B[j..]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = an[i] === bn[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: DiffOp[] = [];
  const push = (kind: DiffOp["kind"], text: string) => {
    const last = ops.at(-1);
    if (last && last.kind === kind) last.text += ` ${text}`;
    else ops.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (an[i] === bn[j]) {
      push("same", B[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push("removed", A[i++]!);
    else push("added", B[j++]!);
  }
  while (i < n) push("removed", A[i++]!);
  while (j < m) push("added", B[j++]!);
  return ops;
};

/**
 * The review's diff: the whole script against the whole cut in ONE
 * alignment, then shared out to the beats. Every word written is matched
 * once, so a sentence a neighbouring beat says is never shown as cut (the
 * old per-beat diff against a whole paragraph struck 60–70% of a real
 * script that had lost almost nothing). A run of the script that no beat
 * says is struck on the beat that follows it (the last beat for the end).
 * `span` is the script's words for that beat as written, for keep mine.
 */
export const cutDiff = (source: string, beats: string[]): { ops: DiffOp[]; span: string }[] => {
  const A = words(source);
  const an = A.map(norm);
  const B: { w: string; beat: number }[] = beats.flatMap((t, k) => words(t).map((w) => ({ w, beat: k })));
  const bn = B.map((b) => norm(b.w));
  const n = A.length;
  const m = B.length;
  const out = beats.map(() => ({ ops: [] as DiffOp[], span: [] as string[] }));
  if (!m) return out.map(() => ({ ops: [], span: "" }));
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = an[i] === bn[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const push = (k: number, kind: DiffOp["kind"], text: string) => {
    const ops = out[k]!.ops;
    const last = ops.at(-1);
    if (last && last.kind === kind) last.text += ` ${text}`;
    else ops.push({ kind, text });
    if (kind !== "added") out[k]!.span.push(text);
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (an[i] === bn[j]) {
      push(B[j]!.beat, "same", B[j]!.w);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) push(B[j]!.beat, "removed", A[i++]!);
    else push(B[j]!.beat, "added", B[j++]!.w);
  }
  while (i < n) push(beats.length - 1, "removed", A[i++]!);
  while (j < m) push(B[j]!.beat, "added", B[j++]!.w);
  return out.map((o) => ({ ops: o.ops, span: o.span.join(" ") }));
};

/** How alike two texts are, 0–1: the share of the shorter's words found in the other. */
export const overlap = (a: string, b: string): number => {
  const A = tokens(a);
  const B = new Set(tokens(b));
  if (!A.length || !B.size) return 0;
  const hits = A.filter((w) => B.has(w)).length;
  return hits / Math.min(A.length, B.size);
};

/** The source, as the paragraphs Tom wrote (blank-line separated; a lone line is a paragraph too). */
export const paragraphs = (source: string): string[] =>
  source
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+[.)])\s)/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** The paragraph of the source a beat came from: the one it shares most words with (undefined when none shares many). */
export const sourceOf = (beat: string, paras: string[]): { index: number; text: string } | undefined => {
  let best = -1;
  let score = 0.3;
  paras.forEach((p, i) => {
    const o = overlap(beat, p);
    if (o > score) {
      score = o;
      best = i;
    }
  });
  return best < 0 ? undefined : { index: best, text: paras[best]! };
};

/** A cut's words as one piece, for reading. */
export const cutText = (s: Pick<Script, "long">, c: Cut): string => c.beats.map((b) => beatText(s, b)).join("\n\n");

/** Spoken length, roughly: 2.6 words a second. */
export const spokenSeconds = (text: string): number => Math.round(tokens(text).length / 2.6);

/** The beats that are planned, recorded and organised: the long cut's (shorts are parked, desk-ascii-scripts.md decision 1). */
export const plannedBeats = (s: Pick<Script, "long" | "shorts">): { cut: Cut; beat: Beat }[] => (s.long ? s.long.beats.map((beat) => ({ cut: s.long!, beat })) : []);

/** A beat's visual: its own, or (a short's shared beat) the long beat's. */
export const cardOfBeat = (s: Pick<Script, "long">, b: Beat): BeatCard | undefined => (b.from ? s.long?.beats.find((x) => x.id === b.from)?.card : b.card);

/** The pictures the script has chosen, for the editor's Cards shelf (and the old sketches, on older scripts). */
export const sketchesOf = (s: Pick<Script, "long" | "shorts">): { src: string; label: string; beat: string; look?: number }[] =>
  plannedBeats(s).flatMap(({ beat }) => {
    const label = beat.text.slice(0, 60);
    const chosen = (beat.pictures ?? []).flatMap((p, k) => (p.chosen ? [{ src: p.chosen, label: k ? `${label} (2)` : label, beat: beat.id, look: p.look }] : []));
    return chosen.length ? chosen : beat.card?.kind === "sketch" && beat.card.src ? [{ src: beat.card.src, label, beat: beat.id }] : [];
  });

// ── pictures, chapters ──

/** A beat guessed at longer than this (spoken seconds) gets a second picture. */
export const LONG_BEAT = 30;
/** Never two chapters closer than this (spoken seconds): YouTube's own floor. Claude's suggestions keep to its stricter rules (rewrite.ts); Tom's own chapters only need this. */
export const CHAPTER_GAP = 10;

/** A fresh look seed, 1–9999 like the Desk's other seeds. */
export const newLook = (): number => 1 + Math.floor(Math.random() * 9999);

/** How many pictures a beat wants by its length. */
export const picturesWanted = (text: string): number => (spokenSeconds(text) > LONG_BEAT ? 2 : 1);

/** The chapters that show: every named one, but never two within CHAPTER_GAP (the first wins). Beat ids. */
export const allowedChapters = (beats: Pick<Beat, "id" | "text" | "chapter">[]): Set<string> => {
  const ok = new Set<string>();
  let at = 0;
  let last = -Infinity;
  for (const b of beats) {
    if (b.chapter?.trim() && at - last >= CHAPTER_GAP) {
      ok.add(b.id);
      last = at;
    }
    at += spokenSeconds(b.text);
  }
  return ok;
};

/** Where each beat starts, roughly (spoken seconds from the top), for showing chapter spacing. */
export const beatStarts = (beats: Pick<Beat, "text">[]): number[] => {
  let at = 0;
  return beats.map((b) => {
    const t = at;
    at += spokenSeconds(b.text);
    return t;
  });
};
