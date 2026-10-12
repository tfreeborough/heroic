/**
 * A SEQUENCE (an "edit" on screen): video tracks of clips cut from any
 * number of recordings, audio tracks of clips cut from takes off the mic,
 * one music bed, and markers. Every clip sits at a time of its own (`at`,
 * seconds into the sequence) and nothing moves unless you move it.
 * Design: docs/design/desk-sequence-editor.md.
 *
 * Two clocks, never mixed:
 *  - SOURCE time: seconds into a recording (a video clip's `start`/`end`)
 *    or into a take (an audio clip's `start`/`end`).
 *  - SEQUENCE time: seconds into the video the sequence makes (`at`).
 *
 * How two video clips on one track meet is geometry, not a setting: they
 * overlap = a slide as long as the overlap; they touch = a hard cut; they
 * touch and carry the same recording straight on = no join at all; a gap =
 * the track below shows through. Video tracks stack: at any moment the
 * lowest track with picture fills the frame and the next one up shares it.
 *
 * Every edit here is a pure function: a sequence in, a new one out. The
 * Desk's editor keeps a history of them for undo.
 */
import { MIN_PIECE, pieceEnd, pieceSeconds, sortPieces } from "./timeline";
import type { Piece, Take } from "./types";

// ── boxes (framing) ──

/** A rectangle of a recording's frame, as fractions of its width and height. */
export type Box = { x: number; y: number; w: number; h: number };
export const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 };

export const sameBox = (a: Box, b: Box): boolean => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.w - b.w) < 1e-4 && Math.abs(a.h - b.h) < 1e-4;

/** A phone's status bar and nav bar shaved, as a box. */
export const cropBox = (top: number, bottom: number): Box => ({ x: 0, y: top, w: 1, h: Math.max(0.2, 1 - top - bottom) });

/** A box's shape on screen (width ÷ height), for a recording of `aspect`. */
export const boxAspect = (box: Box, aspect: number): number => (box.w * aspect) / box.h;

/** The biggest box of shape `want` (width ÷ height on screen) inside `within`, centred. */
export const fitBox = (within: Box, aspect: number, want: number): Box => {
  let h = within.h;
  let w = (want * h) / aspect;
  if (w > within.w) {
    w = within.w;
    h = (w * aspect) / want;
  }
  return { x: within.x + (within.w - w) / 2, y: within.y + (within.h - h) / 2, w, h };
};

// ── the model ──

/** A slice of a recording, placed on a video track. */
export type Clip = {
  /** Stable through moves and trims; a split gives the right half a new one. */
  id: string;
  /** The recording, as a path under the game's public dir ("footage/x.mp4"). */
  src: string;
  /** The slice of the recording, in source seconds. */
  start: number;
  end: number;
  /** Where it starts in the sequence. */
  at: number;
  /** How long the whole recording is (how far an edge can be dragged out). */
  sourceSeconds: number;
  /** The recording's width ÷ height. */
  aspect: number;
  /** The part of the frame that's picture (a phone's status and nav bars shaved). Default: all of it. */
  crop?: Box;
  /** Which part shows in each output shape ("vertical", "vertical:stacked", …). Default: see frameBox. */
  frames?: Partial<Record<string, Box>>;
  /** The recording's own sound: off, or a level (default 1). */
  muted?: boolean;
  volume?: number;
};

export type VideoTrack = {
  id: string;
  /** Sorted by `at`. */
  clips: Clip[];
  /** The whole track's own sound off (the picture still plays). */
  muted?: boolean;
};

/** A slice of a take (`take` = index into the sequence's takes), placed on an audio track. The Piece shape, so the caption and ducking maths apply as they are. */
export type AudioClip = Piece & { id: string; muted?: boolean; volume?: number };

export type AudioTrack = {
  id: string;
  /** Sorted by `at`, never overlapping. */
  clips: AudioClip[];
  /** The whole track off (an alternative take, kept). */
  muted?: boolean;
};

/** One song under the whole edit. */
export type Music = {
  /** The song's file under the game's music folder. */
  song: string;
  /** Seconds into the song it starts from. */
  from: number;
  /** 0–1. */
  level: number;
};

/** How the voice sounds and reads, for every audio clip in the edit. */
export type VoiceSettings = {
  /** Shifts every caption later (+) or earlier (−). */
  captionNudgeMs: number;
  /** Takes are levelled and de-rumbled (the raw recording is kept beside each). */
  tidy: boolean;
  /** Background noise turned down in the takes: 0 (off) to 3. */
  denoise?: number;
  /** The voice's level, 0–1. */
  volume?: number;
};

/**
 * Something on screen for a stretch that isn't footage (docs/design/desk-scripts.md):
 * a TEXT card (a few words), an IMAGE (a sketch, under the game's public
 * dir), a B-ROLL slot (a note of what to film: shown in the editor,
 * never drawn in the render), or a BUILD (a picture that builds itself out
 * of glyphs, docs/design/desk-ascii-scripts.md: its `src` and its look
 * `seed`), or a CHAPTER (its name in `text`: the screen clears and the
 * name builds out of glyphs). A card is content; the template draws it.
 */
