/**
 * A voice-over: recordings of someone talking (takes), sliced and placed
 * along a clip (pieces), with the words that were said (from Whisper).
 *
 * Two clocks, never mixed:
 *  - TAKE time: seconds into a recording. Words and a piece's slice live here.
 *  - CLIP time: seconds into the footage the voice was recorded against.
 *    Only a piece's `at` lives here.
 * A word's place on the clip is always worked out from its piece, so moving
 * or cutting a piece carries its captions with it.
 */
export type Word = {
  text: string;
  /** Seconds into the take. */
  start: number;
  end: number;
  /** Said, but kept off the captions. */
  hidden?: boolean;
};

export type Take = {
  /** Path under the game's public dir, e.g. "voice/takes/harpoon-1.wav". */
  file: string;
  seconds: number;
  /** ISO timestamp. */
  recordedAt: string;
  words: Word[];
  /** Whisper has been over it (an empty `words` then means silence, not "not yet"). */
  transcribed?: boolean;
};

export type Piece = {
  /** Index into the voice-over's takes. */
  take: number;
  /** The slice of the take, in take time. */
  start: number;
  end: number;
  /** Where the slice starts on the clip, in clip time. */
  at: number;
};

export type CaptionStyle = "off" | "tiktok" | "regular";

export type VoiceOver = {
  id: string;
  /** The footage file it was recorded against. */
  clip: string;
  takes: Take[];
  /** Kept sorted by `at`; never overlapping. */
  pieces: Piece[];
  /** Shifts every caption later (+) or earlier (−), for when the timing feels off. */
  captionNudgeMs: number;
  /** Takes are levelled and de-rumbled (the raw recording is kept beside each). */
  tidy: boolean;
  /** How hard the background noise is turned down in the takes: 0 (off) to 3 (strong). See NOISE_LEVELS. */
  denoise?: number;
  /** The voice's own level, 0–1 (1 = as the takes are). A video can turn it down further (`voiceVolume`). */
  volume?: number;
};

/** A caption that lands a frame or two ahead of its word reads as in time; one that lands with it reads as late. */
export const CAPTION_LEAD_MS = -50;

export const emptyVoiceOver = (id: string, clip: string): VoiceOver => ({ id, clip, takes: [], pieces: [], captionNudgeMs: CAPTION_LEAD_MS, tidy: true });

/** A name → the id a voice-over is filed under. Ids name files and travel in URLs and staticFile() paths, so they stay plain. */
export const voiceId = (name: string): string =>
  name
    .replace(/\.(json|mp4|mov|m4v)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voice";
