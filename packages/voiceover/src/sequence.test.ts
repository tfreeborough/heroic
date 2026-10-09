import { describe, expect, test } from "bun:test";
import { type LegacySequence, legacyStarts, upgradeSequence } from "./legacy";
import {
  type AudioClip,
  type Clip,
  type Sequence,
  addMarker,
  appendAt,
  audioPieces,
  clipOf,
  clipOfTake,
  emptySequence,
  findAudio,
  findClip,
  fitAudio,
  fitVideo,
  footageAt,
  layersAt,
  moveAudio,
  moveVideo,
  placeAudio,
  placeVideo,
  removeVideo,
  sequenceSeconds,
  shiftClips,
  snapPoints,
  snapTo,
  splitAt,
  splitAudioAt,
  splitVideoAt,
  stackIntervals,
  timeTrack,
  trimAudioEnd,
  trimAudioStart,
  trimVideoEnd,
  trimVideoStart,
} from "./sequence";
import type { VoiceOver } from "./types";

const PHONE = { seconds: 30, width: 1080, height: 2340 };
const clip = (id: string, src: string, start: number, end: number, at: number, extra: Partial<Clip> = {}): Clip => ({ id, src, start, end, at, sourceSeconds: 30, aspect: 1080 / 2340, ...extra });
const seq = (clips: Clip[], more: Partial<Sequence> = {}): Sequence => ({ ...emptySequence("s", "s", "now"), video: [{ id: "v1", clips }], ...more });

describe("timing on one track", () => {
  test("overlap = slide, touch = cut, gap = gap, same recording straight on = continue", () => {
    const s = seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 6, 9.6), clip("c", "footage/c.mp4", 0, 4, 15.6), clip("c2", "footage/c.mp4", 4, 8, 19.6), clip("d", "footage/d.mp4", 0, 2, 25)]);
    const t = timeTrack(s.video[0]!);
    expect(t.map((x) => x.arrive)).toEqual(["first", "slide", "cut", "continue", "gap"]);
    expect(t[1]!.overlap).toBe(0.4);
    expect(t[0]!.leave).toBe(0.4);
    expect(sequenceSeconds(s)).toBe(27);
  });
  test("a slide never lasts longer than either clip", () => {
    const s = seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 0.5, 9.0)]);
    expect(timeTrack(s.video[0]!)[1]!.overlap).toBe(0.5);
  });
  test("what's on screen through a gap is the track below, else nothing", () => {
    const s = seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 6, 12)]);
    expect(footageAt(s, 5)).toEqual({ track: 0, clip: 0, time: 5 });
    expect(footageAt(s, 11)).toBeUndefined();
    expect(footageAt(s, 13)).toEqual({ track: 0, clip: 1, time: 1 });
  });
  test("an empty sequence is zero long", () => {
    expect(sequenceSeconds(emptySequence("e", "e"))).toBe(0);
  });
});

describe("tracks on top of each other", () => {
  const two = seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 10, 10)], { video: [{ id: "v1", clips: [clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 10, 10)] }, { id: "v2", clips: [clip("x", "footage/x.mov", 0, 6, 4)] }] });
  test("layers at a moment, bottom first", () => {
    expect(layersAt(two, 2)).toEqual([0]);
    expect(layersAt(two, 5)).toEqual([0, 1]);
    expect(layersAt(two, 25)).toEqual([]);
  });
  test("the stacked stretches merge across the lower track's joins", () => {
    expect(stackIntervals(two)).toEqual([{ start: 4, end: 10 }]);
  });
  test("the split eases in and out of a stretch", () => {
    const iv = stackIntervals(two);
    expect(splitAt(iv, 3)).toBe(0);
    expect(splitAt(iv, 4.2)).toBeGreaterThan(0);
    expect(splitAt(iv, 4.2)).toBeLessThan(1);
    expect(splitAt(iv, 7)).toBe(1);
    expect(splitAt(iv, 9.9)).toBeLessThan(1);
    expect(splitAt(iv, 10)).toBe(0);
  });
  test("a track with picture through a gap below becomes the main layer", () => {
    const s: Sequence = { ...two, video: [{ id: "v1", clips: [clip("a", "footage/a.mp4", 0, 4, 0)] }, { id: "v2", clips: [clip("x", "footage/x.mov", 0, 6, 2)] }] };
    expect(layersAt(s, 5)).toEqual([1]);
    expect(footageAt(s, 5)).toEqual({ track: 1, clip: 0, time: 3 });
    expect(stackIntervals(s)).toEqual([{ start: 2, end: 4 }]);
  });
});

