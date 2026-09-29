/**
 * A voice-over on a Blood in the Sand video: the maker talking over his own
 * game, with captions. The mechanics (the pieces, the timing, the caption
 * pages) are @heroic/voiceover's; this file is the BITS look and where the
 * captions sit in each shape.
 *
 * A template adds `voiceProps` to its schema, calls useVoice() for the
 * ducking level, and puts <VoiceLayer> inside its Stage.
 */
import type * as React from "react";
import { z } from "zod";
import type { CaptionStyle, Piece, VoiceOver } from "@heroic/voiceover";
import { type CaptionPlacement, type CaptionTheme, Captions, VoiceTrack, useDuck, useVideoPieces, useVoiceOver } from "@heroic/voiceover/remotion";
import { SANS, palette } from "./brand";
import { useType } from "./cinematic";
import { useFormat } from "./components";
import { useStage } from "./stage";

/** How far the music and the game's own sound drop while the voice talks. */
export const DUCK_LEVEL = 0.35;

/** The fields every voiced template carries (spread into its z.object). */
export const voiceProps = {
  voice: z.string().optional().describe("A voice-over recorded against this clip on the Voice screen. Leave the hook and the other lines empty when you use one"),
  captions: z.enum(["off", "tiktok", "regular"]).optional().describe("Captions for the voice-over: tiktok (a few big words at a time, the spoken one lit), regular (a subtitle line), or off"),
  voiceVolume: z.number().min(0).max(2).optional().describe("The voice's level (default 1)"),
  duck: z.number().min(0).max(1).optional().describe("Where the music and the game's sound sit while you're talking, as a share of their own level (default 0.35; 1 = don't turn them down)"),
  voiceData: z.any().optional().describe("The Desk's editor passes an unsaved voice-over here; leave it alone"),
  segments: z.any().optional().describe("The Desk's editor previews a cut it hasn't made yet with these (kept pieces of the recording, in seconds); leave it alone"),
  slide: z.number().min(0).max(2).optional().describe("With segments: seconds each join takes"),
};
export type VoiceProps = { voice?: string; captions?: CaptionStyle; voiceVolume?: number; duck?: number; voiceData?: unknown };
/** The Desk's fields a form never shows. */
export const EDITOR_ONLY = ["voiceData", "segments", "slide"];
/** In a template's Desk defaults, so the choices survive a template switch. */
export const voiceDefaults = { voice: "", captions: "tiktok", voiceVolume: 1, duck: DUCK_LEVEL };

const theme: CaptionTheme = { font: SANS, color: palette.bone, active: palette.sand, ink: "#140a04", ground: palette.ink };

export type Voice = { voice: VoiceOver | null; pieces: Piece[]; duck: (frame: number) => number };

/**
 * The voice-over for this video. `startFrom` is how far into the clip the
 * video starts and `bodyFrames` how long the footage runs: the voice stops
 * with the footage, never over an end card.
 */
export const useVoice = (props: VoiceProps, startFrom: number, bodyFrames: number, fps: number): Voice => {
  const voice = useVoiceOver(props.voice || undefined, (props.voiceData as VoiceOver | undefined) ?? null);
  const pieces = useVideoPieces(voice, startFrom, bodyFrames / fps);
  const duck = useDuck(pieces, props.duck ?? DUCK_LEVEL);
  return { voice, pieces, duck };
};

/**
 * Where captions sit. Vertical: centred, clear of the platforms' caption
 * block (the bottom fifth) and narrow enough to miss their button rail on
 * the right. Square: low on the footage. Landscape: across the foot of the
 * frame, under the play.
 */
const usePlacement = (): CaptionPlacement => {
  const { format, width, height } = useFormat();
  const { box } = useStage();
  const scale = useType();
  if (format === "vertical") return { centre: width / 2, bottom: Math.round(height * 0.27), width: Math.round(width * 0.72), scale };
  if (format === "square") return { centre: box.x + box.w / 2, bottom: Math.round(height * 0.12), width: Math.round(Math.min(width * 0.86, Math.max(box.w, width * 0.6))), scale };
  return { centre: width / 2, bottom: Math.round(height * 0.07), width: Math.round(width * 0.7), scale };
};

/** The sound and the words. Inside a Stage, so the captions know where the footage is. */
export const VoiceLayer: React.FC<{ voice: Voice; captions?: CaptionStyle; volume?: number }> = ({ voice, captions = "tiktok", volume = 1 }) => {
  const place = usePlacement();
  if (!voice.voice) return null;
  return (
    <>
      <VoiceTrack voice={voice.voice} pieces={voice.pieces} volume={volume} />
      <Captions voice={voice.voice} pieces={voice.pieces} style={captions} theme={theme} place={place} />
    </>
  );
};
