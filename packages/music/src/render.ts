/**
 * Turns a Score (src/music/compose.ts) into stereo sound. Every instrument
 * is a few lines of maths (no samples), so a track is the same every time
 * for the same seed.
 *
 * It's a seamless loop by construction: notes that ring past the end wrap
 * round to the start, and the reverb and tape wobble run over the loop
 * twice and keep the second pass, so the tail of the end is already
 * sounding when the start comes round.
 */
import { mulberry } from "@heroic/ascii-build";
import type { Inst, Note, Score } from "./compose";

export const SR = 48000;
const TAU = Math.PI * 2;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export type Stereo = { l: Float32Array; r: Float32Array };

/** Extra seconds each instrument rings on after its note. */
const RING: Record<Inst, number> = {
  epiano: 1.8, piano: 2.2, musicbox: 2.5, celesta: 2, kalimba: 1.6, marimba: 1, vibes: 2.5, ocarina: 0.15, flute: 0.15, harp: 2.2, guitar: 1.5, pizz: 0.6, pulse: 0.05,
  pad: 1.6, choir: 1.4, strings: 1.4, bass: 0.35, sub: 0.4, tri: 0.05,
  kick: 0.2, snare: 0.1, hat: 0, shaker: 0, rim: 0, chipkick: 0, chipsnare: 0, chiphat: 0,
};
/** Rough loudness balance between instruments (set by measuring stems: `--stems`). */
const GAIN: Record<Inst, number> = {
  epiano: 1, piano: 1, musicbox: 1.6, celesta: 1.6, kalimba: 1.4, marimba: 1.2, vibes: 1.3, ocarina: 1.2, flute: 1.2, harp: 1, guitar: 3, pizz: 1.2, pulse: 1,
  pad: 1, choir: 1, strings: 1, bass: 1, sub: 0.6, tri: 0.5,
  kick: 1.4, snare: 4, hat: 5.5, shaker: 7, rim: 1, chipkick: 2.5, chipsnare: 4, chiphat: 5.5,
};

/** Struck or plucked: [frequency ratio, amplitude, decay per second] partials. */
const struck = (out: Float32Array, f: number, parts: number[][], v: number, attack: number, rel: (t: number) => number) => {
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let s = 0;
    for (const [ratio, amp, decay] of parts) if (f * ratio! < 16000) s += amp! * Math.sin(TAU * f * ratio! * t) * Math.exp(-t * decay!);
    out[i] = s * Math.min(1, t / attack) * rel(t) * v;
  }
};

/**
 * Sustained and bowed/sung: three detuned sawtooth voices built from their
 * harmonics, each harmonic weighted by `shape(hz, cutoff)` (a lowpass, or a
 * vowel), with vibrato. Harmonics come from the sine recurrence
 * sin(hx) = 2cos(x)sin((h-1)x) − sin((h-2)x), so it's cheap.
 */
const sustained = (out: Float32Array, n: Note, f: number, cutoff: (t: number) => number, rand: () => number,
  o: { attack: number; rel: number; vib: number; maxHz: number; shape: (hz: number, c: number) => number; gain: number }) => {
  const detune = [-0.006, 0, 0.0065];
  const ph = detune.map(() => rand() * TAU);
  const lfo = detune.map(() => rand() * TAU);
  const maxH = Math.max(1, Math.floor(o.maxHz / f));
  const amps = new Float32Array(maxH + 1);
  let top = maxH;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    if (i % 256 === 0) {
      const c = cutoff(n.t + t);
      top = 1;
      for (let h = 1; h <= maxH; h++) {
        amps[h] = o.shape(f * h, c) / h;
        if (amps[h]! > 0.002) top = h;
      }
    }
    let s = 0;
    for (let d = 0; d < 3; d++) {
      const wob = 1 + o.vib * Math.min(1, t / 0.6) * Math.sin(TAU * 5.1 * t + lfo[d]!);
      ph[d] = ph[d]! + (TAU * f * (1 + detune[d]!) * wob) / SR;
      const x = ph[d]!;
      const s1 = Math.sin(x);
      const c2 = 2 * Math.cos(x);
      let a = 0;
      let b = s1;
      s += amps[1]! * s1;
      for (let h = 2; h <= top; h++) {
        const nx = c2 * b - a;
        a = b;
        b = nx;
        s += amps[h]! * nx;
      }
    }
    const env = Math.min(1, t / o.attack) * (t < n.dur ? 1 : Math.exp(-(t - n.dur) * o.rel)) * (1 + 0.08 * Math.sin(TAU * 0.3 * t + lfo[0]!));
    out[i] = s * env * n.vel * o.gain;
  }
};

