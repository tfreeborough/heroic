import { describe, expect, test } from "bun:test";
import type { Word } from "@heroic/voiceover";
import { matchScript } from "./match";
import { organiseCut, splitPoint } from "./organise";
import { type Cut, type Script, emptyScript } from "./scripts";

const said = (text: string, from = 0, step = 0.3): Word[] => text.split(/\s+/).map((t, i) => ({ text: t, start: from + i * step, end: from + (i + 1) * step - 0.05 }));
const B1 = "Blood in the Sand wasn't always the game it is now. I changed my mind about three big things.";
const B2 = "Originally it wasn't meant to be an arena game at all. I'd designed it as an open world RPG.";
const B3 = "There'd be dozens of monsters, hundreds of items, and hundreds of talents. Quests, dungeons, you name it.";

const long: Cut = {
  id: "L",
  kind: "long",
  title: "Three things",
  beats: [
    { id: "b1", text: B1, card: { kind: "text", text: "Three things" } },
    { id: "b2", text: B2, card: { kind: "sketch", prompt: "a globe", src: "cards/x/b2-1.png" } },
    { id: "b3", text: B3, card: { kind: "none" } },
  ],
};
const script = (takes: Script["takes"]): Script => ({ ...emptyScript("s", "Three things"), long, takes, gap: 0.3 });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const covers = (s: Script) => new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));

