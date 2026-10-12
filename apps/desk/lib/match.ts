/**
 * Which beats of a script a take reads, and where in the take each one
 * starts (docs/design/desk-scripts.md § Organise). Pure: words in, covers
 * out. The prompter ticks beats off with it as takes land; organise
 * slices the takes with it.
 *
 * The take's words (only those inside its kept regions) and the beats'
 * words are both normalised the same way (scripts.ts `tokens`), and a
 * longest-common-subsequence alignment of the take against all the beats
 * in order says, for every beat, how many of its words were heard in
 * order and when the first and last of them were said. A beat counts as
 * COVERED when most of its words were (the threshold is a dial; 0.7 to
 * start). Nothing here picks between two takes that cover the same beat:
 * that's shown and left to Tom (decision 4).
 */
import type { Take, Word } from "@heroic/voiceover";
import { type Script, beatText, cutsOf, tokens } from "./scripts";

export type Span = { start: number; end: number };

/** A beat as the matcher sees it. */
export type BeatWords = { id: string; text: string };

/** One beat a take reads: where in the take it starts and ends, and how much of it was heard (0–1). */
export type Cover = { beat: string; start: number; end: number; score: number };

/** The share of a beat's words that must be heard, in order, for it to count as read. */
export const COVER_THRESHOLD = 0.7;
/** A beat this short (tokens) is a heading or a line; it only counts when read on its own, a pause either side, not as a phrase inside a longer beat. */
const SHORT_BEAT = 5;
const PAUSE = 0.4;

/** The words of a take that survive its kept regions (no regions = the whole take). */
export const keptWords = (take: Pick<Take, "words"> & { keep?: Span[] }): Word[] => {
  const keep = take.keep;
  if (!keep?.length) return take.words;
  return take.words.filter((w) => keep.some((k) => w.start >= k.start - 1e-3 && w.end <= k.end + 1e-3));
};

/** The kept regions as they'd be after one is cut out. Regions never overlap and stay sorted. */
export const cutRegion = (keep: Span[] | undefined, seconds: number, cut: Span): Span[] => {
  const base = keep?.length ? keep : [{ start: 0, end: seconds }];
  const out: Span[] = [];
  for (const k of base) {
    if (cut.end <= k.start || cut.start >= k.end) {
      out.push(k);
      continue;
    }
    if (cut.start > k.start) out.push({ start: k.start, end: cut.start });
    if (cut.end < k.end) out.push({ start: cut.end, end: k.end });
  }
  return out.filter((k) => k.end - k.start > 0.02);
};

/** The kept regions with the edges set: everything before `start` and after `end` is out. */
export const trimRegion = (keep: Span[] | undefined, seconds: number, start: number, end: number): Span[] => {
  const base = keep?.length ? keep : [{ start: 0, end: seconds }];
  return base.map((k) => ({ start: Math.max(k.start, start), end: Math.min(k.end, end) })).filter((k) => k.end - k.start > 0.02);
};

/** Seconds a take plays for, kept regions only. */
export const keptSeconds = (take: Pick<Take, "seconds"> & { keep?: Span[] }): number => (take.keep?.length ? take.keep.reduce((s, k) => s + (k.end - k.start), 0) : take.seconds);

/** The alignment's scoring: a word heard in place, a word wrong, a word skipped on either side. */
const MATCH = 1;
const MISMATCH = -1;
const GAP = -0.6;

