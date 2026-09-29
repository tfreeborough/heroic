/**
 * Whisper's output → words that sit where the sound is.
 *
 * Whisper knows WHAT was said very well and WHEN only roughly. Measured on
 * a real recording, both of the times it gives for a word (its own span,
 * and the aligned time from --dtw) were out by anything up to 0.9s around
 * a pause: a word "starts" the moment the one before it ends, however long
 * the speaker waited, so a caption lights up well before it's said.
 *
 * The recording itself knows exactly where the pauses are. So:
 *  1. find the stretches of SPEECH in the sound (the pauses are what's left);
 *  2. put each word in the stretch Whisper heard it END in, the one thing
 *     it gets right;
 *  3. share each stretch out among its words, first word starting where
 *     the sound does, last word ending where it does.
 */
import type { Word } from "./types";

export type Span = { start: number; end: number };

/** One item of whisper.cpp's JSON (`-ojf`, one word per item): its span in ms, and its tokens with their aligned times. */
export type WhisperItem = {
  text: string;
  offsets: { from: number; to: number };
  tokens?: { text: string; t_dtw: number; offsets?: { from: number; to: number } }[];
};

/** A word as Whisper heard it: its own span, and (with --dtw) when the token before it ended and when its last spoken token did. */
export type HeardWord = { text: string; from: number; to: number; after?: number; by?: number };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const notSpeech = (text: string) => /^\s*\[[^\]]*\]\s*$/.test(text) || /^\s*\([^)]*\)\s*$/.test(text) || /^\s*[♪♫]+\s*$/.test(text);
const onlyPunctuation = (text: string) => /^[\s.,;:!?…"'“”‘’()\-–—]+$/.test(text);

/**
 * Items → words. An item that starts with a space starts a word; anything
 * else (the "'s" of "he's", a comma, the tail of a long word) joins the
 * word before it. Bracketed items ([BLANK_AUDIO], [_BEG_]) aren't speech.
 * Aligned times are whisper.cpp's, in hundredths of a second, −1 for none.
 */
export const wordsFromWhisper = (items: WhisperItem[]): HeardWord[] => {
  const words: HeardWord[] = [];
  let cursor: number | undefined; // where the last token ended
  for (const item of items) {
    const raw = item.text;
    const said = (item.tokens ?? []).filter((t) => !notSpeech(t.text));
    const tokens = said.filter((t) => t.t_dtw >= 0);
    const last = tokens.length ? tokens[tokens.length - 1]!.t_dtw / 100 : undefined;
    if (!raw || !raw.trim() || notSpeech(raw)) {
      if (last !== undefined) cursor = last;
      continue;
    }
    // The item's own span takes in the silence round the word; its spoken tokens' spans don't.
    const voiced = said.filter((t) => t.offsets && !onlyPunctuation(t.text));
    const from = (voiced[0]?.offsets ?? item.offsets).from / 1000;
    const to = Math.max((voiced[voiced.length - 1]?.offsets ?? item.offsets).to / 1000, from);
    const spoken = tokens.filter((t) => !onlyPunctuation(t.text));
    const by = spoken.length ? spoken[spoken.length - 1]!.t_dtw / 100 : undefined;
    const prev = words[words.length - 1];
    if (prev && !/^\s/.test(raw)) {
      prev.text += raw.trim();
      if (!onlyPunctuation(raw)) {
        prev.to = Math.max(prev.to, to);
        if (by !== undefined) prev.by = Math.max(prev.by ?? 0, by);
      }
    } else words.push({ text: raw.trim(), from, to, after: cursor, by });
    cursor = last !== undefined ? Math.max(cursor ?? 0, last) : to;
  }
  return words;
};

/**
 * The stretches of a recording where someone is speaking. `samples` is
 * mono PCM (any scale). The threshold adapts to the recording: two fifths
 * of the way up from its noise floor to its speaking level, which leaves
 * breaths and room noise out and keeps quiet consonants in. A gap has to
 * last `pause` seconds to split a stretch: shorter is the closure inside a
 * word ("cap-tions"), not a pause.
 */
export const speechOf = (samples: ArrayLike<number>, rate: number, pause = 0.06): Span[] => {
  const hop = Math.max(1, Math.round(rate * 0.01));
  const win = Math.max(hop, Math.round(rate * 0.025));
  const frames = Math.floor((samples.length - win) / hop) + 1;
  if (frames < 1) return [];
  const db = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, e = i + win; i < e; i++) sum += samples[i]! * samples[i]!;
    db[f] = 10 * Math.log10(sum / win + 1e-12);
  }
  const sorted = Float64Array.from(db).sort();
  const floor = sorted[Math.floor(frames * 0.1)]!;
  const speech = sorted[Math.floor(frames * 0.9)]!;
  // Nothing but noise (or nothing but talk): no telling speech from pause.
  if (speech - floor < 12) return [];
  const threshold = floor + (speech - floor) * 0.4;
  const need = Math.max(1, Math.round(pause / 0.01));
  const out: Span[] = [];
  let from = -1;
  let quiet = 0;
  for (let f = 0; f <= frames; f++) {
    const loud = f < frames && db[f]! >= threshold;
    if (loud) {
      if (from < 0) from = f;
      quiet = 0;
    } else if (from >= 0) {
      quiet++;
      if (quiet >= need || f === frames) {
        const span = { start: r3((from * hop) / rate), end: r3(((f - quiet + 1) * hop + (win - hop)) / rate) };
        // A blip (a click, a lip smack) isn't a word.
        if (span.end - span.start >= 0.08) out.push(span);
        from = -1;
        quiet = 0;
      }
    }
  }
  return out;
};

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "").length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
/** How long a word probably took: the middle of what Whisper's two clocks say and what its length suggests. Robust to either clock being nonsense. */
const weigh = (w: HeardWord): number => {
  const guesses = [0.05 + 0.06 * Math.max(1, letters(w.text))];
  if (w.to - w.from > 0.03 && w.to - w.from < 2) guesses.push(w.to - w.from);
  if (w.by !== undefined && w.after !== undefined && w.by - w.after > 0.03 && w.by - w.after < 2) guesses.push(w.by - w.after);
  return Math.max(0.04, median(guesses));
};

