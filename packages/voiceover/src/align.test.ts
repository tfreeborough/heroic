import { describe, expect, test } from "bun:test";
import { type WhisperItem, pcmOfWav, placeWords, speechOf, wordsFromWhisper } from "./align";

/**
 * whisper.cpp's own output for part of a real take (--max-len 1
 * --split-on-word true --dtw), trimmed to what's read. Each token: its text,
 * its span in seconds, its aligned time in hundredths.
 */
const item = (text: string, from: number, to: number, tokens: [string, number, number, number][]): WhisperItem => ({
  text,
  offsets: { from: from * 1000, to: to * 1000 },
  tokens: tokens.map(([t, f, e, d]) => ({ text: t, t_dtw: d, offsets: { from: f * 1000, to: e * 1000 } })),
});
const heard: WhisperItem[] = [
  item("", 0, 0, [["[_BEG_]", 0, 0, -1]]),
  item(" this", 2.0, 2.36, [[" this", 2.0, 2.33, 230]]),
  item(" is", 2.36, 2.52, [[" is", 2.36, 2.52, 240]]),
  item(" me", 2.52, 2.7, [[" me", 2.52, 2.59, 258]]),
  item(" talking,", 2.7, 3.43, [[" talking", 2.7, 3.28, 298], [",", 3.4, 3.4, 350]]),
  item(" and", 3.43, 4.0, [[" and", 3.43, 4.0, 380]]),
  item(" hopefully", 4.0, 4.88, [[" hopefully", 4.0, 4.76, 498]]),
  item(" captions", 4.88, 5.44, [[" captions", 4.88, 5.44, 568]]),
  item(" will", 5.44, 5.78, [[" will", 5.44, 5.78, 600]]),
  item(" good,", 7.93, 8.19, [[" good", 7.93, 8.1, 818], [",", 8.1, 8.19, 842]]),
  item(" but", 8.19, 8.34, [[" but", 8.19, 8.21, 914]]),
  item(" if", 8.34, 8.68, [[" if", 8.34, 8.68, 932], ["[_TT_409]", 8.68, 8.68, -1]]),
];
/** Where that take actually has someone speaking (each stretch checked by ear: Whisper run on it alone). */
const speech = [
  { start: 2.19, end: 3.3 }, // this is me talking
  { start: 3.39, end: 4.05 }, // and
  { start: 4.6, end: 5.23 }, // hopefully
  { start: 5.32, end: 6.91 }, // captions will…
  { start: 7.32, end: 8.22 }, // …good
  { start: 9.07, end: 12.08 }, // but if…
];

describe("whisper → words", () => {
  const words = wordsFromWhisper(heard);
  test("tokens join into words; brackets aren't speech", () => {
    expect(words.map((w) => w.text)).toEqual(["this", "is", "me", "talking,", "and", "hopefully", "captions", "will", "good,", "but", "if"]);
  });
  test("a word carries both of Whisper's clocks: its spoken tokens' span, and the aligned ends either side of it", () => {
    expect(words[3]).toEqual({ text: "talking,", from: 2.7, to: 3.28, after: 2.58, by: 2.98 });
    // The comma's aligned time is where the next word is counted from.
    expect(words[4]!.after).toBe(3.5);
  });
  test("without aligned times there's still the span", () => {
    const plain = wordsFromWhisper([
      { text: " Hello", offsets: { from: 100, to: 400 } },
      { text: " there", offsets: { from: 400, to: 800 } },
      { text: ".", offsets: { from: 800, to: 900 } },
    ]);
    expect(plain.map((w) => [w.text, w.from, w.to, w.by])).toEqual([
      ["Hello", 0.1, 0.4, undefined],
      ["there.", 0.4, 0.8, undefined],
    ]);
  });
});

