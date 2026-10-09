#!/usr/bin/env bun
/**
 * The attention experiment's score: music that seems to speed up and climb
 * for the whole video without ever arriving anywhere, then stops dead.
 *
 * The rhythm is ONE real clock: the hammer, an honest accelerando that
 * climbs from 36 to ~109 BPM over the piece. Everything else is a strict
 * subdivision of it (1, 2, 4, 8 ticks per hammer; triplet fills; rolls that
 * end on a bar line), so the whole track is regular by construction. The
 * "never arrives" feeling comes from three Shepard-style illusions that are
 * all pure arithmetic (which is why no music model can make them):
 *
 *  - the khoomei WHISTLE: a resonance stepping up the harmonic series of a
 *    held drone, several an octave apart with loudness a bell over the
 *    stack, so a whistle is always rising and never arrives;
 *  - a low Shepard GLIDE under the drone, octaves sliding up forever;
 *  - a density drift on the SUBDIVISIONS: the loudness bell moves from the
 *    coarse ticks toward the fine ones and wraps, so the texture always
 *    seems to be getting busier, while every tick stays on the hammer grid.
 *
 * (A true Risset rhythm — layers at doubling tempos — was the first draft.
 * It never sat right: any distinct sound in the stack is a stream the ear
 * follows, and every stream in a Risset stack doubles then hands off to one
 * at half the rate; put the hammer outside the stack and it fights the
 * grid. Two clocks can't share a groove. One clock, real acceleration,
 * illusion in pitch and density. Tom, 10-07.)
 *
 * The beats are real game hits (the hammer and generic weapon hits from the
 * BITS sound bank, the Hammerfall finisher for the final blow) and the crowd
 * is the arena's own ambience, so it is BITS-coded by construction. As the
 * video goes on more of the game joins in: the loudness bell widens so more
 * tempo layers are audible, tremor booms land under the downbeats, blade and
 * staff hits fill the gaps between beats, the war drums roll into every
 * handover, the stands cheer more often and louder the further you get, and
 * the arena's earthquake rumble grows under it all from nothing to a roar.
 * A gong opens it.
 *
 *   bun src/experiments/attention/score.ts --seconds 30
 *
 * Writes public/experiments/attention/{drums,pad,crowd,reactions,quake,hall,mix}.wav and
 * score.json (the parameters, every audible hit's time and weight, and the
 * crowd/gong/roll/horn events, so the video can pulse and react on the actual
 * sounds instead of analysing the audio). Stems are separate so the Desk can
 * duck the pad and crowd under the voice and leave the drums.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

// ---------------------------------------------------------------- parameters

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? "true" : process.argv[++i]!);
}
const num = (k: string, d: number) => (args.has(k) ? Number(args.get(k)) : d);
const str = (k: string, d: string) => args.get(k) ?? d;

export type ScoreParams = {
  /** Length of the video, seconds. The file runs this long exactly. */
  seconds: number;
  /** Unused by the rhythm now (kept so old flags don't error); together with
   * `beats` it still sets the CYCLE the pitch and density illusions drift
   * over: beats × 60 × ln2 / bpm seconds (default ≈ 25s). */
  bpm: number;
  beats: number;
  /** Subdivision layers under the hammer: 1, 2, 4 … ticks per hammer beat. */
  layers: number;
  /** The hammer: a REAL accelerando over the whole piece, not part of the
   * illusion. Its rate at the start, BPM… */
  hammer: number;
  /** …and how many octaves faster it is by the end (1 = double, 1.6 = ×3). */
  hammerRise: number;
  /** Octave voices in the pad. */
  voices: number;
  /** Lowest pad voice, Hz. */
  padBase: number;
  /** Where the pad's loudness bell sits, as a share of the voice stack
   * (0.4 = lower mids, under a speaking voice). */
  padCentre: number;
  /** Width of the loudness bell over the subdivision stack, as a share of
   * it. Narrow = one clear subdivision with audible fades; wide = a thicker,
   * more ambiguous texture. */
  bellWidth: number;
  /** Seconds before the end everything cuts and the blow lands; the hall
   * rings out for the rest. 0 = no ending. */
  stopBefore: number;
  /** Seconds after the cut the blow lands (default 0: ON the cut). */
  hitAfter: number;
  /** How long the hall rings after the blow, seconds (RT60). */
  hall: number;
  /** Level of the low Shepard glide under the drone (0 = off). */
  under: number;
  /** A master swell: how many dB quieter the whole score starts than it
   * ends (default 5; 0 = flat). Applied to every stem alike, so the Desk's
   * balance holds; the blow and the hall are outside it. */
  swell: number;
  /** Three clapper ticks in the last three seconds before the cut (telegraphs the ending; off by default). */
  countdown: boolean;
  /** The pad: "throat" (a khoomei-style drone whose overtone whistle climbs forever) or "glide" (the plain Shepard pad). */
  pad: "throat" | "glide";
  /** The throat drone's fundamental, Hz (default 82 = E2). */
  drone: number;
  /** How far the overtone whistle stands out of the drone (default 2.4; 1 = buried, 4 = piercing). */
  whistle: number;
  seed: number;
};

