import type { Take } from "@heroic/voiceover";
import { type ScriptResearch, wovenSource } from "./research";
import { forRewrite, sourceNotes, type ScriptDoc } from "./doc";

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
/**
 * How a script's pictures are made (cards.ts): "conte" (11-05, Tom's pick off
 * the painter round: Spilliaert's subjects and placement, drawn as Seurat's
 * conté crayon), "film" (black-and-white film stills) or "woodcut" (the old
 * chiaroscuro print). Conté and film use cast reference pictures in their own medium.
 */
export type PictureStyle = "conte" | "film" | "woodcut";
export const PICTURE_STYLES: Record<PictureStyle, string> = { conte: "conté drawing (Spilliaert × Seurat)", film: "film stills", woodcut: "woodcut (old)" };
/** A cast member's reference picture: made for one look in one style (an older one without a style was a film still). */
export type CastRef = { look: string; style?: PictureStyle; candidates: string[]; chosen?: string; error?: string };

/** The script's picture style: set, or woodcut for a script that already has pictures from before film stills (so a remake never mixes the two), else conté. */
export const pictureStyleOf = (s: Pick<Script, "pictureStyle" | "long">): PictureStyle =>
  s.pictureStyle ?? (s.long?.beats.some((b) => b.pictures?.some((p) => p.candidates.length)) ? "woodcut" : "conte");

/** Whether a style draws with the cast's reference pictures. */
export const usesCastRefs = (style: PictureStyle) => style !== "woodcut";

/** A cast member's reference picture, if it's still for their look as it stands and in the script's style. */
export const castRefOf = (s: Pick<Script, "castRefs" | "pictureStyle" | "long">, c: { name: string; look: string }): string | undefined => {
  const r = s.castRefs?.[c.name];
  return r && r.look.trim() === c.look.trim() && (r.style ?? "film") === pictureStyleOf(s) ? r.chosen : undefined;
};

const STOP = new Set("with that this from into over under their them they then than when where what which while about above below after before behind beside between each every only some such very just more most other same like and the for are was were its his her one two side early later small large long".split(" "));
const lookWords = (t: string) => t.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * Who's in a picture: the prompt writer's list while the prompt is the one
 * it was listed for; otherwise (an edited or older prompt) every cast member
 * whose look is mostly written out in it (prompts write a cast member's look
 * out word for word), dropping one whose matched words all sit inside a
 * better match's (the plain box inside the deluxe box's description).
 */
export const castIn = (p: Pick<BeatPicture, "prompt" | "cast" | "castFor">, cast: { name: string; look: string }[]): string[] => {
  if (p.cast && p.castFor?.trim() === p.prompt.trim()) return p.cast.filter((n) => cast.some((c) => c.name === n));
  const have = new Set(lookWords(p.prompt));
  const found = cast.flatMap((c) => {
    const want = [...new Set(lookWords(c.look))];
    const hit = want.filter((w) => have.has(w));
    const cover = hit.length / Math.max(1, want.length);
    return cover >= 0.7 ? [{ name: c.name, cover, hit: new Set(hit) }] : [];
  });
  return found.filter((x) => !found.some((y) => y !== x && y.cover > x.cover && [...x.hit].every((w) => y.hit.has(w)))).map((x) => x.name);
};

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
  /** Cast members in this picture (by name), as the prompt writer listed them for `castFor`; their reference pictures go to the image model with it. A prompt changed since (Tom's edit) falls back to matching cast looks in its words (castIn). */
  cast?: string[];
  castFor?: string;
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
  /** The story line: what we see while this beat is said, decided for the whole video at once (Plan the story). The prompts are written from it. */
  scene?: string;
  /** Its picture, or two for a long beat. */
  pictures?: BeatPicture[];
  /** What the score does under it. */
  mood?: BeatMood;
  /** Key words (as written in the beat) the picture's glyphs fly out to spell as they're said. */
  pulled?: string[];
  /** A chapter starts at this beat: its name. */
  chapter?: string;
  /** How long its kept recording runs, in seconds, as the last Find shorts measured it (unset = not recorded then). */
  seconds?: number;
  /** A long beat: its sentences as recorded (the kept take's words, riffs included), each with its seconds, as the last Find shorts or Reshape measured them (desk-shorts.md § 6). */
  sentences?: BeatSentence[];
  /** A short's excerpt beat that keeps only some of its long beat's sentences (desk-shorts.md § 6): sentences `first..last` (1-based, as recorded) and the words they had, which organise finds again in the take. No part = the whole beat. */
  part?: BeatPart;
};

