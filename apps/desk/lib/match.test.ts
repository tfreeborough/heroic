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