const P: ScoreParams = {
  seconds: num("seconds", 30),
  bpm: num("bpm", 20),
  beats: num("beats", 12),
  layers: num("layers", 4),
  hammer: num("hammer", 24),
  hammerRise: num("hammerRise", 1.74), // 24 → 80 BPM
  voices: num("voices", 6),
  padBase: num("padBase", 55),
  padCentre: num("padCentre", 0.4),
  bellWidth: num("bellWidth", 0.34),
  stopBefore: num("stopBefore", 6.0), // room after the blow for the match's own ending, then the card
  hitAfter: num("hitAfter", 0),
  hall: num("hall", 3.2),
  under: num("under", 0.55),
  swell: num("swell", 5),
  countdown: args.get("countdown") === "true",
  pad: (str("pad", "throat") === "glide" ? "glide" : "throat") as "throat" | "glide",
  drone: num("drone", 82),
  whistle: num("whistle", 2.4),
  seed: num("seed", 7),
};
const OUT = str("out", join(import.meta.dir, "../../../public/experiments/attention"));

const SR = 48000;
const LN2 = Math.LN2;
/** One cycle: every layer doubles its tempo, every voice climbs an octave. */
const cycle = (P.beats * 60 * LN2) / P.bpm;
const total = Math.round(P.seconds * SR);

// ------------------------------------------------------------------ helpers

/** Deterministic noise, so the same parameters give the same file. */
let rng = P.seed >>> 0 || 1;
const rand = () => {
  rng = (rng * 1664525 + 1013904223) >>> 0;
  return rng / 0x100000000;
};