/** One sentence of a long beat as recorded. */
export type BeatSentence = { text: string; seconds: number };
/** The sentences of its long beat a short's beat keeps. */
export type BeatPart = { first: number; last: number; said: string };

/** One video's worth: the long cut, or a short. */
export type Cut = {
  id: string;
  kind: "long" | "short";
  title: string;
  /** A short: its first line, on screen from frame one. */
  hook?: string;
  /** Claude's one line on why this works as a video. */
  why?: string;
  /** A short (docs/design/desk-shorts.md): what its hook has to say for the first beat to land (the opener it replaces), if anything. */
  check?: string;
  /** A short Claude offered as a near miss: what's wrong with it. */
  problem?: string;
  /** A short made of more than one piece of the long cut: why each seam reads as one piece of speech, the meaning kept. */
  join?: string;
  /** A binned short: why, in Tom's words (desk-shorts.md § 6); the finder and Reshape read it. */
  binReason?: string;
  /** A short made by Reshape: the short it was reshaped from. */
  reshapedFrom?: string;
  /** The judge's score, 1–10: how sure it is a stranger watches to the end and taps the profile. */
  score?: number;
  /** A short: the hook lines Claude offered (desk-shorts.md § 2), each with where it came from ("your line, beat 12" or "new words"). */
  hookDrafts?: { text: string; source: string }[];
  /** A short: suggested (Claude's, not yet Tom's call), kept, or binned (hidden, but Find more knows not to offer it again). */
  state?: "suggested" | "kept" | "binned";
  /** A short (docs/design/desk-shorts.md § 5): its words for the platforms, written by Claude when it's rendered, Tom's to change. The Queue reads them from here. */
  post?: ShortPost;
  beats: Beat[];
};

/** A short's post copy: the title (Shorts), one description for every platform (fits X's 280), and the tags for YouTube Studio's box. */
export type ShortPost = { title: string; description: string; tags: string };

/** A source the cuts were made from, kept: every rewrite or adjust snapshots the text it ran on. */
export type SourceVersion = { at: string; text: string };

/**
 * A recording of Tom reading the script, with its words and the parts of it
 * he's kept (no `keep` = all of it). `assign`: the beats Tom says it reads
 * (ids, in order), for when the matcher didn't hear them: it then reads
 * those and only those. `spans`: where Tom dragged a beat to in this take
 * (beat id → take seconds), over what the matcher found; organise slices
 * exactly there.
 */
export type ScriptTake = Take & { keep?: { start: number; end: number }[]; assign?: string[]; spans?: Record<string, { start: number; end: number }> };

/**
 * The long video written up as an article for the studio site's dev log
 * (docs/design/desk-writeup.md): Claude drafts it from the long cut, Tom
 * edits it, Save to the site writes the markdown (and the chosen thumbnail
 * as its cover) into the site's content folder for him to commit.
 */
export type Writeup = {
  /** The page's title, for search: what it's about in words someone would type. */
  title: string;
  /** One or two sentences: the listing, the meta description, the social card. */
  description: string;
  /** The answer-first opening shown above the video: two or three sentences answering the title's question, for answer engines (ChatGPT search, Perplexity, AI Overviews) to quote. */
  summary?: string;
  /** The URL: /log/<slug>/. */
  slug: string;
  /** Markdown: paragraphs, ## headings, lists. No title line. */
  body: string;
  /** The YouTube video's id, once it's up (the page gets the player). Tom's to paste. */
  youtube?: string;
  /** The page's date (YYYY-MM-DD): the video's publish date, fetched when the link is pasted, Tom's to change. Unset = the first save's date. The dev log orders by it. */
  date?: string;
  /** The cover's picture: any of the thumbnail tries (under the game's public dir), drawn as glyphs with no words. Unset = the chosen thumbnail's. */
  cover?: string;
  /** When Claude last wrote it. */
  writtenAt: string;
  /** Where Save to the site last wrote it (paths from the repo root), with the date the page carries. */
  saved?: { at: string; date: string; file: string; cover?: string };
};

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
  sequences?: {
    id: string;
    cut: string;
    run: number;
    at: string;
    missing: number;
    conflicts: number;
    youtube?: string;
    /** A short's edit (desk-shorts.md § 3): the short it was organised from. Unset = the long video's. */
    short?: string;
    /** A short's render, once it's made: the library slug (its .mp4 and thumbnail under the renders dir). */
    render?: string;
  }[];
  /** Facts from real sources, pinned after Tom's sentences (docs/design/desk-research.md). The accepted ones are woven into what the rewrite reads. */
  research?: ScriptResearch;
  /** The long video's thumbnail ideas (docs/design/desk-thumbnails.md). */
  thumbnails?: ThumbnailIdea[];
  /** YouTube titles to test, beside the long cut's title (docs/design/desk-thumbnails.md). */
  titles?: TitleIdea[];
  /** The top of the long video's YouTube description and its tags, written by Claude, Tom's to change. The chapters go under it. */
  youtube?: { description: string; tags: string };
  /** The long video as an article for the site's dev log (docs/design/desk-writeup.md). */
  writeup?: Writeup;
  /** The world every picture lives in (a submarine crew, a lighthouse winter…): Claude picks it at the first plan, Tom can write his own. */
  theme?: string;
  /** What that world LOOKS like, in literal words: sent to the image model with every picture (it never sees the theme). Claude writes it at the plan; Tom's to change. */
  look?: string;
  /** The world's recurring characters, places and objects, each with one fixed look that's written out in every prompt they're in. */
  cast?: { name: string; look: string }[];
  /** A reference picture per cast member, by name (film style only): passed to the image model with every picture they're in, so they look the same all video. Valid while `look` matches the cast member's look; a changed look gets a fresh one. Server-owned: page saves never send it. */
  castRefs?: Record<string, CastRef>;
  /** How this script's pictures are made (cards.ts): "film" (black-and-white film stills with cast references, 11-05) or "woodcut" (the old chiaroscuro print). Unset: woodcut if any picture was made before film existed, else film. */
  pictureStyle?: PictureStyle;
  /** Looks thrown away by New look & cast (newest last, a few kept): the next plan is told to go somewhere else. Server-owned. */
  triedLooks?: string[];
  /** ISO timestamp once the video's made. */
  done?: string;
  createdAt: string;
  updatedAt: string;
};

