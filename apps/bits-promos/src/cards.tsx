/**
 * The cards on a sequence's overlay track, drawn (docs/design/desk-scripts.md):
 * a TEXT card is a few words in the brand type; an IMAGE is a sketch, on
 * the backdrop or small over the footage; a B-ROLL slot draws nothing at
 * all (it's a note for the editor). A card is content; this is the look.
 *
 * `full` cards sit on the backdrop and give way to footage: while any
 * video track has picture, a full card isn't drawn (the b-roll wins).
 * `over` cards sit in the top third of a tall frame, the right third of a
 * wide one, whatever's playing. Each fades and rises in over a few frames
 * and fades out at its end. Drawn inside the Stage, under the captions.
 */
import { useMemo } from "react";
import type * as React from "react";
import { AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { CHAPTER_CARD, LOCKED_LOOK, PALETTES } from "@heroic/ascii-build";
import { BuildLayer, ChapterCard } from "@heroic/ascii-build/remotion";
import { type Card, type Playable, audioPieces, cardEnd, layersAt, piecesInVideo, placedWords, sortClips } from "@heroic/voiceover";
import { GLYPH_FAMILY, buildShows } from "./glyphs";
import { CINZEL, SANS, palette } from "./brand";
import { useFormat } from "./components";

/** Seconds a card takes to come in and to go. */
const IN = 0.3;
const OUT = 0.25;
const ends = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const srcUrl = (src: string) => (/^(\/|https?:|blob:)/.test(src) ? src : staticFile(src));

/** How big the type is for a text card: short lines big, long lines smaller, scaled to the frame. */
const textSize = (text: string, width: number, height: number, full: boolean): number => {
  const longest = Math.max(1, ...text.split("\n").map((l) => l.trim().length));
  const words = text.trim().split(/\s+/).length;
  const base = Math.min(width, height) * (full ? 0.085 : 0.05);
  const shrink = Math.min(1, 14 / Math.max(longest, 8)) * (words > 12 ? 0.8 : 1);
  return Math.round(base * Math.max(0.45, shrink));
};

const TextCard: React.FC<{ card: Card; full: boolean }> = ({ card, full }) => {
  const { width, height } = useFormat();
  const text = (card.text ?? "").trim();
  const size = textSize(text, width, height, full);
  const lines = text.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: Math.round(size * 0.35), maxWidth: full ? "80%" : "88%", textAlign: "center" }}>
      <div style={{ width: Math.round(size * 1.6), height: Math.max(3, Math.round(size * 0.08)), background: palette.crimson }} />
      <div style={{ fontFamily: full ? CINZEL : SANS, fontWeight: full ? 700 : 800, fontSize: size, lineHeight: 1.15, color: palette.bone, textShadow: "0 4px 24px rgba(0,0,0,0.6)", letterSpacing: full ? 0.5 : 0 }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
};

const ImageCard: React.FC<{ card: Card; full: boolean }> = ({ card, full }) => {
  const { width, height } = useFormat();
  if (!card.src) return null;
  const w = Math.round(Math.min(width, height) * (full ? 0.72 : 0.42));
  return <Img src={srcUrl(card.src)} style={{ width: w, height: w, objectFit: "contain", filter: "drop-shadow(0 18px 40px rgba(0,0,0,0.55))" }} />;
};