const sfxDir = join(import.meta.dir, "../../../../blood-in-the-sand/assets/audio/sfx");
/** Decode a bank mp3 to mono 48 kHz floats with Remotion's sibling ffmpeg. */
const sample = (name: string): Float32Array => {
  const file = join(sfxDir, `${name}.mp3`);
  if (!existsSync(file)) throw new Error(`no such sound in the bank: ${name}`);
  if (!ffmpegPath) throw new Error("ffmpeg-static has no binary for this platform");
  const p = Bun.spawnSync([ffmpegPath, "-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(SR), "-"], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed on ${name}: ${p.stderr.toString()}`);
  const buf = p.stdout;
  const out = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  // Trim leading silence so every hit's transient lands on its beat.
  let start = 0;
  while (start < out.length && Math.abs(out[start]!) < 0.01) start++;
  return out.slice(Math.max(0, start - 48));
};

/** Stereo buffer. */
class Track {
  l = new Float32Array(total);
  r = new Float32Array(total);
  /** Add a mono sample at `at` seconds, through a one-pole lowpass at `cutoff` Hz, panned -1..1. */
  hit(s: Float32Array, at: number, gain: number, cutoff: number, pan: number) {
    const start = Math.round(at * SR);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
    const gl = gain * Math.SQRT1_2 * (1 - pan) ** 0.5 * 1.19;
    const gr = gain * Math.SQRT1_2 * (1 + pan) ** 0.5 * 1.19;
    let y = 0;
    for (let i = 0; i < s.length; i++) {
      const n = start + i;
      if (n >= total) break;
      if (n < 0) continue;
      y += a * (s[i]! - y);
      this.l[n] = this.l[n]! + y * gl;
      this.r[n] = this.r[n]! + y * gr;
    }
  }
  peak() {
    let m = 0;
    for (let i = 0; i < total; i++) m = Math.max(m, Math.abs(this.l[i]!), Math.abs(this.r[i]!));
    return m;
  }
  scale(g: number) {
    for (let i = 0; i < total; i++) {
      this.l[i] = this.l[i]! * g;
      this.r[i] = this.r[i]! * g;
    }
  }
  /** Multiply by a per-sample envelope. */
  shape(env: (t: number) => number) {
    for (let i = 0; i < total; i++) {
      const g = env(i / SR);
      this.l[i] = this.l[i]! * g;
      this.r[i] = this.r[i]! * g;
    }
  }
  /** Time-varying one-pole lowpass, cutoff in Hz as a function of time. */
  sweep(cutoff: (t: number) => number) {
    let yl = 0;
    let yr = 0;
    let a = 0;
    for (let i = 0; i < total; i++) {
      if (i % 64 === 0) a = 1 - Math.exp((-2 * Math.PI * cutoff(i / SR)) / SR);
      yl += a * (this.l[i]! - yl);
      yr += a * (this.r[i]! - yr);
      this.l[i] = yl;
      this.r[i] = yr;
    }
  }
  /**
   * A big stone hall: a Freeverb-style reverb (eight parallel combs with
   * damping, four series allpasses, the right channel's delays offset so the
   * tail is wide) fed by this track × `send(t)`, with a slow echo in front
   * of it. Returns the WET signal as a new track.
   */
  hall(send: (t: number) => number, rt60: number): Track {
    const wet = new Track();
    const scale = SR / 44100;
    const combL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * scale * 1.7));
    const combR = combL.map((d) => d + Math.round(23 * scale));
    const apL = [556, 441, 341, 225].map((d) => Math.round(d * scale));
    const apR = apL.map((d) => d + Math.round(23 * scale));
    const mk = (ds: number[]) => ds.map((d) => ({ buf: new Float32Array(d), i: 0, lp: 0, g: 10 ** ((-3 * d) / (rt60 * SR)) }));
    const cl = mk(combL);
    const cr = mk(combR);
    const al = mk(apL);
    const ar = mk(apR);
    const damp = 0.25;
    // The echo: three slaps off the far walls before the wash.
    const echoD = Math.round(0.37 * SR);
    const echoL = new Float32Array(echoD);
    const echoR = new Float32Array(echoD);
    let ei = 0;
    const pre = Math.round(0.035 * SR);
    const run = (combs: ReturnType<typeof mk>, aps: ReturnType<typeof mk>, x: number) => {
      let y = 0;
      for (const c of combs) {
        const out = c.buf[c.i]!;
        c.lp = out * (1 - damp) + c.lp * damp;
        c.buf[c.i] = x + c.lp * c.g;
        c.i = (c.i + 1) % c.buf.length;
        y += out;
      }
      y /= combs.length;
      for (const a of aps) {
        const b = a.buf[a.i]!;
        const v = y + b * -0.5;
        a.buf[a.i] = v;
        a.i = (a.i + 1) % a.buf.length;
        y = b + v * 0.5;
      }
      return y;
    };
    for (let i = 0; i < total; i++) {
      const g = send(i / SR);
      const src = i - pre;
      let xl = src >= 0 ? this.l[src]! * g : 0;
      let xr = src >= 0 ? this.r[src]! * g : 0;
      const el = echoL[ei]!;
      const er = echoR[ei]!;
      echoL[ei] = xl + er * 0.42;
      echoR[ei] = xr + el * 0.42;
      ei = (ei + 1) % echoD;
      xl += el * 0.6;
      xr += er * 0.6;
      wet.l[i] = run(cl, al, xl);
      wet.r[i] = run(cr, ar, xr);
    }
    return wet;
  }
  add(o: Track, g = 1) {
    for (let i = 0; i < total; i++) {
      this.l[i] = this.l[i]! + o.l[i]! * g;
      this.r[i] = this.r[i]! + o.r[i]! * g;
    }
  }
  wav(): Uint8Array {
    const bytes = 44 + total * 4;
    const b = new DataView(new ArrayBuffer(bytes));
    const ascii = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    ascii(0, "RIFF");
    b.setUint32(4, bytes - 8, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    b.setUint32(16, 16, true);
    b.setUint16(20, 1, true); // PCM
    b.setUint16(22, 2, true); // stereo
    b.setUint32(24, SR, true);
    b.setUint32(28, SR * 4, true);
    b.setUint16(32, 4, true);
    b.setUint16(34, 16, true);
    ascii(36, "data");
    b.setUint32(40, total * 4, true);
    for (let i = 0; i < total; i++) {
      b.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, this.l[i]!)) * 32767), true);
      b.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, this.r[i]!)) * 32767), true);
    }
    return new Uint8Array(b.buffer);
  }
}

/** Share of the video elapsed: the REAL build rides on this. */
const progress = (t: number) => Math.min(1, t / P.seconds);
/** The bell every layer/voice's loudness follows over its stack position 0..n. */
const bell = (p: number, n: number, centre = 0.5, width = 0.34) => {
  if (p <= 0 || p >= n) return 0;
  const x = (p / n - centre) / width;
  // Gaussian, windowed to zero at both ends so a wrap never clicks.
  return Math.exp(-0.5 * x * x) * Math.sin((Math.PI * p) / n) ** 0.5;
};
/**
 * The hammer clock. Rate A·2^(R·t/S) hammers per second integrates in closed
 * form, so hammer m lands at tOf(m) exactly and any subdivision is tOf(m/2^j).
 */
const A = P.hammer / 60;
const R = P.hammerRise;
const S = P.seconds;
const tOf = (tau: number) => (R > 0 ? (S / R) * Math.log2(1 + (tau * R * Math.LN2) / (A * S)) : tau / A);
const tauOf = (t: number) => (R > 0 ? ((A * S) / (R * Math.LN2)) * (2 ** ((R * t) / S) - 1) : A * t);
/** The cut lands ON a hammer beat: the last one at or before the asked
 * time, so the hall always gets at least `stopBefore` to ring and never
 * much more than a beat over it. */
const stopAt = (() => {
  if (P.stopBefore <= 0) return Infinity;
  const asked = P.seconds - P.stopBefore;
  let beat = Math.floor(tauOf(asked));
  while (tOf(beat) > P.seconds - 0.5) beat -= 1;
  return tOf(beat);
})();

