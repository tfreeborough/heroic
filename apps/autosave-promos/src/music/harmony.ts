/**
 * Writes chord progressions instead of picking them from a list, so hundreds
 * of saves don't keep landing on the same few.
 *
 *  - WHERE THE CHORDS GO: a walk over "what usually comes next" (a Markov
 *    chain: each next chord is drawn by weight from the ones that follow
 *    the current one well). Diatonic chords, plus borrowed ones from outside
 *    the key (♭VI, ♭VII, the minor iv) and secondary dominants (a 7th chord
 *    that pulls into the next one), more of them in moods that suit them.
 *  - COLOUR: each track picks a small palette (7ths, 9ths, add9, 6ths, sus,
 *    11ths…) and every chord takes its own colour from it, only where it's
 *    sweet (no flat 9ths, no clashing 6ths).
 *  - BASS: the root, inversions (the bass walks to the nearest chord note,
 *    so it moves in steps) or a pedal (one bass note held under it all).
 *  - VOICING: close, or spread open (one note dropped an octave).
 *
 * Pure: a seeded random stream in, chords out. Notes are semitones: `root`
 * and `bass` above the tonic, chord tones as intervals above the root.
 */
import type { Mood } from "./mood";

export type Mode = "ionian" | "dorian" | "lydian" | "mixolydian" | "aeolian";
export type Colour = "plain" | "seventh" | "added9" | "ninth" | "sixth" | "sus" | "eleventh";
type Quality = "maj" | "min" | "dom";

export type Chord = {
  /** The node it came from: a scale degree "0"–"6" or a borrowed chord ("b6", "iv", "V/5"…). */
  node: string;
  /** Semitones above the tonic. */
  root: number;
  /** Intervals above the root, root first. */
  tones: number[];
  /** Semitones above the tonic of the bass note. */
  bass: number;
  quality: Quality;
  colour: Colour;
  /** A suspended chord (no third): the hanging lead-in. */
  sus: boolean;
};

export const SCALES: Record<Mode, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

/** Chords from outside the key: where their root sits and what kind they are. */
const BORROWED: Record<string, { root: number; quality: Quality }> = {
  b3: { root: 3, quality: "maj" },
  b6: { root: 8, quality: "maj" },
  b7: { root: 10, quality: "maj" },
  iv: { root: 5, quality: "min" },
  IV: { root: 5, quality: "maj" },
  ii: { root: 2, quality: "min" },
  V: { root: 7, quality: "dom" },
  // Secondary dominants: "V/5" is the dominant of degree 5, and resolves there.
  "V/1": { root: 9, quality: "dom" },
  "V/4": { root: 2, quality: "dom" },
  "V/5": { root: 4, quality: "dom" },
};
const isBorrowed = (node: string) => node in BORROWED;

/**
 * What follows what, per mode, with weights. Diminished chords are left out.
 * Roman numerals in the comments are the ionian names.
 */