/** The best stretch of the take that reads this beat (a local alignment): how many of its words were heard in order, and which heard words bracket it. */
const findBeat = (A: string[], Bt: string[], gaps?: boolean[]): { matches: number; from: number; to: number } | undefined => {
  const n = A.length;
  const m = Bt.length;
  if (!n || !m) return undefined;
  const W = m + 1;
  const H = new Float32Array((n + 1) * W);
  // 0 = stop, 1 = diagonal (a pair), 2 = up (a heard word skipped), 3 = left (a beat word skipped)
  const D = new Uint8Array((n + 1) * W);
  let best = 0;
  let bi = 0;
  let bj = 0;
  for (let i = 1; i <= n; i++) {
    const a = A[i - 1];
    for (let j = 1; j <= m; j++) {
      const diag = H[(i - 1) * W + j - 1]! + (a === Bt[j - 1] ? MATCH : MISMATCH);
      const up = H[(i - 1) * W + j]! + GAP;
      const left = H[i * W + j - 1]! + GAP;
      let v = 0;
      let d = 0;
      if (diag > v) {
        v = diag;
        d = 1;
      }
      if (up > v) {
        v = up;
        d = 2;
      }
      if (left > v) {
        v = left;
        d = 3;
      }
      H[i * W + j] = v;
      D[i * W + j] = d;
      if (v > best) {
        best = v;
        bi = i;
        bj = j;
      }
    }
  }
  if (best <= 0) return undefined;
  // Walk back from the best cell to where the stretch began, counting the words that paired up.
  let i = bi;
  let j = bj;
  let matches = 0;
  let from = bi - 1;
  while (i > 0 && j > 0) {
    const d = D[i * W + j];
    if (d === 0) break;
    if (d === 1) {
      if (A[i - 1] === Bt[j - 1]) {
        matches++;
        from = i - 1;
      }
      i--;
      j--;
    } else if (d === 2) i--;
    else j--;
  }
  // The alignment stops at the last word that paired: a beat ending on a word heard differently ("…the other three players" read as "3 players")
  // would lose its tail. Take in as many more heard words as the beat had left, so long as there's no pause before them.
  let to = bi - 1;
  for (let left = m - bj; left > 0 && to + 1 < n && !(gaps?.[to + 1] ?? false); left--) to++;
  return { matches, from, to };
};

/**
 * Where in the take each beat is read. Each beat is aligned on its own
 * to the best-matching stretch of the take (a local alignment, so one
 * take's words can't be scattered across the script's earlier beats, and
 * a beat that occurs anywhere in the take is found). Two beats that claim
 * overlapping stretches of the take keep the one with more words heard.
 */
export const matchTake = (take: Pick<Take, "words"> & { keep?: Span[] }, beats: BeatWords[], threshold = COVER_THRESHOLD): Cover[] => {
  const heard = keptWords(take).filter((w) => !w.hidden);
  const A = heard.map((w) => tokens(w.text).join(""));
  if (!A.length) return [];
  // A pause before each heard word.
  const gaps = heard.map((w, i) => i > 0 && w.start - heard[i - 1]!.end >= PAUSE);
  type Found = Cover & { from: number; to: number; matches: number };
  const found: Found[] = [];
  for (const b of beats) {
    const Bt = tokens(b.text);
    if (!Bt.length) continue;
    const f = findBeat(A, Bt, gaps);
    if (!f) continue;
    const score = f.matches / Bt.length;
    if (score < threshold) continue;
    if (Bt.length <= SHORT_BEAT) {
      const before = f.from === 0 || heard[f.from]!.start - heard[f.from - 1]!.end >= PAUSE;
      const after = f.to === heard.length - 1 || heard[f.to + 1]!.start - heard[f.to]!.end >= PAUSE;
      if (!before || !after) continue;
    }
    found.push({ beat: b.id, start: heard[f.from]!.start, end: heard[f.to]!.end, score: Math.round(score * 100) / 100, from: f.from, to: f.to, matches: f.matches });
  }
  // Overlapping claims on the same stretch of the take: the beat with more words heard keeps it.
  const kept: Found[] = [];
  for (const f of [...found].sort((a, b) => b.matches - a.matches || a.from - b.from)) {
    const clash = kept.some((k) => {
      const overlap = Math.min(f.to, k.to) - Math.max(f.from, k.from) + 1;
      return overlap > 0 && overlap >= 0.3 * Math.min(f.to - f.from + 1, k.to - k.from + 1);
    });
    if (!clash) kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start).map(({ from: _f, to: _t, matches: _m, ...c }) => c);
};

/**
 * A take against the whole script: aligned to each cut in that cut's
 * order (a short's own opening followed by a long beat reads in the
 * short's order, not the long cut's), the covers merged by beat with the
 * best score kept. A short's shared beat counts as the long beat.
 */