// -------------------------------------------------------------------- drums

const accents = ["hit_hammer_1", "hit_hammer_2", "hit_hammer_3"].map(sample);
const ticks = ["hit_generic_2", "hit_generic_3", "hit_generic_4"].map(sample);
const fills = ["hit_blade_2", "hit_blade_3", "hit_staff_2"].map(sample);
const booms = ["cast_tremor_1", "cast_tremor_2", "cast_tremor_3"].map(sample);
const roll = sample("cast_war_drums_1");
const finalBlow = sample("finisher_hammerfall_1");

type Hit = { t: number; w: number; layer: number; accent: boolean };
type Event = { t: number; kind: string };
const hits: Hit[] = [];
const events: Event[] = [];
const drums = new Track();

/** The bell widens as the video goes on: more subdivisions audible at once. */
const width = (q: number) => P.bellWidth * (0.8 + 0.5 * q);
/** Layer j's position in the stack at cycle phase u: the bell drifts toward the FINER ticks. */
const position = (j: number, u: number) => (((j - u) % P.layers) + P.layers) % P.layers;
/** Weighted ticks per hammer the stack puts out at phase u; flattened so only the drift moves. */
const density = (u: number, w: number) => {
  let d = 0;
  for (let j = 0; j < P.layers; j++) d += bell(position(j, u), P.layers, 0.5, w) * 2 ** j;
  return d;
};
const meanDensity = (w: number) => {
  let d = 0;
  for (let i = 0; i < 64; i++) d += density((i + 0.5) / 64, w);
  return d / 64;
};

// THE HAMMER — the clock. Beat one of every bar heavier; the tremor booms
// ride under beat one from a quarter of the way in and under beat three
// past the midpoint: the floor joining the beat.
const hammers: number[] = [];
for (let m = 0; ; m++) {
  const t = tOf(m);
  if (t >= stopAt - 0.01) break;
  hammers.push(t);
  const q = progress(t);
  const one = m % 4 === 0;
  const g = (one ? 1 : 0.68) * (0.78 + 0.22 * q);
  drums.hit(accents[m % accents.length]!, t, g, 5000 + 8000 * q, 0);
  hits.push({ t: Math.round(t * 1000) / 1000, w: Math.round(g * 100) / 100, layer: -2, accent: one });
  if (one && q > 0.25) drums.hit(booms[m % booms.length]!, t + 0.01, Math.min(1, (q - 0.25) / 0.5) * 0.95, 7000, 0);
  if (m % 4 === 2 && q > 0.6) drums.hit(booms[(m + 1) % booms.length]!, t + 0.01, Math.min(1, (q - 0.6) / 0.3) * 0.6, 5000, 0);
}

// THE TICKS — strict subdivisions of the hammer: layer j plays 2^j per beat.
// Loudness is a bell over the stack that drifts toward the finer layers one
// step per cycle and wraps (the Shepard trick on density): the texture
// always seems to be getting busier, and every tick is on the grid.
for (let j = 0; j < P.layers; j++) {
  const per = 2 ** j;
  for (let m = 0; ; m++) {
    const t0 = tOf(m / per);
    if (t0 >= stopAt) break;
    const t = t0 + (rand() - 0.5) * 0.004;
    const q = progress(t0);
    const u = (t0 / cycle) % 1;
    const w = width(q);
    const b = bell(position(j, u), P.layers, 0.5, w) * (meanDensity(w) / density(u, w));
    // Where in the beat: on the hammer (masked by it), the half, the rest.
    const inBeat = m % per;
    const place = inBeat === 0 ? 0.55 : inBeat * 2 === per ? 0.8 : 0.6;
    const level = b * place * (0.92 + rand() * 0.16);
    if (level < 0.006) continue;
    const cutoff = 500 + 9000 * b ** 1.5;
    drums.hit(ticks[Math.floor(rand() * ticks.length)]!, t, level * 0.85, cutoff, (j % 2 ? 1 : -1) * 0.18);
    hits.push({ t: Math.round(t * 1000) / 1000, w: Math.round(level * 100) / 100, layer: j, accent: inBeat === 0 });
  }
}

// FILLS — past the midpoint, blade and staff hits on the triplets of the
// beat: positions the binary ticks never land on, so the texture genuinely
// thickens rather than just getting louder. Still on the clock.
for (let m = 0; ; m++) {
  const tb = tOf(m);
  if (tb >= stopAt) break;
  const q = progress(tb);
  if (q <= 0.45) continue;
  const g = Math.min(1, (q - 0.45) / 0.45) * 0.34;
  for (const frac of [1 / 3, 2 / 3]) {
    const t = tOf(m + frac) + (rand() - 0.5) * 0.006;
    if (t < stopAt) drums.hit(fills[Math.floor(rand() * fills.length)]!, t, g * (frac < 0.5 ? 1 : 0.7), 3500 + 4000 * q, (frac < 0.5 ? -1 : 1) * 0.3);
  }
}

