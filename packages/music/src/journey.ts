/**
 * A long piece that follows a story (docs/design/desk-ascii-scripts.md):
 * the score under a glyph video, written for its exact beat times.
 *
 * ONE piece, never tracks crossfaded. The seed fixes what makes it sound
 * like one thing all the way through: the key, the tempo, the style and
 * its instruments, and THE THEME (a short tune that comes back, varied).
 * The beats only steer it: each beat's mood picks the mode (the same home
 * note in another colour, so a change never jolts), its intensity decides
 * how many layers play (pad → chords → bass → the theme → arpeggio →
 * drums) and how bright it is. Changes land on phrase lines (four bars):
 * layers come and go there, the curves glide over bars rather than switch.
 *
 *   intro      the title: a pad on the home chord swells in, the theme's
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
import { GROOVES, type Groove, type Inst, LIFT, MOOD_PRESETS, type Note, type Score, STYLE_TABLE, type Style, type StyleName, TUNE_DEGREES } from "./compose";
import { type Chord, type Mode, SCALES, chordName, harmony } from "./harmony";
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
};

/** The styles that suit a long piece under talking (4/4, nothing that won't sit back). */
export const JOURNEY_STYLES: StyleName[] = ["felt", "rhodes", "ambient", "guitar", "downtempo", "chip"];
/** When the end card's mosaic lands (seconds into the card): home lands with it. */
const END_LAND = 4.6;
/** Where layers come in, by intensity. */
const AT = { chords: 0.12, bass: 0.3, theme: 0.35, arp: 0.5, drums: 0.72 };

const pc = (n: number) => ((n % 12) + 12) % 12;
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MODES: Mode[] = ["ionian", "dorian", "lydian", "mixolydian", "aeolian"];

