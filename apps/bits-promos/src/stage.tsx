/**
 * The Stage: how footage sits inside the frame.
 *
 * A recording's *visible* rectangle is worked out exactly (aspect ÷ what
 * the framing keeps), so it can be dressed like a shot: rounded corners, a
 * hairline, a deep shadow, a soft vignette — and behind it, breathing
 * slowly, in the shapes where the footage leaves room (square, landscape),
 * the same footage blurred and warmed as the fill, the way a broadcast
 * package treats a phone clip. Overlays read the rectangle via useStage()
 * so a lower third can hug the footage instead of the frame.
 *
 * It plays a SEQUENCE (the Desk's edits: video tracks of clips, each at
 * its own time) or a plain recording as a one-clip sequence. On one track,
 * clips that overlap slide (the next comes in from the right as the last
 * leaves left), clips that touch cut, two halves of one recording carry
 * straight on (framed differently: the camera glides). Where two tracks
 * have picture the frame splits: the lower one fills its half, the upper
 * one slides into the other (top in a tall frame, right in a wide one).
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { getVideoMetadata } from "@remotion/media-utils";
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { type Box, type Clip, type Playable, WHOLE, boxAspect, clipEnd, cropBox, frameBox, isLegacySequence, layersAt, sameBox, sortClips, splitAt, stackBox, stackIntervals, stackRegions, timeTrack, upgradeSequence } from "@heroic/voiceover";
import { ditherOverlay, palette } from "./brand";
import { Backdrop, useFormat } from "./components";

/** Seconds the camera takes to glide between two framings of the same footage. */
const GLIDE = 0.6;
/** Seconds the frame takes to split when a second track comes in (and to close up after). */
const STACK_IN = 0.4;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
type Rect = { x: number; y: number; w: number; h: number };
const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });
/** Between two framings of a recording (`aspect`), shaped for a card of shape `want`: so nothing stretches while a card changes shape. */
const mixBox = (a: Box, b: Box, k: number, aspect: number, want: number): Box => {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const cx = lerp(a.x + a.w / 2, b.x + b.w / 2, k);
  const cy = lerp(a.y + a.h / 2, b.y + b.h / 2, k);
  let h = Math.min(1, lerp(a.h, b.h, k));
  let w = (want * h) / aspect;
  if (w > 1) {
    w = 1;
    h = (aspect * w) / want;
  }
  return { x: Math.max(0, Math.min(1 - w, cx - w / 2)), y: Math.max(0, Math.min(1 - h, cy - h / 2)), w, h };
};
const regionPx = (r: Box, width: number, height: number): Rect => ({ x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height });

/** A modern iPhone capture (the dynamic-island era) when nothing better is known. */
export const PHONE_ASPECT = 9 / 19.5;

export type StageBox = { x: number; y: number; w: number; h: number };
export type StageLayout = {
  box: StageBox;
  /** Free width either side of the footage. Landscape with a portrait clip
   * has ~500px a side — enough for text to live beside the play. */
  side: number;
  /** Text beside the footage (landscape) rather than over it. */
  column: boolean;
};
const StageContext = createContext<StageLayout | null>(null);

/** The footage rectangle, for overlays. Outside a Stage: the whole frame. */
export const useStage = (): StageLayout => {
  const ctx = useContext(StageContext);
  const { width, height } = useFormat();
  return ctx ?? { box: { x: 0, y: 0, w: width, h: height }, side: 0, column: false };
};

/**
 * The recording's aspect (w/h): from the prop when the Desk knows it (the
 * sidecar's facts), otherwise read off the file once — a delayRender so a
 * CLI render waits for it — and the phone guess if that fails.
 */
export const useSourceAspect = (src: string | null, given?: number): number => {
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    if (given || !src || /\.json(\?|$)/.test(src)) return;
    let done = false;
    const handle = delayRender(`stage: measuring ${src}`);
    const finish = (aspect: number | null) => {
      if (done) return;
      done = true;
      if (aspect) setMeasured(aspect);
      continueRender(handle);
    };
    getVideoMetadata(src)
      .then((m) => finish(m.width && m.height ? m.width / m.height : null))
      .catch(() => finish(null));
    return () => finish(null);
  }, [src, given]);
  return given ?? measured ?? PHONE_ASPECT;
};

/** Where the visible footage lands: fitted whole, centred, inset when the
 * shape leaves room for the frame treatment to read. */
export const layoutStage = (frame: { width: number; height: number; format: string }, aspect: number, keep: number): StageLayout => {
  const shown = aspect / keep;
  const pad = frame.format === "vertical" ? 0 : Math.round(frame.height * 0.06);
  const maxW = frame.width - pad * 2;
  const maxH = frame.height - pad * 2;
  const h = Math.min(maxH, maxW / shown);
  const w = Math.round(h * shown);
  const x = Math.round((frame.width - w) / 2);
  const y = Math.round((frame.height - h) / 2);
  const side = x;
  return { box: { x, y, w, h: Math.round(h) }, side, column: side >= 380 };
};

