/**
 * What each mood and style sounds like, in words: the menu Claude chooses a
 * save's music from (Autosave's desk.server.ts), so it picks by sound, not
 * by name. Keep these in step with the tables in compose.ts.
 */
import type { StyleName } from "./compose";
import type { Mood } from "./mood";

export const MOOD_NOTES: Record<Mood, string> = {
  cosy: "warm and settled, major key, gentle swing, a crackly record in the background",
  wistful: "looking back fondly, major with a sad borrowed chord, slow, tape wobble",
  wonder: "open and dreamy, the bright floating Lydian scale, lots of reverb",
  night: "late and quiet, minor, slow, rain in the background",
  playful: "bouncy and light, major, quicker, a lot of swing",
  tender: "soft and close, major, slow, hushed",
  focus: "steady and absorbed, Dorian minor, mid tempo",
  curious: "light on its feet, wondering what's next, Lydian, mid tempo",
  tense: "uneasy and driven, minor, darker and muffled",
  eerie: "still and unsettling, minor, very roomy, sparse",
  driving: "forward motion, quicker, clean",
  melancholy: "sad and heavy-hearted, minor, slow, tape wobble",
  triumph: "big and bright, major, broad, made it",
};

export const STYLE_NOTES: Record<StyleName, string> = {
  felt: "solo felt piano, soft chords and a sparse tune, sometimes strings under",
  rhodes: "electric piano chords, music box or ocarina tune, harp or kalimba arpeggio",
  waltz: "RPG village waltz in 3/4, plucked oom-pah with a flute tune",
  chip: "chiptune: square-wave arpeggios and tune, chip drums, Game Boy era",
  ambient: "held choir or string chords, celesta or kalimba tune, very slow and spacious",
  lullaby: "3/4 music box or kalimba arpeggio over soft pads",
  guitar: "fingerpicked acoustic guitar, ocarina or piano tune",
  downtempo: "held strings or choir, kalimba or marimba arpeggio, half-time beat",
  dnb: "ambient drum and bass: fast broken beat under slow pads and a sub bass",
  marimba: "picked marimba or kalimba, hand drums, flute tune, sunny",
  harp: "fingerpicked harp over strings or choir, flute or celesta tune, storybook",
  score: "film score: held strings or choir, plucked strings running under, a march on the drums",
  vibes: "swung late-night jazz trio: vibraphone or electric piano, brushes, rim clicks",
  toybox: "celesta and music box with a wind-up arpeggio, sweet or a bit haunted",
  synthwave: "80s synthwave: fast square-wave arpeggio over pads, bouncing bass, four-on-the-floor kick, neon",
  chant: "Gregorian chant: a small choir of monks singing Latin syllables low and slow over open fifths, no beat, a cathedral's echo; solemn, ancient, or dryly ironic",
};