/** What the list shows. */
export type ScriptSummary = Pick<Script, "id" | "title" | "done" | "createdAt" | "updatedAt"> & { hasSource: boolean; hasCuts: boolean; shorts: number; stale: boolean };

/** The story (one call) or the prompts (a batch of beats a call) running on the server; the page polls. Or how the last run failed. `done`/`total` are beats. */
export type PlanState = { state: "running"; stage: "story" | "prompts"; done: number; total: number; startedAt: string } | { state: "failed"; stage: "story" | "prompts"; error: string; done: number; total: number };
/** How a script's Find shorts run is going (docs/design/desk-shorts.md): nothing once it's landed; the failure until the next press. */
export type ShortsState = { state: "running"; startedAt: string; /** A Reshape of this short (desk-shorts.md § 6), not a whole find. */ short?: string } | { state: "failed"; error: string; short?: string };

/** A short runs this long, spoken (docs/design/desk-shorts.md): good ones are found, not trimmed to a length. */
export const SHORT_MIN = 20;
export const SHORT_MAX = 90;

export type ScriptPatch = Partial<Pick<Script, "title" | "source" | "long" | "shorts" | "gap" | "takes" | "thumbnails" | "titles" | "youtube" | "writeup" | "theme" | "look" | "cast" | "pictureStyle">> & { done?: boolean };

export const DEFAULT_GAP = 0.3;

/** A URL slug: lower case ascii words joined by hyphens, at most 80 characters. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");

/** A YYYY-MM-DD date, or "" for anything else. */
export const isoDate = (text: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !Number.isNaN(Date.parse(text.trim())) ? text.trim() : "");

/** A YouTube video id out of whatever Tom pasted: a watch URL, a youtu.be link, a Shorts link, or the id itself. */
export const youtubeId = (text: string): string => {
  const t = text.trim();
  const m = t.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/) ?? t.match(/^([A-Za-z0-9_-]{11})$/);
  return m?.[1] ?? "";
};

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
  shorts: s.shorts.filter((c) => c.state && c.state !== "binned").length,
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

/** A long beat's seconds as recorded (the last Find shorts measured it), else a guess from its words. */
export const beatSeconds = (b: Pick<Beat, "text" | "seconds">): number => b.seconds ?? spokenSeconds(b.text);

/** How long a short runs: its excerpt beats' recorded seconds, a part only its sentences' (a hook beat of its own is guessed from its words). */
export const shortSeconds = (s: Pick<Script, "long">, c: Pick<Cut, "beats">): number => {
  const long = new Map((s.long?.beats ?? []).map((b) => [b.id, b] as const));
  return Math.round(
    c.beats.reduce((n, b) => {
      if (!b.from) return n + beatSeconds(b);
      const lb = long.get(b.from) ?? b;
      if (!b.part) return n + beatSeconds(lb);
      return n + sentencesOf(lb).slice(b.part.first - 1, b.part.last).reduce((m, x) => m + x.seconds, 0);
    }, 0),
  );
};