/** A file as fetched: this shape, or the one from before 2026-10-05 (brought up to date here, without its voice-over files). */
const asPlayable = (v: unknown): Playable | null => {
  if (isLegacySequence(v)) return upgradeSequence(v);
  const p = v as Playable | null;
  return p && Array.isArray(p.video) ? p : null;
};

/**
 * A sequence, or a plain recording as a one-clip sequence. `src` here is
 * what the template was handed: a recording, or a sequence's JSON (both
 * under public/). An inline sequence (the Desk's editor, unsaved) wins.
 */
export const useSequence = (src: string | null, inline?: Playable | null): Playable | null => {
  const isSeq = Boolean(src && /\.json(\?|$)/.test(src));
  const [loaded, setLoaded] = useState<{ src: string; seq: Playable | null } | null>(null);
  useEffect(() => {
    if (inline || !src || !isSeq) return;
    let done = false;
    const handle = delayRender(`stage: loading ${src}`);
    const finish = (seq: Playable | null) => {
      if (done) return;
      done = true;
      setLoaded({ src, seq });
      continueRender(handle);
    };
    fetch(src, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => finish(asPlayable(v)))
      .catch(() => finish(null));
    return () => finish(null);
  }, [src, inline, isSeq]);
  if (inline) return inline;
  return isSeq && loaded?.src === src ? loaded.seq : null;
};

/** Where a box of the recording sits on the video element: the element is
 * sized and shifted so exactly the box fills its parent. */
const boxStyle = (b: Box): React.CSSProperties => ({
  position: "absolute",
  left: `${(-b.x / b.w) * 100}%`,
  top: `${(-b.y / b.h) * 100}%`,
  width: `${100 / b.w}%`,
  height: `${100 / b.h}%`,
  objectFit: "fill",
});

const card = (format: string): React.CSSProperties => ({
  position: "absolute",
  borderRadius: format === "vertical" ? 22 : 28,
  overflow: "hidden",
  boxShadow: "0 0 0 1px rgba(242,233,212,0.12), 0 40px 90px rgba(0,0,0,0.6)",
  backgroundColor: palette.night,
});

const srcUrl = (src: string) => (/^(\/|https?:|blob:)/.test(src) ? src : staticFile(src));
const ends = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * One video track, every clip laid out as its own card (a phone clip and a
 * framed screen recording have different shapes). `offset` = the frame of
 * the sequence showing at this layer's frame zero (a template's
 * startFrom). `still` = the blurred fill: the same timing, no slides, no
 * sound, covering the frame.
 *
 * A clip's place in the frame depends on what else has picture at that
 * moment: alone it fills the frame; as the lower of two it shrinks into its
 * half; as the upper it takes the other half, sliding in from that edge
 * when it starts the stack, or morphing from full frame when it was already
 * playing and something came in under it.
 */
