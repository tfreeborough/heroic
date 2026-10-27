/**
 * Writes a save's music from its seed and mood: soft loading-screen music
 * that follows the video.
 *
 * Two choices shape a track:
 *   mood   (from the memory's words) the harmony and feel: mode, tempo,
 *          how bright, how much room, the background texture
 *   style  (the seed, from the styles that suit the mood) the arrangement:
 *          felt piano, electric piano, village waltz, chiptune, ambient
 *          choir, lullaby, guitar, downtempo, ambient drum and bass
 * then the seed picks everything inside them: key, progression, colour of
 * the chords, instruments, the little tune, arpeggio pattern.
 *
 * It's shaped to the save, not just laid under it:
 *   build    chords + a sparse tune; bass, arpeggio and drums join after a
 *            bar; the sound opens up (brighter) as the bar fills
 *   ~99%     tune, arpeggio and drums stop on a hanging chord (it holds its breath)
 *   saved    the home chord lands with the chime; the tune answers it a beat later
 *   exit     it closes back down; a reversed chord swells into the loop point,
 *            so the end leads straight into the start (it's made to loop)
 *
 * The chime (public/sfx/chime.mp3) is in C (C, E, F, B), so every key is a
 * white-key mode (C Ionian, D Dorian, F Lydian, G Mixolydian, A Aeolian) moved
 * by `chimeShift` semitones; the video plays the chime moved the same amount.
 *
 * Pure: (seed, mood, moments) → a list of notes plus a few curves.
 * src/music/render.ts turns it into sound.
 */
import { mulberry } from "@heroic/ascii-build";
import { LEAD_INS, type Chord, type Mode, SCALES, chordName, harmony } from "./harmony";
import type { Mood } from "./mood";

export type Inst =
  | "epiano" | "piano" | "musicbox" | "celesta" | "kalimba" | "marimba" | "vibes" | "ocarina" | "flute" | "harp" | "guitar" | "pizz" | "pulse"
  | "pad" | "choir" | "strings" | "chant"
  | "bass" | "sub" | "tri"
  | "kick" | "snare" | "hat" | "shaker" | "rim" | "chipkick" | "chipsnare" | "chiphat";
export type Texture = "crackle" | "tape" | "rain" | "hiss" | "none";
/** A sung syllable's vowel (the chant). */
export type Vowel = "a" | "e" | "i" | "o" | "u";
export type { Mode };

export type Note = {
  t: number;
  dur: number;
  midi: number;
  vel: number;
  inst: Inst;
  /** -1 left … 1 right. */
  pan: number;
  /** Played backwards, ending at t + dur (the swell into the loop). */
  reverse?: boolean;
  /** The chant's syllable (else one is picked by where the note falls). */
  vowel?: Vowel;
  /** The chant: a syllable (the lips open into the vowel) or a held note that swells in; unset, short notes are syllables. */
  sung?: "syllable" | "hold";
};

/** When things happen in the video, in seconds (from Save.tsx's timeline). */
export type Moments = { seconds: number; buildEnd: number; saved: number; exitStart: number };

export type Score = {
  seconds: number;
  mood: Mood;
  style: StyleName;
  notes: Note[];
  /** Pad brightness in Hz over the video. */
  cutoff: (t: number) => number;
  /** Overall level, 0..1, over the video. */
  level: (t: number) => number;
  texture: Texture;
  reverb: { rt60: number; wet: number };
  /** Tape wobble, 0 = none. */
  wow: number;
  /** Master lowpass, Hz: lower = softer, older. */
  lowpass: number;
  /** Semitones to move the chime so it sits in this key. */
  chimeShift: number;
  /** One line saying what the seed chose. */
  label: string;
  /** false: a piece that runs once, start to end (journey.ts); notes past the end are cut,
   * effects run once. Default: a loop (a save's tune), where the end rings into the start. */
  loop?: boolean;
};

// ------------------------------------------------------------------ harmony

/** The white-key tonic of each mode, so the C chime fits. */
const WHITE: Record<Mode, number> = { ionian: 0, dorian: 2, lydian: 5, mixolydian: 7, aeolian: 9 };
/** Scale degrees the tune may use (0-based): the clash-free ones. */
const TUNE: Record<Mode, number[]> = {
  ionian: [0, 1, 2, 4, 5],
  dorian: [0, 1, 2, 3, 4, 6],
  lydian: [0, 1, 2, 3, 4, 6],
  mixolydian: [0, 1, 2, 4, 5, 6],
  aeolian: [0, 1, 2, 3, 4, 6],
};

// ------------------------------------------------------------------- moods

type MoodPreset = {
  modes: Mode[];
  bpm: [number, number];
  textures: Texture[];
  rt60: number;
  wet: number;
  wow: number;
  lowpass: number;
  brightness: number;
  swing: number;
  /** The nostalgic borrowed minor IV before home (Ionian only). */
  minorFour?: number;
  /** Land on the VI instead of home (Aeolian only): a softer, sadder save. */
  deceptive?: number;
};

