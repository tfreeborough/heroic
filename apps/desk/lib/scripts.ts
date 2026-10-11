import type { Take } from "@heroic/voiceover";

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

/** One thought, a few sentences, five to fifteen seconds spoken. */
export type Beat = {
  /** Stable through edits; what a take match and a card refer to. */
  id: string;
  text: string;
  /** A short's beat that is the same words as a long beat: that beat's id (one recording serves both). */
  from?: string;
  /** The words changed since the last rewrite (a re-paste, or Tom's hand): its match and card want checking. */
  changed?: boolean;
  /** The visual plan for it. A short's shared beat uses the long beat's. */
  card?: BeatCard;
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

/** A recording of Tom reading the script, with its words and the parts of it he's kept (no `keep` = all of it). */
export type ScriptTake = Take & { keep?: { start: number; end: number }[] };

export type Script = {
  id: string;
  title: string;
  /** What Tom pasted, live (saves as it changes). */
  source: string;
  /** The texts the cuts were rewritten from, oldest first. The last is what the current cuts came from. */
  sources: SourceVersion[];
  long?: Cut;
  shorts: Cut[];
  /** The takes recorded against the prompter (files under public/voice/takes, like an edit's). */
  takes: ScriptTake[];
  /** Seconds of silence organise leaves between beats. */
  gap: number;
  /** How many times organise has run (each run names its sequences by it). */
  runs?: number;
  /** The sequences organise wrote, newest last: the cut each is, which run, when. */
  sequences?: { id: string; cut: string; run: number; at: string; missing: number; conflicts: number }[];
  /** ISO timestamp once the video's made. */
  done?: string;
  createdAt: string;
  updatedAt: string;
};

/** What the list shows. */
export type ScriptSummary = Pick<Script, "id" | "title" | "done" | "createdAt" | "updatedAt"> & { hasSource: boolean; hasCuts: boolean; shorts: number; stale: boolean };

export type ScriptPatch = Partial<Pick<Script, "title" | "source" | "long" | "shorts" | "gap" | "takes">> & { done?: boolean };

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

/** The cuts were made from an older source than the one in the box. */
export const isStale = (s: Pick<Script, "source" | "sources" | "long">): boolean => Boolean(s.long) && (s.sources.at(-1)?.text ?? "").trim() !== s.source.trim();

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

/** Words as the matcher and the diff see them: lower case, no punctuation, numbers kept. */
export const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

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

/** The beats that carry their own plan: the long cut's, then the shorts' beats that aren't a long beat. */
export const plannedBeats = (s: Pick<Script, "long" | "shorts">): { cut: Cut; beat: Beat }[] => [
  ...(s.long ? s.long.beats.map((beat) => ({ cut: s.long!, beat })) : []),
  ...s.shorts.flatMap((cut) => cut.beats.filter((b) => !b.from).map((beat) => ({ cut, beat }))),
];

/** A beat's visual: its own, or (a short's shared beat) the long beat's. */
export const cardOfBeat = (s: Pick<Script, "long">, b: Beat): BeatCard | undefined => (b.from ? s.long?.beats.find((x) => x.id === b.from)?.card : b.card);

/** The pictures the script has made, for the editor's Cards shelf. */
export const sketchesOf = (s: Pick<Script, "long" | "shorts">): { src: string; label: string; beat: string }[] =>
  plannedBeats(s).flatMap(({ cut, beat }, i) => (beat.card?.kind === "sketch" && beat.card.src ? [{ src: beat.card.src, label: `${cut.kind === "long" ? "" : "short · "}${beat.text.slice(0, 60)}`, beat: beat.id }] : []));

/** What to film: every b-roll slot, numbered by its beat, as one list to take out with the phone. */
export const shotList = (s: Pick<Script, "long" | "shorts">): string =>
  plannedBeats(s)
    .filter(({ beat }) => beat.card?.kind === "broll" && beat.card.note?.trim())
    .map(({ cut, beat }) => {
      const n = cut.beats.findIndex((b) => b.id === beat.id) + 1;
      return `${cut.kind === "long" ? "" : `[${cut.title}] `}${n}. ${beat.card!.note!.trim()}\n   while saying: "${beat.text.slice(0, 90)}${beat.text.length > 90 ? "…" : ""}"`;
    })
    .join("\n\n");