describe("organise", () => {
  test("one take reading everything: three clips in order with the gap, cards and markers at the beats", () => {
    const s = script([{ file: "voice/takes/t1.wav", seconds: 30, recordedAt: "", words: said(`${B1} ${B2} ${B3}`, 1), transcribed: true }]);
    const { seq, missing, conflicts } = organiseCut(s, long, covers(s), { id: "x-long", name: "x" });
    expect(missing).toEqual([]);
    expect(conflicts).toEqual([]);
    const clips = seq.audio[0]!.clips;
    expect(clips.length).toBe(3);
    expect(clips[0]!.at).toBe(0);
    // The second clip starts where the first ends plus the gap.
    expect(clips[1]!.at).toBeCloseTo(clips[0]!.end - clips[0]!.start + 0.3, 2);
    // Slices run from just before the beat's first word to halfway into the gap before the next beat's first word.
    expect(clips[0]!.start).toBeCloseTo(1 - 0.12, 2);
    expect(clips[0]!.end).toBeCloseTo(1 + 19 * 0.3 - 0.025, 2);
    expect(seq.markers?.length).toBe(3);
    const cards = seq.overlay!.cards;
    expect(cards.map((c) => c.kind)).toEqual(["text", "image"]);
    // The sketch lasts through the "none" beat to the end of the edit.
    expect(cards[1]!.at).toBe(clips[1]!.at);
    expect(cards[1]!.at + cards[1]!.seconds).toBeCloseTo(clips[2]!.at + (clips[2]!.end - clips[2]!.start), 2);
    expect(seq.idea).toBe("s");
    expect(seq.takes.length).toBe(1);
  });

  test("two takes: one each; a beat nobody read is missing", () => {
    const s = script([
      { file: "voice/takes/t1.wav", seconds: 10, recordedAt: "", words: said(B1, 0.5), transcribed: true },
      { file: "voice/takes/t2.wav", seconds: 10, recordedAt: "", words: said(B3, 0.5), transcribed: true },
    ]);
    const { seq, missing } = organiseCut(s, long, covers(s), { id: "x", name: "x" });
    expect(missing).toEqual(["b2"]);
    expect(seq.audio[0]!.clips.map((c) => c.take)).toEqual([0, 1]);
  });

  test("two takes reading the same beat: a conflict, nothing picked", () => {
    const s = script([
      { file: "voice/takes/t1.wav", seconds: 10, recordedAt: "", words: said(B1, 0.5), transcribed: true },
      { file: "voice/takes/t2.wav", seconds: 10, recordedAt: "", words: said(B1, 0.5), transcribed: true },
    ]);
    const { seq, conflicts } = organiseCut(s, long, covers(s), { id: "x", name: "x" });
    expect(conflicts).toEqual([{ beat: "b1", takes: ["voice/takes/t1.wav", "voice/takes/t2.wav"] }]);
    expect(seq.audio[0]!.clips.length).toBe(0);
  });

  test("a cut take: the slice stays inside the kept region", () => {
    const words = said(`${B1} ${B2}`, 1);
    const b2At = 1 + 19 * 0.3;
    const s = script([{ file: "voice/takes/t1.wav", seconds: 30, recordedAt: "", words, transcribed: true, keep: [{ start: b2At - 0.05, end: 30 }] }]);
    const { seq, missing } = organiseCut(s, long, covers(s), { id: "x", name: "x" });
    expect(missing).toEqual(["b1", "b3"]);
    expect(seq.audio[0]!.clips[0]!.start).toBeCloseTo(b2At - 0.05, 2);
  });

  test("words said round the script's (an added opening, a number heard as digits) stay in, and the slice never starts inside a word", () => {
    const words = said(`So to be fair, ${B1} Honestly 100%`, 1);
    const s = script([{ file: "voice/takes/t1.wav", seconds: 30, recordedAt: "", words, transcribed: true }]);
    const clip = organiseCut(s, long, covers(s), { id: "x", name: "x" }).seq.audio[0]!.clips[0]!;
    expect(clip.start).toBeCloseTo(1 - 0.12, 2);
    expect(clip.end).toBeCloseTo(words.at(-1)!.end + 0.18, 2);
  });

  test("a pause the trim shortened stays short, and the beat carries on after it", () => {
    const words = [...said(B1.split(". ")[0]! + ".", 1), ...said(B1.split(". ")[1]!, 6)];
    const s = script([{ file: "voice/takes/t1.wav", seconds: 12, recordedAt: "", words, transcribed: true, keep: [{ start: 0.8, end: 3.75 }, { start: 5.8, end: 11 }] }]);
    const clips = organiseCut(s, long, covers(s), { id: "x", name: "x" }).seq.audio[0]!.clips;
    expect(clips.map((c) => [c.start, c.end])).toEqual([
      [0.88, 3.75],
      [5.8, r3(words.at(-1)!.end + 0.18)],
    ]);
    expect(clips[1]!.at).toBeCloseTo(3.75 - 0.88, 3);
  });

  test("a short's shared beat is read by the long beat's take", () => {
    const short: Cut = { id: "S", kind: "short", title: "The RPG", hook: "", beats: [{ id: "s1", text: "I nearly spent five years on the wrong game.", card: { kind: "text", text: "Five years" } }, { id: "s2", text: B2, from: "b2" }] };
    const s: Script = { ...script([{ file: "voice/takes/t1.wav", seconds: 30, recordedAt: "", words: said(`I nearly spent five years on the wrong game. ${B2}`, 1), transcribed: true }]), shorts: [short] };
    const { seq, missing } = organiseCut(s, short, covers(s), { id: "x-short-1", name: "x" });
    expect(missing).toEqual([]);
    expect(seq.audio[0]!.clips.length).toBe(2);
    // The shared beat's card is the long beat's sketch.
    expect(seq.overlay!.cards.map((c) => c.kind)).toEqual(["text", "image"]);
  });

  test("pictures become glyph builds; a beat with two splits at its sentence break", () => {
    const pic = (src: string, look: number) => ({ prompt: "p", candidates: [src], chosen: src, look });
    const withPics: Cut = { ...long, beats: [{ id: "b1", text: B1, pictures: [pic("cards/s/b1.png", 11)] }, { id: "b2", text: B2, pictures: [pic("cards/s/b2.png", 22), pic("cards/s/b2-p2.png", 33)] }, { id: "b3", text: B3 }] };
    const s = { ...script([{ file: "voice/takes/t1.wav", seconds: 30, recordedAt: "", words: said(`${B1} ${B2} ${B3}`, 1), transcribed: true }]), long: withPics };
    const { seq } = organiseCut(s, withPics, covers(s), { id: "x-long", name: "x" });
    const cards = seq.overlay!.cards;
    expect(cards.map((c) => [c.kind, c.src, c.seed])).toEqual([["build", "cards/s/b1.png", 11], ["build", "cards/s/b2.png", 22], ["build", "cards/s/b2-p2.png", 33]]);
    const clip2 = seq.audio[0]!.clips[1]!;
    // B2's first sentence ends on "all." (its 11th word): the second picture starts there.
    const allEnd = 1 + 19 * 0.3 + 11 * 0.3 - 0.05;
    expect(cards[2]!.at).toBeCloseTo(clip2.at + (allEnd - clip2.start), 2);
    expect(cards[1]!.at + cards[1]!.seconds).toBeCloseTo(cards[2]!.at, 2);
    // The last build holds through the beat with no picture.
    const clip3 = seq.audio[0]!.clips[2]!;
    expect(cards[2]!.at + cards[2]!.seconds).toBeCloseTo(clip3.at + (clip3.end - clip3.start), 2);
  });

  test("a split with no sentence break near the middle falls on the middle", () => {
    expect(splitPoint(said("one two three four five six", 0, 1), 0, 6)).toBe(3);
  });

  test("chapters: the first beat's opens the video with no card, a later one leaves a gap with its card", async () => {
    const { CHAPTER_CARD, youtubeChapters } = await import("@heroic/ascii-build");
    // Long enough for chapters: pad the beats' words out to minutes (only the spoken-length guess reads them).
    const pad = (t: string) => `${t} ${"and so on ".repeat(400)}`;
    const chap: Cut = { ...long, beats: [{ id: "b1", text: pad(B1), chapter: "The start" }, { id: "b2", text: B2 }, { id: "b3", text: pad(B3), chapter: "The turn" }] };
    const s = { ...script([{ file: "voice/takes/t1.wav", seconds: 30, recordedAt: "", words: said(`${B1} ${B2} ${B3}`, 1), transcribed: true }]), long: chap };
    const sc = new Map(s.takes.map((t) => [t.file, matchScript(t, { long: { ...chap, beats: long.beats }, shorts: [] })]));
    const { seq, chapters } = organiseCut(s, chap, sc, { id: "x-long", name: "x" });
    expect(seq.title).toBe("Three things");
    const cards = seq.overlay?.cards ?? [];
    const card = cards.find((c) => c.kind === "chapter");
    expect(card?.text).toBe("The turn");
    expect(card?.n).toBe(2);
    expect(cards.filter((c) => c.kind === "chapter").length).toBe(1);
    // The third beat's voice starts after the card's gap.
    const clips = seq.audio[0]!.clips;
    expect(clips[2]!.at).toBeCloseTo(card!.at + CHAPTER_CARD, 2);
    expect(chapters.map((c) => c.name)).toEqual(["The start", "The turn"]);
    expect(chapters[0]!.at).toBe(0);
    // Two chapters is under YouTube's three: no list.
    expect(youtubeChapters(chapters)).toBe("");
    expect(youtubeChapters([...chapters, { name: "The end", at: chapters[1]!.at + 60 }]).split("\n")[0]).toBe("0:00 The start");
  });
});