const MOODS: Record<Mood, MoodPreset> = {
  cosy: { modes: ["ionian", "mixolydian"], bpm: [66, 80], textures: ["crackle", "crackle", "hiss"], rt60: 1.8, wet: 0.22, wow: 0.3, lowpass: 7000, brightness: 0.9, swing: 0.56 },
  wistful: { modes: ["ionian", "dorian"], bpm: [60, 72], textures: ["tape", "crackle"], rt60: 2.6, wet: 0.3, wow: 1, lowpass: 6000, brightness: 0.8, swing: 0.54, minorFour: 0.5 },
  wonder: { modes: ["lydian", "lydian", "ionian"], bpm: [62, 76], textures: ["none", "hiss"], rt60: 4, wet: 0.4, wow: 0.15, lowpass: 9000, brightness: 1.2, swing: 0.5 },
  night: { modes: ["aeolian", "dorian"], bpm: [54, 66], textures: ["rain", "rain", "hiss"], rt60: 3.5, wet: 0.36, wow: 0.4, lowpass: 5500, brightness: 0.7, swing: 0.52, deceptive: 0.35 },
  playful: { modes: ["ionian", "mixolydian", "lydian"], bpm: [78, 94], textures: ["none", "crackle"], rt60: 1.4, wet: 0.18, wow: 0.2, lowpass: 9000, brightness: 1.1, swing: 0.6 },
  tender: { modes: ["ionian", "lydian"], bpm: [64, 76], textures: ["hiss", "tape"], rt60: 2.4, wet: 0.3, wow: 0.5, lowpass: 6500, brightness: 0.75, swing: 0.5 },
  // For telling a story (journey.ts): the score moves between these under one key and tempo.
  focus: { modes: ["dorian", "ionian"], bpm: [70, 84], textures: ["hiss", "none"], rt60: 2, wet: 0.24, wow: 0.2, lowpass: 7500, brightness: 0.85, swing: 0.52 },
  curious: { modes: ["lydian", "lydian", "ionian"], bpm: [72, 86], textures: ["none", "hiss"], rt60: 2.2, wet: 0.26, wow: 0.2, lowpass: 8500, brightness: 1, swing: 0.55 },
  tense: { modes: ["aeolian", "aeolian", "dorian"], bpm: [68, 80], textures: ["hiss", "none"], rt60: 2.8, wet: 0.3, wow: 0.3, lowpass: 5000, brightness: 0.6, swing: 0.5 },
  eerie: { modes: ["aeolian", "dorian"], bpm: [56, 66], textures: ["hiss", "rain"], rt60: 4.5, wet: 0.42, wow: 0.6, lowpass: 5500, brightness: 0.65, swing: 0.5 },
  driving: { modes: ["dorian", "mixolydian", "aeolian"], bpm: [84, 96], textures: ["none"], rt60: 1.8, wet: 0.2, wow: 0.1, lowpass: 9000, brightness: 1.05, swing: 0.5 },
  melancholy: { modes: ["aeolian", "dorian"], bpm: [58, 70], textures: ["tape", "hiss"], rt60: 3.2, wet: 0.34, wow: 0.6, lowpass: 5500, brightness: 0.7, swing: 0.52 },
  triumph: { modes: ["ionian", "lydian", "mixolydian"], bpm: [76, 90], textures: ["none"], rt60: 3, wet: 0.3, wow: 0.1, lowpass: 10000, brightness: 1.2, swing: 0.5 },
};

// ------------------------------------------------------------------ styles

type Play = "strike" | "hold" | "pick" | "chiparp" | "oompah" | "organum";
type Bass = "soft" | "sub" | "tri" | "none";
type Groove = "halftime" | "dnb" | "chip" | "brush" | "hand" | "march" | "four" | "pulse";

type Style = {
  moods: Mood[];
  /** Overrides the mood's tempo. */
  bpm?: [number, number];
  meter?: number;
  barsPerChord?: number;
  chords: [Inst, Play][];
  /** A quiet sustained layer under the chords (null = none). */
  pad: (Inst | null)[];
  tune: Inst[];
  /** Eighths per tune step (2 = the tune moves in quarter notes). */
  tuneUnit?: number;
  density: [number, number];
  arp: number;
  arpInst: Inst[];
  /** Arpeggio notes per beat. */
  arpRate: number[];
  bass: Bass[];
  drums?: Groove[];
  textures?: Texture[];
  rtScale?: number;
  lowpass?: number;
  swing?: number;
};

