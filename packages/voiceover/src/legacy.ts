/**
 * The shape edits had before 2026-10-05 (one packed row of shots, a top
 * row, voice-overs in their own files), and how one becomes a sequence.
 * Kept only to read old files: nothing writes this shape any more.
 */
import { type AudioClip, type AudioTrack, type Box, type Clip, type Sequence, type VideoTrack, newId } from "./sequence";
import { sortPieces } from "./timeline";
import type { VoiceOver } from "./types";

export type LegacyShot = {
  id: string;
  src: string;
  start: number;
  end: number;
  sourceSeconds: number;
  aspect: number;
  crop?: Box;
  frames?: Partial<Record<string, Box>>;
  muted?: boolean;
  volume?: number;
  join?: "slide" | "cut";
};
export type LegacyOver = LegacyShot & { at: number };
export type LegacySequence = {
  id: string;
  name: string;
  note?: string;
  idea?: string;
  shots: LegacyShot[];
  over?: LegacyOver[];
  markers?: { id: string; at: number }[];
  slide: number;
  origin?: { file: string; from?: string };
  createdAt: string;
  updatedAt: string;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const len = (s: { start: number; end: number }) => s.end - s.start;
const EPS = 0.002;

/** Where each shot started on the old packed row: end to end, each slide overlapping the two, a cut not, two halves of one recording running straight on. */
export const legacyStarts = (seq: Pick<LegacySequence, "shots" | "slide">): number[] => {
  const out: number[] = [];
  let t = 0;
  seq.shots.forEach((s, i) => {
    const prev = seq.shots[i - 1];
    const carries = prev && prev.src === s.src && Math.abs(prev.end - s.start) < EPS;
    const arrive = !prev ? "first" : carries ? "continue" : (s.join ?? "slide");
    const overlap = arrive === "slide" ? Math.max(Math.min(0.1, len(prev!), len(s)), Math.min(seq.slide || 0.4, len(prev!) / 2, len(s) / 2)) : 0;
    t = r3(t - overlap);
    out.push(Math.max(0, t));
    t = r3(t + len(s));
  });
  return out;
};

const toClip = (s: LegacyShot, at: number): Clip => {
  const { join: _join, ...rest } = s;
  return { ...rest, at: r3(at) };
};

/**
 * An old edit and the voice-overs recorded over it → a sequence. The
 * shots keep the moments they played at (a slide stays an overlap, a cut
 * stays touching); the top row is the second video track. The edit's own
 * voice-over (named after it) is the first audio track and sets the voice;
 * any other is a further track, muted, so an alternative script isn't
 * lost.
 */
export const upgradeSequence = (old: LegacySequence, voices: VoiceOver[] = []): Sequence => {
  const starts = legacyStarts(old);
  const video: VideoTrack[] = [{ id: "v1", clips: old.shots.map((s, i) => toClip(s, starts[i]!)) }];
  if (old.over?.length) video.push({ id: "v2", clips: [...old.over].sort((a, b) => a.at - b.at).map((o) => toClip(o, o.at)) });
  const own = voices.find((v) => v.id === old.id) ?? voices[0];
  const others = voices.filter((v) => v !== own);
  const takes = [...(own?.takes ?? []), ...others.flatMap((v) => v.takes)];
  let offset = own?.takes.length ?? 0;
  const audio: AudioTrack[] = [{ id: "a1", clips: (own?.pieces ?? []).map((p): AudioClip => ({ ...p, id: newId() })) }];
  for (const v of others) {
    const base = offset;
    offset += v.takes.length;
    audio.push({ id: `a${audio.length + 1}`, muted: true, clips: sortPieces(v.pieces).map((p): AudioClip => ({ ...p, take: p.take + base, id: newId() })) });
  }
  return {
    id: old.id,
    name: old.name,
    ...(old.note ? { note: old.note } : {}),
    ...(old.idea ? { idea: old.idea } : {}),
    video,
    audio,
    takes,
    voice: { captionNudgeMs: own?.captionNudgeMs ?? -50, tidy: own?.tidy ?? true, ...(own?.denoise ? { denoise: own.denoise } : {}), ...(own?.volume !== undefined && own.volume !== 1 ? { volume: own.volume } : {}) },
    ...(old.markers?.length ? { markers: [...old.markers].sort((a, b) => a.at - b.at) } : {}),
    slide: old.slide || 0.4,
    ...(old.origin ? { origin: old.origin } : {}),
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
  };
};

export const isLegacySequence = (v: unknown): v is LegacySequence => Boolean(v && typeof v === "object" && Array.isArray((v as LegacySequence).shots) && !Array.isArray((v as { video?: unknown }).video));
