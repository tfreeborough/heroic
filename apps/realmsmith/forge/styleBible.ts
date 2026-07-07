/**
 * The style bible: per-asset-type prompt templates + the game's identity lines
 * (docs/design/asset-forge.md). The template — not the model — owns all brand
 * language; the user's sentence only fills the {subject} slot. It's checked in
 * so brand drift is diffable. Iterate these against real generations.
 *
 * Lesson from the first iteration: shape words ("punchy, fast attack") and
 * material lists in a FIXED suffix fight any subject they don't match (a nest
 * of skittering spiders is not punchy), and negations ("no ambience") are
 * ignored or inverted by audio models. So the fixed template carries tone
 * only, and per-subject shape/texture language comes from the LLM expander
 * below (or the user's own editing — the panel's prompt box sends verbatim).
 *
 * v1 carries the `sfx` type only; image types land with the icon pass.
 */

/** Sound identity for Enter the Gauntlet — the tone every SFX prompt carries. */
const SOUND_IDENTITY = "a dark-fantasy dungeon game — gritty and physical, never cartoonish or synthetic";

export interface SfxSpec {
  id: "sfx";
  label: string;
  provider: "elevenlabs-sfx";
  /** Takes generated per request — picking from a spread beats iterating prompts. */
  candidates: number;
  /** 0–1: how strictly ElevenLabs follows the prompt vs. improvises (their default 0.3). */
  promptInfluence: number;
  /**
   * Loudness-normalization target. -16 LUFS integrated / -1.5 dB true peak is a
   * common mobile-game level that leaves headroom under the music beds
   * (docs/design/audio.md § Assets).
   */
  loudnessLufs: number;
  truePeakDb: number;
  /** Repo-relative destination folder. */
  destination: string;
  /** Seed prompt when the user generates straight from the sentence. */
  template: (subject: string) => string;
}

export const SFX: SfxSpec = {
  id: "sfx",
  label: "Sound effect (one-shot)",
  provider: "elevenlabs-sfx",
  candidates: 3,
  promptInfluence: 0.3,
  loudnessLufs: -16,
  truePeakDb: -1.5,
  destination: "apps/enter-the-gauntlet/assets/audio/sfx",
  template: (subject) => `${subject}. A single one-shot sound effect for ${SOUND_IDENTITY}.`,
};

/**
 * The prompt expander: an LLM rewrites the user's rough sentence into a
 * provider-shaped SFX prompt — concrete sources/textures, an explicit sonic
 * shape, positive phrasing. This is where per-subject craft lives, so the
 * fixed template above can stay minimal.
 */
export const EXPANDER = {
  model: "gpt-5-mini",
  system:
    "You write prompts for ElevenLabs' sound-effects model. The user gives a rough description of a " +
    "game sound; you reply with ONE refined prompt and nothing else — no quotes, no preamble.\n" +
    "Rules:\n" +
    "- Describe the sound itself, concretely: the sources (creatures, materials, surfaces), the " +
    "actions, and the sonic texture (e.g. chitinous skittering, wet crunch, hollow thud, metallic ring).\n" +
    "- Give it a shape: how it starts, peaks, and ends, and roughly how long " +
    '("a short dry burst", "a two-second swell that dies quickly").\n' +
    "- Say what should be heard, never what should not — the model ignores negations.\n" +
    "- Audio vocabulary works: impact, whoosh, layered, close-mic'd, dry, one-shot.\n" +
    `- The sound is for ${SOUND_IDENTITY}. Let that colour material and tone choices only where it fits the subject.\n` +
    "- At most 40 words. It is a single sound effect, not music and not speech.",
} as const;