type Span = { t0: number; t1: number; chord: Chord; tonic: number; mode: Mode; pcs: number[]; v: number[]; bass: number; intensity: number; mood: Mood };

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
  const beat = 60 / between(...(S.bpm ?? B.bpm));
  const bar = 4 * beat;
  const bpc = S.barsPerChord ?? 1;
  const eighth = beat / 2;
  const swing = S.swing ?? 0.5;
  const swung = (slot: number, unit = eighth) => (slot % 2 === 1 ? (slot - 1) * unit + 2 * unit * swing : slot * unit);
  const nudge = () => (rand() - 0.5) * 0.016;
  const [chordInst, play] = pick(S.chords);
  // Never the same voice twice: a style that plays its chords on the pad gets strings under them.
  const padPick: Inst = pick(S.pad) ?? "pad";
  const padInst: Inst = padPick === chordInst ? "strings" : padPick;
  const tuneInst = pick(S.tune);
  const arpInst: Inst = S.arpInst.length ? pick(S.arpInst) : "harp";
  const arpRate = S.arpRate.length ? pick(S.arpRate) : 2;
  const bassInst: Inst = ({ soft: "bass", sub: "sub", tri: "tri", none: "bass" } as const)[pick(S.bass.filter((b) => b !== "none").length ? S.bass.filter((b) => b !== "none") : (["soft"] as const))];
  const groove: Groove = S.drums ? pick(S.drums) : "halftime";
  const bell: Inst = tuneInst === "celesta" ? "musicbox" : "celesta";
  const open = rand() < 0.3;
  /** Each mood's mode, fixed for the piece. */
  const modeOf = new Map<Mood, Mode>();
  const moodMode = (m: Mood) => {
    if (!modeOf.has(m)) modeOf.set(m, MOOD_PRESETS[m].modes[Math.floor(mulberry(seed * 7 + m.length * 13 + m.charCodeAt(0))() * MOOD_PRESETS[m].modes.length)]!);
    return modeOf.get(m)!;
  };

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
  const themeLen = 2 * bar;
  const slots = Math.round(themeLen / unit);
  const k = 4 + Math.floor(trand() * 3);
  const rhythm = new Set<number>([0]);
  while (rhythm.size < Math.min(k, slots - 2)) {
    const s = Math.floor(trand() * (slots - 2));
    if (s % 2 === 0 || trand() < 0.4) rhythm.add(s);
  }
  const motif = [...rhythm].sort((a, b) => a - b);
  const contour = motif.slice(1).map(() => tpick([-1, 1, -1, 1, 2, -2, 0, 3, -2]));
  const lift = LIFT[tuneInst] ?? 0;
  const anchor = 72 + lift;

  // ------------------------------------------------- the grid of chords
  const harmonies = new Map<string, ReturnType<typeof harmony>>();
  const harmonyOf = (mode: Mode, mood: Mood) => {
    const key = `${mode}/${mood}`;
    if (!harmonies.has(key)) harmonies.set(key, harmony(mulberry(seed * 89 + 3 + MODES.indexOf(mode) * 1009 + mood.length * 31), mode, mood));
    return harmonies.get(key)!;
  };
  const spans: Span[] = [];
  const phraseStarts: { t: number; intensity: number; first: boolean; index: number }[] = [];
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

  const addSpan = (t0: number, t1: number, node: string, mode: Mode, mood: Mood, intensity: number, sus = false) => {
    const H = harmonyOf(mode, mood);
    const chord = H.chord(node, { sus });
    const tonic = pc(tonic0 + shift);
    const pcs = chord.tones.map((x) => pc(chord.root + x + tonic));
    const v = voice(pcs, prevV, open);
    prevV = v;
    spans.push({ t0, t1, chord, tonic, mode, pcs, v, bass: pc(chord.bass + tonic), intensity, mood });
    return chord;
  };

  for (const seg of segments) {
    const bars: number[] = [];
    for (let t = seg.from; t < seg.to - bar * 0.5; t += bar * bpc) bars.push(t);
    let index = 0;
    /** Chords in a four-bar phrase. */
    const perPhrase = Math.max(1, Math.round(4 / bpc));
    for (let p = 0; p < bars.length; p += perPhrase) {
      const ps = bars[p]!;
      const phraseBars = bars.slice(p, p + perPhrase);
      const pe = Math.min(seg.to, (bars[p + phraseBars.length] ?? seg.to));
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
      phraseStarts.push({ t: ps, intensity, first: index === 0, index });
      const H = harmonyOf(mode, mood);
      const path = H.walk(phraseBars.length);
      const lastOfSeg = p + phraseBars.length >= bars.length;
      const nextMood = sectionAt(pe + 0.01)?.mood;
      // The phrase before a change of colour, or the end of a segment, comes home.
      if (lastOfSeg || (nextMood && moodMode(nextMood) !== mode)) path[path.length - 1] = "0";
      const chords: Chord[] = [];
      phraseBars.forEach((t, i) => {
        const t1 = i === phraseBars.length - 1 ? pe : phraseBars[i + 1]!;
        chords.push(addSpan(t, t1, path[i]!, mode, mood, intensity));
      });
      H.basses(chords);
      // basses() set the chords' bass notes after the spans were made: copy them over.
      for (let i = 0; i < chords.length; i++) spans[spans.length - chords.length + i]!.bass = pc(chords[i]!.bass + pc(tonic0 + shift));
      index++;
    }
  }
  const spanAt = (t: number) => spans.find((s) => t >= s.t0 && t < s.t1) ?? spans[spans.length - 1];

  // ------------------------------------------------------------- notes
  const notes: Note[] = [];
  const firstSpan = spans[0];
  const homeOf = (tonic: number, mode: Mode, mood: Mood) => {
    const H = harmonyOf(mode, mood);
    const chord = H.chord("0", { colour: "added9" });
    const pcs = chord.tones.map((x) => pc(chord.root + x + tonic));
    return voice(pcs, prevV, false);
  };

  // The intro: the home chord swells in under the title, the theme hinted.
  if (plan.bodyStart > 0.5 && firstSpan) {
    const home = homeOf(firstSpan.tonic, firstSpan.mode, firstSpan.mood);
    for (const n of home) notes.push({ t: 0, dur: plan.bodyStart + 0.4, midi: n, vel: 0.32, inst: padInst, pan: 0 });
    notes.push({ t: plan.bodyStart * 0.35, dur: 2, midi: home[home.length - 1]! + 12, vel: 0.22, inst: bell, pan: 0.2 });
  }

  for (const s of spans) {
    const len = s.t1 - s.t0;
    const I = s.intensity;
    const vel = (v: number) => v * (0.75 + 0.45 * I);
    // pad: always
    for (const n of s.v) notes.push({ t: s.t0, dur: len + 0.05, midi: n, vel: vel(0.3), inst: padInst, pan: 0 });
    // chords
    if (I >= AT.chords) {
      const strike = (t: number, v: number, dur = s.t1 - t) => s.v.forEach((n, j) => notes.push({ t: t + j * 0.014 + nudge(), dur, midi: n, vel: vel(v) * (0.9 + 0.2 * rand()), inst: chordInst, pan: -0.2 + (0.4 * j) / s.v.length }));
      if (play === "hold") for (const n of s.v) notes.push({ t: s.t0, dur: len, midi: n, vel: vel(0.55), inst: chordInst, pan: 0 });
      else if (play === "pick") {
        const root = 40 + pc(s.bass - 40);
        const fifth = root + pc(s.pcs[2]! - root);
        const top = s.v.slice(1);
        const fingers = [null, 1, 0, 2, null, 1, 0, 2];
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar)
          for (let kk = 0; kk < 8; kk++) {
            const t = b + swung(kk);
            if (t >= s.t1) continue;
            const f = fingers[kk] ?? null;
            notes.push({ t: t + nudge(), dur: 2.5 * eighth, midi: f === null ? (kk === 0 ? root : fifth) : top[f % top.length]!, vel: vel(f === null ? 0.5 : 0.36) * (0.85 + 0.3 * rand()), inst: "guitar", pan: f === null ? -0.15 : 0.2 });
          }
      } else if (play === "chiparp") {
        const step = beat / 4;
        let kk = 0;
        for (let t = s.t0; t < s.t1 - 1e-6; t += step, kk++) notes.push({ t, dur: step * 0.9, midi: s.v[kk % s.v.length]!, vel: vel(0.2), inst: "pulse", pan: -0.25 });
      } else {
        // strike (and anything else): once a bar, a soft second strike when it's busier
        for (let b = s.t0; b < s.t1 - 1e-6; b += bar) {
          strike(b, 0.48);
          if (I >= 0.45 && b + bar / 2 < s.t1) strike(b + bar / 2 + (swing - 0.5) * beat, 0.3);
        }
      }
    }
    // bass (tense and eerie hold the home note under everything)
    if (I >= AT.bass) {
      const pedal = s.mood === "tense" || s.mood === "eerie";
      const root = 36 + pc((pedal ? s.tonic : s.bass) - 36);
      if (bassInst === "tri") for (let t = s.t0, kk = 0; t < s.t1 - 1e-6; t += eighth, kk++) notes.push({ t, dur: eighth * 0.85, midi: root + (kk % 2 ? 12 : 0), vel: vel(0.45), inst: "tri", pan: 0 });
      else notes.push({ t: s.t0 + nudge(), dur: len, midi: root, vel: vel(0.5), inst: bassInst, pan: 0 });
    }
    // arpeggio (driving wants it sooner)
    if (I >= AT.arp || (s.mood === "driving" && I >= 0.3)) {
      const step = beat / (s.mood === "driving" ? Math.max(2, arpRate) : arpRate);
      const pattern = [0, 1, 2, 3, 2, 1];
      const up = arpInst === "kalimba" || arpInst === "marimba" ? 0 : 12;
      let kk = 0;
      for (let t = s.t0; t < s.t1 - 1e-6; t += step, kk++) {
        const v = [...s.v, s.v[0]! + 12].map((n) => n + up);
        notes.push({ t: t + nudge(), dur: step * 2, midi: v[pattern[kk % pattern.length]! % v.length]!, vel: vel(0.2 + 0.06 * rand()), inst: arpInst, pan: kk % 2 ? 0.35 : -0.35 });
      }
    }
  }

  // drums: only the busiest stretches, and soft
  const G = GROOVES[groove];
  const kit = G.chip ? ({ kick: "chipkick", snare: "chipsnare", hat: "chiphat" } as const) : ({ kick: "kick", snare: "snare", hat: "hat" } as const);
  for (const s of spans) {
    if (s.intensity < AT.drums) continue;
    const sixteenth = beat / 4;
    for (let b = s.t0; b < s.t1 - 1e-6; b += bar)
      for (let st = 0; st < 16; st++) {
        const t = b + st * sixteenth;
        if (t >= s.t1) break;
        const hit = (inst: Inst, v: number, pan = 0) => notes.push({ t: t + nudge() * 0.5, dur: 0.3, midi: 60, vel: v * (0.75 + 0.3 * rand()) * 0.8, inst, pan });
        if (G.kick.includes(st)) hit(kit.kick, st === 0 ? 0.75 : 0.55);
        if (G.snare.includes(st)) hit(kit.snare, 0.5);
        if (G.hat.includes(st)) hit(kit.hat, st % 4 === 0 ? 0.36 : 0.26, 0.3);
        if (G.shaker) hit("shaker", st % 2 ? 0.18 : 0.26, -0.3);
      }
  }

  // ------------------------------------------------------------- the theme
  /** The scale steps the theme may use around its anchor, in a span's key and mode. */
  const stepsFor = (s: Span) => {
    const scale = SCALES[s.mode];
    const allowed = TUNE_DEGREES[s.mode];
    const out: number[] = [];
    for (let d = -14; d < 28; d++) {
      if (!allowed.includes(((d % 7) + 7) % 7)) continue;
      const n = 60 + s.tonic + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7]! + lift;
      if (n >= 64 + lift && n <= 86 + lift) out.push(n);
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
  /** The theme from `start`: `shape` its contour, `inst` and `vel` how it's played, `upTo` where it must stop. */
  const sing = (start: number, shape: number[], inst: Inst, v: number, upTo: number, register = 0) => {
    let at = -1;
    motif.forEach((slot, j) => {
      const t = start + swung(slot, unit);
      if (t >= upTo - 0.1) return;
      const s = spanAt(t);
      if (!s) return;
      const steps = stepsFor(s);
      at = at < 0 ? nearestIn(steps, anchor + register, s.pcs) : Math.max(0, Math.min(steps.length - 1, at + shape[j - 1]!));
      if (slot % 4 === 0 || (!s.pcs.includes(pc(steps[at]!)) && s.pcs.some((p) => pc(p - steps[at]!) === 1 || pc(steps[at]! - p) === 1))) at = nearestIn(steps, steps[at]!, s.pcs);
      const next = motif[j + 1] !== undefined ? start + swung(motif[j + 1]!, unit) : start + themeLen;
      notes.push({ t: t + nudge(), dur: Math.min(4 * unit, next - t), midi: steps[at]!, vel: v * (0.85 + 0.2 * trand()), inst, pan: 0.15 });
    });
  };
  const variation = () => contour.map((c, i) => (i === contour.length - 1 ? tpick([-2, -1, 1, 2]) : i === 0 ? tpick([c, -c, c]) : c));
  for (const p of phraseStarts) {
    if (p.intensity < AT.theme) continue;
    const s = spanAt(p.t);
    const phraseEnd = Math.min(...spans.filter((x) => x.t0 >= p.t).slice(0, Math.max(1, Math.round(4 / bpc))).map((x) => x.t1), end);
    const tv = (tuneInst === "pulse" ? 0.38 : 0.6) * (0.8 + 0.4 * p.intensity);
    // Stated on the first, third… phrase of a segment; answered (varied) on the busier others; rests otherwise, so it means something when it's back.
    if (p.index % 2 === 0) sing(p.t, contour, tuneInst, tv, phraseEnd);
    else if (p.intensity >= 0.55) sing(p.t + themeLen, variation(), tuneInst, tv * 0.85, phraseEnd, s?.mood === "melancholy" ? -5 : 0);
  }

  // ------------------------------------------------------------- breaks
  for (const b of breaks) {
    const before = spanAt(b.start - 0.01) ?? firstSpan;
    if (!before) continue;
    const home = homeOf(before.tonic, before.mode, before.mood);
    for (const n of home) notes.push({ t: b.start, dur: b.end - b.start + 0.3, midi: n, vel: 0.3, inst: padInst, pan: 0 });
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
    const leadV = voice(lead.tones.map((x) => pc(lead.root + x + last.tonic)), last.v, false);
    for (const n of leadV) notes.push({ t: plan.endCard, dur: END_LAND, midi: n, vel: 0.4, inst: padInst, pan: 0 });
    spans.push({ t0: plan.endCard, t1: land, chord: lead, tonic: last.tonic, mode: last.mode, pcs: lead.tones.map((x) => pc(lead.root + x + last.tonic)), v: leadV, bass: pc(lead.root + last.tonic), intensity: 0.6, mood: last.mood });
    const home = homeOf(last.tonic, last.mode, last.mood);
    const homeChord = H.chord("0", { colour: "added9" });
    spans.push({ t0: land, t1: plan.seconds + 1, chord: homeChord, tonic: last.tonic, mode: last.mode, pcs: homeChord.tones.map((x) => pc(homeChord.root + x + last.tonic)), v: home, bass: pc(last.tonic), intensity: 0.4, mood: last.mood });
    sing(plan.endCard + 0.2, contour, tuneInst, tuneInst === "pulse" ? 0.4 : 0.66, land);
    const ring = plan.seconds - land;
    for (const n of home) {
      notes.push({ t: land, dur: ring, midi: n, vel: 0.62, inst: chordInst, pan: 0 });
      notes.push({ t: land, dur: ring, midi: n, vel: 0.34, inst: padInst, pan: 0 });
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
    const fin = Math.min(1, t / fadeIn);
    const fout = Math.min(1, Math.max(0, (plan.seconds - t) / 6));
    const intro = t < plan.bodyStart ? 0.75 : loud(t);
    return fin * fout * intro;
  };

  const label = [
    `${styleName} (${baseMood} at heart)`,
    `${NAMES[tonic0]}`,
    `${Math.round(60 / beat)} bpm`,
    [...new Set(spans.map((s) => `${s.mood}→${s.mode}`))].join(", "),
    `${spans.length} chords, theme ${motif.length} notes on ${tuneInst}`,
    lifts ? `${lifts} lift${lifts > 1 ? "s" : ""}` : "",
    `${chordInst} chords over ${padInst}, ${arpInst} arpeggio, ${groove} drums when it's busiest`,
    spans.slice(0, 8).map((s) => chordName(s.chord, s.tonic)).join(" ") + (spans.length > 8 ? " …" : ""),
  ].filter(Boolean).join(" · ");

  return {
    seconds: plan.seconds,
    mood: baseMood,
    style: styleName,
    notes,
    cutoff,
    level,
    texture: "none",
    reverb: { rt60: B.rt60 * (S.rtScale ?? 1), wet: B.wet },
    wow: B.wow * 0.5,
    lowpass: Math.min(B.lowpass + 1500, S.lowpass ?? Infinity),
    chimeShift: 0,
    label,
    loop: false,
  };
};