describe("placing video", () => {
  const base = seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 6, 12)]);
  test("a clip may overlap a neighbour (that's a slide) but never sit inside one", () => {
    expect(fitVideo(base.video[0]!, 9, 6)).toBe(9);
    // 4s long, asked for inside a's 0–10: pushed to the nearest spot that fits (ending where b starts, sliding over a's tail).
    expect(fitVideo(base.video[0]!, 3, 4)).toBe(8);
    // Something longer than a that would swallow it is pushed clear too (to a slide off a's end, the nearest fit).
    expect(fitVideo({ clips: [base.video[0]!.clips[0]!] }, -2, 14)).toBe(9.6);
  });
  test("placing on a track past the last makes the track", () => {
    const s = placeVideo(base, 2, clip("x", "footage/x.mov", 0, 3, 0), 1);
    expect(s.video).toHaveLength(3);
    expect(s.video[2]!.clips[0]!.at).toBe(1);
  });
  test("moving between tracks keeps the clip", () => {
    const s = moveVideo(base, "b", 1, 3);
    expect(s.video[0]!.clips.map((c) => c.id)).toEqual(["a"]);
    expect(s.video[1]!.clips[0]).toMatchObject({ id: "b", at: 3 });
  });
  test("adding footage goes on the end overlapping by a slide, or at the playhead", () => {
    expect(appendAt(base.video[0]!, 30, 0.4)).toBe(17.6);
    expect(appendAt(base.video[0]!, 11, 0.4)).toBe(11);
    expect(appendAt({ clips: [] }, 5, 0.4)).toBe(5);
  });
  test("deleting leaves the gap", () => {
    const s = removeVideo(base, ["a"]);
    expect(s.video[0]!.clips).toHaveLength(1);
    expect(s.video[0]!.clips[0]!.at).toBe(12);
  });
  test("a split keeps the footage where it was", () => {
    const s = splitVideoAt(base, 0, 4);
    const [l, r] = s.video[0]!.clips;
    expect(l).toMatchObject({ id: "a", start: 0, end: 4, at: 0 });
    expect(r).toMatchObject({ start: 4, end: 10, at: 4 });
    expect(timeTrack(s.video[0]!)[1]!.arrive).toBe("continue");
    expect(splitVideoAt(base, 0, 11)).toBe(base);
  });
  test("trimming an edge moves the edge, not the footage under it", () => {
    const s = trimVideoStart(base, "a", 2);
    expect(s.video[0]!.clips[0]).toMatchObject({ start: 2, at: 2 });
    const e = trimVideoEnd(base, "b", 20);
    // b's recording is 30s; its clip starts at source 0, at 12: the end can reach 20.
    expect(e.video[0]!.clips[1]).toMatchObject({ end: 8 });
    // a can't be trimmed past its recording's start.
    expect(trimVideoStart(base, "a", -3).video[0]!.clips[0]!.at).toBe(0);
  });
});