/** The short's excerpt as long beat numbers (1-based) in the short's order (a beat cut into two pieces shows twice); nothing when it has no excerpt beats. */
export const shortBeats = (s: Pick<Script, "long">, c: Pick<Cut, "beats">): number[] => {
  const ids = (s.long?.beats ?? []).map((b) => b.id);
  return c.beats.flatMap((b) => (b.from ? [ids.indexOf(b.from) + 1] : [])).filter((n) => n > 0);
};

/** "5–7 + 12": the runs of long beats a short is made of. */
export const shortLabel = (ns: number[]): string => {
  const runs: number[][] = [];
  for (const n of ns) {
    const r = runs.at(-1);
    if (r && n === r[r.length - 1]! + 1) r.push(n);
    else runs.push([n]);
  }
  return runs.map((r) => (r.length > 1 ? `${r[0]}–${r[r.length - 1]}` : `${r[0]}`)).join(" + ");
};

/** A short made of these long beats (1-based numbers, in this order), word for word: each beat carries the long beat's id in `from`. */
export const excerpt = (s: Pick<Script, "long">, ns: number[]): Beat[] => {
  const long = s.long?.beats ?? [];
  return ns.flatMap((n) => {
    const b = long[n - 1];
    return b ? [{ id: newId(), text: b.text, from: b.id }] : [];
  });
};

// ── a short by sentence (desk-shorts.md § 6) ──

/** At most this many pieces in a short: more sounds stitched together. */
export const SHORT_PIECES = 4;

/** A sentence of the long cut: its long beat's number and the sentence's within it, both 1-based. */
export type SentenceRef = { n: number; k: number };

/** A long beat's sentences as recorded; a beat never measured counts as one sentence, its own words. */
export const sentencesOf = (b: Pick<Beat, "text" | "seconds" | "sentences">): BeatSentence[] => (b.sentences?.length ? b.sentences : [{ text: b.text, seconds: beatSeconds(b) }]);

/** The words a short's beat says: its part's as recorded, else its long beat's. */
export const pieceText = (s: Pick<Script, "long">, b: Beat): string => b.part?.said || beatText(s, b);

const sameRef = (a: SentenceRef | undefined, b: SentenceRef | undefined) => Boolean(a && b && a.n === b.n && a.k === b.k);
/** The sentence said straight after this one in the long cut. */
const nextRef = (long: Beat[], r: SentenceRef): SentenceRef | undefined => (r.k < sentencesOf(long[r.n - 1]!).length ? { n: r.n, k: r.k + 1 } : r.n < long.length ? { n: r.n + 1, k: 1 } : undefined);
/** The sentence said straight before it. */
const prevRef = (long: Beat[], r: SentenceRef): SentenceRef | undefined => (r.k > 1 ? { n: r.n, k: r.k - 1 } : r.n > 1 ? { n: r.n - 1, k: sentencesOf(long[r.n - 2]!).length } : undefined);

/** The short's excerpt as sentences of the long cut, in the order it says them. */
export const refsOf = (s: Pick<Script, "long">, c: Pick<Cut, "beats">): SentenceRef[] => {
  const long = s.long?.beats ?? [];
  const index = new Map(long.map((b, i) => [b.id, i] as const));
  return c.beats.flatMap((b) => {
    const i = b.from ? index.get(b.from) : undefined;
    if (i === undefined) return [];
    const count = sentencesOf(long[i]!).length;
    const first = b.part ? Math.max(1, Math.min(count, b.part.first)) : 1;
    const last = b.part ? Math.max(first, Math.min(count, b.part.last)) : count;
    return Array.from({ length: last - first + 1 }, (_, j) => ({ n: i + 1, k: first + j }));
  });
};

/** The short's pieces: runs of sentences said one straight after another in the long cut. */
export const piecesOf = (s: Pick<Script, "long">, refs: SentenceRef[]): SentenceRef[][] => {
  const long = s.long?.beats ?? [];
  const out: SentenceRef[][] = [];
  for (const r of refs) {
    const p = out.at(-1);
    if (p && sameRef(nextRef(long, p.at(-1)!), r)) p.push(r);
    else out.push([r]);
  }
  return out;
};

