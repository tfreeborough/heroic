/**
 * ORGANISE (docs/design/desk-scripts.md § Organise): the takes → one
 * sequence per cut. Pure: a script and the covers in, a sequence out.
 *
 * For each beat of the cut, in order: the one take that reads it
 * (two = a CONFLICT, shown and left: nothing is picked for Tom; none =
 * MISSING, skipped), sliced from where the beat starts in the take to
 * where the next beat starts in the same take (or the take's kept end),
 * laid on the audio track one after another with `gap` seconds between.
 * The beat's card lands on the overlay at the beat's start: a text card
 * or a sketch lasts until the next card, a b-roll slot until its beat
 * ends. A marker at every beat start. The video tracks are empty: that's
 * the editor's job, after.
 */
import { type AudioClip, type Card, type Sequence, type Take, emptySequence, newId } from "@heroic/voiceover";
import type { Cover } from "./match";
import { type Beat, type Cut, type Script, cardOfBeat } from "./scripts";

export type Organised = {
  seq: Sequence;
  /** Beats no take reads. */
  missing: string[];
  /** Beats more than one take reads: the beat and the takes (by file). */
  conflicts: { beat: string; takes: string[] }[];
};

/** A little of the take before the first word and after the last, so a slice doesn't start on a consonant. */
const LEAD = 0.12;
const TAIL = 0.18;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The kept region of a take that holds `t` (the whole take when none are set). */
const regionAt = (take: Script["takes"][number], t: number): { start: number; end: number } => {
  const keep = take.keep?.length ? take.keep : [{ start: 0, end: take.seconds }];
  return keep.find((k) => t >= k.start - 1e-3 && t <= k.end + 1e-3) ?? keep[0]!;
};

export const organiseCut = (s: Script, cut: Cut, covers: Map<string, Cover[]>, opts: { id: string; name: string }): Organised => {
  const seq: Sequence = { ...emptySequence(opts.id, opts.name), idea: s.id, takes: s.takes.map(({ keep: _k, ...t }): Take => t) };
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
    const region = regionAt(tk, cover.start);
    // The slice: from just before the beat's first word to where the next beat starts in this same take, else just after its last word.
    const next = cut.beats[k + 1];
    const nextHere = next ? reads(next).find((x) => x.take === take && x.cover.start > cover.start) : undefined;
    const start = r3(Math.max(region.start, cover.start - LEAD));
    const end = r3(Math.min(region.end, nextHere ? nextHere.cover.start - LEAD : cover.end + TAIL));
    if (end - start < 0.1) {
      missing.push(b.id);
      return;
    }
    const at = r3(cursor);
    audio.push({ id: newId(), take, start, end, at });
    markers.push({ id: newId(), at });
    const seconds = end - start;
    // The card.
    const plan = cardOfBeat(s, b);
    if (plan && plan.kind !== "none") {
      if (lastCard && lastCard.kind !== "broll") lastCard.seconds = r3(at - lastCard.at);
      const card: Card = plan.kind === "text" ? { id: newId(), kind: "text", text: plan.text ?? "", at, seconds: r3(seconds), place: "full", beat: b.id } : plan.kind === "sketch" ? { id: newId(), kind: "image", src: plan.src ?? "", at, seconds: r3(seconds), place: "full", beat: b.id } : { id: newId(), kind: "broll", note: plan.note ?? "", at, seconds: r3(seconds), place: "full", beat: b.id };
      cards.push(card);
      lastCard = card;
    } else if (lastCard && lastCard.kind !== "broll") lastCard.seconds = r3(at + seconds - lastCard.at);
    cursor = at + seconds + s.gap;
  });
  seq.audio = [{ id: "a1", clips: audio }];
  if (cards.length) seq.overlay = { id: "o1", cards: cards.filter((c) => c.seconds >= 0.3) };
  if (markers.length) seq.markers = markers;
  return { seq, missing, conflicts };
};
