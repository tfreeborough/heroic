import type * as React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { SANS, palette } from "./brand";
import { Backdrop, Card, Footage, Outro, PreviewBanner, RecChip } from "./components";

export type GameplayClipProps = {
  /** File under public/clips/, e.g. "harpoon-triple.mp4". Empty = placeholder. */
  clip: string;
  /** The banner + card title (e.g. "Match point"). */
  title: string;
  /** The card's second line. */
  line: string;
  /** Seconds of gameplay to show (trim inside the template with startFrom). */
  durationSeconds: number;
  /** Seconds into the clip to start from. */
  startFrom?: number;
  /** Phone recordings carry the game's audio — keep it unless it's noisy. */
  muted?: boolean;
  /** A music track under public/music/, played under the whole video. */
  music?: string;
  /** Shave the phone's status strip / nav bar: fractions of the recording's height. */
  cropTop?: number;
  cropBottom?: number;
};

export const CLIP_TIMING = { outro: 6, banner: 3.2, cardAt: 3.5, cardFor: 4 } as const;

/** Cold open on your recording → outro (same grammar as the spotlights). */
export const GameplayClip: React.FC<GameplayClipProps> = ({ clip, title, line, startFrom = 0, muted = false, music, cropTop, cropBottom }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const bodyEnd = durationInFrames - Math.round(CLIP_TIMING.outro * fps);
  const bodyOut = interpolate(frame, [bodyEnd - 8, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const bannerFrames = Math.round(CLIP_TIMING.banner * fps);
  const cardAt = Math.round(CLIP_TIMING.cardAt * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      {music ? <Audio src={staticFile(`music/${music}`)} volume={0.8} loop /> : null}
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {clip ? (
            <Footage cropTop={cropTop} cropBottom={cropBottom}>
              <OffthreadVideo
                src={staticFile(`clips/${clip}`)}
                startFrom={Math.round(startFrom * fps)}
                muted={muted}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </Footage>
          ) : (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <Backdrop glow={0.3} />
              <div style={{ fontFamily: SANS, fontSize: 40, color: palette.steel, textAlign: "center", padding: "0 90px" }}>
                Drop a screen recording in public/clips/ and set the clip prop
              </div>
            </AbsoluteFill>
          )}
          <PreviewBanner kindLabel="MATCH CLIP" name={title} until={bannerFrames} />
          <RecChip from={bannerFrames + 6} />
          <Card name={title} line={line} delay={cardAt} until={cardAt + Math.round(CLIP_TIMING.cardFor * fps)} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