export type CardKind = "text" | "image" | "broll" | "build" | "chapter";
export type Card = {
  id: string;
  kind: CardKind;
  /** text: the lines. */
  text?: string;
  /** image: the file under the game's public dir ("cards/<script>/x.png"). */
  src?: string;
  /** broll: what to film. */
  note?: string;
  /** build: the look seed (how the glyphs arrive and fill in: same seed, same build). */
  seed?: number;
  /** build: key words the picture's glyphs fly out to spell as they're said. */
  pulled?: string[];
  /** chapter: its number ("CHAPTER TWO"): the first beat's chapter opens the video with no card, so the first card may be two. */
  n?: number;
  /** Where it starts in the sequence. */
  at: number;
  seconds: number;
  /** full: the frame, on the backdrop (it gives way to any footage playing). over: small, over whatever is playing. */
  place: "full" | "over";
  /** The script beat that put it there, so organise can find its own cards again. */
  beat?: string;
};
/** The one row of cards. Sorted by `at`, never overlapping. */
export type OverlayTrack = { id: string; cards: Card[] };

/** A moment a template can hang something on (a list clip's items). */
export type Marker = { id: string; at: number };

export type Sequence = {
  id: string;
  name: string;
  note?: string;
  /** The idea it's making, by id (the Desk's Ideas tab): its script is read while recording. */
  idea?: string;
  /** The video's title (organise writes the script's), for a template's cold open. */
  title?: string;
  /** Bottom first: video[0] is the track that fills the frame when it has picture. */
  video: VideoTrack[];
  audio: AudioTrack[];
  /** The recordings the audio clips slice. Never removed (clips refer to them by index). */
  takes: Take[];
  voice: VoiceSettings;
  music?: Music;
  /** The cards (text, sketches, b-roll slots), drawn by the template over the footage. */
  overlay?: OverlayTrack;
  /** Sorted by `at`. Numbered by position: the first is 1. */
  markers?: Marker[];
  /** Seconds a slide takes by default: how far + Add footage overlaps the clip before, and a snap point when dragging. */
  slide: number;
  /** Where it was started from, so the Clips screen opens the same edit again. */
  origin?: { file: string; from?: string };
  createdAt: string;
  updatedAt: string;
};

/** What the player needs of a sequence (the editor passes an unsaved one inline). */
export type Playable = Pick<Sequence, "video" | "audio" | "takes" | "voice" | "music" | "markers" | "slide" | "overlay"> & Partial<Pick<Sequence, "title">>;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const len = (c: { start: number; end: number }) => c.end - c.start;
const EPS = 0.002;
/** The shortest clip worth keeping, in seconds. */
export const MIN_CLIP = 0.1;
export const DEFAULT_SLIDE = 0.4;

export const newId = (): string => Math.random().toString(36).slice(2, 10);
export const clipEnd = (c: { at: number; start: number; end: number }): number => r3(c.at + len(c));
export const sortClips = <T extends { at: number }>(clips: T[]): T[] => [...clips].sort((a, b) => a.at - b.at);

export const emptySequence = (id: string, name: string, now = new Date().toISOString()): Sequence => ({
  id,
  name,
  video: [{ id: "v1", clips: [] }],
  audio: [{ id: "a1", clips: [] }],
  takes: [],
  voice: { captionNudgeMs: -50, tidy: true },
  slide: DEFAULT_SLIDE,
  createdAt: now,
  updatedAt: now,
});

/** A recording as one clip, all of it (or a slice), not yet placed. */
export const clipOf = (src: string, facts: { seconds: number; width: number; height: number }, opts: { crop?: Box; muted?: boolean; start?: number; end?: number; at?: number } = {}): Clip => ({
  id: newId(),
  src,
  start: opts.start ?? 0,
  end: opts.end ?? facts.seconds,
  at: opts.at ?? 0,
  sourceSeconds: facts.seconds,
  aspect: facts.width && facts.height ? facts.width / facts.height : 9 / 16,
  ...(opts.crop && !sameBox(opts.crop, WHOLE) ? { crop: opts.crop } : {}),
  ...(opts.muted ? { muted: true } : {}),
});

// ── timing ──

export type Arrive = "first" | "slide" | "cut" | "continue" | "gap";
export type Timed = {
  index: number;
  at: number;
  end: number;
  arrive: Arrive;
  /** Seconds this clip slides in over the one before (0 unless `arrive` is a slide). */
  overlap: number;
  /** Seconds the next clip slides in over this one. */
  leave: number;
};

/** Same recording, carrying straight on from where the clip before stopped. */
export const continues = (prev: { src: string; end: number } | undefined, next: { src: string; start: number }): boolean => Boolean(prev && prev.src === next.src && Math.abs(prev.end - next.start) < EPS);

/** How each clip on a track arrives and leaves. The track is read sorted by `at`. */
export const timeTrack = (track: Pick<VideoTrack, "clips">): Timed[] => {
  const clips = sortClips(track.clips);
  const out: Timed[] = clips.map((c, i) => {
    const prev = clips[i - 1];
    if (!prev) return { index: i, at: c.at, end: clipEnd(c), arrive: "first", overlap: 0, leave: 0 };
    const pEnd = clipEnd(prev);
    const over = pEnd - c.at;
    if (over > EPS) return { index: i, at: c.at, end: clipEnd(c), arrive: "slide", overlap: r3(Math.min(over, len(prev), len(c))), leave: 0 };
    if (over > -EPS) return { index: i, at: c.at, end: clipEnd(c), arrive: continues(prev, c) ? "continue" : "cut", overlap: 0, leave: 0 };
    return { index: i, at: c.at, end: clipEnd(c), arrive: "gap", overlap: 0, leave: 0 };
  });
  out.forEach((t, i) => {
    const next = out[i + 1];
    if (next?.arrive === "slide") t.leave = next.overlap;
  });
  return out;
};

