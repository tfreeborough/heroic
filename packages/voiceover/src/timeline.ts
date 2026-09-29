/**
 * The edits a voice row allows, as pure functions: every one takes the
 * pieces and returns new pieces, sorted by where they sit on the clip and
 * never overlapping. The Voice screen keeps a history of the results for undo.
 */
import type { Piece, Take, VoiceOver, Word } from "./types";

/** The shortest piece worth keeping, in seconds. */
export const MIN_PIECE = 0.08;

export const pieceSeconds = (p: Piece): number => p.end - p.start;
export const pieceEnd = (p: Piece): number => p.at + pieceSeconds(p);
export const sortPieces = (pieces: Piece[]): Piece[] => [...pieces].sort((a, b) => a.at - b.at);
/** Where the last piece stops, in clip time. */
export const voiceEnd = (pieces: Piece[]): number => pieces.reduce((m, p) => Math.max(m, pieceEnd(p)), 0);
export const pieceAt = (pieces: Piece[], clipTime: number): number => pieces.findIndex((p) => clipTime >= p.at && clipTime < pieceEnd(p));

const round = (n: number) => Math.round(n * 1000) / 1000;
const clampTo = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Where a split should land so it doesn't cut a word in half: if `clipTime`
 * falls inside a word (or within `reach` of its edge), the middle of the
 * nearest gap between words; otherwise `clipTime` itself.
 */
export const snapToGap = (piece: Piece, take: Take | undefined, clipTime: number, reach = 0.12): number => {
  const words = (take?.words ?? []).filter((w) => w.end > piece.start && w.start < piece.end);
  if (!words.length) return clipTime;
  const t = piece.start + (clipTime - piece.at);
  const near = words.some((w) => t > w.start - reach && t < w.end + reach);
  if (!near) return clipTime;
  // The gaps: before the first word, between each pair, after the last.
  const gaps: number[] = [];
  for (let i = 0; i <= words.length; i++) {
    const before = i === 0 ? piece.start : words[i - 1]!.end;
    const after = i === words.length ? piece.end : words[i]!.start;
    if (after - before >= 0) gaps.push((before + after) / 2);
  }
  const inside = gaps.filter((g) => g > piece.start + MIN_PIECE && g < piece.end - MIN_PIECE);
  if (!inside.length) return clipTime;
  const best = inside.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  // Only a nudge: a split asked for mid-sentence shouldn't jump half a second away.
  return Math.abs(best - t) <= 0.4 ? round(piece.at + (best - piece.start)) : clipTime;
};

/** Cut the piece under `clipTime` in two. No-op if it would leave a sliver. */
export const splitPiece = (pieces: Piece[], clipTime: number): Piece[] => {
  const i = pieceAt(pieces, clipTime);
  const p = pieces[i];
  if (!p) return pieces;
  const cut = round(p.start + (clipTime - p.at));
  if (cut - p.start < MIN_PIECE || p.end - cut < MIN_PIECE) return pieces;
  const left: Piece = { ...p, end: cut };
  const right: Piece = { ...p, start: cut, at: round(p.at + (cut - p.start)) };
  return [...pieces.slice(0, i), left, right, ...pieces.slice(i + 1)];
};

export const dropPiece = (pieces: Piece[], index: number): Piece[] => pieces.filter((_, i) => i !== index);

/** Slide a piece along the clip. It stops at its neighbours and at the clip's start. */
export const movePiece = (pieces: Piece[], index: number, at: number): Piece[] => {
  const p = pieces[index];
  if (!p) return pieces;
  const lo = index > 0 ? pieceEnd(pieces[index - 1]!) : 0;
  const next = pieces[index + 1];
  const hi = next ? next.at - pieceSeconds(p) : Infinity;
  const to = round(clampTo(at, lo, Math.max(lo, hi)));
  return pieces.map((x, i) => (i === index ? { ...x, at: to } : x));
};

/** Drag a piece's left edge: more or less of the take's beginning, the rest staying put. */
export const trimStart = (pieces: Piece[], index: number, at: number): Piece[] => {
  const p = pieces[index];
  if (!p) return pieces;
  const floor = index > 0 ? pieceEnd(pieces[index - 1]!) : 0;
  // Can't reveal take before 0, can't pass the neighbour, can't eat the whole piece.
  const lo = Math.max(floor, p.at - p.start);
  const hi = pieceEnd(p) - MIN_PIECE;
  const to = clampTo(at, lo, hi);
  const delta = to - p.at;
  return pieces.map((x, i) => (i === index ? { ...x, at: round(to), start: round(x.start + delta) } : x));
};

