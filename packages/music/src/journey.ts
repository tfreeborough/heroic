/**
 * A long piece that follows a story (docs/design/desk-ascii-scripts.md):
 * the score under a glyph video, written for its exact beat times.
 *
 * ONE piece, never tracks crossfaded. The seed fixes what makes it sound
 * like one thing all the way through: the key, the tempo, the style and
 * its instruments, and THE THEME (a short tune that comes back, varied).
 * The beats only steer it: each beat's mood picks the mode (the same home
 * note in another colour, so a change never jolts), its intensity decides
 * how many layers play and how bright it is. Changes land on phrase lines
 * (four or eight bars): layers come and go there, the curves glide over
 * bars rather than switch.
 *
 * THE ARRANGEMENT is the seed's too (docs/design/desk-score-variety.md):
 * two felt-piano scores used to be the same arrangement with different
 * notes. Now inside a style the seed draws
 *   foundation   what's under everything: a pad, strings, a low drone, or nothing
 *   figuration   how the chords are played: struck, pulsed, broken, rolled, held, picked
 *   recipe       the order the layers join in as the beats get busier
 *   figure       the arpeggio's shape and rate
 *   voicing      close in the middle, open and low, high, or spread
 *   phrases      four or eight bars; chords every bar, or every two when it's quiet
 *   theme        two or four bars; a second voice answering; a chapter it sits out,
 *                a chapter a guest plays it, half speed under quiet beats
 *   harmony      how far it reaches for colour; a chapter in another key; a
 *                chord from nowhere in eerie and wonder
 *   groove       which light kit, how much swing
 *   room         how big, and a faint texture or none
 *   chant        one dark middle chapter sung by a schola over an organum fifth
 * and some of those change at a chapter. The draws come from their own
 * stream in a fixed order, so a draw added later never reshuffles the
 * ones before it.
 *
 *   intro      the title: the foundation on the home chord swells in, the theme's
 *              first notes hinted
 *   segments   the speaking, cut at each chapter card; a segment ends home
 *   breaks     a chapter card: the pad holds home, a bell, then a fresh
 *              phrase starts as the voice comes back
 *   lift       a beat marked big moment: from that phrase on the key steps
 *              up a tone (twice at most)
 *   accents    a pulled word: a soft bell on a chord note
 *   end card   the theme in full over the reel, home lands on the mosaic,
 *              then it rings out and fades
 *
 * Pure: (seed, plan) → a Score. render.ts plays it (with `loop: false`).
 */
import { mulberry } from "@heroic/ascii-build";
import { CHANT_TEXTS, GROOVES, type Groove, type Inst, LIFT, MOOD_PRESETS, type Note, type Score, STYLE_TABLE, type Style, type StyleName, TUNE_DEGREES, type Texture } from "./compose";
import { type Chord, type HarmonyBias, type Mode, SCALES, chordName, harmony } from "./harmony";
import type { Mood } from "./mood";

export type JourneySection = { start: number; end: number; mood: Mood; intensity: number; lift?: boolean };
export type JourneyPlan = {
  /** The whole video, seconds. */
  seconds: number;
  /** Where the speaking starts (the title runs before it). */
  bodyStart: number;
  /** Where the end card starts, if there is one: the theme plays over its reel and home lands on its mosaic. */
  endCard?: number;
  /** Each beat's stretch of the video and what the music does under it. */
  sections: JourneySection[];
  /** Chapter cards: the music breathes and starts a fresh phrase after. */
  breaks?: { start: number; end: number }[];
  /** Pulled words: a soft bell. */
  accents?: number[];
  /** Pin the style (else the seed picks one that suits the video's main mood). */
  style?: StyleName;
  /** A loop (a short that replays into its own hook): no fade in or out, the last chord leads back into the first, and the render wraps round. */
  loop?: boolean;
};

/** The styles that suit a long piece under talking (4/4, nothing that won't sit back). */
export const JOURNEY_STYLES: StyleName[] = ["felt", "rhodes", "ambient", "guitar", "downtempo", "chip"];
/** Bumped when the composer changes what a seed makes, so a score made before is made again rather than found on disk (Desk score.ts). */
export const JOURNEY_VERSION = 3;
/** When the end card's mosaic lands (seconds into the card): home lands with it. */
const END_LAND = 7.6;

// ------------------------------------------------------- the arrangement

export type Foundation = "pad" | "strings" | "drone" | "none";
export type Figuration = "strike" | "pulse" | "broken" | "rolled" | "hold" | "pick" | "chiparp";
export type Recipe = "classic" | "groove" | "tune" | "calm";
export type Figure = "up" | "updown" | "thirds" | "pedal" | "three" | "sync";
export type Register = "mid" | "low" | "high" | "spread";
type Layer = "chords" | "bass" | "theme" | "figure" | "drums";

type Arrange = {
  foundations: Foundation[];
  figurations: Figuration[];
  recipes: Recipe[];
  figures: Figure[];
  registers: Register[];
  /** Instruments the theme may move to, or that answer it. */
  guests: Inst[];
  textures: Texture[];
  /** Notes per beat the figure may run at. */
  rates: number[];
};