/** Where a card sits: `full` fills the frame (centred); `over` is a band in the top third (tall) or the right third (wide). */
const placeStyle = (place: Card["place"], format: string, width: number, height: number): React.CSSProperties => {
  if (place === "full") return { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" };
  if (format === "landscape") return { position: "absolute", top: 0, bottom: 0, right: 0, width: Math.round(width * 0.36), display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
  return { position: "absolute", top: Math.round(height * 0.06), left: 0, right: 0, height: Math.round(height * 0.26), display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
};

/** Inside its own Sequence: `useCurrentFrame` counts from the card's start. */
const OneCard: React.FC<{ seq: Playable; card: Card }> = ({ seq, card }) => {
  const local = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { format, width, height } = useFormat();
  const frames = Math.max(1, Math.round(card.seconds * fps));
  const now = card.at + local / fps;
  // A full card gives way to footage: nothing drawn while any track has picture.
  const covered = card.place === "full" && layersAt(seq, now).length > 0;
  if (covered) return null;
  const inF = Math.min(Math.round(IN * fps), Math.floor(frames / 2));
  const outF = Math.min(Math.round(OUT * fps), Math.floor(frames / 2));
  const k = Math.min(interpolate(local, [0, inF], [0, 1], { ...ends, easing: Easing.out(Easing.cubic) }), interpolate(local, [frames - outF, frames], [1, 0], ends));
  const rise = (1 - interpolate(local, [0, inF], [0, 1], { ...ends, easing: Easing.out(Easing.cubic) })) * 18;
  const full = card.place === "full";
  return (
    <div style={{ ...placeStyle(card.place, format, width, height), opacity: k, transform: `translateY(${rise}px)` }}>
      {card.kind === "text" ? <TextCard card={card} full={full} /> : card.kind === "image" ? <ImageCard card={card} full={full} /> : null}
    </div>
  );
};

/**
 * An edit's glyph pictures and chapter cards (docs/design/desk-ascii-scripts.md),
 * as the Beats template draws them, in whatever template plays the edit
 * (the editor's preview among them): on the matrix ground while one shows,
 * giving way to footage like a full card.
 */
const GlyphCards: React.FC<{ seq: Playable; offset: number }> = ({ seq, offset }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const pal = PALETTES.matrix;
  const look = LOCKED_LOOK;
  const startFrom = offset / fps;
  const words = useMemo(() => (seq.takes.length ? placedWords({ takes: seq.takes, captionNudgeMs: seq.voice.captionNudgeMs }, piecesInVideo(audioPieces(seq), startFrom, durationInFrames / fps)) : []), [seq, startFrom, durationInFrames, fps]);
  const builds = useMemo(() => buildShows(seq, words, startFrom), [seq, words, startFrom]);
  const chapters = useMemo(() => sortClips((seq.overlay?.cards ?? []).filter((c) => c.kind === "chapter")), [seq]);
  if (!builds.length && !chapters.length) return null;
  const now = startFrom + frame / fps;
  const footage = layersAt(seq, now).length > 0;
  const showing = !footage && [...builds, ...chapters].some((c) => now >= c.at && now < c.at + c.seconds + 0.5);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {showing ? <AbsoluteFill style={{ backgroundColor: pal.bg }} /> : null}
      <BuildLayer cards={builds} offset={offset} palette={pal} family={GLYPH_FAMILY} look={look} hiddenAt={(s) => layersAt(seq, s).length > 0} />
      {chapters.map((c, i) => {
        const from = Math.round(c.at * fps) - offset;
        if (from + CHAPTER_CARD * fps <= 0 || from >= durationInFrames || footage) return null;
        return (
          <Sequence key={c.id} from={from} durationInFrames={Math.round((CHAPTER_CARD + 0.4) * fps)} layout="none">
            <ChapterCard n={c.n ?? i + 1} name={c.text ?? ""} palette={pal} family={GLYPH_FAMILY} nameFont={`700 ${Math.round(Math.min(width, height) * 0.15)}px ${CINZEL}`} look={look} seed={500 + i} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/** Every card of the sequence, each in its own Sequence so it only exists while it shows. `offset` = the sequence frame at this layer's frame zero. `glyphs`: draw the glyph pictures and chapters too. */
export const CardsLayer: React.FC<{ seq: Playable; offset: number; glyphs?: boolean }> = ({ seq, offset, glyphs = true }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const cards = sortClips(seq.overlay?.cards ?? []).filter((c) => c.kind === "text" || c.kind === "image");
  if (!cards.length) return glyphs ? <GlyphCards seq={seq} offset={offset} /> : null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {glyphs ? <GlyphCards seq={seq} offset={offset} /> : null}
      {cards.map((c) => {
        const from = Math.round(c.at * fps) - offset;
        const frames = Math.max(1, Math.round((cardEnd(c) - c.at) * fps));
        if (from + frames <= 0 || from >= durationInFrames) return null;
        return (
          <Sequence key={c.id} from={from} durationInFrames={frames} layout="none">
            <OneCard seq={seq} card={c} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
