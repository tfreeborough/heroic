import { describe, expect, test } from "bun:test";
import type { Word } from "@heroic/voiceover";
import { cutRegion, keptWords, matchTake, trimRegion } from "./match";

/** Words said one after another, 0.3s each from `from`. */
const said = (text: string, from = 0, step = 0.3): Word[] => text.split(/\s+/).map((t, i) => ({ text: t, start: from + i * step, end: from + (i + 1) * step - 0.05 }));

const beats = [
  { id: "b1", text: "Blood in the Sand wasn't always the game it is now. I changed my mind about three big things." },
  { id: "b2", text: "Originally it wasn't meant to be an arena game at all. I'd designed it as an open world RPG." },
  { id: "b3", text: "There'd be dozens of monsters, hundreds of items, and hundreds of talents. Quests, dungeons, you name it." },
  { id: "b4", text: "Looking back now, there really isn't a way to build that game on your own." },
];

describe("matching a take to the beats", () => {
  test("a take reading two beats straight through covers both, with their starts in take time", () => {
    const words = said(`${beats[1]!.text} ${beats[2]!.text}`, 2);
    const covers = matchTake({ words }, beats);
    expect(covers.map((c) => c.beat)).toEqual(["b2", "b3"]);
    expect(covers[0]!.start).toBe(2);
    expect(covers[1]!.start).toBeCloseTo(2 + 19 * 0.3, 2); // b2 is 19 words
    expect(covers[0]!.score).toBe(1);
  });

  test("a few dropped and changed words still count; half a beat doesn't", () => {
    const loose = "Originally it wasn't meant to be an arena game. I designed it as an open world RPG, like Warcraft.";
    expect(matchTake({ words: said(loose) }, beats).map((c) => c.beat)).toEqual(["b2"]);
    const half = "Originally it wasn't meant to be an arena game at all.";
    expect(matchTake({ words: said(half) }, beats)).toEqual([]);
  });

  test("punctuation and case never matter", () => {
    const words = said("blood in the sand WASN'T always the game it is now; i changed my mind about three big things!");
    expect(matchTake({ words }, beats)[0]?.beat).toBe("b1");
  });

  test("a beat's last words heard differently still end the cover at the last word said", () => {
    const words = said("Looking back now, there really isn't a way to build that game on yer lonesome.");
    const [c] = matchTake({ words }, beats);
    expect(c?.beat).toBe("b4");
    expect(c!.end).toBe(words.at(-1)!.end);
    // Spelled numbers and digits are the same word.
    expect(matchTake({ words: said("I changed my mind about 3 big things.") }, [{ id: "n", text: "I changed my mind about three big things." }])[0]?.score).toBe(1);
  });

  test("words outside the kept regions aren't heard", () => {
    const words = said(`${beats[0]!.text} ${beats[3]!.text}`);
    const all = matchTake({ words }, beats).map((c) => c.beat);
    expect(all).toEqual(["b1", "b4"]);
    const b1Seconds = 19 * 0.3; // b1 is 19 words
    const only = matchTake({ words, keep: [{ start: b1Seconds, end: 100 }] }, beats).map((c) => c.beat);
    expect(only).toEqual(["b4"]);
    expect(keptWords({ words, keep: [{ start: b1Seconds, end: 100 }] }).length).toBe(15);
  });

  test("a hidden word is not heard", () => {
    const words = said(beats[3]!.text).map((w, i) => (i < 6 ? { ...w, hidden: true } : w));
    expect(matchTake({ words }, beats)).toEqual([]);
  });
});

describe("kept regions", () => {
  test("cutting the middle out of a whole take leaves two regions", () => {
    expect(cutRegion(undefined, 10, { start: 4, end: 6 })).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
  });
  test("cutting across a region's edge shortens it; a cut over all of it removes it", () => {
    const keep = [
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ];
    expect(cutRegion(keep, 10, { start: 3, end: 7 })).toEqual([
      { start: 0, end: 3 },
      { start: 7, end: 10 },
    ]);
    expect(cutRegion(keep, 10, { start: 5, end: 11 })).toEqual([{ start: 0, end: 4 }]);
  });
  test("trimming the edges keeps only what's inside", () => {
    expect(trimRegion(undefined, 10, 1, 9)).toEqual([{ start: 1, end: 9 }]);
    expect(trimRegion([{ start: 0, end: 4 }, { start: 6, end: 10 }], 10, 2, 8)).toEqual([
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ]);
  });
});

describe("beats set by hand", () => {
  test("a take Tom says is beat 2 reads beat 2 across its kept part, even when nothing matches", async () => {
    const { assignedCovers, matchScript } = await import("./match");
    const { emptyScript } = await import("./scripts");
    const s = { ...emptyScript("s", "t"), long: { id: "L", kind: "long" as const, title: "t", beats: [{ id: "a", text: "the first beat here" }, { id: "b", text: "the second beat here" }, { id: "c", text: "the third beat here" }] } };
    const words = ["completely", "different", "words", "said"].map((text, i) => ({ text, start: 1 + i, end: 1.6 + i }));
    const take = { file: "t.wav", seconds: 8, recordedAt: "", words, transcribed: true };
    expect(matchScript(take, s)).toEqual([]);
    expect(matchScript({ ...take, assign: ["b"] }, s)).toEqual([{ beat: "b", start: 1, end: 4.6, score: 1 }]);
    // Two beats with nothing to align on share the take.
    const two = assignedCovers({ ...take, assign: ["b", "c"] }, s);
    expect(two.map((c) => c.beat)).toEqual(["b", "c"]);
    expect(two[0]!.start).toBe(1);
    expect(two[1]!.start).toBeCloseTo(two[0]!.end, 5);
    expect(two[1]!.end).toBe(4.6);
  });
});

describe("auto trim", () => {
  test("trims the ends, shortens a long pause, keeps a hand cut, and changes nothing the second time", async () => {
    const { autoTrim } = await import("./match");
    const w = (text: string, start: number, end: number) => ({ text, start, end });
    const take = { seconds: 20, words: [w("one", 2, 2.4), w("two", 2.5, 2.9), w("three", 6, 6.4), w("four", 6.5, 6.9), w("five", 12, 12.4)] };
    const keep = autoTrim(take)!;
    expect(keep[0]!.start).toBeCloseTo(1.85, 5);
    expect(keep.at(-1)!.end).toBeCloseTo(12.6, 5);
    // The 3.1s pause after "two" comes down to 0.4s.
    expect(keep[1]!.start - keep[0]!.end).toBeCloseTo(6 - 0.2 - (2.9 + 0.2), 5);
    expect(autoTrim({ ...take, keep })).toEqual(keep);
    // Tom cut "four" out by hand: it stays out.
    const cut = [{ start: 0, end: 6.45 }, { start: 6.95, end: 20 }];
    const again = autoTrim({ ...take, keep: cut })!;
    expect(again.some((k) => k.start <= 6.6 && k.end >= 6.8)).toBe(false);
    // Without pauses: just the ends.
    expect(autoTrim(take, false)).toEqual([{ start: 1.85, end: 12.6 }]);
  });
});