const TrackLayer: React.FC<{ seq: Playable; track: number; offset: number; muted: boolean; volume?: (frame: number) => number; still?: boolean; push?: number }> = ({ seq, track, offset, muted, volume, still, push = 0 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const shape = useFormat();
  const clips = useMemo(() => sortClips(seq.video[track]?.clips ?? []), [seq, track]);
  const timed = useMemo(() => timeTrack({ clips }), [clips]);
  const intervals = useMemo(() => stackIntervals(seq), [seq]);
  const now = (frame + offset) / fps;
  const layers = still ? [] : layersAt(seq, now);
  const role: "main" | "over" | "hidden" | "alone" = still ? "alone" : layers[0] === track ? (layers.length > 1 ? "main" : "alone") : layers[1] === track ? "over" : "hidden";
  const split = still ? 0 : splitAt(intervals, now, STACK_IN);
  const frameAspect = shape.width / shape.height;
  const regions = stackRegions(frameAspect);
  const mainHalf = regionPx(regions.main, shape.width, shape.height);
  const overHalf = regionPx(regions.over, shape.width, shape.height);
  const wide = regions.over.x > 0;
  const drift = interpolate(frame, [0, durationInFrames], [0, 1], { easing: Easing.inOut(Easing.quad), ...ends });
  const scale = 1 + push * drift;
  const stack = intervals.find((s) => now >= s.start && now < s.end);
  return (
    <>
      {clips.map((c, i) => {
        const t = timed[i]!;
        const from = Math.round(c.at * fps) - offset;
        const frames = Math.max(1, Math.round((c.end - c.start) * fps));
        if (from + frames <= 0 || from >= durationInFrames) return null;
        const inD = Math.round(t.overlap * fps);
        const outD = Math.round(t.leave * fps);
        const arriving = !still && t.arrive === "slide" && inD > 0;
        const leaving = !still && outD > 0;
        const local = frame - from;
        const x = (arriving ? interpolate(local, [0, inD], [100, 0], ends) : 0) + (leaving ? interpolate(local, [frames - outD, frames], [0, -100], ends) : 0);
        // The sound crossfades under a slide; it's silent while the clip isn't showing.
        const own = c.muted || seq.video[track]?.muted ? 0 : (c.volume ?? 1);
        const level = (f: number) => {
          const at = (from + f + offset) / fps;
          const shown = layersAt(seq, at).slice(0, 2).includes(track) ? 1 : 0;
          return shown * own * (volume ? volume(from + f) : 1) * (arriving ? interpolate(f, [0, inD], [0, 1], ends) : 1) * (leaving ? interpolate(f, [frames - outD, frames], [1, 0], ends) : 1);
        };
        // Two halves of the same footage framed differently: the camera glides from one framing to the other (a pan).
        const settled = frameBox(c, shape.format, frameAspect);
        const prev = clips[i - 1];
        const from0 = t.arrive === "continue" && prev ? frameBox(prev, shape.format, frameAspect) : null;
        const glide = from0 && !sameBox(from0, settled) ? Math.min(Math.round(GLIDE * fps), Math.floor(frames / 2)) : 0;
        const k = glide ? interpolate(local, [0, glide], [0, 1], { ...ends, easing: Easing.inOut(Easing.cubic) }) : 1;
        const alone = glide && from0 ? { x: from0.x + (settled.x - from0.x) * k, y: from0.y + (settled.y - from0.y) * k, w: from0.w + (settled.w - from0.w) * k, h: from0.h + (settled.h - from0.h) * k } : settled;
        const full = layoutStage(shape, boxAspect(alone, c.aspect), 1).box;
        // Where this card is right now.
        let at: Rect = full;
        let box: Box = alone;
        let hidden = false;
        if (role === "main") {
          at = lerpRect(full, mainHalf, split);
          box = mixBox(alone, stackBox(c, shape.format, mainHalf.w / mainHalf.h), split, c.aspect, at.w / at.h);
        } else if (role === "over") {
          // Was it already on screen (alone) when the stack began, or will it be when it ends? Then it morphs; otherwise it slides in from its edge.
          const began = stack ? c.at < stack.start - 0.01 : false;
          const stays = stack ? clipEnd(c) > stack.end + 0.01 : false;
          const edge = stack ? ((now - stack.start < stack.end - now) ? began : stays) : false;
          const overBox = stackBox(c, shape.format, overHalf.w / overHalf.h);
          if (edge) {
            at = lerpRect(full, overHalf, split);
            box = mixBox(alone, overBox, split, c.aspect, at.w / at.h);
          } else {
            const off = 1 - split;
            at = { ...overHalf, x: overHalf.x + (wide ? off * (overHalf.w + 40) : 0), y: overHalf.y - (wide ? 0 : off * (overHalf.h + 40)) };
            box = overBox;
          }
        } else if (role === "hidden") hidden = true;
        const video = <OffthreadVideo src={srcUrl(c.src)} startFrom={Math.round(c.start * fps)} muted={muted || still || Boolean(c.muted) || Boolean(seq.video[track]?.muted)} volume={still ? undefined : level} style={still ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" } : boxStyle(box)} />;
        return (
          <Sequence key={c.id} from={from} durationInFrames={frames} premountFor={fps}>
            {still ? (
              video
            ) : (
              <AbsoluteFill style={{ transform: x ? `translateX(${x}%)` : undefined, opacity: hidden ? 0 : 1 }}>
                <div style={{ ...card(shape.format), left: at.x, top: at.y, width: at.w, height: at.h }}>
                  <div style={{ position: "absolute", inset: 0, transform: push ? `scale3d(${scale}, ${scale}, 1)` : undefined, transformOrigin: "50% 50%", willChange: push ? "transform" : undefined }}>{video}</div>
                  <Dressing />
                </div>
              </AbsoluteFill>
            )}
          </Sequence>
        );
      })}
    </>
  );
};

/** The vignette and the inner hairline every card wears. */
const Dressing: React.FC = () => (
  <>
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.42) 100%)",
        pointerEvents: "none",
      }}
    />
    <div style={{ position: "absolute", inset: 0, borderRadius: "inherit", boxShadow: "inset 0 0 0 1px rgba(242,233,212,0.06)", pointerEvents: "none" }} />
  </>
);