/** What each style leaves open to the seed. */
const ARRANGE: Partial<Record<StyleName, Arrange>> = {
  felt: { foundations: ["pad", "strings", "drone", "none", "none"], figurations: ["strike", "pulse", "broken", "rolled"], recipes: ["classic", "groove", "tune", "calm"], figures: ["up", "updown", "thirds", "pedal", "three", "sync"], registers: ["mid", "low", "high", "spread"], guests: ["celesta", "vibes", "strings", "musicbox"], textures: ["none", "none", "hiss", "crackle", "tape"], rates: [2, 2, 3, 4] },
  rhodes: { foundations: ["pad", "none", "drone", "strings"], figurations: ["strike", "pulse", "broken"], recipes: ["classic", "groove", "tune", "calm"], figures: ["up", "updown", "thirds", "pedal", "three", "sync"], registers: ["mid", "high", "spread", "low"], guests: ["musicbox", "vibes", "celesta", "harp"], textures: ["none", "none", "hiss", "crackle", "tape"], rates: [2, 2, 3, 4] },
  guitar: { foundations: ["none", "none", "strings", "pad", "drone"], figurations: ["pick", "rolled", "strike"], recipes: ["classic", "tune", "calm", "groove"], figures: ["up", "updown", "thirds", "sync"], registers: ["mid", "spread", "high"], guests: ["piano", "celesta", "vibes", "harp"], textures: ["none", "none", "hiss", "crackle"], rates: [2, 2, 3] },
  downtempo: { foundations: ["pad", "drone", "none"], figurations: ["hold", "pulse"], recipes: ["classic", "groove", "tune", "calm"], figures: ["up", "updown", "thirds", "pedal", "three", "sync"], registers: ["mid", "low", "spread"], guests: ["piano", "vibes", "celesta", "marimba"], textures: ["none", "none", "hiss"], rates: [2, 2, 4] },
  ambient: { foundations: ["pad", "none", "drone"], figurations: ["hold"], recipes: ["classic", "tune", "calm"], figures: ["up", "updown", "pedal", "sync"], registers: ["mid", "low", "spread"], guests: ["celesta", "kalimba", "vibes", "harp"], textures: ["none", "none", "hiss"], rates: [1, 2] },
  chip: { foundations: ["none", "none", "pad"], figurations: ["chiparp", "pulse"], recipes: ["classic", "groove"], figures: ["up", "updown", "thirds", "three", "sync"], registers: ["mid", "high"], guests: ["celesta", "musicbox"], textures: ["none", "hiss"], rates: [2, 4] },
};
const DEFAULT_ARRANGE: Arrange = { foundations: ["pad", "none"], figurations: ["strike", "hold"], recipes: ["classic", "calm"], figures: ["up", "updown"], registers: ["mid", "spread"], guests: ["celesta", "vibes"], textures: ["none"], rates: [2] };

/** Where each layer comes in, by intensity, per recipe. A chord-only recipe never gets drums. */
const RECIPES: Record<Recipe, Record<Layer, number>> = {
  classic: { chords: 0.12, bass: 0.3, theme: 0.35, figure: 0.5, drums: 0.72 },
  groove: { bass: 0.12, figure: 0.16, chords: 0.3, theme: 0.45, drums: 0.62 },
  tune: { theme: 0.12, chords: 0.28, bass: 0.4, figure: 0.58, drums: 0.78 },
  calm: { chords: 0.12, bass: 0.3, theme: 0.35, figure: 0.55, drums: 9 },
};
/** The arpeggio's shape over the chord's notes (bottom to top, then the bottom an octave up); -1 is a rest, "T" the top note held against the rest. */
const FIGURES: Record<Figure, (number | "T")[]> = {
  up: [0, 1, 2, 3],
  updown: [0, 1, 2, 3, 2, 1],
  thirds: [0, 2, 1, 3, 2, 4, 3, 5],
  pedal: ["T", 0, "T", 1, "T", 2, "T", 1],
  three: [0, 1, 2],
  sync: [0, -1, 1, 2, -1, 3, -1, 2],
};
/** The kits a style with no drums of its own may get. */
const LIGHT_GROOVES: Groove[] = ["halftime", "brush", "hand", "pulse"];
const VOICING: Record<Register, { centre: number; open: boolean }> = { mid: { centre: 60, open: false }, low: { centre: 53, open: true }, high: { centre: 66, open: false }, spread: { centre: 60, open: true } };
const ROOMS = [{ name: "dry", rt: 0.6, wet: 0.75 }, { name: "room", rt: 1, wet: 1 }, { name: "hall", rt: 1.5, wet: 1.25 }];
/** The beats a chapter must mostly be under to be sung. */
const DARK: Mood[] = ["tense", "melancholy", "eerie", "wonder", "night"];
/** Where the sung line sits (A3: tenors), and its floor and ceiling; the organal voice may go lower. */
const CHANT_ANCHOR = 57;

const pc = (n: number) => ((n % 12) + 12) % 12;
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MODES: Mode[] = ["ionian", "dorian", "lydian", "mixolydian", "aeolian"];

type Span = { t0: number; t1: number; chord: Chord; tonic: number; mode: Mode; pcs: number[]; v: number[]; bass: number; intensity: number; mood: Mood; seg: number };

/** Lays a chord out around `centre`, moving as little as possible from the last one. */
const voice = (pcs: number[], prev: number[] | null, open: boolean, centre = 60): number[] => {
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
      const c = prev ? v.reduce((a, n) => a + Math.min(...prev.map((q) => Math.abs(q - n))), 0) : Math.abs(v.reduce((a, n) => a + n, 0) / v.length - centre);
      if (c < cost) [cost, best] = [c, v];
    }
  }
  if (open && best.length >= 4) best = [...best.slice(0, -2), best[best.length - 2]! - 12, best[best.length - 1]!].sort((a, b) => a - b);
  return best;
};

