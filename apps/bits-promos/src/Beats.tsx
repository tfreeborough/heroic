/**
 * BEATS: the long video made of glyph pictures (docs/design/desk-ascii-scripts.md).
 *
 *   cold open   the title builds out of glyphs and rains into the first picture
 *   the body    an organised script's edit straight through: each beat's
 *               picture builds while it's said and falls away as the next
 *               arrives; a pulled word borrows the picture's glyphs to spell
 *               itself; a chapter clears the screen and builds its name; the
 *               voice runs along the foot as a terminal line
 *   end card    every picture again as a reel, a mosaic, the channel name out
 *               of their glyphs and the sign-off, then a hold for YouTube's
 *               end-screen elements
 *
 * A quiet music bed under it all ducks a little while the maker talks (the
 * generated score replaces it in stages 4–5). Footage dropped on a video
 * track in the editor plays over the pictures. Landscape, for YouTube.
 */
import { CHAPTER_CARD, COLD_OPEN, END_CARD, LOCKED_LOOK, PALETTES } from "@heroic/ascii-build";
import { BUILD_TAIL, BuildLayer, ChapterCard, EndCard, TerminalCaptions, TextBuild } from "@heroic/ascii-build/remotion";
import { type Playable, layersAt, placedWords } from "@heroic/voiceover";
import { VoiceTrack } from "@heroic/voiceover/remotion";
import { useMemo } from "react";
import type * as React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { CINZEL } from "./brand";
import { MusicBed, useFormat } from "./components";
import { clipSrc } from "./GameplayClip";
import { GLYPH_FAMILY, buildShows } from "./glyphs";
import { Stage, useSequence } from "./stage";
import { useBed, useVoice, voiceProps } from "./voice";

const FAMILY = GLYPH_FAMILY;

export const beatsSchema = z.object({
  clip: z.string().describe('An organised script\'s edit, as a path under public/ (e.g. "sequences/devlog-long-r1.json").'),
  title: z.string().describe("The title that builds out of glyphs at the start. Leave it blank for the script's own title (organise puts it on the edit); type to use your own"),
  durationSeconds: z.number().min(1).describe("Seconds of the edit to play. In the Desk, leave empty for the whole edit"),
  startFrom: z.number().min(0).optional().describe("Seconds into the edit to start from"),
  palette: z.enum(["sand", "matrix"]).optional().describe("The glyphs' colours: matrix (green, the default) or sand (bone on near-black, the brand)"),
  cols: z.number().min(60).max(400).optional().describe("Glyph columns across a picture: more is finer detail, fewer is chunkier (default 280)"),
  opening: z.enum(["title", "none"]).optional().describe("The title cold open before the first beat, or straight in"),
  ending: z.enum(["card", "none"]).optional().describe("The end card (the reel, the mosaic, the sign-off, a hold for YouTube's end screen), or end on the last word"),
  channel: z.string().optional().describe("The name the end card builds out of glyphs"),
  signoff: z.string().optional().describe("The line typed under it"),
  music: z.string().optional().describe("A song from the game (public/music/) under the whole video, until the generated score lands; an edit's own music bed wins"),
  musicFrom: z.number().min(0).optional().describe("Seconds into the song to start from"),
  musicVolume: z.number().min(0).max(1).optional().describe("The song's level, 0 to 1 (default 0.1: it sits quietly under the talking)"),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Output shape: 16:9 is the one it's for"),
  ...voiceProps,
  captions: z.enum(["off", "terminal"]).optional().describe("The terminal line along the foot (each word decodes as it's said), or off"),
});
export type BeatsProps = z.infer<typeof beatsSchema>;

const openSeconds = (p: Pick<BeatsProps, "opening">) => (p.opening === "none" ? 0 : COLD_OPEN);
export const beatsDurationSeconds = (p: Pick<BeatsProps, "durationSeconds" | "opening" | "ending">): number => openSeconds(p) + p.durationSeconds + (p.ending === "none" ? BUILD_TAIL : END_CARD);