const STYLES = {
  felt: { moods: ["wistful", "night", "tender", "cosy", "wonder", "focus", "melancholy", "tense", "eerie"], chords: [["piano", "strike"]], pad: [null, "strings", "pad"], tune: ["piano"], density: [2, 4], arp: 0.25, arpInst: ["piano"], arpRate: [2], bass: ["none", "soft"] },
  rhodes: { moods: ["cosy", "wistful", "night", "playful", "focus", "curious"], chords: [["epiano", "strike"]], pad: ["pad", null], tune: ["musicbox", "ocarina", "vibes", "epiano"], density: [3, 5], arp: 0.4, arpInst: ["harp", "kalimba"], arpRate: [2], bass: ["soft"] },
  // Lo-fi (boom-bap) was here; cut 10-10 (Tom: the beat felt off). The waltz
  // is RPG-village music: plucked "oom" on one, "pah pah" on two and three.
  waltz: { moods: ["cosy", "playful", "wistful", "wonder", "curious"], meter: 3, bpm: [100, 120], barsPerChord: 2, chords: [["pizz", "oompah"], ["harp", "oompah"], ["guitar", "oompah"]], pad: [null, "strings"], tune: ["flute", "ocarina"], tuneUnit: 2, density: [3, 5], arp: 0, arpInst: [], arpRate: [], bass: ["none"], textures: ["none", "hiss", "crackle"] },
  chip: { moods: ["playful", "wistful", "wonder", "cosy", "driving", "curious"], bpm: [76, 96], chords: [["pulse", "chiparp"]], pad: [null], tune: ["pulse"], density: [3, 6], arp: 0, arpInst: [], arpRate: [], bass: ["tri"], drums: ["chip"], textures: ["none", "hiss"], rtScale: 0.6, lowpass: 6500 },
  ambient: { moods: ["wonder", "night", "tender", "wistful", "eerie", "tense", "melancholy", "triumph"], bpm: [52, 66], chords: [["choir", "hold"], ["strings", "hold"], ["pad", "hold"]], pad: [null], tune: ["celesta", "kalimba", "vibes", "musicbox"], density: [1, 2], arp: 0.5, arpInst: ["celesta", "harp"], arpRate: [1, 2], bass: ["none", "sub"], rtScale: 1.4 },
  lullaby: { moods: ["tender", "cosy", "wistful", "wonder"], meter: 3, bpm: [70, 84], chords: [["pad", "hold"], ["strings", "hold"]], pad: [null], tune: ["musicbox", "kalimba", "celesta"], density: [2, 3], arp: 1, arpInst: ["musicbox", "kalimba", "harp"], arpRate: [2], bass: ["soft"] },
  guitar: { moods: ["cosy", "wistful", "wonder", "night", "focus", "curious", "melancholy"], chords: [["guitar", "pick"]], pad: [null, "strings", "pad"], tune: ["ocarina", "piano", "vibes"], density: [2, 4], arp: 0, arpInst: [], arpRate: [], bass: ["none"] },
  downtempo: { moods: ["night", "wonder", "wistful", "cosy", "driving", "focus", "tense", "triumph"], bpm: [78, 92], chords: [["strings", "hold"], ["choir", "hold"], ["pad", "hold"]], pad: [null], tune: ["kalimba", "vibes", "piano", "marimba"], density: [2, 4], arp: 0.7, arpInst: ["kalimba", "marimba"], arpRate: [2], bass: ["sub"], drums: ["halftime"] },
  dnb: { moods: ["night", "wonder", "wistful", "driving", "tense"], bpm: [164, 174], barsPerChord: 2, chords: [["pad", "hold"], ["choir", "hold"], ["strings", "hold"]], pad: [null], tune: ["piano", "vibes", "celesta"], tuneUnit: 2, density: [2, 4], arp: 0.4, arpInst: ["celesta", "kalimba"], arpRate: [1], bass: ["sub"], drums: ["dnb"], rtScale: 1.1 },
  // Added 10-12 so neighbouring saves have more to choose from (every mood
  // now has at least four styles). Same instruments, new arrangements.
  // Marimba: picked wooden chords, a hand-drum groove, a flute on top.
  marimba: { moods: ["playful", "curious", "cosy", "driving", "focus"], bpm: [84, 100], chords: [["marimba", "pick"], ["kalimba", "pick"]], pad: [null, "pad"], tune: ["flute", "ocarina", "vibes"], density: [3, 5], arp: 0, arpInst: [], arpRate: [], bass: ["soft"], drums: ["hand"], textures: ["none", "hiss"], rtScale: 0.8 },
  // Harp: fingerpicked harp over strings or choir, a flute or celesta tune.
  harp: { moods: ["tender", "wonder", "melancholy", "wistful", "eerie"], chords: [["harp", "pick"]], pad: ["strings", "choir"], tune: ["flute", "celesta", "ocarina"], density: [2, 3], arp: 0, arpInst: [], arpRate: [], bass: ["none", "sub"], rtScale: 1.2 },
  // Score: held strings or choir with plucked strings running under, a march on the drums.
  score: { moods: ["triumph", "tense", "wonder", "driving", "melancholy"], chords: [["strings", "hold"], ["choir", "hold"]], pad: ["pad", null], tune: ["piano", "flute", "vibes"], density: [2, 4], arp: 0.8, arpInst: ["pizz", "harp"], arpRate: [2], bass: ["sub"], drums: ["march"], rtScale: 1.2 },
  // Vibes: a swung late-night trio, brushes and rim clicks.
  vibes: { moods: ["night", "focus", "cosy", "curious", "melancholy"], chords: [["vibes", "strike"], ["epiano", "strike"]], pad: ["pad", null], tune: ["flute", "piano", "ocarina"], density: [3, 5], arp: 0, arpInst: [], arpRate: [], bass: ["soft"], drums: ["brush"], swing: 0.62, textures: ["crackle", "hiss", "rain"] },
  // Toybox: celesta and music box, a wind-up arpeggio. Sweet, or a bit haunted.
  toybox: { moods: ["playful", "tender", "curious", "cosy", "eerie"], bpm: [72, 92], chords: [["celesta", "strike"], ["musicbox", "strike"]], pad: [null, "pad"], tune: ["musicbox", "celesta", "kalimba"], density: [2, 4], arp: 0.8, arpInst: ["musicbox", "celesta"], arpRate: [2, 3], bass: ["none"], textures: ["none", "crackle"] },
  // Synthwave: a fast chip arpeggio over a pad, octave-bouncing bass, four on the floor.
  synthwave: { moods: ["driving", "night", "triumph", "tense"], bpm: [92, 108], chords: [["pulse", "chiparp"], ["pad", "hold"]], pad: ["pad", null], tune: ["epiano", "vibes", "pulse"], density: [3, 5], arp: 0.5, arpInst: ["celesta", "kalimba"], arpRate: [2], bass: ["tri"], drums: ["four"], textures: ["none", "hiss"], lowpass: 8000 },
  // Chant (10-24): a small schola of monks. Parallel organum (open fifths sung under the chord roots, each chord a
  // syllable), the tune sung low in Latin syllables, sometimes strings under, no beat, a cathedral's echo.
  chant: { moods: ["eerie", "melancholy", "tense", "night", "wonder"], bpm: [52, 64], chords: [["chant", "organum"]], pad: [null, null, "strings"], tune: ["chant"], tuneUnit: 2, density: [2, 3], arp: 0, arpInst: [], arpRate: [], bass: ["none", "sub"], textures: ["none", "hiss"], rtScale: 1.6 },
} satisfies Record<string, Style>;
export type StyleName = keyof typeof STYLES;
export const STYLE_NAMES = Object.keys(STYLES) as StyleName[];
export const stylesFor = (mood: Mood) => STYLE_NAMES.filter((s) => (STYLES[s] as Style).moods.includes(mood));

