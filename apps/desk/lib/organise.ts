/**
 * ORGANISE (docs/design/desk-scripts.md § Organise): the takes → one
 * sequence per cut. Pure: a script and the covers in, a sequence out.
 *
 * For each beat of the cut, in order: the one take that reads it
 * (two = a CONFLICT, shown and left: nothing is picked for Tom; none =
 * MISSING, skipped), sliced from where the beat starts in the take to
 * where the next beat starts in the same take (or the take's kept end),
 * laid on the audio track one after another with `gap` seconds between.
 * A slice takes in the whole run of speech round the beat's words, not just
 * the words the script has, and keeps out what the take's trim cut (a
 * shortened pause): one clip per kept piece, back to back.
 * The beat's card lands on the overlay at the beat's start: its chosen
 * picture as a BUILD (docs/design/desk-ascii-scripts.md; two pictures on a
 * long beat, split at the sentence break nearest its middle), or on an
 * older script its text card or sketch, lasting until the next card (a
 * b-roll slot until its beat ends). A marker at every beat start. The video tracks are empty: that's
 * the editor's job, after.
 */
import { type AudioClip, type Card, type Sequence, type Take, type Word, emptySequence, newId } from "@heroic/voiceover";
import { type Cover, KEEP_AFTER, type Span, keptWords } from "./match";
import { CHAPTER_CARD } from "@heroic/ascii-build";
import { type Beat, type Cut, type Script, allowedChapters, cardOfBeat } from "./scripts";

export type Organised = {
  seq: Sequence;
  /** Beats no take reads. */
  missing: string[];
  /** Beats more than one take reads: the beat and the takes (by file). */
  conflicts: { beat: string; takes: string[] }[];
  /** Where each chapter starts, in edit seconds (the first beat's, if it opens one, at 0). */
  chapters: { name: string; at: number }[];
};

/** A little of the take before the first word, so a slice doesn't start on a consonant… */
const LEAD = 0.12;
/** …and after the last, the trim's own margin, which a closing "t" needs (see KEEP_AFTER). */
const TAIL = KEEP_AFTER;
/** Where to cut between two words not said in one breath: TAIL after the first, LEAD before the second, the pause shared out in that proportion when it's too short for both. */
const between = (a: Word, b: Word) => {
  const k = Math.min(1, Math.max(0, b.start - a.end) / (TAIL + LEAD));
  return { end: a.end + TAIL * k, start: b.start - LEAD * k };
};
/** Words closer than this are one run of speech: a slice takes in all of a run, never part of one. */
const JOINED = 0.4;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Where a beat's slice of a take starts and ends, in take seconds. The
 * cover only runs from the first to the last word the script has, so it's
 * widened over the words said in the same breath either side (an "And" or
 * "To be fair," Tom added, a number heard as digits at the end). Words that
 * run on into another beat's cover belong to that beat.
 */
export const sliceOf = (take: Script["takes"][number], cover: Cover, covers: Cover[]): Span => {
  const words = keptWords(take);
  const claimed = (w: Word) => covers.some((c) => c.beat !== cover.beat && w.start >= c.start - 1e-3 && w.end <= c.end + 1e-3);
  const joined = (a: Word, b: Word) => b.start - a.end < JOINED;
  let i = words.findIndex((w) => w.start >= cover.start - 1e-3);
  let j = words.findLastIndex((w) => w.end <= cover.end + 1e-3);
  if (i < 0 || j < i) return { start: Math.max(0, cover.start - LEAD), end: Math.min(take.seconds, cover.end + TAIL) };
  while (i > 0 && !claimed(words[i - 1]!) && joined(words[i - 1]!, words[i]!)) i--;
  let k = j;
  while (k + 1 < words.length && !claimed(words[k + 1]!) && joined(words[k]!, words[k + 1]!)) k++;
  if (!(k + 1 < words.length && claimed(words[k + 1]!) && joined(words[k]!, words[k + 1]!))) j = k;
  const first = words[i]!;
  const last = words[j]!;
  const before = words[i - 1];
  const after = words[j + 1];
  return {
    start: r3(Math.max(0, first.start - LEAD, before ? between(before, first).start : 0)),
    end: r3(Math.min(take.seconds, last.end + TAIL, after ? between(last, after).end : Infinity)),
  };
};

/** start..end of a take with what its trim cut taken out: the kept pieces, in order. */
const keptPieces = (take: Script["takes"][number], start: number, end: number): Span[] =>
  (take.keep?.length ? take.keep : [{ start: 0, end: take.seconds }])
    .map((k) => ({ start: r3(Math.max(k.start, start)), end: r3(Math.min(k.end, end)) }))
    .filter((k) => k.end - k.start > 0.02);

/** Seconds into a slice that a moment of the take lands, the cut pieces taken out. */
const intoSlice = (pieces: Span[], t: number) => pieces.reduce((s, p) => s + Math.max(0, Math.min(p.end, t) - p.start), 0);

/**
 * Where a slice of a take (start..end, take seconds) is best split in two:
 * after the sentence-ending word nearest its middle (within the middle 60%),
 * else the middle. Seconds from `start`.
 */