describe("audio", () => {
  const take = { file: "voice/takes/s-1.wav", seconds: 8, recordedAt: "", words: [] };
  const base: Sequence = { ...emptySequence("s", "s", "now"), takes: [take, { ...take, file: "voice/takes/s-2.wav", seconds: 5 }], audio: [{ id: "a1", clips: [{ id: "p", take: 0, start: 0, end: 8, at: 2 }] }] };
  test("a new take lands on the track asked for when it's free", () => {
    const { seq: s, track } = placeAudio(base, 0, clipOfTake(1, 5), 12);
    expect(track).toBe(0);
    expect(s.audio[0]!.clips.map((c) => c.at)).toEqual([2, 12]);
  });
  test("…and on a new track when something's already there, trimming nothing", () => {
    const { seq: s, track } = placeAudio(base, 0, clipOfTake(1, 5), 4);
    expect(track).toBe(1);
    expect(s.audio[0]!.clips[0]).toMatchObject({ start: 0, end: 8, at: 2 });
    expect(s.audio[1]!.clips[0]).toMatchObject({ take: 1, at: 4 });
  });
  test("a clip of a take can skip its opening", () => {
    expect(clipOfTake(0, 8, 0.6)).toMatchObject({ start: 0.6, end: 8 });
  });
  test("moving stops at neighbours; across tracks it needs room", () => {
    const s = placeAudio(base, 0, clipOfTake(1, 5), 12).seq;
    // 8s long, asked for 9: it would run into the clip at 12, so it stops against it.
    expect(moveAudio(s, "p", 0, 9).audio[0]!.clips[0]!.at).toBe(4);
    expect(fitAudio(s.audio[0]!, 9, 8, "p")).toBe(4);
    const moved = moveAudio(s, "p", 1, 1);
    expect(moved.audio[1]!.clips[0]).toMatchObject({ id: "p", at: 1 });
    expect(moved.audio[0]!.clips).toHaveLength(1);
  });
  test("split, trim", () => {
    const s = splitAudioAt(base, 0, 5);
    expect(s.audio[0]!.clips.map((c) => [c.start, c.end, c.at])).toEqual([
      [0, 3, 2],
      [3, 8, 5],
    ]);
    expect(trimAudioStart(base, "p", 4).audio[0]!.clips[0]).toMatchObject({ start: 2, at: 4 });
    expect(trimAudioEnd(base, "p", 20).audio[0]!.clips[0]!.end).toBe(8);
  });
  test("what's heard leaves out muted tracks and clips", () => {
    const s: Sequence = { ...base, audio: [...base.audio, { id: "a2", muted: true, clips: [{ id: "q", take: 1, start: 0, end: 5, at: 0 }] }, { id: "a3", clips: [{ id: "r", take: 1, start: 0, end: 5, at: 20, muted: true } as AudioClip, { id: "t", take: 1, start: 0, end: 2, at: 30 }] }] };
    expect(audioPieces(s).map((c) => c.id)).toEqual(["p", "t"]);
    expect(sequenceSeconds(s)).toBe(32);
    expect(findAudio(s, "t")).toMatchObject({ track: 2, index: 1 });
  });
});

describe("a selection moved together", () => {
  const take = { file: "voice/takes/s-1.wav", seconds: 8, recordedAt: "", words: [] };
  const s: Sequence = { ...seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 6, 12)]), takes: [take], audio: [{ id: "a1", clips: [{ id: "p", take: 0, start: 0, end: 4, at: 1 }, { id: "q", take: 0, start: 4, end: 8, at: 13 }] }] };
  test("everything shifts by the same amount", () => {
    const m = shiftClips(s, ["b", "q"], 3);
    expect(findClip(m, "b")!.clip.at).toBe(15);
    expect(findAudio(m, "q")!.clip.at).toBe(16);
    expect(findClip(m, "a")!.clip.at).toBe(0);
  });
  test("it stops at zero", () => {
    const m = shiftClips(s, ["a", "p"], -5);
    expect(findClip(m, "a")!.clip.at).toBe(0);
    expect(findAudio(m, "p")!.clip.at).toBe(1);
  });
  test("audio stops against audio: as much of the move as fits", () => {
    // q (4s at 13) back by 11 would land on p (1–5): it stops just after p instead.
    expect(findAudio(shiftClips(s, ["q"], -11), "q")!.clip.at).toBeCloseTo(5, 1);
    expect(shiftClips(s, ["q"], -11).audio[0]!.clips).toHaveLength(2);
  });
  test("a video clip stops short of being swallowed by the next", () => {
    // Both halves of a split clip dragged 14s right would put the second inside the 20s clip at 12: it goes as far as it can.
    const halves: Sequence = { ...s, video: [{ id: "v1", clips: [clip("a", "footage/a.mp4", 0, 5, 0), clip("a2", "footage/a.mp4", 5, 10, 5), clip("b", "footage/b.mp4", 0, 20, 12)] }] };
    const m = shiftClips(halves, ["a", "a2"], 14);
    const a2 = findClip(m, "a2")!.clip;
    expect(a2.at).toBeGreaterThan(5);
    expect(a2.at + 5).toBeLessThanOrEqual(32 + 0.01);
    expect(findClip(m, "a")!.clip.at).toBeCloseTo(a2.at - 5, 3);
  });
});

