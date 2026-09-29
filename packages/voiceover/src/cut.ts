/**
 * A CUT: the pieces of a recording that are kept, played end to end, each
 * join a slide that overlaps the two pieces either side of it.
 *
 * Two clocks again:
 *  - SOURCE time: seconds into the recording being cut.
 *  - OUTPUT time: seconds into the clip the cut makes. This is the clock a
 *    voice-over's pieces sit on.
 * A voice-over is pinned to the footage under it: change the cut and each
 * piece is carried to wherever its footage went (remapPieces).
 */
import { pieceSeconds, sortPieces } from "./timeline";
import type { Piece } from "./types";

export type Segment = { start: number; end: number };
export type Cut = {
  /** Kept pieces of the source, in order, never touching (touching pieces are one piece). */
  segments: Segment[];
  /** Seconds each join overlaps, already limited to what the pieces allow (joinOverlap). */
  overlap: number;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const len = (s: Segment) => s.end - s.start;

/** A recording played whole. */
export const wholeCut = (seconds: number): Cut => ({ segments: [{ start: 0, end: seconds }], overlap: 0 });

/** Kept pieces → segments: pieces that touch in the source are one stretch of footage, not a join. */
export const mergeSegments = (kept: Segment[], eps = 0.001): Segment[] => {
  const out: Segment[] = [];
  for (const s of [...kept].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= eps) last.end = Math.max(last.end, s.end);
    else if (len(s) > 0) out.push({ start: s.start, end: s.end });
  }
  return out;
};

/** How long a join can be: what was asked for, but never more than half of any piece, never less than a tenth of a second. (The same rule ffmpeg's cut uses.) */
export const joinOverlap = (segments: Segment[], wanted: number): number => (segments.length > 1 ? Math.max(0.1, Math.min(wanted || 0.4, ...segments.map((s) => len(s) / 2))) : 0);

export const makeCut = (kept: Segment[], wanted: number): Cut => {
  const segments = mergeSegments(kept);
  return { segments, overlap: joinOverlap(segments, wanted) };
};

/** Where each segment starts in the output. */
export const outStarts = (cut: Cut): number[] => {
  const out: number[] = [];
  let t = 0;
  cut.segments.forEach((s, i) => {
    out.push(r3(t));
    t += len(s) - (i < cut.segments.length - 1 ? cut.overlap : 0);
  });
  return out;
};

export const cutSeconds = (cut: Cut): number => Math.max(0, r3(cut.segments.reduce((t, s) => t + len(s), 0) - Math.max(0, cut.segments.length - 1) * cut.overlap));

/** Which segment is on screen at `out` (through a join: the one arriving). */
export const segmentAt = (cut: Cut, out: number): number => {
  const starts = outStarts(cut);
  let at = 0;
  starts.forEach((o, i) => {
    if (out >= o) at = i;
  });
  return at;
};

/** The moment of the recording on screen at `out`. Past the end it carries on counting, so nothing is lost there. */
export const toSource = (cut: Cut, out: number): number => {
  if (!cut.segments.length) return out;
  const i = segmentAt(cut, out);
  return r3(cut.segments[i]!.start + (out - outStarts(cut)[i]!));
};

/**
 * When a moment of the recording plays in the output. A moment that was cut
 * away has no time of its own: it lands on the join, where the footage
 * after it begins.
 */
export const toOutput = (cut: Cut, source: number): number => {
  if (!cut.segments.length) return source;
  const starts = outStarts(cut);
  const last = cut.segments.length - 1;
  if (source >= cut.segments[last]!.end) return r3(starts[last]! + (source - cut.segments[last]!.start));
  for (let i = 0; i <= last; i++) {
    const s = cut.segments[i]!;
    if (source < s.start) return starts[i]!;
    if (source < s.end) return r3(starts[i]! + (source - s.start));
  }
  return cutSeconds(cut);
};

/**
 * The voice-over's pieces, carried from one cut of a recording to another:
 * each piece stays over the footage it started on. Pieces pushed together
 * (the footage between them went) queue up rather than overlap.
 */
export const remapPieces = (pieces: Piece[], from: Cut, to: Cut): Piece[] => {
  let floor = 0;
  return sortPieces(pieces).map((p) => {
    const at = Math.max(floor, toOutput(to, toSource(from, p.at)));
    floor = at + pieceSeconds(p);
    return { ...p, at: r3(at) };
  });
};

/** A time in one cut's output → the same footage's time in another's. */
export const remapTime = (t: number, from: Cut, to: Cut): number => toOutput(to, toSource(from, t));

export const sameCut = (a: Cut, b: Cut): boolean =>
  Math.abs(a.overlap - b.overlap) < 0.002 && a.segments.length === b.segments.length && a.segments.every((s, i) => Math.abs(s.start - b.segments[i]!.start) < 0.002 && Math.abs(s.end - b.segments[i]!.end) < 0.002);