// ROLLS — the war drums roll into a bar line every eight bars, louder each
// time, and once more into the cut at full weight.
for (let m = 32; tOf(m) < stopAt - 1; m += 32) {
  const end = tOf(m);
  const at = end - roll.length / SR;
  if (at <= 0) continue;
  const q = progress(end);
  drums.hit(roll, at, 0.35 + 0.55 * q, 2000 + 6000 * q, 0);
  events.push({ t: Math.round(at * 1000) / 1000, kind: "roll" });
}
if (P.stopBefore > 0) {
  drums.hit(roll, stopAt - roll.length / SR, 1, 9000, 0);
  events.push({ t: Math.round((stopAt - roll.length / SR) * 1000) / 1000, kind: "roll" });
}
if (P.countdown && P.stopBefore > 0) {
  const clap = sample("countdown_tick_4");
  for (const back of [3, 2, 1]) drums.hit(clap, stopAt - back, 0.9, 12000, 0);
}
hits.sort((a, b) => a.t - b.t);
// The real build: the drums open up from a muffled thud to full brightness.
drums.sweep((t) => 1400 + 10000 * progress(t) ** 1.6);

// ---------------------------------------------------------------- reactions

// The stands: a gong to open, then cheers — sparse and distant at first,
// closer together and louder the further in you are. (Jeers for the first
// third, and the Tide's horn at 80%, were tried and dropped: the stands are
// with you, and the horn got lost in the mix. Tom, 10-07.)
const reactions = new Track();
{
  const gong = sample("fight_start_1");
  const cheers = ["crowd_cheer_1", "crowd_cheer_2", "crowd_cheer_3", "crowd_cheer_4", "crowd_cheer_5", "crowd_cheer_6", "crowd_cheer_7", "crowd_cheer_8"].map(sample);
  reactions.hit(gong, 0.05, 0.9, 6000, 0);
  events.push({ t: 0.05, kind: "gong" });
  let t = 3.5 + rand() * 3;
  while (t < stopAt - 2.5) {
    const q = progress(t);
    reactions.hit(cheers[Math.floor(rand() * cheers.length)]!, t, 0.3 + 0.7 * q, 1800 + 6000 * q, (rand() - 0.5) * 0.6);
    events.push({ t: Math.round(t * 1000) / 1000, kind: "cheer" });
    t += 11 - 8.5 * q + rand() * 2;
  }
}
events.sort((a, b) => a.t - b.t);

// ---------------------------------------------------------------------- pad