export const videoEnd = (seq: Pick<Playable, "video">): number => Math.max(0, ...seq.video.flatMap((t) => t.clips.map(clipEnd)));
export const audioEnd = (seq: Pick<Playable, "audio">): number => Math.max(0, ...seq.audio.flatMap((t) => t.clips.map(pieceEnd)));
export const cardEnd = (c: Pick<Card, "at" | "seconds">): number => r3(c.at + c.seconds);
export const overlayEnd = (seq: Pick<Playable, "overlay">): number => Math.max(0, ...(seq.overlay?.cards ?? []).map(cardEnd));
/** Where the last thing stops. */
export const sequenceSeconds = (seq: Pick<Playable, "video" | "audio" | "overlay">): number => r3(Math.max(videoEnd(seq), audioEnd(seq), overlayEnd(seq)));

/** The clip on a track showing at `t` (through a slide: the one arriving). -1: none. */
export const clipAt = (track: Pick<VideoTrack, "clips">, t: number): number => {
  const clips = sortClips(track.clips);
  let at = -1;
  clips.forEach((c, i) => {
    if (t >= c.at - EPS && t < clipEnd(c) - EPS) at = i;
  });
  return at;
};

/** Which tracks have picture at `t`, bottom first. */
export const layersAt = (seq: Pick<Playable, "video">, t: number): number[] => seq.video.flatMap((track, i) => (clipAt(track, t) >= 0 ? [i] : []));

/** The footage on screen at `t` on the lowest track with picture: which track, which clip, and the moment of its recording. */
export const footageAt = (seq: Pick<Playable, "video">, t: number): { track: number; clip: number; time: number } | undefined => {
  const track = layersAt(seq, t)[0];
  if (track === undefined) return undefined;
  const clips = sortClips(seq.video[track]!.clips);
  const i = clipAt({ clips }, t);
  const c = clips[i]!;
  return { track, clip: i, time: r3(c.start + (t - c.at)) };
};

/** The stretches where two or more tracks have picture: the frame is split for these. */
export const stackIntervals = (seq: Pick<Playable, "video">): { start: number; end: number }[] => {
  const points = [...new Set(seq.video.flatMap((t) => t.clips.flatMap((c) => [c.at, clipEnd(c)])))].sort((a, b) => a - b);
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b - a < EPS) continue;
    if (layersAt(seq, (a + b) / 2).length < 2) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.end - a) < EPS) last.end = b;
    else out.push({ start: a, end: b });
  }
  return out;
};

/** The split the frame is in at `t`: 0 = one track alone, 1 = two sharing it, easing over `ramp` seconds either end of each stacked stretch. */
export const splitAt = (intervals: { start: number; end: number }[], t: number, ramp = 0.4): number => {
  for (const s of intervals) {
    if (t < s.start || t >= s.end) continue;
    const k = Math.min(1, (t - s.start) / ramp, (s.end - t) / ramp);
    // Ease in and out: smoothstep.
    const e = Math.max(0, Math.min(1, k));
    return e * e * (3 - 2 * e);
  }
  return 0;
};

// ── video edits ──

const withVideo = <T extends Pick<Playable, "video">>(seq: T, i: number, clips: Clip[]): T => ({ ...seq, video: seq.video.map((t, k) => (k === i ? { ...t, clips: sortClips(clips) } : t)) });

/** Where a clip is: its track and its place on it. */
export const findClip = (seq: Pick<Playable, "video">, id: string): { track: number; index: number; clip: Clip } | undefined => {
  for (let track = 0; track < seq.video.length; track++) {
    const clips = sortClips(seq.video[track]!.clips);
    const index = clips.findIndex((c) => c.id === id);
    if (index >= 0) return { track, index, clip: clips[index]! };
  }
  return undefined;
};

/**
 * Whether a clip `seconds` long starting at `at` may sit on a track with
 * `others`: it may overlap a neighbour (a slide), but never swallow one or
 * be swallowed (that's what another track is for).
 */
const roomOnVideo = (others: Clip[], at: number, seconds: number): boolean => {
  if (at < -EPS) return false;
  const end = at + seconds;
  return others.every((o) => {
    const oEnd = clipEnd(o);
    const inside = at >= o.at - EPS && end <= oEnd + EPS;
    const around = at <= o.at + EPS && end >= oEnd - EPS;
    return !(inside || around);
  });
};

/** The nearest start to `at` on a video track where a clip `seconds` long fits (see roomOnVideo), leaving out clip `skip`. */
export const fitVideo = (track: Pick<VideoTrack, "clips">, at: number, seconds: number, skip?: string, slide = DEFAULT_SLIDE): number => {
  const others = track.clips.filter((c) => c.id !== skip);
  const want = Math.max(0, at);
  if (roomOnVideo(others, want, seconds)) return r3(want);
  const candidates = [0, ...others.flatMap((o) => [clipEnd(o), clipEnd(o) - slide, o.at - seconds, o.at - seconds + slide])].filter((c) => roomOnVideo(others, c, seconds));
  if (!candidates.length) return r3(want);
  return r3(candidates.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0]!);
};

/** A clip onto track `track` at `at` (moved along if it wouldn't fit there). A track past the last makes a new one. */
export const placeVideo = <T extends Pick<Playable, "video" | "slide">>(seq: T, track: number, clip: Clip, at: number): T => {
  let s: T = seq;
  while (s.video.length <= track) s = { ...s, video: [...s.video, { id: `v${s.video.length + 1}-${newId()}`, clips: [] }] };
  const tr = s.video[track]!;
  return withVideo(s, track, [...tr.clips.filter((c) => c.id !== clip.id), { ...clip, at: fitVideo(tr, at, len(clip), clip.id, s.slide) }]);
};

