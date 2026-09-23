import type * as React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { SANS, palette } from "./brand";
import { BrandMark, LowerThird, SignOff, TitleReveal, chromeTop } from "./cinematic";
import { Backdrop, MusicBed, Outro, RecChip, useFormat } from "./components";
import { Stage, useSourceAspect } from "./stage";

/** The props panel / Desk form for a match clip. Every field described. */
export const gameplayClipSchema = z.object({
  clip: z
    .string()
    .describe('The recording, as a path under public/ (e.g. "footage/VID_1.mp4"); a bare filename means public/clips/. Empty = placeholder.'),
  title: z.string().describe('The cold-open title, in gold (e.g. "Match point")'),
  line: z.string().describe("The hook sentence on the lower third (e.g. \"He had one HP left. Then the Harpoon.\")"),
  durationSeconds: z.number().min(1).describe("Seconds of gameplay before the end card — in the Desk, leave empty for the rest of the clip"),
  startFrom: z.number().min(0).optional().describe("Seconds into the recording to start from"),
  muted: z.boolean().optional().describe("Drop the recording's own audio"),
  music: z.string().optional().describe("A song from the game (public/music/), played under the whole video. Record with Battle music off in Settings"),
  musicFrom: z.number().min(0).optional().describe("Seconds into the song to start from (the songs build, so the heavy part is usually 60s+ in)"),
  musicVolume: z.number().min(0).max(1).optional().describe("The song's level, 0 to 1 (default 0.8; the recording plays at 1)"),
  cropTop: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the top (status strip)"),
  cropBottom: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the bottom (nav bar)"),
  ending: z.enum(["signoff", "pitch"]).optional().describe("How it closes: the developer's sign-off (default) or the feature-list pitch the spotlights use"),
  push: z.number().min(0).max(0.1).optional().describe("A slow push-in on the footage, as a fraction (default 0 = still — pixel art crawls under a zoom; 0.03 if you want it anyway)"),
  sourceAspect: z.number().min(0.2).max(5).optional().describe("The recording's width ÷ height; the Desk fills this from the sidecar, a CLI render reads the file"),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Output shape: 9:16 (default), 1:1 or 16:9"),
});
export type GameplayClipProps = z.infer<typeof gameplayClipSchema>;

/**
 * The cut, in seconds: the title rides the first beats of the footage,
 * the lower third follows, and the end card closes. `outro` is the end
 * card's length whichever ending is picked, so the Desk's timing holds.
 */
export const CLIP_TIMING = { outro: 6, titleUntil: 3.0, lowerAt: 3.4, lowerFor: 4.2, dip: 0.4 } as const;

/** Total length: the cut plus the end card. */
export const gameplayClipDurationSeconds = (p: Pick<GameplayClipProps, "durationSeconds">): number => p.durationSeconds + CLIP_TIMING.outro;

/** `clip` names a file in public/clips/ unless it already carries a folder. */
export const clipSrc = (clip: string): string => staticFile(clip.includes("/") ? clip : `clips/${clip}`);

/**
 * One match clip, dressed: cold open on the footage (already playing at
 * frame zero — no logo screen), the title landing in tracked gold with the
 * "real gameplay" eyebrow, the brand mark and REC chip holding the corners,
 * the hook on a broadcast lower third, the audio easing out into a dip,
 * then the developer's sign-off. The footage itself never moves (pixel art
 * crawls under a zoom); the blurred fill breathes instead.
 */
export const GameplayClip: React.FC<GameplayClipProps> = ({ clip, title, line, startFrom = 0, muted = false, music, musicFrom, musicVolume, cropTop, cropBottom, ending = "signoff", push, sourceAspect }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { format } = useFormat();
  const bodyEnd = durationInFrames - Math.round(CLIP_TIMING.outro * fps);
  const dip = Math.round(CLIP_TIMING.dip * fps);
  const bodyOut = interpolate(frame, [bodyEnd - dip, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titleUntil = Math.round(CLIP_TIMING.titleUntil * fps);
  const lowerAt = Math.round(CLIP_TIMING.lowerAt * fps);
  const src = clip ? clipSrc(clip) : null;
  const aspect = useSourceAspect(src, sourceAspect);
  const clipVolume = (f: number) => interpolate(f, [bodyEnd - fps * 0.8, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <MusicBed music={music} from={musicFrom} level={musicVolume} />
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {src ? (
            <Stage src={src} startFrom={Math.round(startFrom * fps)} muted={muted} cropTop={cropTop} cropBottom={cropBottom} aspect={aspect} volume={clipVolume} push={push}>
              <BrandMark from={titleUntil} />
              <RecChip from={titleUntil + 6} top={chromeTop(format)} />
              {title ? <TitleReveal title={title} until={titleUntil} /> : null}
              {line ? <LowerThird kicker={title} line={line} at={lowerAt} until={lowerAt + Math.round(CLIP_TIMING.lowerFor * fps)} /> : null}
            </Stage>
          ) : (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <Backdrop glow={0.3} />
              <div style={{ fontFamily: SANS, fontSize: 40, color: palette.steel, textAlign: "center", padding: "0 90px" }}>
                Pick a recording and set the clip prop
              </div>
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>{ending === "pitch" ? <Outro /> : <SignOff />}</Sequence>
    </AbsoluteFill>
  );
};