export const splitPoint = (words: { text: string; start: number; end: number }[], start: number, end: number): number => {
  const mid = (start + end) / 2;
  const len = end - start;
  let best: number | undefined;
  for (const w of words) {
    if (!/[.!?]["”’)]*$/.test(w.text.trim()) || w.end <= start + len * 0.2 || w.end >= end - len * 0.2) continue;
    if (best === undefined || Math.abs(w.end - mid) < Math.abs(best - mid)) best = w.end;
  }
  return r3((best ?? mid) - start);
};

export const organiseCut = (s: Script, cut: Cut, covers: Map<string, Cover[]>, opts: { id: string; name: string }): Organised => {
  const seq: Sequence = { ...emptySequence(opts.id, opts.name), idea: s.id, ...(cut.title.trim() ? { title: cut.title.trim() } : {}), takes: s.takes.map(({ keep: _k, ...t }): Take => t) };
  // Chapters the rules allow (desk-ascii-scripts.md); one on a beat nobody read moves to the next beat that's in.
  const allowed = allowedChapters(cut.beats);
  const chapters: Organised["chapters"] = [];
  let pendingChapter: string | undefined;
  const missing: string[] = [];
  const conflicts: Organised["conflicts"] = [];
  const audio: AudioClip[] = [];
  const cards: Card[] = [];
  const markers: { id: string; at: number }[] = [];
  const beatId = (b: Beat) => b.from ?? b.id;
  // Where each beat is read: every (take, cover) that reads it.
  const reads = (b: Beat) => s.takes.flatMap((t, i) => (covers.get(t.file) ?? []).filter((c) => c.beat === beatId(b)).map((c) => ({ take: i, file: t.file, cover: c })));
  let cursor = 0;
  let lastCard: Card | undefined;
  cut.beats.forEach((b, k) => {
    const r = reads(b);
    if (allowed.has(b.id)) pendingChapter = b.chapter!.trim();
    if (!r.length) {
      missing.push(b.id);
      return;
    }
    if (r.length > 1) {
      conflicts.push({ beat: b.id, takes: r.map((x) => x.file) });
      return;
    }
    const { take, cover } = r[0]!;
    const tk = s.takes[take]!;
    const inTake = covers.get(tk.file) ?? [];
    // The slice: from just before the beat's first word to where the next beat starts in this same take, else just after its last word.
    const next = cut.beats[k + 1];
    const nextHere = next ? reads(next).find((x) => x.take === take && x.cover.start > cover.start) : undefined;
    const { start } = sliceOf(tk, cover, inTake);
    const end = nextHere ? sliceOf(tk, nextHere.cover, inTake).start : sliceOf(tk, cover, inTake).end;
    const pieces = keptPieces(tk, start, end);
    const seconds = pieces.reduce((n, p) => n + (p.end - p.start), 0);
    if (seconds < 0.1) {
      missing.push(b.id);
      return;
    }
    // A chapter opens here: a silent gap with its card (the first beat's needs none: the title opens the video).
    if (pendingChapter !== undefined) {
      if (audio.length) {
        const ch: Card = { id: newId(), kind: "chapter", text: pendingChapter, n: chapters.length + 1, at: r3(cursor), seconds: CHAPTER_CARD, place: "full", beat: b.id };
        if (lastCard && lastCard.kind !== "broll") lastCard.seconds = r3(ch.at - lastCard.at);
        cards.push(ch);
        lastCard = ch;
        cursor = ch.at + CHAPTER_CARD;
      }
      chapters.push({ name: pendingChapter, at: r3(cursor) });
      pendingChapter = undefined;
    }
    const at = r3(cursor);
    let laid = at;
    for (const p of pieces) {
      audio.push({ id: newId(), take, start: p.start, end: p.end, at: r3(laid) });
      laid += p.end - p.start;
    }
    markers.push({ id: newId(), at });
    // The beat's pictures, as glyph builds.
    const pics = (b.pictures ?? []).filter((p) => p.chosen);
    if (pics.length) {
      if (lastCard && lastCard.kind !== "broll" && lastCard.kind !== "chapter") lastCard.seconds = r3(at - lastCard.at);
      const split = pics.length > 1 ? r3(at + intoSlice(pieces, start + splitPoint(tk.words, start, end))) : at + seconds;
      pics.slice(0, 2).forEach((p, k) => {
        const from = k ? split : at;
        const to = k || pics.length === 1 ? at + seconds : split;
        const card: Card = { id: newId(), kind: "build", src: p.chosen!, seed: p.look, ...(b.pulled?.length ? { pulled: b.pulled } : {}), at: r3(from), seconds: r3(to - from), place: "full", beat: b.id };
        cards.push(card);
        lastCard = card;
      });
      cursor = at + seconds + s.gap;
      return;
    }
    // An older script's plan.
    const plan = cardOfBeat(s, b);
    if (plan && plan.kind !== "none") {
      if (lastCard && lastCard.kind !== "broll") lastCard.seconds = r3(at - lastCard.at);
      const card: Card = plan.kind === "text" ? { id: newId(), kind: "text", text: plan.text ?? "", at, seconds: r3(seconds), place: "full", beat: b.id } : plan.kind === "sketch" ? { id: newId(), kind: "image", src: plan.src ?? "", at, seconds: r3(seconds), place: "full", beat: b.id } : { id: newId(), kind: "broll", note: plan.note ?? "", at, seconds: r3(seconds), place: "full", beat: b.id };
      cards.push(card);
      lastCard = card;
    } else if (lastCard && lastCard.kind !== "broll" && lastCard.kind !== "chapter") lastCard.seconds = r3(at + seconds - lastCard.at);
    cursor = at + seconds + s.gap;
  });
  seq.audio = [{ id: "a1", clips: audio }];
  if (cards.length) seq.overlay = { id: "o1", cards: cards.filter((c) => c.seconds >= 0.3) };
  if (markers.length) seq.markers = markers;
  return { seq, missing, conflicts, chapters };
};