/** Where + Add footage puts a clip: at `t`, or on the end of the track overlapping the last clip by a slide if `t` is past the end. */
export const appendAt = (track: Pick<VideoTrack, "clips">, t: number, slide: number): number => {
  const end = Math.max(0, ...track.clips.map(clipEnd));
  if (!track.clips.length) return r3(Math.max(0, t));
  if (t >= end - EPS) return r3(Math.max(0, end - Math.min(slide, Math.min(...track.clips.map(len)) / 2)));
  return r3(Math.max(0, t));
};

/** A clip to another track and/or time. */
export const moveVideo = <T extends Pick<Playable, "video" | "slide">>(seq: T, id: string, track: number, at: number): T => {
  const here = findClip(seq, id);
  if (!here) return seq;
  const lifted = withVideo(seq, here.track, seq.video[here.track]!.clips.filter((c) => c.id !== id));
  return placeVideo(lifted, track, here.clip, at);
};

/** Out, leaving the gap. Nothing else moves. */
export const removeVideo = <T extends Pick<Playable, "video">>(seq: T, ids: string[]): T => ({ ...seq, video: seq.video.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.includes(c.id)) })) });

export const updateVideo = <T extends Pick<Playable, "video">>(seq: T, id: string, patch: Partial<Clip>): T => ({ ...seq, video: seq.video.map((t) => ({ ...t, clips: sortClips(t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c))) })) });

/** Split the clip under `t` on track `track` in two. The left half keeps the id. */
export const splitVideoAt = <T extends Pick<Playable, "video">>(seq: T, track: number, t: number): T => {
  const tr = seq.video[track];
  if (!tr) return seq;
  const clips = sortClips(tr.clips);
  const i = clipAt(tr, t);
  const c = clips[i];
  if (!c) return seq;
  const cut = r3(c.start + (t - c.at));
  if (cut - c.start < MIN_CLIP || c.end - cut < MIN_CLIP) return seq;
  const left: Clip = { ...c, end: cut };
  const right: Clip = { ...c, id: newId(), start: cut, at: r3(t) };
  return withVideo(seq, track, [...clips.slice(0, i), left, right, ...clips.slice(i + 1)]);
};

/** Drag a clip's left edge: the footage under it stays put, so `start` and `at` move together. Stops at the recording's start, at a sliver, and at the clip before. */
export const trimVideoStart = <T extends Pick<Playable, "video">>(seq: T, id: string, at: number): T => {
  const here = findClip(seq, id);
  if (!here) return seq;
  const c = here.clip;
  const others = seq.video[here.track]!.clips.filter((x) => x.id !== id);
  const prev = Math.max(0, ...others.filter((o) => o.at < c.at).map((o) => o.at + MIN_CLIP));
  const lo = Math.max(prev, c.at - c.start);
  const hi = clipEnd(c) - MIN_CLIP;
  const to = Math.max(lo, Math.min(hi, at));
  const d = to - c.at;
  return updateVideo(seq, id, { at: r3(to), start: r3(c.start + d) });
};

/** Drag a clip's right edge. Stops at the recording's end, at a sliver, and before the clip after would be swallowed. */
export const trimVideoEnd = <T extends Pick<Playable, "video">>(seq: T, id: string, endAt: number): T => {
  const here = findClip(seq, id);
  if (!here) return seq;
  const c = here.clip;
  const others = seq.video[here.track]!.clips.filter((x) => x.id !== id);
  const next = Math.min(Infinity, ...others.filter((o) => o.at > c.at).map((o) => clipEnd(o) - MIN_CLIP));
  const hi = Math.min(next, c.at + (c.sourceSeconds - c.start));
  const to = Math.max(c.at + MIN_CLIP, Math.min(hi, endAt));
  return updateVideo(seq, id, { end: r3(c.start + (to - c.at)) });
};

export const addVideoTrack = <T extends Pick<Playable, "video">>(seq: T): T => ({ ...seq, video: [...seq.video, { id: `v${seq.video.length + 1}-${newId()}`, clips: [] }] });
export const updateVideoTrack = <T extends Pick<Playable, "video">>(seq: T, track: number, patch: Partial<Omit<VideoTrack, "clips">>): T => ({ ...seq, video: seq.video.map((t, i) => (i === track ? { ...t, ...patch } : t)) });
/** Is a video clip's own sound heard at all (its switch and its track's)? */
export const videoHeard = (seq: Pick<Playable, "video">, track: number, clip: Pick<Clip, "muted">): boolean => !clip.muted && !seq.video[track]?.muted;
/** Empty tracks off the end go (the first always stays). */
export const dropEmptyVideoTracks = <T extends Pick<Playable, "video">>(seq: T): T => {
  const video = [...seq.video];
  while (video.length > 1 && !video[video.length - 1]!.clips.length) video.pop();
  return video.length === seq.video.length ? seq : { ...seq, video };
};

// ── audio edits ──

const withAudio = <T extends Pick<Playable, "audio">>(seq: T, i: number, clips: AudioClip[]): T => ({ ...seq, audio: seq.audio.map((t, k) => (k === i ? { ...t, clips: sortPieces(clips) as AudioClip[] } : t)) });

export const findAudio = (seq: Pick<Playable, "audio">, id: string): { track: number; index: number; clip: AudioClip } | undefined => {
  for (let track = 0; track < seq.audio.length; track++) {
    const clips = sortPieces(seq.audio[track]!.clips) as AudioClip[];
    const index = clips.findIndex((c) => c.id === id);
    if (index >= 0) return { track, index, clip: clips[index]! };
  }
  return undefined;
};

