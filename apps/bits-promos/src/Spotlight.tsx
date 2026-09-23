import type * as React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { palette } from "./brand";
import { BrandMark, Embers, LowerThird, SignOff, chromeTop } from "./cinematic";
import { Backdrop, Outro, RecChip, useFormat } from "./components";
import { clipSrc } from "./GameplayClip";
import { DEFAULT_TAGLINE } from "./data/copy";
import roster from "./data/roster.json";
import { ItemReveal } from "./spotlightKit";
import { Stage, useSourceAspect } from "./stage";

export interface RosterEntry {
  id: string;
  name: string;
  icon: string;
  /** The item's codex quote, synced from the game. */
  tagline?: string;
  stats: [string, string][];
  category?: string;
}

export const findEntry = (kind: "weapon" | "ability", id: string): RosterEntry => {
  const list = (kind === "weapon" ? roster.weapons : roster.abilities) as RosterEntry[];
  const entry = list.find((e) => e.id === id) ?? list[0];
  if (!entry) throw new Error(`empty ${kind} roster — run \`bun run sync\``);
  return entry;
};

/** The props panel / Desk form for a weapon or ability spotlight. */
export const spotlightSchema = z.object({
  kind: z.enum(["weapon", "ability"]).describe("Which roster the id comes from"),
  id: z.string().describe('The item id from the sim, e.g. "blade" or "sinkhole"'),
  clip: z
    .string()
    .optional()
    .describe('In-game footage as a path under public/ (e.g. "footage/x.mp4"); a bare filename means public/clips/ (the rig captures, <kind>-<id>.mp4)'),
  clipSeconds: z.number().min(1).optional().describe("Seconds of footage before the end card — in the Desk, leave empty for the rest of the clip"),
  clipStartFrom: z.number().min(0).optional().describe("Seconds into the recording to start from (skips the lobby beat)"),
  music: z.string().optional().describe("A track under public/music/, played under the whole video"),
  muted: z.boolean().optional().describe("Drop the recording's own audio"),
  cropTop: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the top (status strip)"),
  cropBottom: z.number().min(0).max(0.4).optional().describe("Fraction of the recording's height to shave off the bottom (nav bar)"),
  ending: z.enum(["pitch", "signoff"]).optional().describe("How it closes: the feature-list pitch (default for spotlights) or the indie sign-off the match clip uses"),
  sourceAspect: z.number().min(0.2).max(5).optional().describe("The recording's width ÷ height; the Desk fills this from the sidecar, a CLI render reads the file"),
  format: z.enum(["vertical", "square", "landscape"]).optional().describe("Output shape: 9:16 (default), 1:1 or 16:9"),
});
export type SpotlightProps = z.infer<typeof spotlightSchema>;

/**
 * COLD OPEN — the footage is playing at frame zero (a logo screen reads as
 * an ad and eats the scroll-decision second). The item's reveal rides the
 * opening beats — a weapon slams in, an ability rises — with the sim's
 * numbers on a spec plate; the corner chrome holds; the tagline follows
 * on an icon-led lower third; the pitch lives in the end card.
 */
export const TIMING = { outro: 6, defaultClip: 8, noClip: 5, reveal: 3.2, cardAt: 3.5, cardFor: 4 } as const;
export const spotlightSeconds = (p: SpotlightProps): number =>
  (p.clip ? (p.clipSeconds ?? TIMING.defaultClip) : TIMING.noClip) + TIMING.outro;

export const Spotlight: React.FC<SpotlightProps> = ({ kind, id, clip, clipStartFrom, music, muted = false, cropTop, cropBottom, ending = "pitch", sourceAspect }) => {
  const entry = findEntry(kind, id);
  const { format } = useFormat();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const bodyEnd = durationInFrames - Math.round(TIMING.outro * fps);
  const dip = Math.round(0.4 * fps);
  const bodyOut = interpolate(frame, [bodyEnd - dip, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = entry.tagline ?? DEFAULT_TAGLINE;
  const revealUntil = Math.round(TIMING.reveal * fps);
  const cardAt = Math.round(TIMING.cardAt * fps);
  const cardUntil = cardAt + Math.round(TIMING.cardFor * fps);
  const src = clip ? clipSrc(clip) : null;
  const aspect = useSourceAspect(src, sourceAspect);
  const clipVolume = (f: number) => interpolate(f, [bodyEnd - fps * 0.8, bodyEnd], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const musicVolume = (f: number) => interpolate(f, [durationInFrames - fps * 1.6, durationInFrames], [0.8, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const top = chromeTop(format);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.night }}>
      {music ? <Audio src={staticFile(`music/${music}`)} volume={musicVolume} loop /> : null}
      <Sequence durationInFrames={bodyEnd}>
        <AbsoluteFill style={{ opacity: bodyOut }}>
          {src ? (
            <Stage src={src} startFrom={Math.round((clipStartFrom ?? 0) * fps)} muted={muted} cropTop={cropTop} cropBottom={cropBottom} aspect={aspect} volume={clipVolume}>
              <BrandMark from={revealUntil} />
              <RecChip from={revealUntil + 6} top={top} />
              <ItemReveal kind={kind} entry={entry} until={revealUntil} />
              <LowerThird kicker={entry.name} line={line} at={cardAt} until={cardUntil} icon={entry.icon} />
            </Stage>
          ) : (
            <AbsoluteFill>
              <Backdrop glow={0.6} />
              <Embers />
              <BrandMark from={0} />
              {/* No footage: the reveal is the whole show, and stays. */}
              <ItemReveal kind={kind} entry={entry} until={bodyEnd + 30} centred />
              <LowerThird kicker={entry.name} line={line} at={cardAt} until={bodyEnd + 30} />
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      </Sequence>
      <Sequence from={bodyEnd}>{ending === "signoff" ? <SignOff /> : <Outro />}</Sequence>
    </AbsoluteFill>
  );
};