/**
 * Each word into the stretch of speech it was heard to END in, then each
 * stretch shared out among its words. Without any stretches (a recording
 * with no telling speech from noise) Whisper's own times are all there is.
 */
export const placeWords = (heard: HeardWord[], speech: Span[]): Word[] => {
  if (!heard.length) return [];
  if (!speech.length) {
    const out: Word[] = [];
    for (const w of heard) {
      const prev = out[out.length - 1];
      const start = Math.max(w.after ?? w.from, prev ? prev.end : 0);
      const end = Math.max(start + 0.04, w.by ?? w.to);
      out.push({ text: w.text, start: r3(start), end: r3(end) });
    }
    return out;
  }
  // Which stretch: the one holding the moment the word was heard by. In a
  // pause, the next one: Whisper's times run early, never late, so a word
  // "finished" during a pause hasn't been said yet.
  let k = 0;
  const groups: HeardWord[][] = speech.map(() => []);
  for (const w of heard) {
    const anchor = w.by ?? (w.from + w.to) / 2;
    let at = speech.findIndex((s) => anchor < s.end);
    if (at < 0) at = speech.length - 1;
    k = Math.max(k, at);
    groups[k]!.push(w);
  }
  const out: Word[] = [];
  groups.forEach((words, i) => {
    if (!words.length) return;
    const span = speech[i]!;
    const weights = words.map(weigh);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = span.start;
    words.forEach((w, j) => {
      const end = j === words.length - 1 ? span.end : t + ((span.end - span.start) * weights[j]!) / total;
      out.push({ text: w.text, start: r3(t), end: r3(Math.max(t + 0.02, end)) });
      t = end;
    });
  });
  return out;
};

/** Mono 16-bit PCM out of a WAV file's bytes (what the Desk makes for Whisper). */
export const pcmOfWav = (bytes: Uint8Array): { samples: Int16Array; rate: number } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let rate = 16000;
  let channels = 1;
  let bits = 16;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "fmt ") {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (tag(at) === "data") {
      if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}-bit`);
      // ffmpeg writing to a pipe can't go back and fill the size in; trust the file's length then.
      const length = Math.min(size, bytes.length - (at + 8));
      const count = Math.floor(length / 2 / channels);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(at + 8 + i * 2 * channels, true);
      return { samples, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("WAV file has no sound in it");
};