/** Drum patterns on a 16-step bar. */
const GROOVES: Record<Groove, { kick: number[]; snare: number[]; hat: number[]; ghost?: number[]; rim?: number[]; shaker?: boolean; chip?: boolean }> = {
  halftime: { kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], ghost: [14], shaker: true },
  dnb: { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ghost: [7, 9] },
  chip: { kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14], chip: true },
  brush: { kick: [0, 10], snare: [], hat: [0, 4, 8, 12], rim: [4, 12], shaker: true },
  hand: { kick: [0, 8], snare: [], hat: [], rim: [4, 10, 12], shaker: true },
  march: { kick: [0, 8], snare: [4, 12], hat: [], ghost: [13, 15] },
  four: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  // The lightest kit there is (journey.ts): a kick on one and three, a shaker. No snare.
  pulse: { kick: [0, 8], snare: [], hat: [], shaker: true },
};

/** How far above middle C the tune sits, per instrument (the chant: tenors, around A3). */
const LIFT: Partial<Record<Inst, number>> = { musicbox: 12, celesta: 12, kalimba: 5, flute: 5, vibes: 0, piano: 0, chant: -14 };

/** The Latin a chant sings, as the vowel of each syllable (the chant style here; a chant chapter in journey.ts). */
export const CHANT_TEXTS: { name: string; vowels: Vowel[] }[] = [
  { name: "Kyrie", vowels: ["i", "i", "e", "e", "e", "i", "o"] },
  { name: "Dies irae", vowels: ["i", "e", "i", "e", "i", "e", "i", "a"] },
  { name: "Alleluia", vowels: ["a", "e", "u", "i", "a"] },
  { name: "Sanctus", vowels: ["a", "u", "a", "u", "o", "i", "u"] },
  { name: "Requiem", vowels: ["e", "i", "e", "e", "e", "a"] },
  { name: "Gloria", vowels: ["o", "i", "a", "i", "e", "e", "i", "e", "o"] },
];

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const pc = (n: number) => ((n % 12) + 12) % 12;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** A save's music comes from its slot number, so no two saves share a tune;
 * `take` > 0 asks the same slot for a different one. */
export const musicSeed = (slot: number, take = 0) => slot + take * 100_000;

/** Choices made outside the seed (variety.ts, so neighbouring saves differ):
 * the key, as semitones off the white-key mode, and how quick, 0 = the
 * slowest the style or mood allows, 1 = the quickest. */
export type Vary = { chimeShift?: number; pace?: number };