const roomOnAudio = (others: AudioClip[], at: number, seconds: number): boolean => at >= -EPS && others.every((o) => at + seconds <= o.at + EPS || at >= pieceEnd(o) - EPS);

/** The nearest start to `at` on an audio track where a clip `seconds` long overlaps nothing (leaving out `skip`), or undefined if there's no room at all. */
export const fitAudio = (track: Pick<AudioTrack, "clips">, at: number, seconds: number, skip?: string): number | undefined => {
  const others = track.clips.filter((c) => c.id !== skip);
  const want = Math.max(0, at);
  if (roomOnAudio(others, want, seconds)) return r3(want);
  const candidates = [0, ...others.flatMap((o) => [pieceEnd(o), o.at - seconds])].filter((c) => roomOnAudio(others, c, seconds));
  return candidates.length ? r3(candidates.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0]!) : undefined;
};

/**
 * An audio clip onto a track at `at`. On `track` if it's free there;
 * otherwise the first track below it with room at that exact moment, else
 * a new track. Nothing already there is ever trimmed by it.
 */
export const placeAudio = <T extends Pick<Playable, "audio">>(seq: T, track: number, clip: AudioClip, at: number): { seq: T; track: number } => {
  const seconds = pieceSeconds(clip);
  const want = Math.max(0, at);
  const lifted: T = { ...seq, audio: seq.audio.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clip.id) })) };
  const order = [track, ...lifted.audio.map((_, i) => i).filter((i) => i !== track)];
  for (const i of order) {
    const tr = lifted.audio[i];
    if (tr && roomOnAudio(tr.clips, want, seconds)) return { seq: withAudio(lifted, i, [...tr.clips, { ...clip, at: r3(want) }]), track: i };
  }
  const added: T = { ...lifted, audio: [...lifted.audio, { id: `a${lifted.audio.length + 1}-${newId()}`, clips: [{ ...clip, at: r3(want) }] }] };
  return { seq: added, track: added.audio.length - 1 };
};

/** Slide an audio clip along its track (it stops at its neighbours), or onto another track where there's room. A track past the last makes a new one. */
export const moveAudio = <T extends Pick<Playable, "audio">>(seq: T, id: string, track: number, at: number): T => {
  const here = findAudio(seq, id);
  if (!here) return seq;
  let s: T = seq;
  while (s.audio.length <= track) s = { ...s, audio: [...s.audio, { id: `a${s.audio.length + 1}-${newId()}`, clips: [] }] };
  const tr = s.audio[track]!;
  const fitted = fitAudio(tr, at, pieceSeconds(here.clip), id);
  if (fitted === undefined) return seq;
  const lifted = withAudio(s, here.track, s.audio[here.track]!.clips.filter((c) => c.id !== id));
  return withAudio(lifted, track, [...lifted.audio[track]!.clips, { ...here.clip, at: fitted }]);
};

export const removeAudio = <T extends Pick<Playable, "audio">>(seq: T, ids: string[]): T => ({ ...seq, audio: seq.audio.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.includes(c.id)) })) });

export const updateAudio = <T extends Pick<Playable, "audio">>(seq: T, id: string, patch: Partial<AudioClip>): T => ({ ...seq, audio: seq.audio.map((t) => ({ ...t, clips: sortPieces(t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c))) as AudioClip[] })) });

export const audioAt = (track: Pick<AudioTrack, "clips">, t: number): number => track.clips.findIndex((c) => t >= c.at && t < pieceEnd(c));

/** Split the audio clip under `t` on track `track`. The left half keeps the id. */
export const splitAudioAt = <T extends Pick<Playable, "audio">>(seq: T, track: number, t: number): T => {
  const tr = seq.audio[track];
  if (!tr) return seq;
  const clips = sortPieces(tr.clips) as AudioClip[];
  const i = audioAt({ clips }, t);
  const c = clips[i];
  if (!c) return seq;
  const cut = r3(c.start + (t - c.at));
  if (cut - c.start < MIN_PIECE || c.end - cut < MIN_PIECE) return seq;
  return withAudio(seq, track, [...clips.slice(0, i), { ...c, end: cut }, { ...c, id: newId(), start: cut, at: r3(t) }, ...clips.slice(i + 1)]);
};

/** Drag an audio clip's left edge: more or less of the take's beginning, the rest staying put. */
export const trimAudioStart = <T extends Pick<Playable, "audio">>(seq: T, id: string, at: number): T => {
  const here = findAudio(seq, id);
  if (!here) return seq;
  const c = here.clip;
  const floor = Math.max(0, ...seq.audio[here.track]!.clips.filter((o) => o.id !== id && o.at < c.at).map(pieceEnd));
  const lo = Math.max(floor, c.at - c.start);
  const hi = pieceEnd(c) - MIN_PIECE;
  const to = Math.max(lo, Math.min(hi, at));
  const d = to - c.at;
  return updateAudio(seq, id, { at: r3(to), start: r3(c.start + d) });
};

export const trimAudioEnd = <T extends Pick<Playable, "audio" | "takes">>(seq: T, id: string, endAt: number): T => {
  const here = findAudio(seq, id);
  if (!here) return seq;
  const c = here.clip;
  const next = Math.min(Infinity, ...seq.audio[here.track]!.clips.filter((o) => o.id !== id && o.at > c.at).map((o) => o.at));
  const takeSeconds = seq.takes[c.take]?.seconds ?? c.end;
  const hi = Math.min(next, c.at + (takeSeconds - c.start));
  const to = Math.max(c.at + MIN_PIECE, Math.min(hi, endAt));
  return updateAudio(seq, id, { end: r3(c.start + (to - c.at)) });
};