export const matchScript = (take: Pick<Take, "words" | "seconds"> & { keep?: Span[]; assign?: string[] }, s: Pick<Script, "long" | "shorts">, threshold = COVER_THRESHOLD): Cover[] => {
  if (take.assign?.length) return assignedCovers(take, s);
  const best = new Map<string, Cover>();
  for (const cut of cutsOf(s)) {
    const beats = cut.beats.map((b) => ({ id: b.from ?? b.id, text: beatText(s, b) }));
    for (const c of matchTake(take, beats, threshold)) {
      const was = best.get(c.beat);
      if (!was || c.score > was.score) best.set(c.beat, c);
    }
  }
  return [...best.values()].sort((a, b) => a.start - b.start);
};

/**
 * A take Tom has said reads certain beats (the matcher didn't hear them):
 * it covers exactly those, in order, across its kept part. One beat takes
 * the lot. Several are placed where the alignment finds them, however
 * faintly; one it can't find at all shares out what's left between its
 * neighbours.
 */
export const assignedCovers = (take: Pick<Take, "words" | "seconds"> & { keep?: Span[]; assign?: string[] }, s: Pick<Script, "long" | "shorts">): Cover[] => {
  const all = cutsOf(s).flatMap((c) => c.beats.map((b) => ({ id: b.from ?? b.id, text: beatText(s, b) })));
  const beats = (take.assign ?? []).flatMap((id) => all.find((b) => b.id === id) ?? []);
  if (!beats.length) return [];
  const words = keptWords(take);
  const keep = take.keep?.length ? take.keep : [{ start: 0, end: take.seconds }];
  // The kept part: from the first word heard to the last (or the kept edges when nothing was heard).
  const from = words[0]?.start ?? keep[0]!.start;
  const to = words.at(-1)?.end ?? keep.at(-1)!.end;
  if (beats.length === 1) return [{ beat: beats[0]!.id, start: from, end: to, score: 1 }];
  const found = new Map(matchTake(take, beats, 0.01).map((c) => [c.beat, c]));
  const starts: (number | undefined)[] = beats.map((b) => found.get(b.id)?.start);
  starts[0] = from;
  // Fill the gaps evenly between the starts the alignment did find.
  for (let i = 1; i < beats.length; i++) {
    if (starts[i] !== undefined && starts[i]! > starts[i - 1]!) continue;
    let j = i;
    while (j < beats.length && (starts[j] === undefined || starts[j]! <= starts[i - 1]!)) j++;
    const end = j < beats.length ? starts[j]! : to;
    const step = (end - starts[i - 1]!) / (j - i + 1);
    for (let k = i; k < j; k++) starts[k] = starts[k - 1]! + step;
  }
  return beats.map((b, i) => ({ beat: b.id, start: starts[i]!, end: i + 1 < beats.length ? starts[i + 1]! : to, score: found.get(b.id)?.score ?? 0 }));
};

/** A pause longer than this inside a take is shortened by the auto trim… */
export const LONG_PAUSE = 0.7;
/** …to about this. */
const KEEP_PAUSE = 0.4;

/**
 * The tidy-up a take gets without Tom touching it: the silence off both
 * ends (to just before the first word and just after the last) and,
 * with `pauses`, every pause longer than LONG_PAUSE between two words cut
 * down to about KEEP_PAUSE. Works on what's already kept, so cuts Tom
 * made by hand stay; running it again changes nothing. Undefined = no
 * words to go by (left as it is).
 */
export const autoTrim = (take: Pick<Take, "words" | "seconds"> & { keep?: Span[] }, pauses = true): Span[] | undefined => {
  const words = keptWords(take).filter((w) => !w.hidden);
  if (!words.length) return take.keep;
  let keep = trimRegion(take.keep, take.seconds, Math.max(0, words[0]!.start - 0.15), Math.min(take.seconds, words.at(-1)!.end + 0.2));
  if (pauses)
    for (let i = 1; i < words.length; i++) {
      const gap = words[i]!.start - words[i - 1]!.end;
      if (gap > LONG_PAUSE) keep = cutRegion(keep, take.seconds, { start: words[i - 1]!.end + KEEP_PAUSE / 2, end: words[i]!.start - KEEP_PAUSE / 2 });
    }
  return keep;
};
