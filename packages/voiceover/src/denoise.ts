/**
 * Background noise out of a voice recording, the way Audacity's Noise
 * Reduction does it:
 *
 *  1. LEARN the noise from the parts where nobody is speaking: for every
 *     frequency, how loud the room is and how much that varies.
 *  2. GATE each frequency separately: wherever the sound at a frequency
 *     isn't clearly above the room's, turn that frequency down by
 *     `reduce` dB. Where there's voice, leave it alone.
 *  3. SMOOTH the gating across neighbouring frequencies and through time
 *     (open a little ahead of a word, close gently after it), which is
 *     what stops the burbling a crude gate leaves behind.
 *
 * The noise is turned DOWN, never cut to nothing: a recording with a
 * little room left in it sounds like a person in a room, and one with
 * none sounds like a phone call.
 *
 * (ffmpeg's own filters were tried first, on real takes: afftdn took off
 * 4–8 dB whatever it was asked for, anlmdn took off 20 and 2–5 dB of the
 * consonants with it.)
 */
import type { Span } from "./align";

export type DenoiseOptions = {
  /** How far the noise is turned down, in dB. */
  reduce: number;
  /** How far above the room's level a frequency has to be to count as voice, in standard deviations of the room's own variation. Higher = more is treated as noise. */
  sensitivity?: number;
};

const SIZE = 2048;
const HOP = SIZE / 4;
const BINS = SIZE / 2 + 1;

/** In-place radix-2 FFT. `inverse` leaves the result unscaled. */
const fft = (re: Float64Array, im: Float64Array, inverse: boolean) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
};

/** The parts of a recording where nobody's speaking, given the parts where somebody is: what the noise is learnt from. */
export const pausesOf = (speech: Span[], seconds: number, margin = 0.06, shortest = 0.15): Span[] => {
  const out: Span[] = [];
  let at = 0;
  for (const s of [...speech, { start: seconds, end: seconds }]) {
    const span = { start: at + (at > 0 ? margin : 0), end: s.start - (s.start < seconds ? margin : 0) };
    if (span.end - span.start >= shortest) out.push(span);
    at = Math.max(at, s.end);
  }
  return out;
};

/**
 * `samples` (mono, −1…1) with its background turned down. `pauses` = where
 * nobody is speaking (pausesOf); with none to learn from, the quietest
 * tenth of the recording stands in. Same length out as in.
 */