const pad = new Track();
if (P.pad === "glide") {
  const phase = new Float64Array(P.voices * 2);
  const detune = [1.0, 1.0035]; // a chorus pair per voice
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    if (t >= stopAt) break;
    const q = progress(t);
    let s = 0;
    for (let v = 0; v < P.voices; v++) {
      // Each voice climbs continuously; when it runs off the top it rejoins
      // at the bottom, silent at both ends of the bell.
      const pos = (v + t / cycle) % P.voices;
      const g = bell(pos, P.voices, P.padCentre, 0.22);
      if (g < 0.001) continue;
      const f = P.padBase * 2 ** pos;
      for (let d = 0; d < 2; d++) {
        const idx = v * 2 + d;
        phase[idx] = (phase[idx]! + (f * detune[d]!) / SR) % 1;
        const ph = phase[idx]! * 2 * Math.PI;
        // Soft saw: a few harmonics, the upper ones growing with the build.
        const h = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + (0.18 + 0.2 * q) * Math.sin(3 * ph) + 0.1 * q * Math.sin(4 * ph);
        s += h * g;
      }
    }
    // Slow breath so it never sits still.
    const breath = 0.86 + 0.14 * Math.sin(2 * Math.PI * t * 0.11);
    const out = s * breath * (0.55 + 0.45 * q);
    pad.l[i] = out;
    pad.r[i] = out;
  }
  // Keep the pad under a speaking voice: it brightens, but never past 3 kHz.
  pad.sweep((t) => 900 + 2100 * progress(t));
  // A touch of width: the right channel a few ms behind the left.
  const lag = Math.round(0.0062 * SR);
  for (let i = total - 1; i >= lag; i--) pad.r[i] = pad.r[i - lag]!;
} else {
  // THROAT. Khoomei is a low, pressed drone whose mouth cavity is tuned so
  // sharply that one harmonic at a time rings out as a whistle, and the
  // melody is the singer stepping that resonance from harmonic to harmonic.
  // Here the drone holds, and the whistle is the Shepard climb: several
  // resonances an octave apart all stepping UP the harmonic series, loudness
  // a bell over the stack, so a whistle is always rising and never arrives.
  //
  // Source: a pressed glottal pulse as a wavetable (sum of harmonics with a
  // chesty bump at 2–6 and a slow roll-off), two singers a few cents apart,
  // left and right. Filters: a fixed chest formant, a fixed nasal formant,
  // and the sweeping overtone resonances (narrow two-pole bandpasses whose
  // centre glides to the nearest harmonic, so it steps rather than slides).
  const TABLE = 4096;
  const table = new Float32Array(TABLE);
  for (let n = 1; n <= 64; n++) {
    const chest = n >= 2 && n <= 6 ? 1.6 : 1;
    const amp = (chest / n) * Math.exp(-n / 40);
    for (let i = 0; i < TABLE; i++) table[i] = table[i]! + amp * Math.sin((2 * Math.PI * n * i) / TABLE);
  }
  {
    let m = 0;
    for (let i = 0; i < TABLE; i++) m = Math.max(m, Math.abs(table[i]!));
    for (let i = 0; i < TABLE; i++) table[i] = table[i]! / m;
  }
  const lookup = (ph: number) => {
    const x = (ph - Math.floor(ph)) * TABLE;
    const i0 = Math.floor(x);
    const fr = x - i0;
    return table[i0]! * (1 - fr) + table[(i0 + 1) % TABLE]! * fr;
  };
  /** Two-pole resonant bandpass (constant peak gain). */
  class BP {
    private z1 = 0;
    private z2 = 0;
    private b0 = 0;
    private a1 = 0;
    private a2 = 0;
    set(fc: number, Q: number) {
      const w = (2 * Math.PI * Math.min(fc, SR * 0.45)) / SR;
      const alpha = Math.sin(w) / (2 * Q);
      const a0 = 1 + alpha;
      this.b0 = alpha / a0; // b2 = -b0, b1 = 0
      this.a1 = (-2 * Math.cos(w)) / a0;
      this.a2 = (1 - alpha) / a0;
    }
    run(x: number) {
      // Direct form II transposed with b1 = 0, b2 = -b0.
      const y = this.b0 * x + this.z1;
      this.z1 = -this.a1 * y + this.z2;
      this.z2 = -this.b0 * x - this.a2 * y;
      return y;
    }
  }
  const singers = [
    { detune: 0.9977, pan: -1, phase: 0.13 },
    { detune: 1.0023, pan: 1, phase: 0.61 },
  ];
  const OVERTONES = 4; // sweeping resonances, an octave apart
  const LOW = 2; // the climb runs harmonics 2 → 2·2^OVERTONES (164 Hz → 2.6 kHz at E2)
  const chest = singers.map(() => new BP());
  const nasal = singers.map(() => new BP());
  const whistle = singers.map(() => Array.from({ length: OVERTONES }, () => new BP()));
  const centre = singers.map(() => new Float64Array(OVERTONES));
  const gains = new Float64Array(OVERTONES);
  const vib = new Float64Array(singers.length);
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    if (t >= stopAt) break;
    const q = progress(t);
    if (i % 32 === 0) {
      // Where each overtone resonance sits: climbing the harmonic series one
      // octave per cycle, gliding to the nearest harmonic so it STEPS.
      for (let j = 0; j < OVERTONES; j++) {
        const pos = (j + t / cycle) % OVERTONES;
        gains[j] = bell(pos, OVERTONES, 0.45, 0.26);
        const harmonic = Math.round(LOW * 2 ** pos);
        for (let sIdx = 0; sIdx < singers.length; sIdx++) {
          const c = centre[sIdx]!;
          // A glide of ~70 ms (per 32-sample block) — a singer's jaw, not a knob.
          c[j] = c[j]! + (harmonic - c[j]!) * 0.012;
          whistle[sIdx]![j]!.set(P.drone * singers[sIdx]!.detune * c[j]!, 28 + 10 * q);
        }
      }
      for (let sIdx = 0; sIdx < singers.length; sIdx++) {
        chest[sIdx]!.set(430 + 60 * Math.sin(t * 0.37), 2.2);
        nasal[sIdx]!.set(2600, 4);
      }
    }
    for (let sIdx = 0; sIdx < singers.length; sIdx++) {
      const sg = singers[sIdx]!;
      // Vibrato around 5.5 Hz, shallow, with a slow wander so it breathes.
      vib[sIdx] = vib[sIdx]! + (5.3 + 0.4 * Math.sin(t * 0.21 + sIdx)) / SR;
      const f = P.drone * sg.detune * (1 + 0.0035 * Math.sin(2 * Math.PI * vib[sIdx]!) + 0.002 * Math.sin(t * 0.17));
      sg.phase += f / SR;
      const src = lookup(sg.phase);
      let y = 0.28 * chest[sIdx]!.run(src) + 0.05 * nasal[sIdx]!.run(src) + 0.1 * src;
      for (let j = 0; j < OVERTONES; j++) y += whistle[sIdx]![j]!.run(src) * gains[j]! * P.whistle;
      // Pressed voice: a slow pulse in level, like a held breath being leaned on.
      const lean = 0.84 + 0.16 * Math.sin(2 * Math.PI * t * 0.09 + sIdx * 1.3);
      const out = y * lean * (0.5 + 0.5 * q);
      if (sg.pan < 0) pad.l[i] = out;
      else pad.r[i] = out;
    }
  }
  // A little of each singer in the other ear so it sits as one voice.
  for (let i = 0; i < total; i++) {
    const l = pad.l[i]!;
    const r = pad.r[i]!;
    pad.l[i] = l * 0.8 + r * 0.35;
    pad.r[i] = r * 0.8 + l * 0.35;
  }
  // The whistle is the top of this sound; let it open with the build.
  pad.sweep((t) => 2400 + 3600 * progress(t));

  // Under the drone, the thing the drone can't do: a low Shepard glide that
  // never stops rising. Three octaves from E1, bell centred low, near-sine
  // so it reads as weight and lift rather than a second melody. It beats
  // slowly against the held drone as it passes — that tension is the point.
  if (P.under > 0) {
    const V = 3;
    const base = P.drone / 2;
    const phase = new Float64Array(V);
    for (let i = 0; i < total; i++) {
      const t = i / SR;
      if (t >= stopAt) break;
      const q = progress(t);
      let v = 0;
      for (let j = 0; j < V; j++) {
        const pos = (j + t / cycle) % V;
        const g = bell(pos, V, 0.4, 0.3);
        if (g < 0.001) continue;
        const f = base * 2 ** pos;
        phase[j] = (phase[j]! + f / SR) % 1;
        const ph = phase[j]! * 2 * Math.PI;
        v += (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * q * Math.sin(3 * ph)) * g;
      }
      // Grows with the track: barely there at the start, full by the end.
      const out = v * P.under * 0.5 * (0.3 + 0.9 * q);
      pad.l[i] = pad.l[i]! + out;
      pad.r[i] = pad.r[i]! + out;
    }
  }
}