const lowpass = (hz: number, c: number) => 1 / Math.sqrt(1 + (hz / c) ** 4);
/** An "oh" vowel: the choir. */
const vowel = (hz: number, c: number) =>
  (0.02 + 1 / (1 + ((hz - 500) / 100) ** 2) + 0.6 / (1 + ((hz - 850) / 120) ** 2) + 0.15 / (1 + ((hz - 2400) / 200) ** 2)) * lowpass(hz, c * 1.6);

/** One note as a mono buffer. */
const voice = (n: Note, cutoff: (t: number) => number, rand: () => number): Float32Array => {
  const f = hz(n.midi);
  const v = n.vel;
  const len = Math.round((n.dur + RING[n.inst]) * SR);
  const out = new Float32Array(len);
  /** Fade after the note ends (`fast` = per-second decay rate). */
  const release = (fast: number) => (t: number) => (t < n.dur ? 1 : Math.exp(-(t - n.dur) * fast));
  const noise = () => rand() * 2 - 1;
  switch (n.inst) {
    case "epiano": {
      // FM electric piano: a sine bent by another sine whose depth decays,
      // so it starts bell-bright and mellows; plus a short metal "tine".
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const idx = (0.6 + 1.4 * v) * Math.exp(-t * 3.5) + 0.25;
        const env = Math.min(1, t / 0.003) * Math.exp(-t * (0.9 + f / 900)) * release(7)(t);
        const tine = 0.06 * v * Math.sin(TAU * f * 7 * t) * Math.exp(-t * 28);
        out[i] = (Math.sin(TAU * f * t + idx * Math.sin(TAU * f * t)) * env + tine) * v;
      }
      break;
    }
    case "piano": {
      // Felt piano: soft hammer (few bright partials), slightly stretched
      // overtones like a real string, two strings a hair apart, a little thump.
      const B = 0.0003;
      const parts: number[][] = [];
      for (let h = 1; h <= 12; h++) parts.push([h * Math.sqrt(1 + B * h * h), Math.exp(-(h - 1) / (1.2 + 3 * v)) / h ** 0.8, 0.6 + 0.35 * h + f / 1500]);
      struck(out, f, parts, v * 0.55, 0.004, release(9));
      const twin = new Float32Array(len);
      struck(twin, f * 1.0009, parts.slice(0, 4), v * 0.25, 0.004, release(9));
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += 0.05 * (noise() - lp);
        out[i] = out[i]! + twin[i]! + (i < 0.03 * SR ? lp * 0.5 * v * Math.exp(-i / (0.006 * SR)) : 0);
      }
      break;
    }
    case "musicbox":
      // Struck metal with a slightly detuned twin for its shimmer.
      struck(out, f, [[1, 1, 2.2], [2.01, 0.28, 4], [5.4, 0.07, 9], [8.9, 0.025, 14], [1.0017, 0.35, 2.6]], v * 0.6, 0.001, release(10));
      break;
    case "celesta":
      struck(out, f, [[1, 1, 1.6], [2, 0.12, 3], [4.02, 0.18, 6]], v * 0.6, 0.001, release(10));
      break;
    case "kalimba": {
      struck(out, f, [[1, 1, 2.6], [5.93, 0.2, 11], [1.003, 0.2, 3]], v * 0.7, 0.0008, release(12));
      for (let i = 0; i < 0.003 * SR; i++) out[i] = out[i]! + noise() * 0.15 * v;
      break;
    }
    case "marimba":
      struck(out, f, [[1, 1, 3.2], [3.93, 0.35, 9], [9.2, 0.08, 18]], v * 0.7, 0.0008, release(12));
      break;
    case "vibes": {
      struck(out, f, [[1, 1, 0.8], [3.99, 0.22, 2.5], [9.9, 0.04, 7]], v * 0.6, 0.001, release(4));
      // The motor: a slow tremolo.
      for (let i = 0; i < len; i++) out[i] = out[i]! * (1 - 0.3 * (0.5 + 0.5 * Math.sin((TAU * 5.3 * i) / SR)));
      break;
    }
    case "ocarina": {
      // A breathy, rounded flute (very Zelda): a sine with a touch of third
      // harmonic, slow attack, vibrato arriving late, and a bit of breath.
      let ph = 0;
      let breath = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const vib = 1 + 0.004 * Math.min(1, Math.max(0, (t - 0.25) / 0.4)) * Math.sin(TAU * 5.2 * t);
        ph += (TAU * f * vib) / SR;
        breath += 0.08 * (noise() - breath);
        const env = Math.min(1, t / 0.07) * release(14)(t) * (0.85 + 0.15 * Math.exp(-t * 3));
        out[i] = (Math.sin(ph) + 0.08 * Math.sin(3 * ph) + 0.25 * breath) * env * v * 0.5;
      }
      break;
    }
    case "flute": {
      // Wooden flute: more breath and a little more body than the ocarina.
      let ph = 0;
      let breath = 0;
      let hp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const vib = 1 + 0.005 * Math.min(1, Math.max(0, (t - 0.2) / 0.3)) * Math.sin(TAU * 5 * t);
        ph += (TAU * f * vib) / SR;
        const x = noise();
        hp += 0.3 * (x - hp);
        breath += 0.2 * (x - hp - breath);
        const env = Math.min(1, t / 0.05) * release(16)(t) * (0.8 + 0.2 * Math.exp(-t * 4));
        out[i] = (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.07 * Math.sin(3 * ph) + 0.4 * breath * (0.6 + 0.4 * Math.exp(-t * 6))) * env * v * 0.45;
      }
      break;
    }
    case "pizz":
      // Plucked strings: bright for an instant, gone in half a second.
      struck(out, f, [[1, 1, 7], [2, 0.45, 11], [3, 0.2, 16], [4, 0.1, 22]], v * 0.8, 0.002, release(20));
      break;
    case "harp": {
      const parts: number[][] = [];
      for (let h = 1; h <= 6; h++) parts.push([h, 1 / h ** 1.6, 1.2 + 0.9 * h]);
      struck(out, f, parts, v * 0.7, 0.002, release(6));
      break;
    }
    case "guitar": {
      // Nylon string, Karplus-Strong: a burst of soft noise fed round a
      // delay one period long, averaged each time so it mellows as it rings.
      const D = SR / f - 0.5;
      const start = Math.ceil(D) + 2;
      let lp = 0;
      for (let i = 0; i < Math.min(start, len); i++) {
        lp += 0.5 * (noise() - lp);
        out[i] = lp * v;
      }
      const read = (x: number) => {
        const a = Math.floor(x);
        return out[a]! + (out[a + 1]! - out[a]!) * (x - a);
      };
      const damp = 0.9965 - f / 400000;
      for (let i = start; i < len; i++) out[i] = damp * 0.5 * (read(i - D) + read(i - D - 1));
      for (let i = 0; i < len; i++) out[i] = out[i]! * release(8)(i / SR) * Math.min(1, i / (0.002 * SR)) * 0.9;
      break;
    }
    case "pulse": {
      // A soft chiptune square (a quarter-width pulse), built from harmonics
      // so it doesn't alias, rounded off up top; vibrato on long notes.
      let ph = 0;
      const maxH = Math.max(1, Math.floor(7000 / f));
      const amps = Array.from({ length: maxH + 1 }, (_, h) => (h ? (Math.sin(Math.PI * h * 0.25) / h) * lowpass(f * h, 3200) : 0));
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const vib = n.dur > 0.3 ? 1 + 0.005 * Math.min(1, Math.max(0, (t - 0.15) / 0.2)) * Math.sin(TAU * 5.5 * t) : 1;
        ph += (TAU * f * vib) / SR;
        let s = 0;
        for (let h = 1; h <= maxH; h++) s += amps[h]! * Math.sin(h * ph);
        out[i] = s * Math.min(1, t / 0.003) * (0.7 + 0.3 * Math.exp(-t * 8)) * release(40)(t) * v * 0.7;
      }
      break;
    }
    case "tri": {
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        ph += (TAU * f) / SR;
        let s = 0;
        for (let h = 1, sign = 1; h <= 9; h += 2, sign = -sign) s += (sign * Math.sin(h * ph)) / (h * h);
        out[i] = s * Math.min(1, t / 0.002) * release(40)(t) * v;
      }
      break;
    }
    case "bass":
    case "sub": {
      // Round and soft, with enough overtones to be heard on a phone.
      const [h2, h3] = n.inst === "bass" ? [0.35, 0.12] : [0.5, 0.2];
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const env = Math.min(1, t / 0.04) * release(9)(t) * (n.inst === "bass" ? 0.75 + 0.25 * Math.exp(-t * 2) : 1);
        out[i] = (Math.sin(TAU * f * t) + h2 * Math.sin(TAU * 2 * f * t) + h3 * Math.sin(TAU * 3 * f * t)) * env * v * 0.55;
      }
      break;
    }
    case "pad":
      sustained(out, n, f, cutoff, rand, { attack: 0.9, rel: 1.8, vib: 0, maxHz: 7000, shape: lowpass, gain: 0.12 });
      break;
    case "strings":
      sustained(out, n, f, (t) => cutoff(t) * 1.2, rand, { attack: 0.45, rel: 2, vib: 0.0025, maxHz: 7000, shape: lowpass, gain: 0.11 });
      break;
    case "choir":
      sustained(out, n, f, cutoff, rand, { attack: 0.6, rel: 2, vib: 0.003, maxHz: 4500, shape: vowel, gain: 0.3 });
      break;
    case "kick": {
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        ph += (TAU * (52 + 95 * Math.exp(-t * 30))) / SR;
        out[i] = (Math.sin(ph) * Math.exp(-t * 9) + noise() * 0.25 * Math.exp(-t * 400)) * v;
      }
      break;
    }
    case "snare": {
      // Soft and brushy: mid noise with a little drum tone.
      let lp = 0;
      let hp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        lp += 0.35 * (noise() - lp);
        hp += 0.06 * (lp - hp);
        out[i] = ((lp - hp) * Math.exp(-t * 16) + 0.3 * Math.sin(TAU * 185 * t) * Math.exp(-t * 22)) * v;
      }
      break;
    }
    case "hat":
    case "shaker": {
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const x = noise();
        lp += 0.5 * (x - lp);
        const env = n.inst === "hat" ? Math.exp(-t * 60) : Math.min(1, t / 0.015) * Math.exp(-t * 35);
        out[i] = (x - lp) * env * v * 0.5;
      }
      break;
    }
    case "rim":
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        out[i] = (Math.sin(TAU * 1700 * t) * Math.exp(-t * 90) + Math.sin(TAU * 820 * t) * Math.exp(-t * 60)) * v * 0.5;
      }
      break;
    case "chipkick": {
      let ph = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        ph += (TAU * (50 + 110 * Math.exp(-t * 40))) / SR;
        out[i] = Math.sign(Math.sin(ph)) * Math.exp(-t * 25) * v * 0.5;
      }
      break;
    }
    case "chipsnare":
    case "chiphat": {
      // The NES noise channel: noise held for a few samples, so it's grainy.
      const hold = n.inst === "chipsnare" ? 6 : 2;
      const decay = n.inst === "chipsnare" ? 20 : 80;
      let x = 0;
      for (let i = 0; i < len; i++) {
        if (i % hold === 0) x = noise();
        out[i] = x * Math.exp((-i / SR) * decay) * v * 0.4;
      }
      break;
    }
  }
  for (let i = 0; i < len; i++) out[i] = out[i]! * GAIN[n.inst];
  return n.reverse ? out.subarray(0, Math.round(n.dur * SR)).reverse() : out;
};

