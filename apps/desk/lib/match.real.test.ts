/**
 * The matcher and organise on Tom's real speech: the words Whisper heard
 * in the 17 takes of the 8 Oct authority-model video (fixtures/
 * authority-takes.json). The beats are built from the clean takes' own
 * transcripts, so what's under test is the mess around them: a passage
 * read twice, an abandoned start, a silent take, a mic test, a four-word
 * heading that also occurs inside a later sentence.
 */
import { describe, expect, test } from "bun:test";
import { matchScript } from "./match";
import { organiseCut } from "./organise";
import { type Cut, type Script, emptyScript } from "./scripts";
import fixture from "./fixtures/authority-takes.json";

const takes = fixture.takes.map((t) => ({ file: `voice/takes/authority-${t.n}.wav`, seconds: t.seconds, recordedAt: "", words: t.words, transcribed: true }));
const text = (n: number) => fixture.takes[n - 1]!.words.map((w) => w.text).join(" ");
/** The clean reading, in order: 11 not 12, 15 not 14, 10 not 9. */
const CLEAN = [1, 2, 3, 6, 7, 8, 10, 11, 13, 15, 16, 17];
const beats = CLEAN.flatMap((n) => {
  const sentences = text(n).split(/(?<=[.!?])\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(" "));
  return out;
});
const long: Cut = { id: "L", kind: "long", title: "Authority", beats: beats.map((t, i) => ({ id: `b${i + 1}`, text: t, card: i % 3 === 0 ? { kind: "text", text: `Point ${i + 1}` } : { kind: "none" } })) };
const s: Script = { ...emptyScript("auth", "Authority"), long, takes, gap: 0.3 };
const covers = new Map(s.takes.map((t) => [t.file, matchScript(t, s)]));
const of = (n: number) => covers.get(takes[n - 1]!.file)!.map((c) => c.beat);

describe("the matcher on real takes", () => {
  test("every clean take covers its own beats and nothing else", () => {
    expect(of(1)).toEqual(["b1"]);
    expect(of(6)).toEqual(["b4", "b5"]);
    expect(of(10)).toEqual(["b9", "b10", "b11"]);
    expect(of(11)).toEqual(["b12", "b13", "b14", "b15"]);
    expect(of(16)).toEqual(["b19"]);
    expect(of(17)).toEqual(["b20"]);
  });
  test("a four-word heading is found read on its own, not inside a later sentence", () => {
    expect(of(7)).toEqual(["b6"]);
    expect(of(14)).toEqual([]); // the abandoned start of 15 says "the server authority model" mid-sentence
    expect(of(15)).toEqual(["b17", "b18"]);
  });
  test("silence, a mic test and an abandoned start cover nothing", () => {
    expect(of(4)).toEqual([]);
    expect(of(5)).toEqual([]);
    expect(of(9)).toEqual([]);
  });
  test("a passage read twice is a conflict, and organise leaves it", () => {
    expect(of(12)).toEqual(["b12", "b13", "b14", "b15"]);
    const { seq, missing, conflicts } = organiseCut(s, long, covers, { id: "auth-long", name: "Authority" });
    expect(missing).toEqual([]);
    expect(conflicts.map((c) => c.beat)).toEqual(["b12", "b13", "b14", "b15"]);
    expect(seq.audio[0]!.clips.length).toBe(beats.length - 4);
    expect(seq.markers?.length).toBe(beats.length - 4);
    // Clips follow in time with the gap between, and every one is a sensible length.
    const clips = seq.audio[0]!.clips;
    for (let i = 1; i < clips.length; i++) expect(clips[i]!.at).toBeGreaterThan(clips[i - 1]!.at);
    for (const c of clips) expect(c.end - c.start).toBeGreaterThan(1);
    // The cards: one per planned beat that made it, each starting with its clip.
    const cards = seq.overlay!.cards;
    for (const card of cards) expect(clips.some((c) => Math.abs(c.at - card.at) < 1e-6)).toBe(true);
  });
});