// -------------------------------------------------------------------- crowd

const crowd = new Track();
{
  const amb = sample("crowd_ambience_1");
  const fadeN = Math.round(2 * SR);
  const loop = amb.length - fadeN;
  for (let i = 0; i < total; i++) {
    const t = i / SR;
    if (t >= stopAt) break;
    const j = i % loop;
    let v = amb[j]!;
    // Crossfade the loop seam.
    if (j < fadeN) {
      const x = j / fadeN;
      v = v * x + amb[loop + j]! * (1 - x);
    }
    crowd.l[i] = v;
    crowd.r[i] = v;
  }
  // The stands fill as the video goes on.
  crowd.shape((t) => 0.12 + 0.88 * progress(t) ** 1.8);
  crowd.sweep((t) => 1200 + 4800 * progress(t));
}

// -------------------------------------------------------------------- quake

// The ground: the arena's earthquake rumble under everything, from nothing
// to a floor-shaking roar by the end. The bank's rumble is a four-second
// event with its own swell and die-away, and looping it whole repeats those
// (Tom heard the tails, 10-07). So: find its steady middle by RMS, then
// rebuild a continuous bed from Hann-windowed grains of that middle at
// random offsets, half-overlapped (the windows sum to one), in two voices
// — one at pitch, one a little lower and slower — so it just keeps quaking.
const quake = new Track();
{
  const rumble = sample("quake_rumble_1");
  const win = Math.round(0.05 * SR);
  const rms: number[] = [];
  for (let i = 0; i + win <= rumble.length; i += win) {
    let e = 0;
    for (let k = 0; k < win; k++) e += rumble[i + k]! ** 2;
    rms.push(Math.sqrt(e / win));
  }
  const peak = Math.max(...rms);
  let a = 0;
  while (a < rms.length && rms[a]! < peak * 0.55) a++;
  let b = rms.length - 1;
  while (b > a && rms[b]! < peak * 0.55) b--;
  const steady = rumble.slice(a * win, (b + 1) * win);
  const G = Math.min(steady.length, Math.round(1.2 * SR));
  const hop = G >> 1;
  const hann = (k: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / G);
  const voices = [
    { rate: 1.0, gain: 1.0, pan: 0 },
    { rate: 0.86, gain: 0.8, pan: 0 },
  ];
  for (const v of voices) {
    const span = Math.floor((steady.length - G * v.rate) / 1);
    for (let g = 0; g * hop < total; g++) {
      const at = g * hop;
      const off = Math.floor(rand() * Math.max(1, span));
      for (let k = 0; k < G; k++) {
        const n = at + k;
        if (n >= total) break;
        const x = off + k * v.rate;
        const i0 = Math.floor(x);
        const fr = x - i0;
        const y = steady[i0]! * (1 - fr) + (steady[i0 + 1] ?? steady[i0]!) * fr;
        const w = hann(k) * v.gain * y;
        quake.l[n] = quake.l[n]! + w;
        quake.r[n] = quake.r[n]! + w;
      }
    }
  }
  for (let i = 0; i < total; i++) {
    if (i / SR >= stopAt) {
      quake.l[i] = 0;
      quake.r[i] = 0;
    }
  }
  quake.shape((t) => 0.04 + 0.96 * progress(t) ** 1.5);
  // Not too dark: a phone speaker has nothing below ~250 Hz, and the rumble's
  // cracking earth and shifting gravel are what reads as a quake on one.
  quake.sweep((t) => 500 + 3500 * progress(t) ** 1.5);
}