/** Freeverb-style room: eight damped combs then four allpasses per side. */
/** `wrap`: the pre-delay reads round the end (a loop); off, the first moment has nothing before it. */
const reverb = (x: Stereo, rt60: number, wrap = true): Stereo => {
  const total = x.l.length;
  const scale = SR / 44100;
  const combL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * scale * 1.3));
  const combR = combL.map((d) => d + Math.round(23 * scale));
  const apL = [556, 441, 341, 225].map((d) => Math.round(d * scale));
  const apR = apL.map((d) => d + Math.round(23 * scale));
  const mk = (ds: number[]) => ds.map((d) => ({ buf: new Float32Array(d), i: 0, lp: 0, g: 10 ** ((-3 * d) / (rt60 * SR)) }));
  const run = (combs: ReturnType<typeof mk>, aps: ReturnType<typeof mk>, inp: number) => {
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i]!;
      c.lp = o * 0.6 + c.lp * 0.4;
      c.buf[c.i] = inp + c.lp * c.g;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    y /= combs.length;
    for (const a of aps) {
      const b = a.buf[a.i]!;
      const w = y + b * -0.5;
      a.buf[a.i] = w;
      a.i = (a.i + 1) % a.buf.length;
      y = b + w * 0.5;
    }
    return y;
  };
  const [cl, cr, al, ar] = [mk(combL), mk(combR), mk(apL), mk(apR)];
  const out = { l: new Float32Array(total), r: new Float32Array(total) };
  const pre = Math.round(0.02 * SR);
  for (let i = 0; i < total; i++) {
    const j = wrap ? (i - pre + total) % total : i - pre;
    out.l[i] = run(cl, al, j >= 0 ? x.l[j]! : 0);
    out.r[i] = run(cr, ar, j >= 0 ? x.r[j]! : 0);
  }
  return out;
};