export const denoise = (samples: Float32Array, rate: number, pauses: Span[], opts: DenoiseOptions): Float32Array => {
  const floor = Math.pow(10, -Math.max(0, opts.reduce) / 20);
  const n = samples.length;
  if (n < SIZE || floor >= 1) return samples.slice();
  const sensitivity = opts.sensitivity ?? 2.5;
  const window = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
  // Frame f covers samples [f·HOP − SIZE + HOP, f·HOP + HOP): the recording is padded at both ends so every sample is in four frames.
  const frames = Math.ceil(n / HOP) + 3;
  const startOf = (f: number) => (f - 3) * HOP;
  const re = new Float32Array(frames * BINS);
  const im = new Float32Array(frames * BINS);
  const level = new Float32Array(frames * BINS); // dB
  const wr = new Float64Array(SIZE);
  const wi = new Float64Array(SIZE);
  for (let f = 0; f < frames; f++) {
    const from = startOf(f);
    for (let i = 0; i < SIZE; i++) {
      const at = from + i;
      wr[i] = at >= 0 && at < n ? samples[at]! * window[i]! : 0;
      wi[i] = 0;
    }
    fft(wr, wi, false);
    for (let k = 0; k < BINS; k++) {
      re[f * BINS + k] = wr[k]!;
      im[f * BINS + k] = wi[k]!;
      level[f * BINS + k] = 10 * Math.log10(wr[k]! * wr[k]! + wi[k]! * wi[k]! + 1e-20);
    }
  }

  // 1. The room: frames that sit wholly inside a pause.
  let room: number[] = [];
  for (let f = 0; f < frames; f++) {
    const a = startOf(f) / rate;
    const b = (startOf(f) + SIZE) / rate;
    if (a >= 0 && b <= n / rate && pauses.some((p) => a >= p.start && b <= p.end)) room.push(f);
  }
  if (room.length < 4) {
    const loud = Array.from({ length: frames }, (_, f) => {
      let sum = 0;
      for (let k = 4; k < BINS; k++) sum += Math.pow(10, level[f * BINS + k]! / 10);
      return { f, sum };
    })
      .filter((x) => startOf(x.f) >= 0 && startOf(x.f) + SIZE <= n)
      .sort((x, y) => x.sum - y.sum);
    room = loud.slice(0, Math.max(4, Math.floor(loud.length / 10))).map((x) => x.f);
  }
  if (!room.length) return samples.slice();
  const threshold = new Float32Array(BINS);
  for (let k = 0; k < BINS; k++) {
    let mean = 0;
    for (const f of room) mean += level[f * BINS + k]!;
    mean /= room.length;
    let dev = 0;
    for (const f of room) dev += (level[f * BINS + k]! - mean) ** 2;
    dev = Math.sqrt(dev / room.length);
    threshold[k] = mean + sensitivity * Math.max(2, dev);
  }

  // 2. Voice or room, per frequency per frame. A frequency counts as voice when the middle of three frames in a row is over the room's threshold: one loud frame on its own is the room having a moment.
  const gain = new Float32Array(frames * BINS); // in dB, 0 = untouched
  const down = -Math.max(0, opts.reduce);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) {
      const a = level[Math.max(0, f - 1) * BINS + k]!;
      const b = level[f * BINS + k]!;
      const c = level[Math.min(frames - 1, f + 1) * BINS + k]!;
      const mid = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
      gain[f * BINS + k] = mid > threshold[k]! ? 0 : down;
    }
  }
  // 3a. Across frequency. A frequency over the threshold with nothing over
  // it either side is the room, not a voice (any real tone is a few
  // frequencies wide here): shut it. Then let the gate open gradually
  // either side of what IS voice, over four frequencies, so the edge of a
  // voiced band isn't a cliff. Voice itself is never turned down by this.
  const row = new Float32Array(BINS);
  const slope = -down / 4;
  for (let f = 0; f < frames; f++) {
    const base = f * BINS;
    for (let k = 0; k < BINS; k++) {
      const alone = gain[base + k] === 0 && (k === 0 || gain[base + k - 1] !== 0) && (k === BINS - 1 || gain[base + k + 1] !== 0);
      row[k] = alone ? down : gain[base + k]!;
    }
    for (let k = 1; k < BINS; k++) row[k] = Math.max(row[k]!, row[k - 1]! - slope);
    for (let k = BINS - 2; k >= 0; k--) row[k] = Math.max(row[k]!, row[k + 1]! - slope);
    gain.set(row, base);
  }
  // 3b. Through time: open over ~20ms ahead of the voice, close over ~100ms after it.
  const perFrame = HOP / rate;
  const release = (-down * perFrame) / 0.1;
  const attack = (-down * perFrame) / 0.02;
  for (let k = 0; k < BINS; k++) {
    for (let f = 1; f < frames; f++) gain[f * BINS + k] = Math.max(gain[f * BINS + k]!, gain[(f - 1) * BINS + k]! - release);
    for (let f = frames - 2; f >= 0; f--) gain[f * BINS + k] = Math.max(gain[f * BINS + k]!, gain[(f + 1) * BINS + k]! - attack);
  }

  // Back to sound: each frame turned down where it's room, windowed again, laid over its neighbours.
  const out = new Float64Array(n);
  // Hann analysis × Hann synthesis at a quarter hop sums to 1.5.
  const scale = 1 / (1.5 * SIZE);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < BINS; k++) {
      const g = Math.pow(10, gain[f * BINS + k]! / 20);
      wr[k] = re[f * BINS + k]! * g;
      wi[k] = im[f * BINS + k]! * g;
    }
    for (let k = 1; k < SIZE / 2; k++) {
      wr[SIZE - k] = wr[k]!;
      wi[SIZE - k] = -wi[k]!;
    }
    fft(wr, wi, true);
    const from = startOf(f);
    for (let i = 0; i < SIZE; i++) {
      const at = from + i;
      if (at >= 0 && at < n) out[at] = out[at]! + wr[i]! * window[i]! * scale;
    }
  }
  return Float32Array.from(out);
};

/** How much each strength takes off. Light leaves the room in; strong is for a fan or a fridge. */
export const NOISE_LEVELS = [
  { level: 0, label: "Off", reduce: 0 },
  { level: 1, label: "Light", reduce: 8 },
  { level: 2, label: "Medium", reduce: 15 },
  { level: 3, label: "Strong", reduce: 24 },
] as const;
export type NoiseLevel = (typeof NOISE_LEVELS)[number]["level"];
