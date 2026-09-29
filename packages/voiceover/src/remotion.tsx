/**
 * The voice-over inside a Remotion template: load it, play its pieces,
 * draw its captions, and tell the music when to get out of the way.
 *
 * A template gives `startFrom` (seconds into the clip the video starts at)
 * wherever one is asked for, because a voice-over is timed against the
 * CLIP; everything here converts to video time.
 */
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { Audio, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { activeWord, bareWord, pageAt, pagesOf } from "./captions";
import { duckAt, piecesInVideo, placedWords } from "./timeline";
import type { CaptionStyle, Piece, VoiceOver } from "./types";

/**
 * The voice-over at `path` (under public/, e.g. "voice/harpoon.json"), or
 * `inline` when the Desk's Voice screen is previewing an edit it hasn't
 * saved. A render waits for the file; a missing one renders silent.
 */
export const useVoiceOver = (path?: string, inline?: VoiceOver | null): VoiceOver | null => {
  const [loaded, setLoaded] = useState<{ path: string; voice: VoiceOver | null } | null>(null);
  useEffect(() => {
    if (inline || !path) return;
    let done = false;
    const handle = delayRender(`voice-over: loading ${path}`);
    const finish = (voice: VoiceOver | null) => {
      if (done) return;
      done = true;
      setLoaded({ path, voice });
      continueRender(handle);
    };
    fetch(staticFile(path), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<VoiceOver>) : null))
      .then((v) => finish(v && Array.isArray(v.pieces) && Array.isArray(v.takes) ? v : null))
      .catch(() => finish(null));
    return () => {
      if (!done) {
        done = true;
        continueRender(handle);
      }
    };
  }, [path, inline]);
  if (inline) return inline;
  return path && loaded?.path === path ? loaded.voice : null;
};

/** The pieces in video time, cut to the span the voice may be heard in. */
export const useVideoPieces = (voice: VoiceOver | null, startFrom = 0, seconds?: number): Piece[] => {
  const { fps, durationInFrames } = useVideoConfig();
  const span = seconds ?? durationInFrames / fps;
  return useMemo(() => (voice ? piecesInVideo(voice.pieces, startFrom, span) : []), [voice, startFrom, span]);
};

/**
 * A level for everything that isn't the voice: multiply the music's and the
 * footage's volume by it. `depth` is where they sit while the voice talks
 * (0.35 = about a third); 1 turns ducking off.
 */
export const useDuck = (pieces: Piece[], depth = 0.35): ((frame: number) => number) => {
  const { fps } = useVideoConfig();
  return useMemo(() => (pieces.length && depth < 1 ? (frame: number) => duckAt(pieces, frame / fps, depth) : () => 1), [pieces, depth, fps]);
};

/** The voice itself: one <Audio> per piece, de-clicked at both ends. */
export const VoiceTrack: React.FC<{ voice: VoiceOver; pieces: Piece[]; volume?: number }> = ({ voice, pieces, volume: asked = 1 }) => {
  const { fps } = useVideoConfig();
  // The voice-over's own level (set where it's edited) times the video's.
  const volume = asked * Math.max(0, Math.min(1, voice.volume ?? 1));
  return (
    <>
      {pieces.map((p, i) => {
        const take = voice.takes[p.take];
        if (!take) return null;
        const from = Math.round(p.at * fps);
        const frames = Math.round((p.at + (p.end - p.start)) * fps) - from;
        if (frames < 1) return null;
        const fade = Math.min(2, Math.floor(frames / 2));
        const level = fade ? (f: number) => volume * interpolate(f, [0, fade, frames - fade, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : volume;
        return (
          <Sequence key={`${p.take}-${p.start}-${p.at}-${i}`} from={from} durationInFrames={frames} layout="none">
            <Audio src={staticFile(take.file)} startFrom={Math.round(p.start * fps)} volume={level} />
          </Sequence>
        );
      })}
    </>
  );
};

/** How a game dresses its captions. Sizes are for a 1080-wide vertical frame; `scale` shrinks them for other shapes. */
export type CaptionTheme = {
  /** CSS font-family. */
  font: string;
  color: string;
  /** The word being said (tiktok). */
  active: string;
  /** The outline and shadow round tiktok words; the band behind a regular caption. */
  ink: string;
  /** Behind a regular caption. */
  ground: string;
};

export type CaptionPlacement = {
  /** Centre line of the caption block, px from the left. */
  centre: number;
  /** Its bottom edge, px from the bottom of the frame. */
  bottom: number;
  /** The widest a caption may be. */
  width: number;
  /** Type scale: 1 on a vertical frame. */
  scale: number;
};

export const Captions: React.FC<{
  voice: VoiceOver;
  /** Already in video time (useVideoPieces). */
  pieces: Piece[];
  style: CaptionStyle;
  theme: CaptionTheme;
  place: CaptionPlacement;
}> = ({ voice, pieces, style, theme, place }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = useMemo(() => (style === "off" ? [] : pagesOf(placedWords(voice, pieces), style)), [voice, pieces, style]);
  if (style === "off") return null;
  const t = frame / fps;
  const page = pageAt(pages, t);
  if (!page) return null;
  const since = (t - page.start) * fps;
  const k = place.scale;
  const box: React.CSSProperties = {
    position: "absolute",
    left: place.centre - place.width / 2,
    width: place.width,
    bottom: place.bottom,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
  };

  if (style === "regular") {
    const size = Math.round(46 * k);
    const lit = activeWord(page, t);
    return (
      <div style={box}>
        <div
          style={{
            fontFamily: theme.font,
            fontWeight: 600,
            fontSize: size,
            lineHeight: 1.28,
            color: theme.color,
            background: theme.ground,
            padding: `${Math.round(size * 0.28)}px ${Math.round(size * 0.5)}px`,
            borderRadius: Math.round(size * 0.22),
            textAlign: "center",
            textWrap: "balance",
            opacity: interpolate(since, [0, 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          } as React.CSSProperties}
        >
          {/* The word being said, in the active colour. Colour only: a change of size or weight would re-flow the line under the reader. */}
          {page.words.map((w, i) => (
            <span key={i} style={i === lit ? { color: theme.active } : undefined}>
              {i ? " " : ""}
              {w.text.trim()}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const size = Math.round(88 * k);
  const active = activeWord(page, t);
  const stroke = Math.max(2, Math.round(size * 0.075));
  // The page lands with a small settle; each word pops as it's said.
  const settle = interpolate(since, [0, 4], [0.92, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={box}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: Math.round(size * 0.3), rowGap: 0, transform: `scale(${settle})`, transformOrigin: "50% 100%" }}>
        {page.words.map((w, i) => {
          const on = i === active;
          const pop = on ? interpolate((t - w.start) * fps, [0, 3, 7], [1, 1.12, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontFamily: theme.font,
                fontWeight: 800,
                fontSize: size,
                lineHeight: 1.12,
                letterSpacing: -size * 0.012,
                color: on ? theme.active : theme.color,
                WebkitTextStroke: `${stroke}px ${theme.ink}`,
                paintOrder: "stroke fill",
                textShadow: `0 ${Math.round(size * 0.05)}px 0 ${theme.ink}, 0 ${Math.round(size * 0.1)}px ${Math.round(size * 0.3)}px rgba(0,0,0,0.55)`,
                transform: `scale(${pop})`,
                transformOrigin: "50% 80%",
              }}
            >
              {bareWord(w.text)}
            </span>
          );
        })}
      </div>
    </div>
  );
};