/** Drag a piece's right edge to `end` (clip time). */
export const trimEnd = (pieces: Piece[], index: number, end: number, takeSeconds: number): Piece[] => {
  const p = pieces[index];
  if (!p) return pieces;
  const next = pieces[index + 1];
  const hi = Math.min(next ? next.at : Infinity, p.at + (takeSeconds - p.start));
  const to = clampTo(end, p.at + MIN_PIECE, hi);
  return pieces.map((x, i) => (i === index ? { ...x, end: round(x.start + (to - x.at)) } : x));
};

/**
 * Lay a new take on the row at `at`. It wins: anything it covers is
 * trimmed back, cut in two, or dropped (recording over a piece replaces it).
 * `start` skips the take's opening (the moment the mic was live before the
 * clip began to move), so the take's sound lines up with what was on screen.
 */
export const layTake = (pieces: Piece[], take: number, seconds: number, at: number, start = 0): Piece[] => {
  const from = Math.max(0, at);
  const skip = clampTo(start, 0, Math.max(0, seconds - MIN_PIECE));
  const to = from + (seconds - skip);
  const kept: Piece[] = [];
  for (const p of pieces) {
    const pEnd = pieceEnd(p);
    if (pEnd <= from || p.at >= to) {
      kept.push(p);
      continue;
    }
    if (p.at < from && from - p.at >= MIN_PIECE) kept.push({ ...p, end: round(p.start + (from - p.at)) });
    if (pEnd > to && pEnd - to >= MIN_PIECE) kept.push({ ...p, start: round(p.start + (to - p.at)), at: round(to) });
  }
  return sortPieces([...kept, { take, start: round(skip), end: round(seconds), at: round(from) }]);
};

/**
 * The pieces as a video sees them: the video starts `startFrom` seconds
 * into the clip and runs `seconds` long, so pieces shift earlier, and any
 * part hanging off either end is cut away. `at` is then VIDEO time.
 */
export const piecesInVideo = (pieces: Piece[], startFrom = 0, seconds = Infinity): Piece[] => {
  const out: Piece[] = [];
  for (const p of pieces) {
    let at = p.at - startFrom;
    let start = p.start;
    let end = p.end;
    if (at < 0) {
      start -= at;
      at = 0;
    }
    const over = at + (end - start) - seconds;
    if (over > 0) end -= over;
    if (end - start >= MIN_PIECE) out.push({ take: p.take, start: round(start), end: round(end), at: round(at) });
  }
  return out;
};

export type PlacedWord = Word & {
  /** Which piece and which word of its take this is (for editing). */
  piece: number;
  take: number;
  index: number;
};

/**
 * Every word that will be heard, timed against the clip (or, given
 * `pieces` already mapped by piecesInVideo, against the video). A word
 * belongs to a piece when its middle falls inside the piece's slice.
 */
export const placedWords = (voice: Pick<VoiceOver, "takes" | "captionNudgeMs">, pieces: Piece[], opts: { hidden?: boolean } = {}): PlacedWord[] => {
  const nudge = (voice.captionNudgeMs || 0) / 1000;
  const out: PlacedWord[] = [];
  pieces.forEach((p, piece) => {
    const take = voice.takes[p.take];
    if (!take) return;
    take.words.forEach((w, index) => {
      if (w.hidden && !opts.hidden) return;
      const mid = (w.start + w.end) / 2;
      if (mid < p.start || mid >= p.end) return;
      const start = Math.max(0, p.at + (Math.max(w.start, p.start) - p.start) + nudge);
      const end = Math.max(start + 0.02, p.at + (Math.min(w.end, p.end) - p.start) + nudge);
      out.push({ ...w, start: round(start), end: round(end), piece, take: p.take, index });
    });
  });
  return out.sort((a, b) => a.start - b.start);
};

/**
 * How loud everything else should be at `t` while the voice talks: 1 when
 * nobody is speaking, `depth` while they are, easing over `ramp` seconds
 * either side so the music is already down when the first word lands.
 */
export const duckAt = (pieces: Piece[], t: number, depth = 0.35, ramp = 0.25): number => {
  let k = 0;
  for (const p of pieces) {
    const end = pieceEnd(p);
    const dist = t < p.at ? p.at - t : t > end ? t - end : 0;
    k = Math.max(k, dist >= ramp ? 0 : 1 - dist / ramp);
    if (k === 1) break;
  }
  // Smoothstep, so the dip has no corners to hear.
  const s = k * k * (3 - 2 * k);
  return 1 - (1 - clampTo(depth, 0, 1)) * s;
};