const NEXT: Record<Mode, Record<string, [string, number][]>> = {
  ionian: {
    "0": [["3", 3], ["5", 3], ["4", 2], ["1", 2], ["2", 1], ["b6", 1], ["b7", 1], ["iv", 1], ["V/1", 0.5], ["V/5", 0.6], ["V/4", 0.5]],
    "1": [["4", 4], ["3", 1.5], ["2", 1], ["0", 1], ["b7", 0.5]],
    "2": [["5", 3], ["3", 2], ["1", 1], ["V/1", 0.4]],
    "3": [["0", 3], ["4", 3], ["1", 1], ["5", 1.5], ["iv", 1.5], ["2", 1], ["b7", 0.7]],
    "4": [["0", 3], ["5", 3], ["3", 2], ["V/5", 0.5]],
    "5": [["3", 3], ["1", 2], ["4", 2], ["2", 1], ["0", 1], ["V/4", 0.5]],
    b6: [["b7", 3], ["0", 2], ["4", 1], ["iv", 1]],
    b7: [["0", 3], ["3", 1], ["b6", 0.7]],
    iv: [["0", 3], ["b7", 1], ["4", 1]],
    "V/1": [["1", 4]],
    "V/4": [["4", 4], ["1", 0.5]],
    "V/5": [["5", 4], ["3", 0.5]],
  },
  dorian: {
    "0": [["3", 3], ["6", 3], ["2", 2], ["4", 2], ["1", 1], ["b6", 1], ["V", 0.5]],
    "1": [["2", 2], ["4", 1], ["0", 1], ["6", 1]],
    "2": [["3", 2], ["6", 2], ["1", 1], ["0", 1], ["b6", 0.6]],
    "3": [["0", 3], ["6", 2], ["4", 1], ["2", 1], ["V", 0.6]],
    "4": [["6", 2], ["3", 2], ["0", 2], ["2", 1]],
    "6": [["0", 3], ["3", 2], ["2", 1], ["4", 1]],
    b6: [["6", 3], ["0", 2], ["V", 0.5]],
    V: [["0", 4]],
  },
  lydian: {
    "0": [["1", 4], ["6", 2], ["5", 2], ["4", 1], ["2", 1], ["IV", 1], ["b7", 0.7]],
    "1": [["0", 4], ["6", 1], ["2", 1], ["5", 1], ["ii", 0.6]],
    "2": [["1", 2], ["5", 2], ["0", 1]],
    "4": [["0", 2], ["1", 2], ["5", 2]],
    "5": [["1", 2], ["4", 2], ["6", 1], ["0", 1], ["IV", 0.6]],
    "6": [["5", 2], ["0", 2], ["1", 1]],
    IV: [["0", 3], ["1", 1]],
    b7: [["0", 2], ["IV", 1]],
    ii: [["0", 2], ["4", 1]],
  },
  mixolydian: {
    "0": [["6", 4], ["3", 3], ["4", 2], ["1", 1], ["5", 1], ["iv", 1], ["b3", 0.6]],
    "1": [["6", 2], ["3", 1], ["4", 1], ["0", 1]],
    "3": [["0", 3], ["6", 2], ["1", 1], ["4", 1], ["iv", 0.8]],
    "4": [["6", 2], ["3", 2], ["0", 2], ["5", 1]],
    "5": [["6", 2], ["3", 2], ["4", 1], ["1", 1]],
    "6": [["0", 3], ["3", 3], ["4", 1], ["b6", 0.6]],
    iv: [["0", 3], ["6", 1]],
    b3: [["6", 2], ["3", 2]],
    b6: [["6", 3], ["0", 1]],
  },
  aeolian: {
    "0": [["5", 3], ["6", 3], ["3", 3], ["2", 2], ["4", 1], ["IV", 1], ["V", 0.6]],
    "2": [["6", 2], ["5", 2], ["3", 2], ["0", 1]],
    "3": [["0", 2], ["6", 2], ["4", 2], ["5", 1], ["V", 1]],
    "4": [["0", 2], ["5", 2], ["3", 1]],
    "5": [["6", 3], ["2", 2], ["3", 2], ["0", 1], ["4", 1], ["IV", 0.6]],
    "6": [["0", 3], ["2", 3], ["5", 1], ["3", 1]],
    IV: [["0", 2], ["6", 2]],
    V: [["0", 4], ["5", 1]],
  },
};

/** The chord before "saved": it hangs, then the home chord lands. */
export const LEAD_INS: Record<Mode, { node: string; sus?: boolean }[]> = {
  ionian: [{ node: "4", sus: true }, { node: "3" }, { node: "4" }, { node: "1" }, { node: "b7" }],
  dorian: [{ node: "6" }, { node: "3" }, { node: "4" }, { node: "6", sus: true }],
  lydian: [{ node: "1" }, { node: "4", sus: true }, { node: "6" }],
  mixolydian: [{ node: "6" }, { node: "3" }, { node: "4", sus: true }],
  aeolian: [{ node: "6" }, { node: "4", sus: true }, { node: "3" }, { node: "V" }],
};

/** How much each mood likes each colour, and borrowed chords. */
export const FLAVOUR: Record<Mood, { palette: Partial<Record<Colour, number>>; borrow: number }> = {
  cosy: { palette: { seventh: 3, added9: 2, sixth: 2, plain: 2, ninth: 1, sus: 1 }, borrow: 0.8 },
  wistful: { palette: { seventh: 3, ninth: 2, added9: 2, eleventh: 1, sus: 1, plain: 1 }, borrow: 1.6 },
  wonder: { palette: { added9: 3, sus: 2, ninth: 2, eleventh: 2, plain: 1, sixth: 1 }, borrow: 1 },
  night: { palette: { seventh: 3, ninth: 2, eleventh: 2, added9: 1, plain: 1 }, borrow: 1.3 },
  playful: { palette: { plain: 3, sixth: 2, added9: 2, seventh: 1, sus: 1 }, borrow: 0.7 },
  tender: { palette: { added9: 3, plain: 2, sixth: 2, sus: 1, seventh: 1 }, borrow: 0.8 },
};

const pc = (n: number) => ((n % 12) + 12) % 12;

type Rand = () => number;
const weighted = <T>(rand: Rand, items: [T, number][]): T => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [x, w] of items) if ((r -= w) <= 0) return x;
  return items[items.length - 1]![0];
};