export const addAudioTrack = <T extends Pick<Playable, "audio">>(seq: T): T => ({ ...seq, audio: [...seq.audio, { id: `a${seq.audio.length + 1}-${newId()}`, clips: [] }] });
export const updateAudioTrack = <T extends Pick<Playable, "audio">>(seq: T, track: number, patch: Partial<AudioTrack>): T => ({ ...seq, audio: seq.audio.map((t, i) => (i === track ? { ...t, ...patch } : t)) });

/** A new take, as a clip the length of it (skipping `skip` seconds of its opening). */
export const clipOfTake = (take: number, seconds: number, skip = 0): AudioClip => ({ id: newId(), take, start: r3(Math.max(0, Math.min(skip, seconds - MIN_PIECE))), end: r3(seconds), at: 0 });

/** Every audio clip that will be heard, as pieces in sequence time (muted tracks and clips left out), sorted. */
export const audioPieces = (seq: Pick<Playable, "audio">): AudioClip[] => sortPieces(seq.audio.flatMap((t) => (t.muted ? [] : t.clips.filter((c) => !c.muted)))) as AudioClip[];

// ── cards (the overlay track) ──

/** The shortest card worth keeping, in seconds. */
export const MIN_CARD = 0.3;
export const DEFAULT_CARD_SECONDS = 4;

const withCards = <T extends Pick<Playable, "overlay">>(seq: T, cards: Card[]): T => ({ ...seq, overlay: { id: seq.overlay?.id ?? "o1", cards: sortClips(cards) } });
const roomOnOverlay = (others: Card[], at: number, seconds: number): boolean => at >= -EPS && others.every((o) => at + seconds <= o.at + EPS || at >= cardEnd(o) - EPS);

export const findCard = (seq: Pick<Playable, "overlay">, id: string): { index: number; card: Card } | undefined => {
  const cards = sortClips(seq.overlay?.cards ?? []);
  const index = cards.findIndex((c) => c.id === id);
  return index >= 0 ? { index, card: cards[index]! } : undefined;
};

/** The card showing at `t`, if any. */
export const cardAt = (seq: Pick<Playable, "overlay">, t: number): Card | undefined => (seq.overlay?.cards ?? []).find((c) => t >= c.at - EPS && t < cardEnd(c) - EPS);

/** The nearest start to `at` where a card `seconds` long overlaps no other (leaving out `skip`), or undefined when there's no room at all. */
export const fitCard = (seq: Pick<Playable, "overlay">, at: number, seconds: number, skip?: string): number | undefined => {
  const others = (seq.overlay?.cards ?? []).filter((c) => c.id !== skip);
  const want = Math.max(0, at);
  if (roomOnOverlay(others, want, seconds)) return r3(want);
  const candidates = [0, ...others.flatMap((o) => [cardEnd(o), o.at - seconds])].filter((c) => roomOnOverlay(others, c, seconds));
  return candidates.length ? r3(candidates.sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0]!) : undefined;
};

/** A new card, not yet placed. */
export const cardOf = (kind: CardKind, content: { text?: string; src?: string; note?: string; beat?: string; seed?: number }, seconds = DEFAULT_CARD_SECONDS, place: Card["place"] = "full"): Card => ({
  id: newId(),
  kind,
  ...(content.seed !== undefined ? { seed: content.seed } : {}),
  ...(content.text !== undefined ? { text: content.text } : {}),
  ...(content.src !== undefined ? { src: content.src } : {}),
  ...(content.note !== undefined ? { note: content.note } : {}),
  ...(content.beat ? { beat: content.beat } : {}),
  at: 0,
  seconds: Math.max(MIN_CARD, seconds),
  place,
});

/**
 * A card onto the overlay at `at`. Dropped into a gap: it goes there, cut
 * down to the gap if the gap is shorter than it (a card never pushes
 * another). Dropped onto a card: the nearest free spot that takes it
 * whole. Unchanged only when the gap it's dropped in is a sliver.
 */
export const placeCard = <T extends Pick<Playable, "overlay">>(seq: T, card: Card, at: number): T => {
  const others = (seq.overlay?.cards ?? []).filter((c) => c.id !== card.id);
  const want = Math.max(0, at);
  const onto = others.find((o) => want >= o.at - EPS && want < cardEnd(o) - EPS);
  if (!onto) {
    const next = Math.min(Infinity, ...others.filter((o) => o.at > want + EPS).map((o) => o.at));
    const prev = Math.max(0, ...others.filter((o) => cardEnd(o) <= want + EPS).map(cardEnd));
    const room = next - prev;
    if (room < MIN_CARD) return seq;
    if (room >= card.seconds) return withCards(seq, [...others, { ...card, at: r3(Math.max(prev, Math.min(want, next - card.seconds))) }]);
    return withCards(seq, [...others, { ...card, at: r3(prev), seconds: r3(room) }]);
  }
  const fitted = fitCard({ overlay: { id: "", cards: others } }, want, card.seconds);
  return fitted === undefined ? seq : withCards(seq, [...others, { ...card, at: fitted }]);
};

/** Slide a card along (it stops at its neighbours). */
export const moveCard = <T extends Pick<Playable, "overlay">>(seq: T, id: string, at: number): T => {
  const here = findCard(seq, id);
  if (!here) return seq;
  const fitted = fitCard(seq, at, here.card.seconds, id);
  if (fitted === undefined) return seq;
  return withCards(seq, (seq.overlay?.cards ?? []).map((c) => (c.id === id ? { ...c, at: fitted } : c)));
};