/** "12.3–14.2 + 9.6", or "5–7 + 12" where a piece is whole beats. */
export const refsLabel = (s: Pick<Script, "long">, refs: SentenceRef[]): string => {
  const long = s.long?.beats ?? [];
  const at = (r: SentenceRef) => `${r.n}.${r.k}`;
  return piecesOf(s, refs)
    .map((p) => {
      const a = p[0]!;
      const z = p.at(-1)!;
      if (a.k === 1 && z.k === sentencesOf(long[z.n - 1]!).length) return a.n === z.n ? `${a.n}` : `${a.n}–${z.n}`;
      return sameRef(a, z) ? at(a) : `${at(a)}–${at(z)}`;
    })
    .join(" + ");
};

/** A short's excerpt as its label. */
export const shortRefsLabel = (s: Pick<Script, "long">, c: Pick<Cut, "beats">): string => refsLabel(s, refsOf(s, c));

/** "12.3" a sentence; a bare "12" is the beat's first sentence (as a start) or its last (as an end). */
const parseRef = (s: Pick<Script, "long">, text: string, as: "start" | "end"): SentenceRef | undefined => {
  const long = s.long?.beats ?? [];
  const m = text.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const b = long[n - 1];
  if (!b) return undefined;
  const count = sentencesOf(b).length;
  const k = m[2] !== undefined ? Number(m[2]) : as === "start" ? 1 : count;
  return k >= 1 && k <= count ? { n, k } : undefined;
};

/** Pieces given as "from"–"to" sentence numbers → the sentences in the order said; undefined when one doesn't read (a number off the cut, an end before its start). */
export const refsOfPieces = (s: Pick<Script, "long">, pieces: { from: string; to: string }[]): SentenceRef[] | undefined => {
  const long = s.long?.beats ?? [];
  const out: SentenceRef[] = [];
  for (const p of pieces) {
    const a = parseRef(s, p.from, "start");
    const z = parseRef(s, p.to, "end");
    if (!a || !z || z.n < a.n || (z.n === a.n && z.k < a.k)) return undefined;
    for (let r: SentenceRef | undefined = a; r; r = sameRef(r, z) ? undefined : nextRef(long, r)) out.push(r);
  }
  return out;
};

/**
 * Sentences → a short's excerpt beats: one beat per run of sentences of the
 * same long beat said in order, whole (no part) when it's all of them. A
 * beat that was already that piece (or, failing that, of that long beat)
 * keeps its id.
 */
export const beatsFromRefs = (s: Pick<Script, "long">, refs: SentenceRef[], had: Beat[] = []): Beat[] => {
  const long = s.long?.beats ?? [];
  const groups: SentenceRef[][] = [];
  for (const r of refs) {
    const g = groups.at(-1);
    if (g && g.at(-1)!.n === r.n && r.k === g.at(-1)!.k + 1) g.push(r);
    else groups.push([r]);
  }
  const used = new Set<string>();
  return groups.flatMap((g) => {
    const lb = long[g[0]!.n - 1];
    if (!lb) return [];
    const sents = sentencesOf(lb);
    const first = g[0]!.k;
    const last = g.at(-1)!.k;
    const part: BeatPart | undefined = first === 1 && last === sents.length ? undefined : { first, last, said: sents.slice(first - 1, last).map((x) => x.text).join(" ") };
    const free = had.filter((b) => b.from === lb.id && !used.has(b.id));
    const was = free.find((b) => (b.part?.first ?? 1) === first && (b.part?.last ?? sents.length) === last) ?? free[0];
    const { part: _p, ...base } = was ?? { id: newId(), text: lb.text, from: lb.id };
    used.add(base.id);
    return [{ ...base, text: lb.text, ...(part ? { part } : {}) }];
  });
};

/** The short with these sentences as its excerpt; its own beats (a hook) stay in front. */
export const withRefs = (s: Pick<Script, "long">, c: Cut, refs: SentenceRef[]): Cut => ({ ...c, beats: [...c.beats.filter((b) => !b.from), ...beatsFromRefs(s, refs, c.beats.filter((b) => b.from))] });

/**
 * The short widened or narrowed by one sentence at either end
 * (desk-shorts.md § 6; a beat never measured is one sentence, so on an old
 * script that's still a beat): the sentence before its first (or after its
 * last) comes in, or the first (or last) goes. Nothing changes when the
 * nudge would run off the long cut, repeat a sentence, or leave none.
 */
export const nudgeShort = (s: Pick<Script, "long">, c: Cut, end: "start" | "end", by: 1 | -1): Cut => {
  const long = s.long?.beats ?? [];
  const refs = refsOf(s, c);
  if (!refs.length || !long.length) return c;
  let next: SentenceRef[];
  if (by === 1) {
    const add = end === "start" ? prevRef(long, refs[0]!) : nextRef(long, refs.at(-1)!);
    if (!add || refs.some((r) => sameRef(r, add))) return c;
    next = end === "start" ? [add, ...refs] : [...refs, add];
  } else {
    if (refs.length < 2) return c;
    next = end === "start" ? refs.slice(1) : refs.slice(0, -1);
  }
  return withRefs(s, c, next);
};