// ------------------------------------------------------------------- ending

const norm = (tr: Track, db: number) => {
  const pk = tr.peak();
  if (pk > 0) tr.scale(10 ** (db / 20) / pk);
};
// The swell: the whole score leans in over its length, in dB, so the build
// is in the level as well as the texture (Tom, 10-07).
if (P.swell > 0) {
  const lean = (t: number) => 10 ** ((-P.swell * (1 - progress(t))) / 20);
  for (const tr of [drums, pad, crowd, reactions, quake]) tr.shape(lean);
}
let hall: Track | null = null;
if (P.stopBefore > 0) {
  // A 4 ms fade, not a hard zero: a cut is still a cut, without the click.
  const fade = (t: number) => (t < stopAt ? 1 : Math.max(0, 1 - (t - stopAt) / 0.004));
  for (const tr of [drums, pad, crowd, reactions, quake]) tr.shape(fade);
  // The blow lands ON the cut — the bombard's blast wave with a powder
  // charge under it, the ground cracking, a quiet anvil ring for the metal,
  // and the body hitting the sand just behind — like a vast door slammed
  // shut. It goes into the drums stem dry…
  const at = stopAt + P.hitAfter;
  const blow = new Track();
  blow.hit(sample("hit_bombard_2"), at, 1, 20000, 0);
  blow.hit(sample("detonate_sandtrap_1"), at + 0.012, 0.75, 14000, 0);
  blow.hit(booms[0]!, at + 0.02, 0.7, 4000, 0);
  blow.hit(finalBlow, at + 0.03, 0.35, 20000, 0);
  blow.hit(sample("blood_squelch_1"), at + 0.11, 0.6, 9000, 0);
  norm(blow, -1);
  hits.push({ t: Math.round(at * 1000) / 1000, w: 1, layer: -1, accent: true });
  // …and the hall rings it out: the last second of the score is sent into
  // the room as well, so the drums don't vanish but recede into it.
  const room = new Track();
  room.add(drums, 0.9);
  room.add(pad, 0.42);
  room.add(crowd, 0.3);
  room.add(reactions, 0.5);
  room.add(quake, 0.7);
  room.add(blow, 1.5);
  const send = (t: number) => (t >= stopAt ? 1 : Math.max(0, 1 - (stopAt - t) / 0.9) ** 2);
  hall = room.hall(send, P.hall);
  norm(hall, -1);
  // Louder than any drum hit: the whole stem steps down around it.
  drums.add(blow, 1.8);
}

// ---------------------------------------------------------------------- mix

norm(drums, -1);
norm(pad, -1);
norm(crowd, -1);
norm(reactions, -1);
norm(quake, -1);
const mix = new Track();
mix.add(drums, 0.9);
mix.add(pad, 0.42);
mix.add(crowd, 0.3);
mix.add(reactions, 0.5);
mix.add(quake, 0.75);
if (hall) mix.add(hall, 0.8);
norm(mix, -1);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "drums.wav"), drums.wav());
writeFileSync(join(OUT, "pad.wav"), pad.wav());
writeFileSync(join(OUT, "crowd.wav"), crowd.wav());
writeFileSync(join(OUT, "reactions.wav"), reactions.wav());
writeFileSync(join(OUT, "quake.wav"), quake.wav());
// The checkpoint whoosh the video plays itself (the Hammerfall fall), so the
// composition has every sound it needs under one folder.
copyFileSync(join(sfxDir, "finisher_hammerfall_fall_1.mp3"), join(OUT, "whoosh.mp3"));
if (hall) writeFileSync(join(OUT, "hall.wav"), hall.wav());
writeFileSync(join(OUT, "mix.wav"), mix.wav());
writeFileSync(
  join(OUT, "score.json"),
  JSON.stringify({ params: P, cycleSeconds: Math.round(cycle * 1000) / 1000, stopAt: P.stopBefore > 0 ? Math.round(stopAt * 1000) / 1000 : null, hits, events }, null, 0),
);
console.log(`${P.seconds}s score → ${OUT}`);
console.log(`hammer ${P.hammer} → ${Math.round(P.hammer * 2 ** P.hammerRise)} BPM, ${hammers.length} beats, cut on the beat at ${stopAt.toFixed(2)}s · ${P.layers} subdivision layers drifting over ${cycle.toFixed(1)}s · pad: ${P.pad === "throat" ? `throat drone at ${P.drone} Hz` : `${P.voices} glide voices from ${P.padBase} Hz`} · ${hits.length} hits`);