describe("snapping", () => {
  const s = seq([clip("a", "footage/a.mp4", 0, 10, 0), clip("b", "footage/b.mp4", 0, 6, 12)], { markers: [{ id: "m", at: 7 }] });
  test("the points: clip edges, a slide before each end, markers, the playhead", () => {
    expect(snapPoints(s, ["b"], 3.3)).toEqual([0, 3.3, 7, 9.6, 10]);
  });
  test("either edge pulls onto a point within reach", () => {
    const pts = snapPoints(s, ["b"]);
    expect(snapTo(9.7, 6, pts, 0.2)).toBe(9.6);
    expect(snapTo(3.9, 6, pts, 0.2)).toBe(4); // its end at 10
    expect(snapTo(5, 6, pts, 0.2)).toBe(5);
  });
});

describe("helpers", () => {
  test("clipOf takes a recording's facts", () => {
    const c = clipOf("footage/x.mp4", PHONE, { start: 2, at: 5, muted: true });
    expect(c).toMatchObject({ start: 2, end: 30, at: 5, sourceSeconds: 30, muted: true });
    expect(c.crop).toBeUndefined();
  });
  test("markers", () => {
    const s = addMarker(addMarker(emptySequence("s", "s"), 3), 3.01);
    expect(s.markers).toHaveLength(1);
  });
});

describe("old edits become sequences", () => {
  const old: LegacySequence = {
    id: "devlog",
    name: "Devlog",
    shots: [
      { id: "a", src: "footage/a.mp4", start: 0, end: 10, sourceSeconds: 30, aspect: 0.46 },
      { id: "b", src: "footage/b.mp4", start: 5, end: 11, sourceSeconds: 30, aspect: 0.46 },
      { id: "c", src: "footage/c.mp4", start: 20, end: 24, sourceSeconds: 30, aspect: 0.46, join: "cut" },
    ],
    over: [{ id: "o", src: "footage/code.mov", start: 0, end: 5, sourceSeconds: 100, aspect: 1.78, at: 3, muted: true }],
    markers: [{ id: "m", at: 2 }],
    slide: 0.4,
    createdAt: "then",
    updatedAt: "then",
  };
  const take = { file: "voice/takes/devlog-1.wav", seconds: 8, recordedAt: "", words: [{ text: "hi", start: 0.5, end: 0.9 }], transcribed: true };
  const own: VoiceOver = { id: "devlog", clip: "seq:devlog", takes: [take], pieces: [{ take: 0, start: 0, end: 8, at: 1 }], captionNudgeMs: -50, tidy: true, denoise: 2, volume: 0.8 };
  const alt: VoiceOver = { id: "devlog-calm", clip: "seq:devlog", takes: [{ ...take, file: "voice/takes/devlog-calm-1.wav" }], pieces: [{ take: 0, start: 0, end: 8, at: 2 }], captionNudgeMs: 0, tidy: false };
  test("shots keep the moments they played at: a slide is an overlap, a cut touches", () => {
    expect(legacyStarts(old)).toEqual([0, 9.6, 15.6]);
    const s = upgradeSequence(old);
    expect(s.video[0]!.clips.map((c) => c.at)).toEqual([0, 9.6, 15.6]);
    expect(timeTrack(s.video[0]!).map((t) => t.arrive)).toEqual(["first", "slide", "cut"]);
    expect(sequenceSeconds(s)).toBe(19.6);
    expect("join" in s.video[0]!.clips[2]!).toBe(false);
  });
  test("the top row is the second track; markers stay", () => {
    const s = upgradeSequence(old);
    expect(s.video[1]!.clips[0]).toMatchObject({ id: "o", at: 3, muted: true });
    expect(s.markers).toEqual([{ id: "m", at: 2 }]);
  });
  test("the edit's own voice-over is A1 and sets the voice; others are muted tracks with their takes along", () => {
    const s = upgradeSequence(old, [alt, own]);
    expect(s.takes.map((t) => t.file)).toEqual(["voice/takes/devlog-1.wav", "voice/takes/devlog-calm-1.wav"]);
    expect(s.audio[0]!.clips[0]).toMatchObject({ take: 0, at: 1 });
    expect(s.audio[1]).toMatchObject({ muted: true });
    expect(s.audio[1]!.clips[0]).toMatchObject({ take: 1, at: 2 });
    expect(s.voice).toEqual({ captionNudgeMs: -50, tidy: true, denoise: 2, volume: 0.8 });
    expect(audioPieces(s)).toHaveLength(1);
  });
  test("no voice-over: an empty first audio track", () => {
    const s = upgradeSequence(old);
    expect(s.audio).toEqual([{ id: "a1", clips: [] }]);
    expect(s.takes).toEqual([]);
  });
});