/** Runs a stateful effect over the loop twice and keeps the second pass. */
const looped = (x: Stereo, fx: (s: Stereo) => Stereo): Stereo => {
  const n = x.l.length;
  const twice = { l: new Float32Array(2 * n), r: new Float32Array(2 * n) };
  twice.l.set(x.l), twice.l.set(x.l, n), twice.r.set(x.r), twice.r.set(x.r, n);
  const y = fx(twice);
  return { l: y.l.slice(n), r: y.r.slice(n) };
};

/** Tape wobble: a gently swaying delay, so the pitch drifts a hair. */
const wobble = (depth: number, seconds: number) => (x: Stereo): Stereo => {
  const n = x.l.length;
  const out = { l: new Float32Array(n), r: new Float32Array(n) };
  // Whole cycles per loop, so the sway lines up at the seam.
  const slow = Math.max(1, Math.round(0.55 * seconds)) / seconds;
  const fast = Math.max(1, Math.round(3.1 * seconds)) / seconds;
  const base = 0.004 * SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const d = base + depth * SR * (0.0011 * Math.sin(TAU * slow * t) + 0.00012 * Math.sin(TAU * fast * t));
    const p = i - d;
    const a = Math.floor(p);
    const fr = p - a;
    const ia = Math.max(0, a);
    const ib = Math.max(0, a + 1);
    out.l[i] = x.l[ia]! * (1 - fr) + x.l[ib]! * fr;
    out.r[i] = x.r[ia]! * (1 - fr) + x.r[ib]! * fr;
  }
  return out;
};