/** How far the music comes up where nobody talks (the title, the end card), as a multiple of its bed level. */
const UNDER_NOTHING = 2;

/** The band along the foot the captions live in, as a share of the frame's height. */
const CAPTION_BAND = 0.14;


export const Beats: React.FC<BeatsProps> = (p) => {
  const { clip, title, durationSeconds, startFrom = 0, palette = "matrix", cols = 280, music, musicFrom, musicVolume = 0.1, voice, voiceData, captions = "terminal", voiceVolume = 0.7, duck = 1, sequenceData } = p;
  const { channel = "Free the Borough Games", signoff = "Thanks for watching, and I'll see you in the next one." } = p;
  const { fps } = useVideoConfig();
  const { format, width, height } = useFormat();
  const pal = PALETTES[palette];
  const src = clip ? clipSrc(clip) : null;
  const track = useSequence(src, (sequenceData as Playable | undefined) ?? null);
  const open = openSeconds(p);
  const openFrames = Math.round(open * fps);
  const bodyEnd = Math.round(durationSeconds * fps);
  const offset = Math.round(startFrom * fps);
  const spoken = useVoice({ voice, voiceData, duck }, track, startFrom, bodyEnd, fps);
  const bed = useBed(track, { music, musicFrom, musicVolume });
  const look = useMemo(() => ({ ...LOCKED_LOOK, cols }), [cols]);
  const words = useMemo(() => (spoken.spoken ? placedWords(spoken.spoken, spoken.pieces) : []), [spoken.spoken, spoken.pieces]);

  // The pictures, each with its pulled words timed to when they're said (seconds from the card's start).
  const builds = useMemo(() => buildShows(track, words, startFrom), [track, words, startFrom]);
  const chapters = useMemo(() => (track?.overlay?.cards ?? []).filter((c) => c.kind === "chapter").sort((a, b) => a.at - b.at), [track]);
  const pictures = useMemo(() => [...new Set(builds.map((b) => b.src))], [builds]);
  // The terminal line stays off while a chapter card has the screen (video seconds from the body's start).
  const clearAt = useMemo(() => (chapters.length ? (s: number) => chapters.some((c) => s + startFrom >= c.at && s + startFrom < c.at + CHAPTER_CARD) : undefined), [chapters, startFrom]);
  const hasFootage = Boolean(track?.video.some((t) => t.clips.length));
  const hiddenAt = useMemo(() => (hasFootage && track ? (s: number) => layersAt(track, s).length > 0 : undefined), [hasFootage, track]);
  const shownTitle = (title || track?.title || "").trim();

  const band = Math.round(height * CAPTION_BAND);
  // Vertical (TikTok, Shorts): their top bar covers the top ~10%, their caption, description and buttons the
  // bottom ~25% and a rail down the right, so the picture sits between and the terminal line above the bottom
  // quarter, clear of the rail (the same safe zone as the other BITS vertical templates). Elsewhere: along the foot.
  const tall = format === "vertical";
  const layout = tall
    ? { pic: { x: 0, y: Math.round(height * 0.11), w: width, h: Math.round(height * 0.5) }, size: Math.round(width * 0.042), left: Math.round(width * 0.07), width: Math.round(width * 0.74), bottom: Math.round(height * 0.27) }
    : { pic: { x: 0, y: 0, w: width, h: height - band }, size: Math.round(Math.min(width, height) * 0.036), left: Math.round(width * 0.09), width: Math.round(width * 0.82), bottom: Math.round(band * 0.28) };
  // From the frame's short side, so a tall frame sets its titles the size a wide one does.
  const nameFont = `700 ${Math.round(Math.min(width, height) * 0.15)}px ${CINZEL}`;

  return (
    <AbsoluteFill style={{ backgroundColor: pal.bg }}>
      {/* The bed sits quiet under the talking; with nothing else playing (the title, the end card) it comes up. */}
      <MusicBed music={bed.music} from={bed.from} level={bed.level} duck={(f) => (f < openFrames || f >= openFrames + bodyEnd ? UNDER_NOTHING : spoken.duck(f - openFrames))} />

      {/* The cold open: the title builds, holds, and rains into the first picture. */}
      {open && shownTitle ? (
        <Sequence durationInFrames={openFrames + Math.round(1.2 * fps)} layout="none">
          <TextBuild
            text={shownTitle}
            font={nameFont}
            maxWidth={tall ? 1000 : 1500}
            box={{ x: width * 0.08, y: height * 0.16, w: width * 0.84, h: height * 0.6 }}
            look={look}
            cols={210}
            seed={shownTitle.length * 31 + 7}
            timing={{ start: 0.3, end: 2.3, exit: { start: open - 0.6, end: open + 0.9 } }}
            palette={pal}
            family={FAMILY}
            arrival="rain"
            order="ground"
          />
        </Sequence>
      ) : null}

      <Sequence from={openFrames} durationInFrames={bodyEnd + Math.round(BUILD_TAIL * fps)} layout="none">
        {/* Footage dropped in by hand plays over the pictures; the pictures don't draw underneath it. */}
        {hasFootage && src ? <Footage seq={track!} src={src} startFrom={offset} /> : null}
        <BuildLayer cards={builds} offset={offset} palette={pal} family={FAMILY} look={look} box={layout.pic} hiddenAt={hiddenAt} />
        {chapters.map((c, i) => {
          const from = Math.round(c.at * fps) - offset;
          if (from + CHAPTER_CARD * fps <= 0 || from >= bodyEnd) return null;
          return (
            <Sequence key={c.id} from={from} durationInFrames={Math.round((CHAPTER_CARD + 0.4) * fps)} layout="none">
              <ChapterCard name={c.text ?? ""} palette={pal} family={FAMILY} nameFont={nameFont} look={look} seed={500 + i} />
            </Sequence>
          );
        })}
        {/* A soft dark floor under the terminal line, so it reads over a picture's lower edge. */}
        {tall ? null : <AbsoluteFill style={{ background: `linear-gradient(180deg, transparent ${Math.round(100 - CAPTION_BAND * 140)}%, ${pal.bg} 100%)`, pointerEvents: "none" }} />}
        <Sequence durationInFrames={bodyEnd} layout="none">
          {spoken.spoken ? <VoiceTrack voice={spoken.spoken} pieces={spoken.pieces} volume={voiceVolume} /> : null}
          {captions !== "off" ? <TerminalCaptions words={words} palette={pal} family={FAMILY} size={layout.size} left={layout.left} width={layout.width} bottom={layout.bottom} clearAt={clearAt} /> : null}
        </Sequence>
      </Sequence>

      {p.ending !== "none" ? (
        <Sequence from={openFrames + bodyEnd} layout="none">
          <EndCard pictures={pictures} channel={channel} line={signoff} palette={pal} family={FAMILY} nameFont={nameFont} look={look} />
        </Sequence>
      ) : null}

      {/* CRT dressing, as on Autosave: scanlines and a soft vignette. */}
      <AbsoluteFill style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 2px, transparent 2px, transparent 4px)", pointerEvents: "none" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.5) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};

/** The edit's footage, shown only while some track has picture (otherwise the Stage's own backdrop would cover the glyphs). */
const Footage: React.FC<{ seq: Playable; src: string; startFrom: number }> = ({ seq, src, startFrom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const on = layersAt(seq, (frame + startFrom) / fps).length > 0;
  return (
    <AbsoluteFill style={{ opacity: on ? 1 : 0 }}>
      <Stage src={src} startFrom={startFrom} muted={false} aspect={16 / 9} sequence={seq} glyphCards={false} />
    </AbsoluteFill>
  );
};