describe("words into the speech", () => {
  const words = placeWords(wordsFromWhisper(heard), speech);
  const by = (text: string) => words.find((w) => w.text === text)!;
  test("a word said after a pause starts when the pause ends, not when the last word did", () => {
    // Whisper had these starting at 3.50 → 3.80 → 4.98 and 8.42: up to 0.9s before they were said.
    expect(by("and").start).toBe(3.39);
    expect(by("hopefully").start).toBe(4.6);
    expect(by("captions").start).toBe(5.32);
    expect(by("but").start).toBe(9.07);
  });
  test("a word before a pause runs up to it and no further", () => {
    expect(by("talking,").end).toBe(3.3);
    expect(by("and").end).toBe(4.05);
    expect(by("hopefully").end).toBe(5.23);
    expect(by("good,").end).toBe(8.22);
  });
  test("no word sits in a pause, and they stay in order", () => {
    for (const w of words) expect(speech.some((s) => w.start >= s.start - 1e-6 && w.end <= s.end + 1e-6)).toBe(true);
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end - 1e-6);
  });
  test("a stretch is shared out by how long each word probably took", () => {
    const [a, b, c, d] = ["this", "is", "me", "talking,"].map(by);
    expect(a!.start).toBe(2.19);
    expect(d!.end - d!.start).toBeGreaterThan(c!.end - c!.start);
    expect(b!.end - b!.start).toBeLessThan(a!.end - a!.start);
  });
  test("a word whose time falls in a pause belongs to the speech after it", () => {
    const out = placeWords([{ text: "late", from: 1, to: 1.2, after: 1, by: 4.3 }], speech);
    expect(out[0]).toEqual({ text: "late", start: 4.6, end: 5.23 });
  });
  test("with no speech found, Whisper's own times stand", () => {
    const out = placeWords(wordsFromWhisper(heard).slice(0, 3), []);
    expect(out[0]).toEqual({ text: "this", start: 2, end: 2.3 });
    expect(out[1]!.start).toBe(2.3);
  });
});

describe("finding the speech", () => {
  const rate = 16000;
  const tone = (seconds: number, level: number) => Array.from({ length: Math.round(seconds * rate) }, (_, i) => Math.sin(i / 8) * level + (((i * 7919) % 13) - 6) * 2);
  test("stretches of sound between pauses, to a couple of hundredths", () => {
    const samples = [...tone(1, 9000), ...tone(0.4, 0), ...tone(1.2, 7000), ...tone(0.03, 0), ...tone(0.5, 9000)];
    const found = speechOf(samples, rate);
    expect(found).toHaveLength(2);
    expect(found[0]!.start).toBeCloseTo(0, 1);
    expect(found[0]!.end).toBeCloseTo(1, 1);
    expect(found[1]!.start).toBeCloseTo(1.4, 1);
    // The 0.03s gap is a closure inside a word, not a pause.
    expect(found[1]!.end).toBeCloseTo(3.13, 1);
  });
  test("a breath is not speech", () => {
    const samples = [...tone(1, 9000), ...tone(0.3, 0), ...tone(0.3, 60), ...tone(0.3, 0), ...tone(1, 9000)];
    expect(speechOf(samples, rate)).toHaveLength(2);
  });
  test("all noise or all talk: nothing to go on", () => {
    expect(speechOf(tone(2, 0), rate)).toEqual([]);
    expect(speechOf(tone(2, 9000), rate)).toEqual([]);
  });
});

describe("reading a WAV", () => {
  test("finds the data past other chunks, and copes with a size that was never filled in", () => {
    const pcm = new Int16Array([1, -2, 300, -400]);
    const bytes = new Uint8Array(12 + 24 + 12 + 8 + pcm.byteLength);
    const v = new DataView(bytes.buffer);
    const put = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
    put(0, "RIFF");
    put(8, "WAVE");
    put(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true);
    v.setUint16(34, 16, true);
    put(36, "LIST");
    v.setUint32(40, 4, true);
    put(48, "data");
    v.setUint32(52, 0xffffffff, true);
    new Uint8Array(bytes.buffer, 56).set(new Uint8Array(pcm.buffer));
    const out = pcmOfWav(bytes);
    expect(out.rate).toBe(16000);
    expect([...out.samples]).toEqual([1, -2, 300, -400]);
  });
});
