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
const findBeat = (A: string[], Bt: string[]): { matches: number; from: number; to: number } | undefined => {
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
  return { matches, from, to: bi - 1 };
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
  type Found = Cover & { from: number; to: number; matches: number };
  const found: Found[] = [];
  for (const b of beats) {
    const Bt = tokens(b.text);
    if (!Bt.length) continue;
    const f = findBeat(A, Bt);
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
export const matchScript = (take: Pick<Take, "words"> & { keep?: Span[] }, s: Pick<Script, "long" | "shorts">, threshold = COVER_THRESHOLD): Cover[] => {
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