/** A sentence of one of the short's beats dropped, or brought back beside its neighbours in that beat. The last sentence never goes. */
export const toggleSentence = (s: Pick<Script, "long">, c: Cut, r: SentenceRef): Cut => {
  const refs = refsOf(s, c);
  const at = refs.findIndex((x) => sameRef(x, r));
  if (at >= 0) return refs.length > 1 ? withRefs(s, c, refs.filter((_, i) => i !== at)) : c;
  let before = -1;
  let after = -1;
  refs.forEach((x, i) => {
    if (x.n !== r.n) return;
    if (x.k < r.k && (before < 0 || x.k > refs[before]!.k)) before = i;
    if (x.k > r.k && (after < 0 || x.k < refs[after]!.k)) after = i;
  });
  const pos = before >= 0 ? before + 1 : after;
  if (pos < 0) return c;
  return withRefs(s, c, [...refs.slice(0, pos), r, ...refs.slice(pos)]);
};

/** The kept shorts' hook beats (a short's own beats, in front of its excerpt), for the prompter's Hooks list. */
export const hookBeats = (s: Pick<Script, "shorts">): { cut: Cut; beat: Beat }[] => s.shorts.filter((c) => c.state === "kept").flatMap((cut) => cut.beats.filter((b) => !b.from).map((beat) => ({ cut, beat })));

/**
 * The short with this hook: `hook` (the line on screen) and a hook beat of
 * its own in front of the excerpt (what the prompter reads). A hook beat
 * already there keeps its id with the new words (marked changed, so its
 * take wants checking); an empty hook takes the beat away.
 */
export const withHook = (c: Cut, text: string): Cut => {
  const hook = text.replace(/\s+/g, " ").trim();
  const own = c.beats.find((b) => !b.from);
  const rest = c.beats.filter((b) => b.from);
  if (!hook) return { ...c, hook: undefined, beats: rest };
  if (own?.text === hook) return { ...c, hook };
  return { ...c, hook, beats: [own ? { ...own, text: hook, changed: true } : { id: newId(), text: hook }, ...rest] };
};

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

// ── the write-up's sources (docs/design/desk-writeup.md) ──

/** Every source is a link: a note without one is never listed. */
export type SourceLink = { title: string; url: string };

const NOTES_HEADING = /^(sources?|references?|links|notes?)\b/i;

/**
 * The URL starting at `from`: up to whitespace, a quote mark or an unmatched
 * `)`, so a Wikipedia-style `Name_(thing)` keeps its brackets. Trailing
 * sentence punctuation is left off.
 */