export const removeCards = <T extends Pick<Playable, "overlay">>(seq: T, ids: string[]): T => (seq.overlay ? withCards(seq, seq.overlay.cards.filter((c) => !ids.includes(c.id))) : seq);
export const updateCard = <T extends Pick<Playable, "overlay">>(seq: T, id: string, patch: Partial<Card>): T => (seq.overlay ? withCards(seq, seq.overlay.cards.map((c) => (c.id === id ? { ...c, ...patch } : c))) : seq);

/** Drag a card's left edge. Stops at a sliver and at the card before. */
export const trimCardStart = <T extends Pick<Playable, "overlay">>(seq: T, id: string, at: number): T => {
  const here = findCard(seq, id);
  if (!here) return seq;
  const c = here.card;
  const floor = Math.max(0, ...(seq.overlay?.cards ?? []).filter((o) => o.id !== id && o.at < c.at).map(cardEnd));
  const to = Math.max(floor, Math.min(cardEnd(c) - MIN_CARD, at));
  return updateCard(seq, id, { at: r3(to), seconds: r3(cardEnd(c) - to) });
};
/** Drag a card's right edge. Stops at a sliver and at the card after. */
export const trimCardEnd = <T extends Pick<Playable, "overlay">>(seq: T, id: string, endAt: number): T => {
  const here = findCard(seq, id);
  if (!here) return seq;
  const c = here.card;
  const next = Math.min(Infinity, ...(seq.overlay?.cards ?? []).filter((o) => o.id !== id && o.at > c.at).map((o) => o.at));
  const to = Math.max(c.at + MIN_CARD, Math.min(next, endAt));
  return updateCard(seq, id, { seconds: r3(to - c.at) });
};

/** Split the card under `t` in two of the same content. The left half keeps the id. */
export const splitCardAt = <T extends Pick<Playable, "overlay">>(seq: T, t: number): T => {
  const c = cardAt(seq, t);
  if (!c || t - c.at < MIN_CARD || cardEnd(c) - t < MIN_CARD) return seq;
  const left: Card = { ...c, seconds: r3(t - c.at) };
  const right: Card = { ...c, id: newId(), at: r3(t), seconds: r3(cardEnd(c) - t) };
  return withCards(seq, [...(seq.overlay?.cards ?? []).filter((x) => x.id !== c.id), left, right]);
};

/** A card's label on a timeline or in a list. */
export const cardLabel = (c: Pick<Card, "kind" | "text" | "src" | "note">): string =>
  c.kind === "text" ? c.text?.trim() || "(empty card)" : c.kind === "chapter" ? `chapter: ${c.text?.trim() || "(no name)"}` : c.kind === "image" || c.kind === "build" ? (c.src ?? "").split("/").pop() || "(no picture)" : `b-roll: ${c.note?.trim() || "(what to film?)"}`;

// ── a selection ──

/**
 * Everything selected, moved together by `dt` seconds. Stops where the
 * first of them would go below zero, where an audio clip would land on
 * another, or where a video clip would swallow a neighbour (they may
 * overlap, that's a slide); if the full move isn't allowed, the largest
 * part of it that is happens instead. Unchanged if none of it can.
 */
export const shiftClips = <T extends Pick<Playable, "video" | "audio" | "slide" | "overlay">>(seq: T, ids: string[], dt: number): T => {
  const set = new Set(ids);
  const cards = seq.overlay?.cards ?? [];
  const picked = [...seq.video.flatMap((t) => t.clips.filter((c) => set.has(c.id))), ...seq.audio.flatMap((t) => t.clips.filter((c) => set.has(c.id))), ...cards.filter((c) => set.has(c.id))];
  if (!picked.length) return seq;
  const most = Math.max(dt, -Math.min(...picked.map((c) => c.at)));
  const attempt = (d: number): T | null => {
    const video = seq.video.map((t) => {
      const still = t.clips.filter((c) => !set.has(c.id));
      const moving = t.clips.filter((c) => set.has(c.id)).map((c) => ({ ...c, at: r3(c.at + d) }));
      if (!moving.every((m) => roomOnVideo([...still, ...moving.filter((x) => x.id !== m.id)], m.at, len(m)))) return null;
      return { ...t, clips: sortClips([...still, ...moving]) };
    });
    const audio = seq.audio.map((t) => {
      const still = t.clips.filter((c) => !set.has(c.id));
      const moving = t.clips.filter((c) => set.has(c.id)).map((c) => ({ ...c, at: r3(c.at + d) }));
      if (!moving.every((m) => roomOnAudio(still, m.at, pieceSeconds(m)))) return null;
      return { ...t, clips: sortPieces([...still, ...moving]) as AudioClip[] };
    });
    if (video.some((t) => !t) || audio.some((t) => !t)) return null;
    const stillCards = cards.filter((c) => !set.has(c.id));
    const movingCards = cards.filter((c) => set.has(c.id)).map((c) => ({ ...c, at: r3(c.at + d) }));
    if (!movingCards.every((m) => roomOnOverlay(stillCards, m.at, m.seconds))) return null;
    const overlay = seq.overlay ? { ...seq.overlay, cards: sortClips([...stillCards, ...movingCards]) } : undefined;
    return { ...seq, video: video as VideoTrack[], audio: audio as AudioTrack[], ...(overlay ? { overlay } : {}) };
  };
  // The whole move, else as much of it as fits: coarse steps back towards nothing, then the edge between the last two narrowed down.
  const whole = attempt(most);
  if (whole) return whole;
  for (let k = 49; k >= 1; k--) {
    let lo = (most * k) / 50;
    if (Math.abs(lo) < 1e-6) break;
    let got = attempt(lo);
    if (!got) continue;
    let hi = (most * (k + 1)) / 50;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const m = attempt(mid);
      if (m) {
        lo = mid;
        got = m;
      } else hi = mid;
    }
    return got;
  }
  return seq;
};

