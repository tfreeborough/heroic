import type * as React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { palette } from "./brand";
import { Backdrop, Card, Footage, Outro, PixelIcon, PreviewBanner, RecChip } from "./components";
import { DEFAULT_TAGLINE, DEV, TAGLINES } from "./data/copy";
import roster from "./data/roster.json";

export interface RosterEntry {
  id: string;
  name: string;
  icon: string;
  stats: [string, string][];
  category?: string;
}

export const findEntry = (kind: "weapon" | "ability", id: string): RosterEntry => {
  const list = (kind === "weapon" ? roster.weapons : roster.abilities) as RosterEntry[];
  const entry = list.find((e) => e.id === id) ?? list[0];
  if (!entry) throw new Error(`empty ${kind} roster — run \`bun run sync\``);
  return entry;
};

export type SpotlightProps = {
  kind: "weapon" | "ability";
  id: string;
  /** In-game footage under public/clips/ (`<kind>-<id>.mp4`). */
  clip?: string;
  clipSeconds?: number;
  /** Seconds into the recording to start from (skips the lobby beat). */
  clipStartFrom?: number;
  /** A music track under public/music/, played under the whole video. */
  music?: string;
  /** Phone recordings carry the game's audio — keep it unless it's noisy. */
  muted?: boolean;
  /** Shave the phone's status strip / nav bar: fractions of the recording's height. */
  cropTop?: number;
  cropBottom?: number;
};

/**
 * COLD OPEN — the footage is playing at frame zero (a logo screen reads as
 * an ad and eats the scroll-decision second). The preview banner rides the
 * opening beats and says what this is and that it's real; a corner REC chip
 * keeps that framing; the tagline card follows; the pitch lives in the outro.
 */
export const TIMING = { outro: 6, defaultClip: 8, noClip: 5, banner: 3.2, cardAt: 3.5, cardFor: 4 } as const;
export const spotlightSeconds = (p: SpotlightProps): number =>
  (p.clip ? (p.clipSeconds ?? TIMING.defaultClip) : TIMING.noClip) + TIMING.outro;

export const Spotlight: React.FC<SpotlightProps> = ({ kind, id, clip, clipStartFrom, music, muted = false, cropTop, cropBottom }) => {
  const entry = findEntry(kind, id);
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const bodyEnd = durationInFrames - Math.round(TIMING.outro * fps);
  const bodyOut = interpolate(frame, [bodyEnd - 8, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = TAGLINES[entry.id] ?? DEFAULT_TAGLINE;
  const bannerFrames = Math.round(TIMING.banner * fps);
  const cardAt = Math.round(TIMING.cardAt * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      {music ? <Audio src={staticFile(`music/${music}`)} volume={0.8} loop /> : null}
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {clip ? (
            <Footage cropTop={cropTop} cropBottom={cropBottom}>
              <OffthreadVideo
                src={staticFile(`clips/${clip}`)}
                startFrom={Math.round((clipStartFrom ?? 0) * fps)}
                muted={muted}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </Footage>
          ) : (
            <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
              <Backdrop glow={0.6} />
              <PixelIcon src={entry.icon} size={640} style={{ transform: "translateY(-160px)" }} />
            </AbsoluteFill>
          )}
          <PreviewBanner kindLabel={DEV.preview[kind]} name={entry.name} until={bannerFrames} />
          <RecChip from={bannerFrames + 6} />
          <Card icon={entry.icon} name={entry.name} line={line} delay={cardAt} until={cardAt + Math.round(TIMING.cardFor * fps)} />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
