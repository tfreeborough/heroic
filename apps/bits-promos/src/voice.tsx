/**
 * The voice on a Blood in the Sand video: the maker talking over his own
 * game, with captions. The mechanics (the audio clips, the timing, the
 * caption pages) are @heroic/voiceover's; this file is the BITS look and
 * where the captions sit in each shape.
 *
 * The voice comes from the edit itself (a sequence's takes and audio
 * tracks), or, for a plain recording voiced before 2026-10-05, from a
 * voice-over file named by the `voice` prop. A template adds `voiceProps`
 * to its schema, calls useVoice() for the ducking level, useBed() for the
 * music, and puts <VoiceLayer> inside its Stage.
 */
import { useMemo } from "react";
import type * as React from "react";
import { z } from "zod";
import { type CaptionStyle, type Music, type Piece, type Playable, type VoiceOver, audioPieces, piecesInVideo } from "@heroic/voiceover";
import { type CaptionPlacement, type CaptionTheme, Captions, type Spoken, VoiceTrack, useDuck, useVoiceOver } from "@heroic/voiceover/remotion";
import { SANS, palette } from "./brand";
import { useType } from "./cinematic";
import { useFormat } from "./components";
import { useStage } from "./stage";

/** How far the music and the game's own sound drop while the voice talks. */
export const DUCK_LEVEL = 0.35;

/** The fields every voiced template carries (spread into its z.object). */
export const voiceProps = {
  voice: z.string().optional().describe("A voice-over file recorded against a plain recording (from before edits carried their own voice). An edit's voice is in the edit: leave this empty"),
  captions: z.enum(["off", "tiktok", "regular"]).optional().describe("Captions for the voice: tiktok (a few big words at a time, the spoken one lit), regular (a subtitle line), or off"),
  voiceVolume: z.number().min(0).max(2).optional().describe("The voice's level (default 1)"),
  duck: z.number().min(0).max(1).optional().describe("Where the music and the game's sound sit while you're talking, as a share of their own level (default 0.35; 1 = don't turn them down)"),
  voiceData: z.any().optional().describe("An unsaved voice-over, inline (the old editor); leave it alone"),
  sequenceData: z.any().optional().describe("The Desk's editor previews an edit it hasn't saved yet with this; leave it alone"),
};
export type VoiceProps = { voice?: string; captions?: CaptionStyle; voiceVolume?: number; duck?: number; voiceData?: unknown };
/** The Desk's fields a form never shows. */
export const EDITOR_ONLY = ["voiceData", "sequenceData"];
/** In a template's Desk defaults, so the choices survive a template switch. */
export const voiceDefaults = { voice: "", captions: "tiktok", voiceVolume: 1, duck: DUCK_LEVEL };

const theme: CaptionTheme = { font: SANS, color: palette.bone, active: palette.sand, ink: "#140a04", ground: palette.ink };

export type Voice = { spoken: Spoken | null; pieces: (Piece & { volume?: number; muted?: boolean })[]; duck: (frame: number) => number };

/**
 * The voice for this video: the edit's own audio tracks when `seq` has
 * takes, else the voice-over file the `voice` prop names. `startFrom` is
 * how far into the clip the video starts and `bodyFrames` how long the
 * footage runs: the voice stops with the footage, never over an end card.
 */
export const useVoice = (props: VoiceProps, seq: Playable | null, startFrom: number, bodyFrames: number, fps: number): Voice => {
  const own = Boolean(seq?.takes.length);
  const legacy = useVoiceOver(own ? undefined : props.voice || undefined, own ? null : ((props.voiceData as VoiceOver | undefined) ?? null));
  const span = bodyFrames / fps;
  const spoken: Spoken | null = useMemo(() => (own && seq ? { takes: seq.takes, captionNudgeMs: seq.voice.captionNudgeMs, volume: seq.voice.volume } : legacy), [own, seq, legacy]);
  const pieces = useMemo(() => (own && seq ? piecesInVideo(audioPieces(seq), startFrom, span) : legacy ? piecesInVideo(legacy.pieces, startFrom, span) : []), [own, seq, legacy, startFrom, span]);
  const duck = useDuck(pieces, props.duck ?? DUCK_LEVEL);
  return { spoken, pieces, duck };
};

/** The song under the video: the edit's music bed when it has one, else the template's own props. */
export const useBed = (seq: Playable | null, props: { music?: string; musicFrom?: number; musicVolume?: number }): { music?: string; from: number; level?: number } => {
  const bed: Music | undefined = seq?.music;
  if (bed?.song) return { music: bed.song, from: bed.from, level: bed.level };
  return { music: props.music, from: props.musicFrom ?? 0, level: props.musicVolume };
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
  if (!voice.spoken) return null;
  return (
    <>
      <VoiceTrack voice={voice.spoken} pieces={voice.pieces} volume={volume} />
      <Captions voice={voice.spoken} pieces={voice.pieces} style={captions} theme={theme} place={place} />
    </>
  );
};