/** The room tone: vinyl crackle, tape hiss or soft rain, just under the music. */
const texture = (kind: Score["texture"], n: number, rand: () => number): Stereo => {
  const out = { l: new Float32Array(n), r: new Float32Array(n) };
  if (kind === "none") return out;
  let lpL = 0;
  let lpR = 0;
  let hpL = 0;
  let hpR = 0;
  const hissLevel = { crackle: 0.006, tape: 0.01, hiss: 0.008, rain: 0.03 }[kind];
  const lpA = kind === "rain" ? 0.25 : 0.6;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // Highpassed noise: hiss (or, darker and swelling, rain).
    lpL += lpA * (rand() * 2 - 1 - lpL);
    lpR += lpA * (rand() * 2 - 1 - lpR);
    hpL += 0.02 * (lpL - hpL);
    hpR += 0.02 * (lpR - hpR);
    const sway = kind === "rain" ? 0.75 + 0.25 * Math.sin((TAU * t) / 3.7) : 1;
    out.l[i] = (lpL - hpL) * hissLevel * sway;
    out.r[i] = (lpR - hpR) * hissLevel * sway;
  }
  // Pops: vinyl crackle, or raindrops ticking on a window.
  const rate = { crackle: 9, tape: 2, hiss: 0, rain: 14 }[kind];
  const pops = Math.round(rate * (n / SR));
  for (let k = 0; k < pops; k++) {
    const at = Math.floor(rand() * n);
    const amp = (kind === "rain" ? 0.02 : 0.05) * rand() ** 2;
    const ring = kind === "rain" ? 2500 + 3500 * rand() : 0;
    const left = rand() < 0.5;
    for (let i = 0; i < (kind === "rain" ? 400 : 40); i++) {
      const j = (at + i) % n;
      const s = kind === "rain" ? Math.sin((TAU * ring * i) / SR) * Math.exp(-i / 60) : (rand() * 2 - 1) * Math.exp(-i / 6);
      (left ? out.l : out.r)[j] = (left ? out.l : out.r)[j]! + s * amp;
      (left ? out.r : out.l)[j] = (left ? out.r : out.l)[j]! + s * amp * 0.4;
    }
  }
  return out;
};