const takeUrl = (line: string, from: number): string => {
  let depth = 0;
  let i = from;
  for (; i < line.length; i++) {
    const c = line[i]!;
    if (/[\s<>"\]]/.test(c)) break;
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return line.slice(from, i).replace(/[.,;:!?]+$/, "");
};

/**
 * A pasted URL fixed up, or undefined when it isn't a web address at all.
 * Copying a link out of a page sometimes doubles it up
 * (`site.com/page/49/!https:/site.com/the-article/`): the address after the
 * `!` is the real one. (Only after a `!`: archive and redirect links carry a
 * second address on purpose.)
 */
const cleanUrl = (raw: string): string | undefined => {
  const inner = raw.match(/\/!(https?:)\/{1,2}(?=[^/])/i);
  const url = inner ? `${inner[1]}//${raw.slice(inner.index! + inner[0].length)}` : raw;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
};

/** Google's backslash escapes (`\$300`) and bold/underline marks off a title. */
const plainTitle = (t: string): string => t.replace(/\\([!-/:-@[-`{-~])/g, "$1").replace(/\*\*|__/g, "").trim();

/** The first markdown link in a line, brackets in the URL and all. */
const mdLink = (line: string): { title: string; url: string } | undefined => {
  const m = /\[([^\]\n]+)\]\((?=https?:)/i.exec(line);
  if (!m) return undefined;
  return { title: m[1]!, url: takeUrl(line, m.index + m[0].length) };
};

/**
 * The article's Sources: the author's own notes (a Sources section, quoted
 * lines) that carry a link, plus the sources of the research findings he
 * accepted. Nothing is invented: a markdown link keeps its words, a bare URL
 * is titled by its site. A note with no working URL isn't a source (quoted
 * lines are also on-screen lists and asides), so it's left out. One entry per
 * URL.
 */
export const sourcesList = (s: Pick<Script, "source" | "research">): SourceLink[] => {
  const out: SourceLink[] = [];
  const seen = new Set<string>();
  const add = (x: { title: string; url: string }) => {
    const url = cleanUrl(x.url);
    const title = plainTitle(x.title);
    if (!url || !title) return;
    const key = url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, url });
  };
  for (const line of sourceNotes(s.source)) {
    const link = mdLink(line);
    if (link) {
      add(link);
      continue;
    }
    const at = line.search(/https?:\/\//i);
    if (at < 0) continue;
    const url = takeUrl(line, at);
    const rest = line.replace(url, "").replace(/[\s:\-–,|.]+$/, "").replace(/^[\s:\-–,|]+/, "").trim();
    let title = rest;
    if (!title) {
      try {
        const u = new URL(url);
        const path = decodeURIComponent(u.pathname).replace(/\/$/, "").split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ").replace(/\.[a-z]+$/i, "");
        title = path ? `${u.hostname.replace(/^www\./, "")}: ${path}` : u.hostname.replace(/^www\./, "");
      } catch {
        title = url;
      }
    }
    add({ title, url });
  }
  for (const f of s.research?.findings ?? []) {
    if (f.status !== "accepted" || f.stance === "refutes") continue;
    const title = f.source.publisher && !f.source.title.toLowerCase().includes(f.source.publisher.toLowerCase()) ? `${f.source.title} (${f.source.publisher})` : f.source.title;
    add({ title, url: f.source.url });
  }
  return out;
};

/** The Sources section as markdown, or "" with nothing to list. Plain links: these are the author's own citations, so no nofollow. Brackets in a URL are percent-encoded so no markdown reader cuts the link short. */
export const sourcesMarkdown = (list: SourceLink[]): string => (list.length ? ["## Sources", "", ...list.map((x) => `- [${x.title.replace(/[[\]]/g, "")}](${x.url.replace(/\(/g, "%28").replace(/\)/g, "%29")})`)].join("\n") : "");

/**
 * The Sources section as YouTube's description wants it: plain text (it
 * shows no markdown, and refuses < and >), one "title: link" a line, under a
 * "Sources" line. YouTube makes the bare URLs clickable. "" with nothing to list.
 */
export const sourcesForYouTube = (list: SourceLink[]): string => (list.length ? ["Sources", ...list.map((x) => `${x.title.replace(/[<>]/g, "").trim()}: ${x.url}`)].join("\n") : "");

/** The body with any Sources section taken off (the save puts the real one back on the end). */
export const withoutSources = (body: string): string => {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => /^##\s+/.test(l) && NOTES_HEADING.test(l.replace(/^##\s+/, "").trim()));
  if (at < 0) return body.trim();
  const end = lines.findIndex((l, i) => i > at && /^##\s+/.test(l));
  return [...lines.slice(0, at), ...(end < 0 ? [] : lines.slice(end))].join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

// ── the write-up's pictures (docs/design/desk-writeup.md) ──

export type ArticlePicture = {
  /** The heading it goes under, as written in the article. */
  heading: string;
  /** The line's index in the body. */
  line: number;
  beat: string;
  /** The beat's chosen picture, under the game's public dir. */
  src: string;
  alt: string;
};

const headingKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * One picture per `##` heading in the article: the heading's chapter's first
 * beat with a chosen picture; a heading that matches no chapter takes the
 * unused one nearest its position. The alt text is the beat's scene line.
 * No headings, no pictures (the page has the cover).
 */
export const articlePictures = (s: Pick<Script, "long">, body: string): ArticlePicture[] => {
  const beats = s.long?.beats ?? [];
  const lines = body.split("\n");
  const headings = lines.flatMap((l, i) => {
    const m = l.match(/^##\s+(.+?)\s*$/);
    return m && !NOTES_HEADING.test(m[1]!) ? [{ text: m[1]!, line: i }] : [];
  });
  if (!headings.length || !beats.length) return [];
  const pic = (b: Beat) => b.pictures?.find((p) => p.chosen)?.chosen;
  // Alt text: the scene line's first sentence, whole words, under 160 characters.
  const alt = (b: Beat) => {
    const line = (b.scene ?? b.pictures?.[0]?.prompt ?? "").replace(/\s+/g, " ").trim();
    const first = line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
    return first.length <= 160 ? first : `${first.slice(0, 160).replace(/\s+\S*$/, "")}…`;
  };
  const used = new Set<string>();
  const out: (ArticlePicture | undefined)[] = headings.map(() => undefined);
  // Chapters first: the heading that is a chapter takes that chapter's picture.
  const chapterStarts = beats.flatMap((b, i) => (b.chapter?.trim() ? [{ key: headingKey(b.chapter), at: i }] : []));
  headings.forEach((h, hi) => {
    const start = chapterStarts.find((c) => c.key === headingKey(h.text));
    if (!start) return;
    const end = chapterStarts.find((c) => c.at > start.at)?.at ?? beats.length;
    const b = beats.slice(start.at, end).find((x) => pic(x) && !used.has(x.id));
    if (!b) return;
    used.add(b.id);
    out[hi] = { heading: h.text, line: h.line, beat: b.id, src: pic(b)!, alt: alt(b) };
  });
  // The rest: the unused picture nearest the heading's place in the piece.
  headings.forEach((h, hi) => {
    if (out[hi]) return;
    const want = ((hi + 0.5) / headings.length) * beats.length;
    const b = beats
      .map((x, i) => ({ x, d: Math.abs(i - want) }))
      .filter(({ x }) => pic(x) && !used.has(x.id))
      .sort((a, c) => a.d - c.d)[0]?.x;
    if (!b) return;
    used.add(b.id);
    out[hi] = { heading: h.text, line: h.line, beat: b.id, src: pic(b)!, alt: alt(b) };
  });
  return out.flatMap((p) => (p ? [p] : []));
};

/** The long video's edits only: a short's edit sits on its own card on the Shorts stage. */
export const longEdits = (s: Pick<Script, "sequences">) => (s.sequences ?? []).filter((x) => !x.short);

/**
 * The words the Queue shows for a render of one of the script's edits
 * (desk-shorts.md § 5): a short's post copy (its title and hook until
 * Claude has written it), or the long video's title, YouTube description
 * with the chapters and then the sources under it, and tags. `written` = Claude's words are in.
 */
export type SequenceWords = { cut: "long" | "short"; short?: string; title: string; description: string; tags: string; written: boolean };
export const sequenceWords = (s: Pick<Script, "long" | "shorts" | "sequences" | "youtube" | "source" | "research">, seqId: string): SequenceWords | undefined => {
  const seq = (s.sequences ?? []).find((x) => x.id === seqId);
  if (!seq) return undefined;
  if (seq.short) {
    const c = s.shorts.find((x) => x.id === seq.short);
    if (!c) return undefined;
    const p = c.post;
    return { cut: "short", short: c.id, title: p?.title || c.title, description: p?.description || c.hook || "", tags: p?.tags ?? "", written: Boolean(p) };
  }
  const description = [s.youtube?.description.trim(), seq.youtube?.trim(), sourcesForYouTube(sourcesList(s))].filter(Boolean).join("\n\n");
  return { cut: "long", title: s.long?.title ?? "", description, tags: s.youtube?.tags ?? "", written: Boolean(s.youtube) };
};

/**
 * A short as its render organises it (desk-shorts.md § 3): each excerpt beat
 * carries its long beat's picture, mood, pulled words and story line (the
 * words are the long beat's already), no chapters; the hook beat shows the
 * first excerpt beat's picture (one build, bursting in under the hook) and
 * sits under its mood. Ids and `from` stay, so the takes still read it.
 */
export const renderableShort = (s: Pick<Script, "long">, c: Cut): Cut => {
  const long = new Map((s.long?.beats ?? []).map((b) => [b.id, b]));
  const first = c.beats.find((b) => b.from);
  const of = (b: Beat): Beat | undefined => (b.from ? long.get(b.from) : undefined);
  const lead = first ? of(first) : undefined;
  return {
    ...c,
    beats: c.beats.map((b): Beat => {
      const { chapter: _c, ...rest } = b;
      const src = of(b) ?? (b.from ? undefined : lead);
      if (!src) return rest;
      const { id: _id, text: _t, from: _f, changed: _ch, chapter: _chap, card: _card, sentences: _se, part: _pa, ...carry } = src;
      // The hook beat borrows the picture and mood, not the words to pull (they're the first beat's to say); a part pulls only words it says.
      if (!b.from) return { ...carry, pulled: undefined, ...rest };
      const said = b.part?.said.toLowerCase();
      return { ...carry, ...rest, ...(said && carry.pulled ? { pulled: carry.pulled.filter((w) => said.includes(w.toLowerCase())) } : {}) };
    }),
  };
};

/** Where a short's render stands (this Desk run), by short id: the score being written, then the render job's own states. */
export type ShortRender = { state: "scoring" | "queued" | "bundling" | "rendering" | "done" | "failed"; progress: number; error?: string; seq?: string; slug?: string };