export const compose = (seed: number, mood: Mood, m: Moments, force?: StyleName, vary: Vary = {}): Score => {
  const rand = mulberry(seed * 131 + 17);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const between = (a: number, b: number) => a + (b - a) * rand();
  const M = MOODS[mood];
  // Drawn even when a style is forced, so a seed keeps its key, chords and
  // tune across styles (only the arrangement changes).
  const drawn = pick(stylesFor(mood));
  const styleName = force ?? drawn;
  const S = STYLES[styleName] as Style;

  // ------------------------------------------------------------ key + time
  const mode = pick(M.modes);
  // Drawn even when given, so the rest of the seed's choices stay put.
  const drawnShift = pick([-2, -1, 0, 1, 2]);
  const chimeShift = vary.chimeShift ?? drawnShift;
  const tonic = pc(WHITE[mode] + chimeShift);
  const scale = SCALES[mode];
  /** Semitones above the tonic for any scale degree (wraps into octaves). */
  const semis = (d: number) => 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7]!;

  // Whole beats up to "saved", so the home chord lands exactly on it. Bar
  // lines and chord changes count back from there; the first is a part bar
  // (a pickup) when they don't divide evenly.
  const meter = S.meter ?? 4;
  const bpc = S.barsPerChord ?? 1;
  const [slow, quick] = S.bpm ?? M.bpm;
  const drawnBpm = between(slow, quick);
  const bpm = vary.pace === undefined ? drawnBpm : slow + (quick - slow) * vary.pace;
  const beats = Math.max(meter * 2, Math.round(m.saved / (60 / bpm)));
  const beat = m.saved / beats;
  const bar = meter * beat;
  const eighth = beat / 2;
  const swing = S.swing ?? M.swing;
  const backFrom = (len: number) => {
    const out: number[] = [];
    for (let s = m.saved - len; s > -len + 1e-6; s -= len) out.unshift(s);
    return out;
  };
  const barStarts = backFrom(bar);
  const lines = backFrom(bar * bpc).map((s) => Math.max(0, s));
  if (lines[1] !== undefined && lines[1] < 2 * beat * bpc - 1e-6) lines.splice(1, 1);
  /** Where the second layer (bass, arpeggio, drums) joins. */
  const entry = lines[1] ?? 0;

  // ---------------------------------------------------------------- chords
  // The harmony (src/music/harmony.ts) draws from its own stream, and the
  // walk is always 12 chords long, so a seed keeps its chords whatever the
  // style; a style only decides how many of them fit.
  const hrand = mulberry(seed * 89 + 3);
  const H = harmony(hrand, mode, mood);
  let lead = LEAD_INS[mode][Math.floor(hrand() * LEAD_INS[mode].length)]!;
  if (M.minorFour && mode === "ionian" && hrand() < M.minorFour) lead = { node: "iv" };
  const homeNode = M.deceptive && mode === "aeolian" && hrand() < M.deceptive ? "5" : "0";
  const path = H.walk(12);
  const splits = Array.from({ length: 12 }, () => hrand() < 0.3);

  // Chord changes before the lead-in: the bar lines, and sometimes two chords
  // share a bar (only in the 4/4, one-chord-a-bar styles).
  const changes: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    changes.push(lines[i]!);
    const len = lines[i + 1]! - lines[i]!;
    if (i > 0 && meter === 4 && bpc === 1 && len > 3.5 * beat && splits[i]) changes.push(lines[i]! + len / 2);
  }
  const before = changes.map((_, i) => path[i % path.length]!);
  // Never hang on the chord we're already on.
  if (before.length && before[before.length - 1] === lead.node) lead = LEAD_INS[mode].find((c) => c.node !== lead.node) ?? lead;
  const chords: Chord[] = [
    ...before.map((n) => H.chord(n)),
    H.chord(lead.node, { sus: lead.sus }),
    H.chord(homeNode, { colour: H.palette.find((c) => c !== "sus") ?? "plain" }),
  ];
  H.basses(chords);
  const times = [...changes, lines[lines.length - 1]!, m.saved, m.seconds];

  /** Lays the chord out around `centre`, moving as little as possible from the last one. */
  const voice = (pcs: number[], prev: number[] | null, centre = 60): number[] => {
    let best: number[] = [];
    let cost = Infinity;
    for (let r = 0; r < pcs.length; r++) {
      const order = [...pcs.slice(r), ...pcs.slice(0, r)];
      for (let low = centre - 10; low < centre + 2; low++) {
        if (pc(low) !== order[0]) continue;
        const v = [low];
        for (const p of order.slice(1)) {
          let n = v[v.length - 1]! + 1;
          while (pc(n) !== p) n++;
          v.push(n);
        }
        const c = prev
          ? v.reduce((a, n) => a + Math.min(...prev.map((q) => Math.abs(q - n))), 0)
          : Math.abs(v.reduce((a, n) => a + n, 0) / v.length - centre);
        if (c < cost) [cost, best] = [c, v];
      }
    }
    // Open voicing: the second note from the top drops an octave.
    if (H.open && best.length >= 4) best = [...best.slice(0, -2), best[best.length - 2]! - 12, best[best.length - 1]!].sort((a, b) => a - b);
    return best;
  };

  type Span = { t0: number; t1: number; chord: Chord; pcs: number[]; v: number[]; bass: number };
  let prevV: number[] | null = null;
  const spans: Span[] = chords.map((chord, i) => {
    const pcs = chord.tones.map((x) => pc(chord.root + x + tonic));
    const v = voice(pcs, prevV);
    prevV = v;
    return { t0: times[i]!, t1: times[i + 1]!, chord, pcs, v, bass: pc(chord.bass + tonic) };
  });
  const spanAt = (t: number) => spans.find((s) => t >= s.t0 && t < s.t1) ?? spans[spans.length - 1]!;

  const notes: Note[] = [];
  const nudge = () => (rand() - 0.5) * 0.016;
  const progress = (t: number) => Math.min(1, t / m.buildEnd);
  /** The held breath at 99%, and the quiet after "saved" while the chime rings. */
  const holding = (t: number) => t >= m.buildEnd - 0.1 && t < m.saved;
  const swung = (slot: number, unit = eighth) => (slot % 2 === 1 ? (slot - 1) * unit + 2 * unit * swing : slot * unit);

  const [chordInst, play] = pick(S.chords);
  const padInst = pick(S.pad);
  /** What the chant sings (its own stream: nothing else moves for it). */
  const text = CHANT_TEXTS[Math.floor(mulberry(seed * 23 + 11)() * CHANT_TEXTS.length)]!;
  const twice = rand() < 0.6;
  const bassType = pick(S.bass);
  spans.forEach((s, i) => {
    const isHome = i === spans.length - 1;
    const len = s.t1 - s.t0;
    if (padInst) for (const n of s.v) notes.push({ t: s.t0, dur: len, midi: n, vel: 0.35, inst: padInst, pan: 0 });
    const strike = (t: number, vel: number, dur = s.t1 - t) =>
      s.v.forEach((n, k) => notes.push({ t: t + k * 0.014 + nudge(), dur, midi: n, vel: vel * (0.9 + 0.2 * rand()), inst: chordInst, pan: -0.2 + (0.4 * k) / s.v.length }));
    switch (play) {
      case "strike":
        strike(s.t0, isHome ? 0.75 : 0.5 + 0.15 * progress(s.t0));
        // A soft second strike mid-bar, except over the held breath.
        if (!isHome && twice && meter === 4 && s.t0 + bar / 2 < m.buildEnd - 0.1) strike(s.t0 + bar / 2 + (swing - 0.5) * beat, 0.32);
        break;
      case "hold":
        for (const n of s.v) notes.push({ t: s.t0, dur: len, midi: n, vel: isHome ? 0.8 : 0.65, inst: chordInst, pan: 0 });
        break;
      case "pick": {
        // Fingerpicking (guitar, harp, marimba…): the thumb on the root and fifth, fingers over the top.
        const root = 40 + pc(s.bass - 40);
        const fifth = root + pc(s.pcs[2]! - root);
        const top = s.v.slice(1);
        const fingers = [null, 1, 0, 2, null, 1, 0, 2];
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar) {
          for (let k = 0; k < meter * 2; k++) {
            const t = b + swung(k);
            if (t >= s.t1 || (holding(t) && k > 0) || (t >= m.exitStart && k > 0)) continue;
            const f = fingers[k % fingers.length] ?? null;
            const midi = f === null ? (k === 0 ? root : fifth) : top[f % top.length]!;
            notes.push({ t: t + nudge(), dur: 2.5 * eighth, midi, vel: (f === null ? 0.55 : 0.4) * (0.85 + 0.3 * rand()), inst: chordInst, pan: f === null ? -0.15 : 0.2 });
          }
        }
        break;
      }
      case "oompah": {
        // The waltz: a low pluck on one, the chord plucked short on two and three.
        const root = 40 + pc(s.bass - 40);
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar) {
          notes.push({ t: b + nudge(), dur: 0.9 * beat, midi: root, vel: 0.6, inst: chordInst, pan: -0.1 });
          for (const k of [1, 2]) {
            const t = b + k * beat;
            if (t >= s.t1 || holding(t) || t >= m.exitStart) continue;
            s.v.forEach((n, j) => notes.push({ t: t + j * 0.008 + nudge(), dur: 0.6 * beat, midi: n, vel: (k === 1 ? 0.36 : 0.3) * (0.9 + 0.2 * rand()), inst: chordInst, pan: 0.15 }));
          }
        }
        break;
      }
      case "organum": {
        // Parallel organum: the chord's root sung low (basses, F2 up), its fifth and octave above, every chord a syllable of the text; the tune sits above the fifth.
        const root = 41 + pc(s.bass - 41);
        const vowel = text.vowels[i % text.vowels.length]!;
        const up = isHome ? 1.25 : 1;
        notes.push({ t: s.t0, dur: len, midi: root, vel: 0.5 * up, inst: chordInst, pan: -0.25, vowel, sung: "syllable" });
        notes.push({ t: s.t0 + 0.04, dur: len, midi: root + 7, vel: 0.42 * up, inst: chordInst, pan: 0.25, vowel, sung: "syllable" });
        notes.push({ t: s.t0 + 0.02, dur: len, midi: root + 12, vel: 0.3 * up, inst: chordInst, pan: 0, vowel, sung: "syllable" });
        break;
      }
      case "chiparp": {
        // Chiptune chords: the notes cycled fast, one voice doing all of them.
        const step = beat / 4;
        let k = 0;
        for (let t = s.t0; t < s.t1 - 1e-6; t += step, k++) {
          if ((holding(t) && t > s.t0) || (t >= m.exitStart && !isHome)) continue;
          notes.push({ t, dur: step * 0.9, midi: s.v[k % s.v.length]!, vel: t >= m.exitStart ? 0.14 : 0.22, inst: "pulse", pan: -0.25 });
        }
        break;
      }
    }
    // Bass joins after the first chord, so the loop starts lighter and builds.
    const bassKind = i === 0 ? "none" : bassType;
    const root = 40 + pc(s.bass - 40);
    if (bassKind === "soft" || bassKind === "sub") notes.push({ t: s.t0 + nudge(), dur: len, midi: root, vel: 0.55, inst: bassKind === "soft" ? "bass" : "sub", pan: 0 });
    if (bassKind === "tri")
      for (let t = s.t0, k = 0; t < s.t1 - 1e-6; t += eighth, k++)
        if (!holding(t) || t === s.t0) notes.push({ t, dur: eighth * 0.85, midi: root + (k % 2 ? 12 : 0), vel: 0.5, inst: "tri", pan: 0 });
  });

  // ------------------------------------------------------------------ tune
  const tuneInst = pick(S.tune);
  const lift = LIFT[tuneInst] ?? 0;
  const allowed = TUNE[mode];
  const steps: number[] = [];
  for (let d = -14; d < 28; d++) {
    if (!allowed.includes(((d % 7) + 7) % 7)) continue;
    const n = 60 + tonic + semis(d) + lift;
    if (n >= 64 + lift && n <= 84 + lift) steps.push(n);
  }
  /** Index into steps of the note nearest n (a chord note, when pcs is given). */
  const nearest = (n: number, pcs?: number[]): number => {
    let bi = -1;
    for (let i = 0; i < steps.length; i++) {
      if (pcs && !pcs.includes(pc(steps[i]!))) continue;
      if (bi < 0 || Math.abs(steps[i]! - n) < Math.abs(steps[bi]! - n)) bi = i;
    }
    return bi < 0 ? nearest(n) : bi;
  };
  // The tune draws from its own stream, so the same seed hums the same tune
  // whatever the style.
  const trand = mulberry(seed * 53 + 9);
  const tpick = <T>(xs: readonly T[]): T => xs[Math.floor(trand() * xs.length)]!;
  const tbetween = (a: number, b: number) => a + (b - a) * trand();
  /** A note a semitone off a chord note (over a borrowed chord, say) rubs: move it onto the chord. */
  const clashes = (n: number, pcs: number[]) => !pcs.includes(pc(n)) && pcs.some((p) => pc(p - n) === 1 || pc(n - p) === 1);
  // A phrase is one chord long, or two for a longer tune.
  const unit = eighth * (S.tuneUnit ?? 1);
  const phraseLen = bar * bpc * (bpc === 1 && trand() < 0.35 ? 2 : 1);
  const slots = Math.round(phraseLen / unit);
  const k = Math.round(tbetween(S.density[0], S.density[1] + 0.99) - 0.49) * Math.round(phraseLen / (bar * bpc));
  const rhythm = new Set<number>([trand() < 0.65 ? 0 : 1]);
  while (rhythm.size < Math.min(k, slots - 1)) {
    const s = Math.floor(trand() * slots);
    if (s % 2 === 0 || trand() < 0.45) rhythm.add(s);
  }
  const motif = [...rhythm].sort((a, b) => a - b);
  const contour = motif.slice(1).map(() => tpick([-1, 1, -1, 1, 2, -2, 0, 3, -2]));
  const anchor = 72 + lift + Math.round(tbetween(-3, 3));
  // The tune sits on top of the mix: it's the bit you'd hum.
  const tuneVel = tuneInst === "pulse" ? 0.4 : 0.7;
  backFrom(phraseLen).forEach((start, b) => {
    const shape = b >= 2 && trand() < 0.5 ? contour.map((c, i) => (i === contour.length - 1 ? tpick([-2, -1, 1, 2]) : c)) : contour;
    let at = nearest(anchor, spanAt(Math.max(0, start)).pcs);
    motif.forEach((slot, j) => {
      const t = start + swung(slot, unit);
      if (j > 0) at = Math.max(0, Math.min(steps.length - 1, at + shape[j - 1]!));
      if (t < 0 || t > m.buildEnd - 0.15) return; // pickup bar starts part way in; holds its breath at 99%
      // Strong beats sit on a chord note.
      if (slot % 4 === 0 || clashes(steps[at]!, spanAt(t).pcs)) at = nearest(steps[at]!, spanAt(t).pcs);
      const next = motif[j + 1] !== undefined ? start + swung(motif[j + 1]!, unit) : start + phraseLen;
      notes.push({ t: t + nudge(), dur: Math.min(4 * unit, next - t), midi: steps[at]!, vel: (tuneVel + 0.2 * trand()) * (0.8 + 0.2 * progress(t)), inst: tuneInst, pan: 0.15 });
    });
  });
  // The answer: the chime speaks first, then the tune steps down home.
  const homePcs = spans[spans.length - 1]!.pcs;
  let at = nearest(anchor + 2, homePcs);
  const answer = 2 + Math.floor(trand() * 2);
  const gap = Math.max(beat, 0.6);
  for (let j = 0; j < answer; j++) {
    const t = m.saved + 1.6 * gap + j * gap * (j === answer - 1 ? 1.5 : 1);
    if (j > 0) at = Math.max(0, at - 1);
    if (j === answer - 1 || clashes(steps[at]!, homePcs)) at = nearest(steps[at]!, homePcs);
    notes.push({ t: t + nudge(), dur: 1.5 * gap, midi: steps[at]!, vel: tuneVel - j * 0.06, inst: tuneInst, pan: 0.15 });
  }

  // ------------------------------------------------------------- arpeggio
  const arp = rand() < S.arp;
  const arpInst = S.arpInst.length ? pick(S.arpInst) : "harp";
  const perBeat = S.arpRate.length ? pick(S.arpRate) : 2;
  const arpUp = arpInst === "kalimba" || arpInst === "marimba" ? 0 : 12;
  if (arp) {
    const step = beat / perBeat;
    const pattern = meter === 3 ? [0, 2, 1, 2, 3, 2] : pick([[0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [0, 1, 2, 3], [3, 2, 1, 0], [0, 2, 1, 2]]);
    let i = 0;
    for (let t = entry; t < m.seconds; t += step, i++) {
      if (holding(t) || t < m.saved + 0.8 && t >= m.saved || t >= m.exitStart) continue;
      const s = spanAt(t);
      const v = [...s.v, s.v[0]! + 12].map((n) => n + arpUp);
      const n = v[pattern[i % pattern.length]! % v.length]!;
      const after = t > m.saved;
      notes.push({ t: t + nudge(), dur: step * 2, midi: n, vel: (0.22 + 0.08 * rand()) * (after ? 0.75 : 0.8 + 0.3 * progress(t)), inst: arpInst, pan: i % 2 ? 0.35 : -0.35 });
    }
  }

  // ----------------------------------------------------------------- drums
  const groove = S.drums ? pick(S.drums) : null;
  if (groove) {
    const G = GROOVES[groove];
    const sixteenth = beat / 4;
    const kit = G.chip ? { kick: "chipkick", snare: "chipsnare", hat: "chiphat" } as const : { kick: "kick", snare: "snare", hat: "hat" } as const;
    // Drum and bass has twice the hits: keep it as soft as the rest.
    const kitLevel = groove === "dnb" ? 0.65 : 1;
    // Drums play straight unless the style itself swings (the mood's swing is for the tune).
    const swingAt = (step: number) => (step % 4 === 2 ? ((S.swing ?? 0.5) - 0.5) * beat : 0);
    const hit = (t: number, inst: Inst, vel: number, pan = 0) => {
      if (t < entry - 1e-6 || holding(t) || t >= m.exitStart) return;
      notes.push({ t: t + nudge() * 0.5, dur: 0.3, midi: 60, vel: vel * kitLevel * (0.85 + 0.3 * rand()), inst, pan });
    };
    for (const b of [...barStarts, m.saved, m.saved + bar]) {
      for (let st = 0; st < 16; st++) {
        const t = b + st * sixteenth + swingAt(st);
        if (G.kick.includes(st)) hit(t, kit.kick, st === 0 ? 0.8 : 0.6);
        if (G.snare.includes(st)) hit(t, kit.snare, 0.6);
        if (G.ghost?.includes(st)) hit(t, kit.snare, 0.18);
        if (G.rim?.includes(st)) hit(t, "rim", 0.38, -0.15);
        if (G.hat.includes(st)) hit(t, kit.hat, st % 4 === 0 ? 0.42 : 0.3, 0.3);
        if (groove === "dnb" && st % 2 === 1) hit(t, "hat", 0.14, 0.3);
        if (G.shaker) hit(t, "shaker", st % 2 ? 0.2 : 0.3, -0.3);
      }
    }
  }

  // ------------------------------------------------- the swell into the loop
  const first = spans[0]!;
  const swell = Math.min(1.4, 2 * beat);
  const swellInst: Inst = ["epiano", "piano", "guitar", "pulse", "harp", "pizz"].includes(chordInst) ? chordInst : chordInst === "chant" ? "strings" : "epiano";
  for (const n of first.v) notes.push({ t: m.seconds - swell, dur: swell, midi: n + 12, vel: 0.4, inst: swellInst, pan: 0, reverse: true });

  // The sung tune: a syllable of the text on each note, in order, and the answer ends on "a-men".
  if (tuneInst === "chant") {
    const sung = notes.filter((n) => n.inst === "chant" && !n.vowel);
    sung.forEach((n, j) => {
      n.vowel = text.vowels[j % text.vowels.length];
      n.sung = "syllable";
    });
    if (sung.length >= 2) [sung[sung.length - 2]!.vowel, sung[sung.length - 1]!.vowel] = ["a", "e"];
  }

  // --------------------------------------------------------------- curves
  const br = M.brightness;
  const tail = 2200 + 2000 * Math.exp(-(m.exitStart - m.saved) * 1.2);
  const cutoff = (t: number) => {
    if (t < m.buildEnd) return br * (600 + 2200 * progress(t) ** 1.4);
    if (t < m.saved) return br * (2800 + 400 * ((t - m.buildEnd) / (m.saved - m.buildEnd)));
    if (t < m.exitStart) return br * (2200 + 2000 * Math.exp(-(t - m.saved) * 1.2));
    return br * (600 + (tail - 600) * (1 - smooth((t - m.exitStart) / (m.seconds - m.exitStart))));
  };
  const level = (t: number) => {
    if (t < m.buildEnd) return 0.72 + 0.28 * smooth(progress(t));
    if (t < m.exitStart) return 1;
    return 0.72 + 0.28 * (1 - smooth((t - m.exitStart) / (m.seconds - m.exitStart)));
  };

  const texture = pick(S.textures ?? M.textures);
  const label = [
    `${styleName} (${mood})`,
    `${NAMES[tonic]} ${mode}`,
    `${Math.round(60 / beat)} bpm ${meter}/4`,
    spans.map((s) => chordName(s.chord, tonic)).join(" "),
    `${H.palette.join("/")}${H.bassMode === "root" ? "" : `, ${H.bassMode}`}${H.open ? ", open" : ""}`,
    [chordInst === "chant" ? `organum on ${text.name}` : `${chordInst} chords`, padInst && `${padInst} under`, `${tuneInst} tune`, arp && `${arpInst} arpeggio`, groove && `${groove} drums`].filter(Boolean).join(", "),
    texture === "none" ? "clean" : texture,
  ].join(" · ");

  return {
    seconds: m.seconds,
    mood,
    style: styleName,
    notes,
    cutoff,
    level,
    texture,
    reverb: { rt60: M.rt60 * (S.rtScale ?? 1), wet: M.wet },
    wow: M.wow,
    lowpass: Math.min(M.lowpass, S.lowpass ?? Infinity),
    chimeShift,
    label,
  };
};

// The tables, for the long-form composer (journey.ts).
export type { MoodPreset, Style, Groove, Play };
export { MOODS as MOOD_PRESETS, STYLES as STYLE_TABLE, GROOVES, LIFT, TUNE as TUNE_DEGREES };