export const journey = (seed: number, plan: JourneyPlan): Score => {
  const rand = mulberry(seed * 131 + 17);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const between = (a: number, b: number) => a + (b - a) * rand();
  const sections = [...plan.sections].sort((a, b) => a.start - b.start);
  const end = plan.endCard ?? plan.seconds;

  // ------------------------------------------------- what the seed fixes
  const weight = new Map<Mood, number>();
  for (const s of sections) weight.set(s.mood, (weight.get(s.mood) ?? 0) + (s.end - s.start));
  const baseMood: Mood = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "focus";
  const B = MOOD_PRESETS[baseMood];
  const suits = JOURNEY_STYLES.filter((n) => (STYLE_TABLE[n] as Style).moods.includes(baseMood));
  const styleName: StyleName = plan.style ?? pick(suits.length ? suits : JOURNEY_STYLES);
  const S = STYLE_TABLE[styleName] as Style;
  const tonic0 = Math.floor(rand() * 12);
  // The band a little wider than the style's or mood's, so two pieces at the same heart move differently.
  const [slow, quick] = S.bpm ?? B.bpm;
  const beat = 60 / between(slow - 5, quick + 5);
  const bar = 4 * beat;
  const bpc = S.barsPerChord ?? 1;
  const eighth = beat / 2;
  const nudge = () => (rand() - 0.5) * 0.016;
  const [chordInst] = pick(S.chords);
  const padPick: Inst = pick(S.pad) ?? "pad";
  // The Save styles' breathy tune voices grate under talking (Tom, 10-25): the draw stands, the voice moves to the style's first other tune.
  const tuneDrawn = pick(S.tune);
  const tuneInst: Inst = tuneDrawn === "ocarina" || tuneDrawn === "flute" ? (S.tune.find((t) => t !== "ocarina" && t !== "flute") ?? "piano") : tuneDrawn;
  const arpInst: Inst = S.arpInst.length ? pick(S.arpInst) : "harp";
  const bassInst: Inst = ({ soft: "bass", sub: "sub", tri: "tri", none: "bass" } as const)[pick(S.bass.filter((b) => b !== "none").length ? S.bass.filter((b) => b !== "none") : (["soft"] as const))];
  const bell: Inst = tuneInst === "celesta" ? "musicbox" : "celesta";
  /** Each mood's mode, fixed for the piece. */
  const modeOf = new Map<Mood, Mode>();
  const moodMode = (m: Mood) => {
    if (!modeOf.has(m)) modeOf.set(m, MOOD_PRESETS[m].modes[Math.floor(mulberry(seed * 7 + m.length * 13 + m.charCodeAt(0))() * MOOD_PRESETS[m].modes.length)]!);
    return modeOf.get(m)!;
  };

  // ------------------------------------------------- the arrangement
  // Its own stream, drawn in this order for good: a draw added later goes on the end.
  const arand = mulberry(seed * 211 + 29);
  const apick = <T>(xs: readonly T[]): T => xs[Math.floor(arand() * xs.length)]!;
  const A = ARRANGE[styleName] ?? DEFAULT_ARRANGE;
  const foundation = apick(A.foundations);
  const figuration0 = apick(A.figurations);
  const recipe = apick(A.recipes);
  const figure0 = apick(A.figures);
  const register = apick(A.registers);
  const long = end - plan.bodyStart > 150;
  const phraseLen = long && !plan.loop ? apick([4, 4, 8]) : 4;
  /** Below this intensity a phrase takes a chord every two bars. */
  const breatheBelow = S.barsPerChord ? 0 : apick([0.3, 0.42, 0.55]);
  const swing = styleName === "chip" ? (S.swing ?? 0.5) : Math.min(0.66, Math.max(0.5, (S.swing ?? 0.5) + apick([-0.02, 0, 0.04, 0.08])));
  const room = apick(ROOMS);
  const texture = apick(A.textures);
  const groove: Groove = S.drums ? apick(S.drums) : apick(LIGHT_GROOVES);
  const arpRate = apick(A.rates);
  const themeBars = phraseLen === 8 && apick([true, false]) ? 4 : 2;
  const augment = apick([true, false, false]);
  const answer = apick([true, false]);
  const guest: Inst = apick(A.guests.filter((g) => g !== tuneInst).length ? A.guests.filter((g) => g !== tuneInst) : A.guests);
  const bias: HarmonyBias = { borrow: apick([0.7, 1, 1, 1.4]), paletteSize: apick([2, 2, 3, 4]) };
  const mediant = apick([true, false, false]);
  const at: Record<Layer, number> = { ...RECIPES[recipe] };
  for (const k of Object.keys(at) as Layer[]) if (at[k] < 1) at[k] = Math.max(0, at[k] + (arand() - 0.5) * 0.08);
  // Nothing under it: the chord instrument is the floor, playing softly from the start.
  if (foundation === "none") at.chords = 0;
  const { centre, open } = VOICING[register];
  const padInst: Inst | null = foundation === "pad" ? (padPick === chordInst ? "strings" : padPick) : foundation === "strings" ? "strings" : null;
  /** The pad for the moments (intro, chapter cards): the foundation's, or a pad when there's none. */
  const momentPad: Inst = padInst ?? "pad";

  /** What the beats ask for at `t` (between beats: the one before). */
  const sectionAt = (t: number): JourneySection | undefined => {
    let s: JourneySection | undefined;
    for (const x of sections) if (x.start <= t + 1e-6) s = x;
    return s ?? sections[0];
  };
  const intensityOver = (t0: number, t1: number) => {
    let sum = 0;
    let n = 0;
    for (let t = t0; t < t1; t += beat) {
      sum += sectionAt(t)?.intensity ?? 0.3;
      n++;
    }
    return n ? sum / n : 0.3;
  };

  // ------------------------------------------------------ the theme
  // Its own stream, so a seed hums the same theme whatever the style.
  const trand = mulberry(seed * 53 + 9);
  const tpick = <T>(xs: readonly T[]): T => xs[Math.floor(trand() * xs.length)]!;
  const unit = eighth * (S.tuneUnit ?? 1);
  const themeLen = themeBars * bar;
  const slots = Math.round(themeLen / unit);
  const k = (themeBars === 4 ? 6 : 4) + Math.floor(trand() * 3);
  const rhythm = new Set<number>([0]);
  while (rhythm.size < Math.min(k, slots - 2)) {
    const s = Math.floor(trand() * (slots - 2));
    if (s % 2 === 0 || trand() < 0.4) rhythm.add(s);
  }
  const motif = [...rhythm].sort((a, b) => a - b);
  const contour = motif.slice(1).map(() => tpick([-1, 1, -1, 1, 2, -2, 0, 3, -2, -3, 4, 1, -1]));
  const lift = LIFT[tuneInst] ?? 0;
  const anchor = 72 + lift;

  // ------------------------------------------------- the grid of chords
  const harmonies = new Map<string, ReturnType<typeof harmony>>();
  const harmonyOf = (mode: Mode, mood: Mood) => {
    const key = `${mode}/${mood}`;
    if (!harmonies.has(key)) harmonies.set(key, harmony(mulberry(seed * 89 + 3 + MODES.indexOf(mode) * 1009 + mood.length * 31), mode, mood, bias));
    return harmonies.get(key)!;
  };
  const spans: Span[] = [];
  const phraseStarts: { t: number; intensity: number; index: number; seg: number; bars: number }[] = [];
  let shift = 0;
  let lifts = 0;
  let prevV: number[] | null = null;
  const lifted = new Set<JourneySection>();
  /** The body cut at the chapter cards. */
  const breaks = [...(plan.breaks ?? [])].sort((a, b) => a.start - b.start);
  const segments: { from: number; to: number }[] = [];
  let from = plan.bodyStart;
  for (const b of breaks) {
    if (b.start > from + bar) segments.push({ from, to: b.start });
    from = b.end;
  }
  if (end > from + bar * 0.5) segments.push({ from, to: end });

  // Per chapter (drawn after the fixed draws, so their count never moves those):
  // the figuration and figure may change hands, the theme may change register,
  // sit a chapter out, or go to the guest; one chapter may be in another key.
  // Each may change hands twice at most in a piece (a long video has a dozen chapters: more and it's restless).
  const figurationOf: Figuration[] = [figuration0];
  const figureOf: Figure[] = [figure0];
  const registerOf: number[] = [0];
  let figurationChanges = 0;
  let figureChanges = 0;
  for (let i = 1; i < segments.length; i++) {
    const f = figurationOf[i - 1]!;
    const changeF = A.figurations.length > 1 && arand() < 0.3 && figurationChanges < 2;
    figurationOf.push(changeF ? apick(A.figurations.filter((x) => x !== f)) : f);
    if (changeF) figurationChanges++;
    const g = figureOf[i - 1]!;
    const changeG = A.figures.length > 1 && arand() < 0.3 && figureChanges < 2;
    figureOf.push(changeG ? apick(A.figures.filter((x) => x !== g)) : g);
    if (changeG) figureChanges++;
    const high = ["musicbox", "celesta", "kalimba"].includes(tuneInst);
    registerOf.push(apick(high ? [0, 0, 0, -12] : [0, 0, 0, 12, -12]));
  }
  const middle = segments.length >= 3 ? Array.from({ length: segments.length - 2 }, (_, i) => i + 1) : [];
  const restSeg = middle.length && !plan.loop && arand() < 0.5 ? apick(middle) : -1;
  const guestSeg = middle.filter((i) => i !== restSeg).length && !plan.loop && arand() < 0.5 ? apick(middle.filter((i) => i !== restSeg)) : -1;
  const modSeg = middle.length && long && !plan.loop && arand() < 0.5 ? apick(middle) : -1;
  const modBy = modSeg >= 0 ? apick([-5, 3, -3, 5]) : 0;
  // The chant (§10): one middle chapter mostly under dark beats may be sung by a schola over an organum fifth,
  // everything else silent. Never in a short, never in chip. Drawn last, so the draws before it never move.
  const darkShare = (seg: { from: number; to: number }) => {
    let d = 0;
    let n = 0;
    for (let t = seg.from; t < seg.to; t += beat) {
      n++;
      if (DARK.includes(sectionAt(t)?.mood ?? baseMood)) d++;
    }
    return n ? d / n : 0;
  };
  const chantable = middle.filter((i) => i !== restSeg && i !== guestSeg && darkShare(segments[i]!) >= 0.6);
  const chantRoll = arand();
  const chantSeg = chantable.length && !plan.loop && styleName !== "chip" && chantRoll < 0.45 ? apick(chantable) : -1;
  const text = apick(CHANT_TEXTS);
  /** A schola in a dry room is a pad: a piece with a chant chapter sits in the hall. */
  const roomUsed = chantSeg >= 0 ? ROOMS[2]! : room;
  /** Per-phrase chance draws (splits, chords from nowhere), their own stream. */
  const prand = mulberry(seed * 317 + 5);

  const addSpan = (t0: number, t1: number, node: string, mode: Mode, mood: Mood, intensity: number, seg: number, sus = false) => {
    const H = harmonyOf(mode, mood);
    const chord = H.chord(node, { sus });
    const tonic = pc(tonic0 + shift + (seg === modSeg ? modBy : 0));
    const pcs = chord.tones.map((x) => pc(chord.root + x + tonic));
    const v = voice(pcs, prevV, open, centre);
    prevV = v;
    spans.push({ t0, t1, chord, tonic, mode, pcs, v, bass: pc(chord.bass + tonic), intensity, mood, seg });
    return chord;
  };

  segments.forEach((seg, segIndex) => {
    const bars: number[] = [];
    for (let t = seg.from; t < seg.to - bar * 0.5; t += bar) bars.push(t);
    let index = 0;
    for (let p = 0; p < bars.length; p += phraseLen) {
      const ps = bars[p]!;
      const phraseBars = bars.slice(p, p + phraseLen);
      const pe = Math.min(seg.to, bars[p + phraseBars.length] ?? seg.to);
      // A big moment inside this phrase: the key steps up a tone from here.
      for (const s of sections)
        if (s.lift && !lifted.has(s) && lifts < 2 && s.start >= ps - bar && s.start < pe) {
          lifted.add(s);
          shift += 2;
          lifts++;
        }
      const sec = sectionAt((ps + pe) / 2) ?? { mood: baseMood, intensity: 0.3 };
      const mood = sec.mood;
      const mode = moodMode(mood);
      const intensity = intensityOver(ps, pe);
      phraseStarts.push({ t: ps, intensity, index, seg: segIndex, bars: phraseBars.length });
      // Chord slots: the style's bars per chord, two when the phrase is quiet
      // enough to breathe; at a peak a bar may carry two.
      const per = intensity < breatheBelow ? 2 : bpc;
      const slotsOf: { t0: number; t1: number }[] = [];
      for (let i = 0; i < phraseBars.length; i += per) {
        const t0 = phraseBars[i]!;
        const t1 = i + per < phraseBars.length ? phraseBars[i + per]! : pe;
        if (per === 1 && intensity >= 0.7 && t1 - t0 > 3.5 * beat && prand() < 0.25) slotsOf.push({ t0, t1: t0 + (t1 - t0) / 2 }, { t0: t0 + (t1 - t0) / 2, t1 });
        else slotsOf.push({ t0, t1 });
      }
      const H = harmonyOf(mode, mood);
      const path = H.walk(slotsOf.length);
      // A chord from nowhere, once in a phrase, where the mood is strange enough to take it.
      if (mediant && (mood === "eerie" || mood === "wonder") && path.length >= 3 && prand() < 0.5) path[1 + Math.floor(prand() * (path.length - 2))] = "III";
      const lastOfSeg = p + phraseBars.length >= bars.length;
      const nextMood = sectionAt(pe + 0.01)?.mood;
      // The phrase before a change of colour, or the end of a segment, comes home.
      if (lastOfSeg || (nextMood && moodMode(nextMood) !== mode)) path[path.length - 1] = "0";
      const chords: Chord[] = [];
      slotsOf.forEach((sl, i) => chords.push(addSpan(sl.t0, sl.t1, path[i]!, mode, mood, intensity, segIndex)));
      H.basses(chords);
      // basses() set the chords' bass notes after the spans were made: copy them over.
      for (let i = 0; i < chords.length; i++) {
        const sp = spans[spans.length - chords.length + i]!;
        sp.bass = pc(chords[i]!.bass + sp.tonic);
      }
      index++;
    }
  });
  // A loop: the last chord is the lead-in (the one the end card uses), so the replay resolves onto the first.
  if (plan.loop && spans.length > 1) {
    const last = spans[spans.length - 1]!;
    const H = harmonyOf(last.mode, last.mood);
    const lead = H.chord(last.mode === "aeolian" ? "6" : "4", { sus: last.mode !== "aeolian" });
    const pcs = lead.tones.map((x) => pc(lead.root + x + last.tonic));
    const v = voice(pcs, spans[spans.length - 2]!.v, open, centre);
    spans[spans.length - 1] = { ...last, chord: lead, pcs, v, bass: pc(lead.root + last.tonic) };
  }
  const spanAt = (t: number) => spans.find((s) => t >= s.t0 && t < s.t1) ?? spans[spans.length - 1];

  // ------------------------------------------------------------- notes
  const notes: Note[] = [];
  const firstSpan = spans[0];
  const homeOf = (tonic: number, mode: Mode, mood: Mood) => {
    const H = harmonyOf(mode, mood);
    const chord = H.chord("0", { colour: "added9" });
    const pcs = chord.tones.map((x) => pc(chord.root + x + tonic));
    return voice(pcs, prevV, false, centre);
  };
  const swung = (slot: number, u = eighth) => (slot % 2 === 1 ? (slot - 1) * u + 2 * u * swing : slot * u);

  // The intro: the home chord swells in under the title, the theme hinted.
  if (plan.bodyStart > 0.5 && firstSpan) {
    const home = homeOf(firstSpan.tonic, firstSpan.mode, firstSpan.mood);
    for (const n of home) notes.push({ t: 0, dur: plan.bodyStart + 0.4, midi: n, vel: 0.32, inst: momentPad, pan: 0 });
    if (foundation === "drone") notes.push({ t: 0, dur: plan.bodyStart + 0.4, midi: 36 + pc(firstSpan.tonic - 36), vel: 0.3, inst: "sub", pan: 0 });
    notes.push({ t: plan.bodyStart * 0.35, dur: 2, midi: home[home.length - 1]! + 12, vel: 0.22, inst: bell, pan: 0.2 });
  }

  for (const s of spans) {
    const len = s.t1 - s.t0;
    const I = s.intensity;
    const vel = (v: number) => v * (0.75 + 0.45 * I);
    const fig = figurationOf[s.seg] ?? figuration0;
    // the chant chapter: the voices and their fifth only (below, with the theme)
    if (s.seg === chantSeg) continue;
    // the foundation: always
    if (padInst) for (const n of s.v) notes.push({ t: s.t0, dur: len + 0.05, midi: n, vel: vel(0.3), inst: padInst, pan: 0 });
    if (foundation === "drone") {
      const low = 36 + pc(s.tonic - 36);
      notes.push({ t: s.t0, dur: len + 0.05, midi: low, vel: vel(0.42), inst: "sub", pan: 0 });
      notes.push({ t: s.t0, dur: len + 0.05, midi: low + 12, vel: vel(0.2), inst: "strings", pan: 0 });
    }
    // chords
    if (I >= at.chords) {
      // With nothing under them the chords carry the quiet on their own, softer.
      const soft = foundation === "none" && I < 0.2 ? 0.75 : 1;
      // A chord struck or rolled inside the span: never past its end (the last span of a segment can be shorter than a bar), never shorter than a grace.
      const strike = (t: number, v: number, dur = Math.max(0.1, s.t1 - t)) => {
        if (t >= s.t1 - 0.05) return;
        s.v.forEach((n, j) => notes.push({ t: t + j * 0.014 + nudge(), dur, midi: n, vel: vel(v) * soft * (0.9 + 0.2 * rand()), inst: chordInst, pan: -0.2 + (0.4 * j) / s.v.length }));
      };
      if (fig === "hold") for (const n of s.v) notes.push({ t: s.t0, dur: len, midi: n, vel: vel(0.55) * soft, inst: chordInst, pan: 0 });
      else if (fig === "pick") {
        const root = 40 + pc(s.bass - 40);
        const fifth = root + pc(s.pcs[2]! - root);
        const top = s.v.slice(1);
        const fingers = [null, 1, 0, 2, null, 1, 0, 2];
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar)
          for (let kk = 0; kk < 8; kk++) {
            const t = b + swung(kk);
            if (t >= s.t1) continue;
            const f = fingers[kk] ?? null;
            notes.push({ t: t + nudge(), dur: 2.5 * eighth, midi: f === null ? (kk === 0 ? root : fifth) : top[f % top.length]!, vel: vel(f === null ? 0.5 : 0.36) * soft * (0.85 + 0.3 * rand()), inst: "guitar", pan: f === null ? -0.15 : 0.2 });
          }
      } else if (fig === "chiparp") {
        const step = beat / 4;
        let kk = 0;
        for (let t = s.t0; t < s.t1 - 1e-6; t += step, kk++) notes.push({ t, dur: step * 0.9, midi: s.v[kk % s.v.length]!, vel: vel(0.2), inst: "pulse", pan: -0.25 });
      } else if (fig === "pulse") {
        // The chord repeated, quarters when it's quiet, eighths when it's up: the engine under the voice.
        const perBar = I >= 0.5 ? 8 : 4;
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar)
          for (let kk = 0; kk < perBar; kk++) {
            const t = b + (perBar === 8 ? swung(kk) : kk * beat);
            if (t >= s.t1) continue;
            const v = kk === 0 ? 0.4 : kk % 2 ? 0.24 : 0.3;
            s.v.forEach((n, j) => notes.push({ t: t + j * 0.006 + nudge(), dur: (perBar === 8 ? eighth : beat) * 0.9, midi: n, vel: vel(v) * soft * (0.9 + 0.2 * rand()), inst: chordInst, pan: -0.15 + (0.3 * j) / s.v.length }));
          }
      } else if (fig === "broken") {
        // The bass note, then the chord's upper notes one at a time: one hand rolling through it.
        const low = 48 + pc(s.bass - 48);
        const top = s.v.slice(1);
        const order = [null, 0, 1, 2, null, 1, 2, 0];
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar)
          for (let kk = 0; kk < 8; kk++) {
            const t = b + swung(kk);
            if (t >= s.t1) continue;
            const o = order[kk]!;
            notes.push({ t: t + nudge(), dur: 2 * eighth, midi: o === null ? low : top[o % top.length]!, vel: vel(o === null ? 0.42 : 0.32) * soft * (0.88 + 0.24 * rand()), inst: chordInst, pan: o === null ? -0.2 : 0.1 + 0.1 * o });
          }
      } else if (fig === "rolled") {
        // Rolled from the bottom, slow; a softer second roll when it's up.
        const roll = (t: number, v: number) => {
          if (t >= s.t1 - 0.05) return;
          s.v.forEach((n, j) => notes.push({ t: t + j * 0.05 + nudge(), dur: Math.max(0.1, s.t1 - t), midi: n, vel: vel(v) * soft * (0.9 + 0.2 * rand()), inst: chordInst, pan: -0.25 + (0.5 * j) / s.v.length }));
        };
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar) {
          roll(b, 0.46);
          if (I >= 0.5 && b + bar / 2 < s.t1) roll(b + bar / 2 + (swing - 0.5) * beat, 0.28);
        }
      } else {
        // strike: once a bar, a soft second strike when it's busier
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar) {
          strike(b, 0.48);
          if (I >= 0.45 && b + bar / 2 < s.t1) strike(b + bar / 2 + (swing - 0.5) * beat, 0.3);
        }
      }
    }
    // bass (tense and eerie hold the home note under everything; a drone is the bass until it's busy)
    if (I >= at.bass + (foundation === "drone" ? 0.25 : 0)) {
      const pedal = s.mood === "tense" || s.mood === "eerie";
      const root = 36 + pc((pedal ? s.tonic : s.bass) - 36);
      if (bassInst === "tri") for (let t = s.t0, kk = 0; t < s.t1 - 1e-6; t += eighth, kk++) notes.push({ t, dur: eighth * 0.85, midi: root + (kk % 2 ? 12 : 0), vel: vel(0.45), inst: "tri", pan: 0 });
      else notes.push({ t: s.t0 + nudge(), dur: len, midi: root, vel: vel(0.5), inst: bassInst, pan: 0 });
    }
    // the figure (driving wants it sooner)
    if (I >= at.figure || (s.mood === "driving" && I >= Math.min(at.figure, 0.3))) {
      const shape = FIGURES[figureOf[s.seg] ?? figure0];
      const step = beat / (s.mood === "driving" ? Math.max(2, arpRate) : arpRate);
      const up = arpInst === "kalimba" || arpInst === "marimba" ? 0 : 12;
      const v = [...s.v, s.v[0]! + 12].map((n) => n + up);
      let kk = 0;
      for (let t = s.t0; t < s.t1 - 1e-6; t += step, kk++) {
        const o = shape[kk % shape.length]!;
        if (o === -1) continue;
        const midi = o === "T" ? v[v.length - 1]! : v[o % v.length]!;
        notes.push({ t: t + nudge(), dur: step * 2, midi, vel: vel(o === "T" ? 0.17 : 0.2 + 0.06 * rand()), inst: arpInst, pan: kk % 2 ? 0.35 : -0.35 });
      }
    }
  }

  // drums: only the busiest stretches, and soft
  const G = GROOVES[groove];
  const kit = G.chip ? ({ kick: "chipkick", snare: "chipsnare", hat: "chiphat" } as const) : ({ kick: "kick", snare: "snare", hat: "hat" } as const);
  for (const s of spans) {
    if (s.intensity < at.drums || s.seg === chantSeg) continue;
    const sixteenth = beat / 4;
    for (let b = s.t0; b < s.t1 - 1e-6; b += bar)
      for (let st = 0; st < 16; st++) {
        const t = b + st * sixteenth;
        if (t >= s.t1) break;
        const hit = (inst: Inst, v: number, pan = 0) => notes.push({ t: t + nudge() * 0.5, dur: 0.3, midi: 60, vel: v * (0.75 + 0.3 * rand()) * 0.8, inst, pan });
        if (G.kick.includes(st)) hit(kit.kick, st === 0 ? 0.75 : 0.55);
        if (G.snare.includes(st)) hit(kit.snare, 0.5);
        if (G.hat.includes(st)) hit(kit.hat, st % 4 === 0 ? 0.36 : 0.26, 0.3);
        if (G.rim?.includes(st)) hit("rim", 0.4, -0.2);
        if (G.shaker) hit("shaker", st % 2 ? 0.18 : 0.26, -0.3);
      }
  }

  // ------------------------------------------------------------- the theme
  /** The scale steps the theme may use around its anchor, in a span's key and mode. */
  const stepsFor = (s: Span, l = lift, lo = 52, hi = 98) => {
    const scale = SCALES[s.mode];
    const allowed = TUNE_DEGREES[s.mode];
    const out: number[] = [];
    for (let d = -21; d < 28; d++) {
      if (!allowed.includes(((d % 7) + 7) % 7)) continue;
      const n = 60 + s.tonic + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7]! + l;
      if (n >= lo + l && n <= hi + l) out.push(n);
    }
    return out;
  };
  const nearestIn = (steps: number[], n: number, pcs?: number[]): number => {
    let bi = -1;
    for (let i = 0; i < steps.length; i++) {
      if (pcs && !pcs.includes(pc(steps[i]!))) continue;
      if (bi < 0 || Math.abs(steps[i]! - n) < Math.abs(steps[bi]! - n)) bi = i;
    }
    return bi < 0 ? nearestIn(steps, n) : bi;
  };
  /** How many syllables the schola has sung (the text runs on through the chapter). */
  let syllable = 0;
  /**
   * The theme from `start`: `shape` its contour, `inst` and `vel` how it's played, `upTo` where it must stop, `u` the step (double for half speed).
   * Sung (`chant`): straight and legato around A3, a syllable of the text on each note, and when `organum` a second voice a fourth below.
   */
  const sing = (start: number, shape: number[], inst: Inst, v: number, upTo: number, register = 0, u = unit, chant?: { organum: boolean }) => {
    let at = -1;
    const total = slots * u;
    motif.forEach((slot, j) => {
      const t = start + (chant ? slot * u : swung(slot, u));
      if (t >= upTo - 0.1) return;
      const s = spanAt(t);
      if (!s) return;
      const steps = chant ? stepsFor(s, 0, 50, 70) : stepsFor(s);
      at = at < 0 ? nearestIn(steps, (chant ? CHANT_ANCHOR : anchor) + register, s.pcs) : Math.max(0, Math.min(steps.length - 1, at + shape[j - 1]!));
      if (slot % 4 === 0 || (!s.pcs.includes(pc(steps[at]!)) && s.pcs.some((p) => pc(p - steps[at]!) === 1 || pc(steps[at]! - p) === 1))) at = nearestIn(steps, steps[at]!, s.pcs);
      const next = motif[j + 1] !== undefined ? start + (chant ? motif[j + 1]! * u : swung(motif[j + 1]!, u)) : start + total;
      if (!chant) {
        notes.push({ t: t + nudge(), dur: Math.min(4 * u, next - t), midi: steps[at]!, vel: v * (0.85 + 0.2 * trand()), inst, pan: 0.15 });
        return;
      }
      const vowel = text.vowels[syllable++ % text.vowels.length]!;
      const dur = Math.max(0.2, Math.min(next, upTo) - t - 0.03);
      const midi = steps[at]!;
      notes.push({ t: t + nudge(), dur, midi, vel: v * (0.9 + 0.1 * trand()), inst: "chant", pan: 0.12, vowel, sung: "syllable" });
      if (chant.organum) {
        // Strict organum: the same line a fourth below in the scale, a fifth where the fourth would be a tritone.
        const low = stepsFor(s, 0, 43, 70);
        let o = low[nearestIn(low, midi - 5)]!;
        if (midi - o === 6) o = low[nearestIn(low, midi - 7)]!;
        if (o < midi) notes.push({ t: t + nudge(), dur, midi: o, vel: v * 0.72 * (0.9 + 0.1 * trand()), inst: "chant", pan: -0.12, vowel, sung: "syllable" });
      }
    });
  };
  const variation = () => contour.map((c, i) => (i === contour.length - 1 ? tpick([-2, -1, 1, 2]) : i === 0 ? tpick([c, -c, c]) : c));
  const guestHigh = ["musicbox", "celesta", "kalimba"].includes(guest);
  for (const p of phraseStarts) {
    const s = spanAt(p.t);
    // Where the phrase's last chord ends (it was the first chord's end for a long while: the theme lost all but its first bar).
    const phraseEnd = Math.min(Math.max(p.t + bar, ...spans.filter((x) => x.t0 >= p.t).slice(0, p.bars).map((x) => x.t1)), end);
    if (p.seg === chantSeg && s) {
      // The organum fifth held under the phrase (long notes swell in), a sub so a phone hears the bottom,
      // and the theme sung at half speed, its leaps smoothed to steps; the second voice joins when the beat is up.
      const root = 45 + pc(s.tonic - 45);
      const hold = phraseEnd - p.t + 0.3;
      notes.push({ t: p.t, dur: hold, midi: root, vel: 0.36, inst: "chant", pan: -0.3, vowel: "o", sung: "hold" });
      notes.push({ t: p.t + 0.05, dur: hold, midi: root + 7, vel: 0.3, inst: "chant", pan: 0.3, vowel: "o", sung: "hold" });
      notes.push({ t: p.t, dur: hold, midi: 36 + pc(s.tonic - 36), vel: 0.3, inst: "sub", pan: 0 });
      const shape = (p.index % 2 === 0 ? contour : variation()).map((c) => Math.max(-2, Math.min(2, c)));
      sing(p.t + beat, shape, "chant", 0.5 * (0.85 + 0.3 * p.intensity), phraseEnd, 0, unit * 2, { organum: p.intensity >= 0.45 || p.index % 2 === 1 });
      continue;
    }
    if (p.intensity < at.theme || p.seg === restSeg) continue;
    const inst: Inst = p.seg === guestSeg ? guest : tuneInst;
    const reg = (registerOf[p.seg] ?? 0) + (s?.mood === "melancholy" ? -5 : 0);
    const tv = (inst === "pulse" ? 0.38 : inst === guest ? 0.5 : 0.6) * (0.8 + 0.4 * p.intensity);
    const half = augment && p.intensity < 0.45 && themeBars * 2 <= p.bars;
    // Stated on the first, third… phrase of a segment (at half speed under a quiet beat when the piece does that);
    // answered (varied) by the second voice or on the busier others; rests otherwise, so it means something when it's back.
    if (p.index % 2 === 0) {
      sing(p.t, contour, inst, tv, phraseEnd, reg, half ? unit * 2 : unit);
      if (!half && answer && p.intensity >= 0.55 && p.t + themeLen < phraseEnd - bar * 0.5) sing(p.t + themeLen, variation(), inst === guest ? tuneInst : guest, tv * 0.6, phraseEnd, reg + (guestHigh ? 0 : 12));
      if (p.bars >= 8 && p.intensity >= 0.55 && !answer) sing(p.t + 4 * bar, variation(), inst, tv * 0.85, phraseEnd, reg);
    } else if (p.intensity >= 0.55) sing(p.t + themeLen, variation(), inst, tv * 0.85, phraseEnd, reg);
  }

  // ------------------------------------------------------------- breaks
  for (const b of breaks) {
    const before = spanAt(b.start - 0.01) ?? firstSpan;
    if (!before) continue;
    const home = homeOf(before.tonic, before.mode, before.mood);
    for (const n of home) notes.push({ t: b.start, dur: b.end - b.start + 0.3, midi: n, vel: 0.3, inst: momentPad, pan: 0 });
    if (foundation === "drone") notes.push({ t: b.start, dur: b.end - b.start + 0.3, midi: 36 + pc(before.tonic - 36), vel: 0.3, inst: "sub", pan: 0 });
    notes.push({ t: b.start + 0.3, dur: 2.4, midi: home[home.length - 1]! + 12, vel: 0.3, inst: bell, pan: -0.2 });
    notes.push({ t: b.start + 0.3 + beat, dur: 2.2, midi: home[home.length - 2]! + 12, vel: 0.22, inst: bell, pan: 0.2 });
  }

  // ------------------------------------------------------------- accents
  for (const a of plan.accents ?? []) {
    if (breaks.some((b) => a >= b.start && a < b.end)) continue;
    const s = spanAt(a);
    if (!s) continue;
    notes.push({ t: a, dur: 1.6, midi: s.v[s.v.length - 1]! + 12, vel: 0.28, inst: bell, pan: 0.25 });
  }

  // ------------------------------------------------------------- end card
  if (plan.endCard !== undefined && firstSpan) {
    const last = spans[spans.length - 1] ?? firstSpan;
    const land = plan.endCard + END_LAND;
    const H = harmonyOf(last.mode, last.mood);
    // Over the reel: the lead-in under the theme in full, then home lands with the mosaic.
    const lead = H.chord(last.mode === "aeolian" ? "6" : "4", { sus: last.mode !== "aeolian" });
    const leadV = voice(lead.tones.map((x) => pc(lead.root + x + last.tonic)), last.v, false, centre);
    for (const n of leadV) notes.push({ t: plan.endCard, dur: END_LAND, midi: n, vel: 0.4, inst: momentPad, pan: 0 });
    spans.push({ t0: plan.endCard, t1: land, chord: lead, tonic: last.tonic, mode: last.mode, pcs: lead.tones.map((x) => pc(lead.root + x + last.tonic)), v: leadV, bass: pc(lead.root + last.tonic), intensity: 0.6, mood: last.mood, seg: last.seg });
    const home = homeOf(last.tonic, last.mode, last.mood);
    const homeChord = H.chord("0", { colour: "added9" });
    spans.push({ t0: land, t1: plan.seconds + 1, chord: homeChord, tonic: last.tonic, mode: last.mode, pcs: homeChord.tones.map((x) => pc(homeChord.root + x + last.tonic)), v: home, bass: pc(last.tonic), intensity: 0.4, mood: last.mood, seg: last.seg });
    sing(plan.endCard + 0.2, contour, tuneInst, tuneInst === "pulse" ? 0.4 : 0.66, land);
    const ring = plan.seconds - land;
    for (const n of home) {
      notes.push({ t: land, dur: ring, midi: n, vel: 0.62, inst: chordInst, pan: 0 });
      notes.push({ t: land, dur: ring, midi: n, vel: 0.34, inst: momentPad, pan: 0 });
    }
    notes.push({ t: land, dur: ring, midi: 36 + pc(last.tonic - 36), vel: 0.5, inst: bassInst === "tri" ? "bass" : bassInst, pan: 0 });
    notes.push({ t: land + beat, dur: 3, midi: home[home.length - 1]! + 12, vel: 0.32, inst: bell, pan: 0.2 });
  }

  // ------------------------------------------------------------- curves
  /** Points at every span start, glided between: the curves never step. */
  const glide = (value: (s: Span) => number) => {
    const pts = spans.map((s) => ({ t: s.t0, v: value(s) }));
    return (t: number) => {
      if (!pts.length) return 1;
      if (t <= pts[0]!.t) return pts[0]!.v;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        if (t < b.t) {
          // Holds, then glides into the next over the bar before it.
          const k = Math.max(0, Math.min(1, (t - (b.t - bar * 1.5)) / (bar * 1.5)));
          return a.v + (b.v - a.v) * k * k * (3 - 2 * k);
        }
      }
      return pts[pts.length - 1]!.v;
    };
  };
  const bright = glide((s) => MOOD_PRESETS[s.mood].brightness * (700 + 2700 * s.intensity));
  const loud = glide((s) => 0.72 + 0.28 * s.intensity);
  const inBreak = (t: number) => breaks.some((b) => t >= b.start && t < b.end);
  const fadeIn = Math.min(2, plan.bodyStart * 0.6 || 0.5);
  const cutoff = (t: number) => (t < plan.bodyStart ? 700 + 1200 * (t / Math.max(0.1, plan.bodyStart)) : bright(t) * (inBreak(t) ? 0.6 : 1));
  const level = (t: number) => {
    const fin = plan.loop ? 1 : Math.min(1, t / fadeIn);
    const fout = plan.loop ? 1 : Math.min(1, Math.max(0, (plan.seconds - t) / 6));
    const intro = t < plan.bodyStart ? 0.75 : loud(t);
    return fin * fout * intro;
  };

  /** Where something changes hands down the chapters: ", hold from chapter 3, pulse from chapter 9". */
  const changes = (xs: (string | number)[]) => xs.flatMap((x, i) => (i > 0 && x !== xs[i - 1] ? [`, ${x} from chapter ${i + 1}`] : [])).join("");
  const label = [
    `${styleName} (${baseMood} at heart)`,
    `${NAMES[tonic0]}`,
    `${Math.round(60 / beat)} bpm`,
    [...new Set(spans.map((s) => `${s.mood}→${s.mode}`))].join(", "),
    `${spans.length} chords, theme ${motif.length} notes over ${themeBars} bars on ${tuneInst}`,
    lifts ? `${lifts} lift${lifts > 1 ? "s" : ""}` : "",
    `${chordInst} ${figuration0} chords${changes(figurationOf)} over ${foundation === "none" ? "nothing" : foundation === "drone" ? "a drone" : padInst}`,
    `${recipe} build, ${register} voicing, phrases of ${phraseLen}, breathes under ${breatheBelow}`,
    `${arpInst} ${figure0} figure${changes(figureOf)} at ${arpRate}/beat, ${groove} drums${at.drums > 1 ? " never" : " when it's busiest"}, swing ${swing.toFixed(2)}`,
    [restSeg >= 0 ? `theme out in chapter ${restSeg + 1}` : "", guestSeg >= 0 ? `${guest} takes it in chapter ${guestSeg + 1}` : "", chantSeg >= 0 ? `monks sing it in chapter ${chantSeg + 1} (${text.name})` : "", answer ? `${guest} answers` : "", augment ? "half speed when quiet" : "", modSeg >= 0 ? `chapter ${modSeg + 1} ${modBy > 0 ? "up" : "down"} ${Math.abs(modBy)} semitones` : "", mediant ? "chords from nowhere" : ""].filter(Boolean).join(", "),
    `${roomUsed.name}${chantSeg >= 0 && room !== roomUsed ? " (the chant's)" : ""}, ${texture}, colour ${bias.borrow}×${bias.paletteSize}`,
    spans.slice(0, 8).map((s) => chordName(s.chord, s.tonic)).join(" ") + (spans.length > 8 ? " …" : ""),
  ].filter(Boolean).join(" · ");

  return {
    seconds: plan.seconds,
    mood: baseMood,
    style: styleName,
    notes,
    cutoff,
    level,
    texture,
    reverb: { rt60: B.rt60 * (S.rtScale ?? 1) * roomUsed.rt, wet: Math.min(0.5, B.wet * roomUsed.wet) },
    wow: B.wow * 0.5,
    lowpass: Math.min(B.lowpass + 1500, S.lowpass ?? Infinity),
    chimeShift: 0,
    label,
    loop: Boolean(plan.loop),
  };
};