export const harmony = (rand: Rand, mode: Mode, mood: Mood) => {
  const scale = SCALES[mode];
  const semis = (d: number) => 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7]!;
  const F = FLAVOUR[mood];

  // The track's choices.
  const palette: Colour[] = [];
  const pool = Object.entries(F.palette) as [Colour, number][];
  const size = 2 + Math.floor(rand() * 2);
  while (palette.length < size) {
    const c = weighted(rand, pool);
    if (!palette.includes(c)) palette.push(c);
  }
  const bassMode = weighted(rand, [["root", 5], ["inversions", 3], ["pedal", 1.5]] as [string, number][]);
  const open = rand() < 0.3;

  /** The intervals a chord's own scale gives it (third, fifth, seventh…), above its root. */
  const context = (node: string) => {
    if (isBorrowed(node)) {
      const { root, quality } = BORROWED[node]!;
      const minor = quality === "min";
      return { root, quality, third: minor ? 3 : 4, fifth: 7, seventh: quality === "maj" ? 11 : 10, second: 2, fourth: 5, sixth: 9 };
    }
    const d = Number(node);
    const iv = (k: number) => pc(semis(d + k) - semis(d));
    const third = iv(2);
    return { root: pc(semis(d)), quality: (third === 3 ? "min" : "maj") as Quality, third, fifth: iv(4), seventh: iv(6), second: iv(1), fourth: iv(3), sixth: iv(5) };
  };

  let lastSus = true; // so the first chord is never suspended
  const chord = (node: string, opts: { sus?: boolean; colour?: Colour } = {}): Chord => {
    const c = context(node);
    let colour = opts.colour ?? (opts.sus ? "sus" : palette[Math.floor(rand() * palette.length)]!);
    // Sus from the palette: major chords only, never twice running (it never resolves otherwise).
    if (colour === "sus" && !opts.sus && (c.quality !== "maj" || lastSus)) colour = palette.find((p) => p !== "sus") ?? "plain";
    lastSus = colour === "sus";
    let third = c.third;
    if (colour === "sus") third = c.fourth === 5 ? 5 : c.second === 2 ? 2 : third;
    const fifth = c.fifth === 6 ? 7 : c.fifth; // never diminished
    const tones = [0, third, fifth];
    const dom = c.quality === "dom";
    const add = (x: number) => tones.includes(x) || tones.push(x);
    switch (colour) {
      case "plain":
      case "sus":
        if (dom) add(c.seventh);
        if (colour === "sus" && third === 5 && c.second === 2) add(2);
        break;
      case "seventh":
        add(c.seventh);
        break;
      case "added9":
        if (dom) add(c.seventh);
        if (c.second === 2) add(2);
        break;
      case "ninth":
        add(c.seventh);
        if (c.second === 2) add(2);
        break;
      case "sixth":
        if (dom) add(c.seventh);
        if (c.sixth === 9) {
          add(9);
          if (c.quality === "maj" && c.second === 2) add(2);
        } else add(c.seventh);
        break;
      case "eleventh":
        add(c.seventh);
        if (c.quality === "min" && c.fourth === 5) add(5);
        else if (c.quality === "maj" && c.fourth === 6) add(6);
        else if (c.second === 2) add(2);
        break;
    }
    return { node, root: c.root, tones, bass: c.root, quality: c.quality, colour, sus: third !== c.third };
  };

  /** The walk: `count` chords, starting at home or one step from it. */
  const walk = (count: number): string[] => {
    const next = (from: string) =>
      weighted(rand, (NEXT[mode][from] ?? NEXT[mode]["0"]!).map(([n, w]) => [n, isBorrowed(n) ? w * F.borrow : w] as [string, number]));
    const out: string[] = [rand() < 0.6 ? "0" : next("0")];
    while (out.length < count) out.push(next(out[out.length - 1]!));
    return out;
  };

  /** Sets each chord's bass note: root, a walking inversion, or a pedal on home. */
  const basses = (chords: Chord[]) => {
    let prev = chords[0]!.root;
    chords.forEach((c, i) => {
      const last = i === chords.length - 1;
      if (bassMode === "pedal" && !last) c.bass = 0;
      else if (bassMode === "inversions" && i > 0 && !last && !c.sus) {
        // The nearest chord note to the last bass, the root preferred.
        const options = [c.root, pc(c.root + c.tones[1]!), pc(c.root + c.tones[2]!)];
        const dist = (a: number) => Math.min(pc(a - prev), pc(prev - a)) + (a === c.root ? 0 : 1.5);
        c.bass = options.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      }
      prev = c.bass;
    });
  };

  return { chord, walk, basses, open, palette, bassMode };
};

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** "Ebmaj7/G" and so on, for the label. */
export const chordName = (c: Chord, tonic: number) => {
  const has = (x: number) => c.tones.includes(x);
  const minor = c.quality === "min" && !c.sus;
  let q = minor ? "m" : "";
  if (c.sus) q += has(5) ? "sus4" : "sus2";
  if (has(10) || has(11)) {
    const seven = has(11) ? (minor ? "(maj7)" : "maj7") : "7";
    q += has(2) ? seven.replace("7", "9") : seven;
    if (has(5) && !c.sus) q += "(11)";
    if (has(6)) q += "#11";
    if (has(9)) q += "(13)";
  } else {
    if (has(9)) q += has(2) ? "6/9" : "6";
    else if (has(2) && !c.sus) q += "add9";
  }
  const root = NAMES[pc(c.root + tonic)]!;
  return c.bass === c.root ? root + q : `${root}${q}/${NAMES[pc(c.bass + tonic)]}`;
};