/** Loudness of each instrument across a track, dB (for balancing GAIN). */
export const stemLevels = (score: Score, seed: number): Partial<Record<Inst, number>> => {
  const n = Math.round(score.seconds * SR);
  const rand = mulberry(seed * 977 + 41);
  const energy: Partial<Record<Inst, number>> = {};
  for (const note of score.notes) {
    const s = voice(note, score.cutoff, rand);
    let e = 0;
    for (let i = 0; i < s.length; i++) e += s[i]! ** 2;
    energy[note.inst] = (energy[note.inst] ?? 0) + e;
  }
  return Object.fromEntries(Object.entries(energy).map(([k, e]) => [k, Math.round(10 * Math.log10(e / n + 1e-12) * 10) / 10]));
};

export const render = (score: Score, seed: number): Stereo => {
  const n = Math.round(score.seconds * SR);
  const once = score.loop === false;
  /** A loop runs its effects twice round and keeps the second pass (so the seam is settled); a piece runs them once. */
  const fx = (x: Stereo, f: (s: Stereo) => Stereo) => (once ? f(x) : looped(x, f));
  const rand = mulberry(seed * 977 + 41);
  const dry = { l: new Float32Array(n), r: new Float32Array(n) };
  for (const note of score.notes) {
    const s = voice(note, score.cutoff, rand);
    const gl = Math.sqrt((1 - note.pan) / 2);
    const gr = Math.sqrt((1 + note.pan) / 2);
    const start = Math.round(note.t * SR);
    if (once) {
      // A piece that runs once: what rings past the end is cut.
      for (let i = Math.max(0, -start); i < s.length && start + i < n; i++) {
        dry.l[start + i] = dry.l[start + i]! + s[i]! * gl;
        dry.r[start + i] = dry.r[start + i]! + s[i]! * gr;
      }
      continue;
    }
    for (let i = 0; i < s.length; i++) {
      const j = (((start + i) % n) + n) % n; // rings past the end → wraps to the start
      dry.l[j] = dry.l[j]! + s[i]! * gl;
      dry.r[j] = dry.r[j]! + s[i]! * gr;
    }
  }
  for (let i = 0; i < n; i++) {
    const g = score.level(i / SR);
    dry.l[i] = dry.l[i]! * g;
    dry.r[i] = dry.r[i]! * g;
  }
  const wet = fx(dry, (x) => reverb(x, score.reverb.rt60, !once));
  const room = texture(score.texture, n, rand);
  let mix: Stereo = { l: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    mix.l[i] = dry.l[i]! + wet.l[i]! * score.reverb.wet * 3;
    mix.r[i] = dry.r[i]! + wet.r[i]! * score.reverb.wet * 3;
  }
  if (score.wow > 0) mix = fx(mix, wobble(score.wow, score.seconds));
  // Soften the top (looped, so the filter has settled by the seam), add the
  // room tone, warm it with a gentle saturation and level it.
  const a = 1 - Math.exp((-TAU * score.lowpass) / SR);
  mix = fx(mix, (x) => {
    let yl = 0;
    let yr = 0;
    for (let i = 0; i < x.l.length; i++) {
      yl += a * (x.l[i]! - yl);
      yr += a * (x.r[i]! - yr);
      x.l[i] = yl;
      x.r[i] = yr;
    }
    return x;
  });
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix.l[i]!), Math.abs(mix.r[i]!));
  const pre = 1.4 / (peak || 1);
  for (let i = 0; i < n; i++) {
    mix.l[i] = Math.tanh(mix.l[i]! * pre) + room.l[i]!;
    mix.r[i] = Math.tanh(mix.r[i]! * pre) + room.r[i]!;
  }
  // Every save at the same loudness (so the template's volume means the
  // same thing for each), unless that would clip.
  peak = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, Math.abs(mix.l[i]!), Math.abs(mix.r[i]!));
    energy += mix.l[i]! ** 2 + mix.r[i]! ** 2;
  }
  const rms = Math.sqrt(energy / (2 * n)) || 1;
  const g = Math.min(10 ** (-16 / 20) / rms, 10 ** (-1 / 20) / (peak || 1));
  for (let i = 0; i < n; i++) {
    mix.l[i] = mix.l[i]! * g;
    mix.r[i] = mix.r[i]! * g;
  }
  return mix;
};

/** 16-bit stereo WAV. */
export const wav = (x: Stereo): Uint8Array => {
  const total = x.l.length;
  const bytes = 44 + total * 4;
  const b = new DataView(new ArrayBuffer(bytes));
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  b.setUint32(4, bytes - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 2, true);
  b.setUint32(24, SR, true);
  b.setUint32(28, SR * 4, true);
  b.setUint16(32, 4, true);
  b.setUint16(34, 16, true);
  ascii(36, "data");
  b.setUint32(40, total * 4, true);
  for (let i = 0; i < total; i++) {
    b.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, x.l[i]!)) * 32767), true);
    b.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, x.r[i]!)) * 32767), true);
  }
  return new Uint8Array(b.buffer);
};