/** Every track, bottom first. */
const Tracks: React.FC<{ seq: Playable; offset: number; muted: boolean; volume?: (frame: number) => number; still?: boolean; push?: number }> = ({ seq, ...rest }) => (
  <>
    {seq.video.map((t, i) => (
      <TrackLayer key={t.id} seq={seq} track={i} {...rest} />
    ))}
  </>
);

/** A plain recording as a sequence: one clip, as long as the video wants it (its src already a URL). */
const soloSequence = (src: string, aspect: number, cropTop: number, cropBottom: number): Playable => ({
  video: [{ id: "v1", clips: [{ id: "clip", src, start: 0, end: 1e6, at: 0, sourceSeconds: 1e6, aspect, crop: cropBox(cropTop, cropBottom) }] }],
  audio: [],
  takes: [],
  voice: { captionNudgeMs: 0, tidy: true },
  slide: 0,
});

export const Stage: React.FC<{
  /** A recording, or a sequence's JSON (staticFile paths). */
  src: string;
  /** Frames into the recording (or the sequence) the video starts at. */
  startFrom: number;
  muted: boolean;
  /** A plain recording's status/nav bars to shave (fractions of its height). A sequence's clips carry their own. */
  cropTop?: number;
  cropBottom?: number;
  /** A plain recording's width ÷ height. */
  aspect: number;
  /** Clip audio, per frame of the body. */
  volume?: (frame: number) => number;
  /** How far a push-in on the footage gets by the end of the body. Off by
   * default: the game is pixel art, and a continuous zoom over a phone
   * capture crawls a pixel at a time across those hard edges. The fill
   * breathes instead. */
  push?: number;
  /** A loop's crossfade: from body frame `from` to `to`, a second (muted)
   * copy of the footage playing from frame `source` fades up over the
   * first, so the last frame matches the replay's opening. */
  blend?: { from: number; to: number; source: number };
  /** The Desk's editor: a sequence it hasn't saved yet. */
  sequence?: Playable | null;
  children?: React.ReactNode;
}> = ({ src, startFrom, muted, cropTop = 0, cropBottom = 0, aspect, volume, push = 0, blend, sequence, children }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const shape = useFormat();
  const loaded = useSequence(src, sequence);
  const seq: Playable = useMemo(() => loaded ?? soloSequence(src, aspect, cropTop, cropBottom), [loaded, src, aspect, cropTop, cropBottom]);
  const frameAspect = shape.width / shape.height;
  // Overlays hug the first clip's card.
  const first = sortClips(seq.video[0]?.clips ?? [])[0];
  const firstBox = first ? frameBox(first, shape.format, frameAspect) : WHOLE;
  const layout = layoutStage(shape, first ? boxAspect(firstBox, first.aspect) : aspect, 1);
  // The fill only earns its decode when some card leaves room to see it.
  const fill = seq.video.some((t) =>
    t.clips.some((c) => {
      const b = layoutStage(shape, boxAspect(frameBox(c, shape.format, frameAspect), c.aspect), 1).box;
      return b.w < shape.width * 0.9 || b.h < shape.height * 0.9;
    }),
  );
  const drift = interpolate(frame, [0, durationInFrames], [0, 1], { easing: Easing.inOut(Easing.quad), extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // The blurred fill can move freely — nothing sharp in it to crawl.
  const fillScale = 1.2 + 0.1 * drift;
  const isSeq = /\.json(\?|$)/.test(src) || Boolean(sequence);
  if (isSeq && !loaded) return <AbsoluteFill style={{ backgroundColor: palette.night }} />;

  return (
    <StageContext.Provider value={layout}>
      <AbsoluteFill style={{ overflow: "hidden", backgroundColor: palette.night }}>
        <Backdrop glow={0.2} />
        {fill ? (
          <>
            <AbsoluteFill style={{ transform: `scale(${fillScale})`, filter: "blur(42px) saturate(1.35) brightness(0.5)" }}>
              <Tracks seq={seq} offset={startFrom} muted still />
            </AbsoluteFill>
            <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(36,23,8,0.35) 0%, rgba(36,23,8,0.55) 100%)` }} />
            <AbsoluteFill style={ditherOverlay} />
          </>
        ) : null}
        <Tracks seq={seq} offset={startFrom} muted={muted} volume={volume} push={push} />
        {blend ? (
          <Sequence from={blend.from} layout="none">
            <AbsoluteFill style={{ opacity: interpolate(frame, [blend.from, blend.to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              <Tracks seq={seq} offset={blend.source} muted push={push} />
            </AbsoluteFill>
          </Sequence>
        ) : null}
        {children}
      </AbsoluteFill>
    </StageContext.Provider>
  );
};

export type { Clip };
