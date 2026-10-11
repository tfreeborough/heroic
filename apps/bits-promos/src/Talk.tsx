/**
 * TALK: the long-form video (docs/design/desk-scripts.md). The maker
 * talking for five minutes and up, landscape for YouTube, straight
 * through a Desk edit: the voice, the cards (text and sketches, drawn by
 * the Stage), the b-roll he dropped in, a music bed. The title rides the
 * opening beats as a cold open, the brand mark holds the corner, regular
 * captions along the foot, and the developer's sign-off closes it (or
 * nothing, for a video that ends on its last word).
 */
import type * as React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { SANS, palette } from "./brand";
import { BrandMark, SignOff, TitleReveal } from "./cinematic";
import { Backdrop, MusicBed } from "./components";
import { clipSrc } from "./GameplayClip";
import { VoiceLayer, useBed, useVoice, voiceProps } from "./voice";
import type { Playable } from "@heroic/voiceover";
import { Stage, useSequence, useSourceAspect } from "./stage";

export const talkSchema = z.object({
  clip: z.string().describe('A Desk edit, as a path under public/ (e.g. "sequences/devlog-1-long.json"). A plain recording works too. Empty = placeholder.'),
  title: z.string().describe("The cold-open title, over the opening beats"),
  durationSeconds: z.number().min(1).describe("Seconds of the edit to play. In the Desk, leave empty for the whole edit"),
  startFrom: z.number().min(0).optional().describe("Seconds into the edit to start from"),
  muted: z.boolean().optional().describe("Drop the footage's own sound"),
  music: z.string().optional().describe("A song from the game (public/music/) under the whole video; an edit's own music bed wins"),
  musicFrom: z.number().min(0).optional().describe("Seconds into the song to start from"),
  musicVolume: z.number().min(0).max(1).optional().describe("The song's level, 0 to 1 (default 0.8; under five minutes of talking, 0.25 is plenty)"),
  videoVolume: z.number().min(0).max(1).optional().describe("The footage's own sound, 0 to 1 (default 1)"),
  cropTop: z.number().min(0).max(0.4).optional().describe("A plain recording's status strip to shave"),
  cropBottom: z.number().min(0).max(0.4).optional().describe("A plain recording's nav bar to shave"),
  ending: z.enum(["signoff", "none"]).optional().describe("How it closes: the developer's sign-off (default), or nothing"),
  sourceAspect: z.number().min(0.2).max(5).optional().describe("A plain recording's width ÷ height; the Desk fills this"),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Output shape: 16:9 is the one it's for"),
  ...voiceProps,
});
export type TalkProps = z.infer<typeof talkSchema>;

export const TALK_TIMING = { outro: 6, titleUntil: 3.2, dip: 0.5 } as const;
export const talkDurationSeconds = (p: Pick<TalkProps, "durationSeconds" | "ending">): number => p.durationSeconds + (p.ending === "none" ? 0 : TALK_TIMING.outro);

export const Talk: React.FC<TalkProps> = ({ clip, title, durationSeconds, startFrom = 0, muted = false, music, musicFrom, musicVolume, videoVolume = 1, cropTop, cropBottom, ending = "signoff", sourceAspect, voice, voiceData, captions = "regular", voiceVolume, duck, sequenceData }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bodyEnd = Math.round(durationSeconds * fps);
  const dip = Math.round(TALK_TIMING.dip * fps);
  const bodyOut = ending === "none" ? 1 : interpolate(frame, [bodyEnd - dip, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titleUntil = Math.round(TALK_TIMING.titleUntil * fps);
  const src = clip ? clipSrc(clip) : null;
  const aspect = useSourceAspect(src, sourceAspect);
  const track = useSequence(src, (sequenceData as Playable | undefined) ?? null);
  const spoken = useVoice({ voice, voiceData, duck }, track, startFrom, bodyEnd, fps);
  const bed = useBed(track, { music, musicFrom, musicVolume });
  const clipVolume = (f: number) => spoken.duck(f) * videoVolume * (ending === "none" ? 1 : interpolate(f, [bodyEnd - fps * 0.8, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      <MusicBed music={bed.music} from={bed.from} level={bed.level} duck={spoken.duck} />
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {src ? (
            <Stage src={src} startFrom={Math.round(startFrom * fps)} muted={muted} cropTop={cropTop} cropBottom={cropBottom} aspect={aspect} volume={clipVolume} sequence={track}>
              <BrandMark from={titleUntil} />
              {title ? <TitleReveal title={title} until={titleUntil} /> : null}
              <VoiceLayer voice={spoken} captions={captions} volume={voiceVolume} />
            </Stage>
          ) : (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <Backdrop glow={0.3} />
              <div style={{ fontFamily: SANS, fontSize: 40, color: palette.steel, textAlign: "center", padding: "0 90px" }}>Pick an edit</div>
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      </Sequence>
      {ending === "none" ? null : (
        <Sequence from={bodyEnd}>
          <SignOff />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