// ── snapping ──

/** The moments a dragged edge likes to land on: every clip's start and end, each video clip's end less a slide, the markers and the playhead. */
export const snapPoints = (seq: Pick<Playable, "video" | "audio" | "markers" | "slide" | "overlay">, exclude: string[], playhead?: number): number[] => {
  const skip = new Set(exclude);
  const pts: number[] = [0];
  for (const t of seq.video) for (const c of t.clips) if (!skip.has(c.id)) pts.push(c.at, clipEnd(c), r3(clipEnd(c) - seq.slide));
  for (const t of seq.audio) for (const c of t.clips) if (!skip.has(c.id)) pts.push(c.at, pieceEnd(c));
  for (const c of seq.overlay?.cards ?? []) if (!skip.has(c.id)) pts.push(c.at, cardEnd(c));
  for (const m of seq.markers ?? []) pts.push(m.at);
  if (playhead !== undefined) pts.push(playhead);
  return [...new Set(pts.map(r3))].sort((a, b) => a - b);
};

/** `at` for something `seconds` long, pulled onto the nearest snap point within `reach` seconds by either edge. */
export const snapTo = (at: number, seconds: number, points: number[], reach: number): number => {
  let best = at;
  let dist = reach;
  for (const p of points) {
    const dStart = p - at;
    if (Math.abs(dStart) < dist) {
      dist = Math.abs(dStart);
      best = p;
    }
    const dEnd = p - (at + seconds);
    if (Math.abs(dEnd) < dist) {
      dist = Math.abs(dEnd);
      best = at + dEnd;
    }
  }
  return r3(Math.max(0, best));
};

// ── framing ──

/**
 * What part of a clip shows in an output shape. A box set for that shape
 * wins. Otherwise the picture (the crop): whole, except widescreen footage
 * in a tall frame, which gets a frame-shaped box from the middle.
 */
export const frameBox = (clip: Pick<Clip, "crop" | "frames" | "aspect">, format: string, frameAspect: number): Box => {
  const set = clip.frames?.[format];
  if (set) return set;
  const crop = clip.crop ?? WHOLE;
  return boxAspect(crop, clip.aspect) > 1 && frameAspect < 1 ? fitBox(crop, clip.aspect, frameAspect) : crop;
};

/** Where the frame splits while two tracks show: the gap between the halves. */
export const STACK = { gap: 0.012 } as const;
/** The two regions of a frame (fractions of its width and height) when two tracks show: the upper track on top (side by side, on the right, in a wide frame). */
export const stackRegions = (frameAspect: number): { main: Box; over: Box } =>
  frameAspect > 1.2
    ? { over: { x: 0.5 + STACK.gap / 2, y: 0, w: 0.5 - STACK.gap / 2, h: 1 }, main: { x: 0, y: 0, w: 0.5 - STACK.gap / 2, h: 1 } }
    : { over: { x: 0, y: 0, w: 1, h: 0.5 - STACK.gap / 2 }, main: { x: 0, y: 0.5 + STACK.gap / 2, w: 1, h: 0.5 - STACK.gap / 2 } };

/** The framing key a clip uses while stacked in an output shape. */
export const stackedKey = (format: string) => `${format}:stacked`;

/** What part of a clip shows while stacked: a box set for that, or the middle of the picture, cut to fill its half of the frame. */
export const stackBox = (clip: Pick<Clip, "crop" | "frames" | "aspect">, format: string, regionAspect: number): Box => clip.frames?.[stackedKey(format)] ?? fitBox(clip.crop ?? WHOLE, clip.aspect, regionAspect);

// ── markers ──

export const sortMarkers = (markers: Marker[]): Marker[] => [...markers].sort((a, b) => a.at - b.at);
const withMarkers = <T extends Pick<Playable, "markers">>(seq: T, markers: Marker[]): T => ({ ...seq, markers: markers.length ? sortMarkers(markers) : undefined });

/** A marker at `t`, unless one is already within `near` seconds of it. */
export const addMarker = <T extends Pick<Playable, "markers">>(seq: T, t: number, near = 0.05): T => {
  const markers = seq.markers ?? [];
  if (markers.some((m) => Math.abs(m.at - t) < near)) return seq;
  return withMarkers(seq, [...markers, { id: newId(), at: r3(Math.max(0, t)) }]);
};
export const moveMarker = <T extends Pick<Playable, "markers">>(seq: T, id: string, at: number): T => withMarkers(seq, (seq.markers ?? []).map((m) => (m.id === id ? { ...m, at: r3(Math.max(0, at)) } : m)));
export const removeMarker = <T extends Pick<Playable, "markers">>(seq: T, id: string): T => withMarkers(seq, (seq.markers ?? []).filter((m) => m.id !== id));

// ── the music bed ──

export const setMusic = <T extends Pick<Playable, "music">>(seq: T, music: Music | undefined): T => ({ ...seq, music: music?.song ? { song: music.song, from: Math.max(0, music.from || 0), level: Math.max(0, Math.min(1, music.level)) } : undefined });

/** Is it a sequence file at all (either shape)? */
export const looksLikeSequence = (v: unknown): v is { video?: unknown; shots?: unknown } => Boolean(v && typeof v === "object" && (Array.isArray((v as { video?: unknown }).video) || Array.isArray((v as { shots?: unknown }).shots)));
