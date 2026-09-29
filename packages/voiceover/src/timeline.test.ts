import { describe, expect, test } from "bun:test";
import { activeWord, bareWord, pageAt, pagesOf } from "./captions";
import { dropPiece, duckAt, layTake, movePiece, pieceEnd, piecesInVideo, placedWords, snapToGap, splitPiece, trimEnd, trimStart } from "./timeline";
import type { Piece, Take } from "./types";

const take = (seconds: number, words: [string, number, number][] = []): Take => ({
  file: "voice/takes/t.wav",
  seconds,
  recordedAt: "2026-09-29T12:00:00",
  words: words.map(([text, start, end]) => ({ text, start, end })),
});
const noOverlap = (pieces: Piece[]) => pieces.every((p, i) => i === 0 || p.at >= pieceEnd(pieces[i - 1]!) - 1e-6);

describe("split", () => {
  test("cuts the piece under the playhead into two that still line up", () => {
    const out = splitPiece([{ take: 0, start: 1, end: 5, at: 10 }], 12);
    expect(out).toEqual([
      { take: 0, start: 1, end: 3, at: 10 },
      { take: 0, start: 3, end: 5, at: 12 },
    ]);
  });
  test("ignores a playhead outside every piece, and a cut that leaves a sliver", () => {
    const pieces: Piece[] = [{ take: 0, start: 0, end: 4, at: 2 }];
    expect(splitPiece(pieces, 1)).toBe(pieces);
    expect(splitPiece(pieces, 2.01)).toBe(pieces);
  });
});

describe("move and trim", () => {
  const pieces: Piece[] = [
    { take: 0, start: 0, end: 2, at: 1 },
    { take: 0, start: 2, end: 4, at: 5 },
    { take: 0, start: 4, end: 5, at: 9 },
  ];
  test("a piece stops at its neighbours", () => {
    expect(movePiece(pieces, 1, 0)[1]!.at).toBe(3);
    expect(movePiece(pieces, 1, 20)[1]!.at).toBe(7);
    expect(movePiece(pieces, 0, -4)[0]!.at).toBe(0);
    expect(noOverlap(movePiece(pieces, 1, 8.5))).toBe(true);
  });
  test("the last piece moves freely to the right", () => {
    expect(movePiece(pieces, 2, 30)[2]!.at).toBe(30);
  });
  test("trimming the left edge keeps the rest of the piece where it was", () => {
    const out = trimStart(pieces, 1, 5.5)[1]!;
    expect(out).toEqual({ take: 0, start: 2.5, end: 4, at: 5.5 });
    expect(pieceEnd(out)).toBe(7);
  });
  test("the left edge can't reveal take that isn't there, or cross the neighbour", () => {
    expect(trimStart(pieces, 0, -3)[0]).toEqual({ take: 0, start: 0, end: 2, at: 1 });
    // piece 1 starts 2s into its take, so 2s more could be revealed — but the neighbour ends at 3.
    expect(trimStart(pieces, 1, 0)[1]).toEqual({ take: 0, start: 0, end: 4, at: 3 });
  });
  test("the right edge stops at the end of the take and at the neighbour", () => {
    expect(trimEnd(pieces, 0, 9, 5)[0]!.end).toBe(4); // neighbour at 5
    expect(trimEnd(pieces, 2, 99, 5)[2]!.end).toBe(5); // take is 5s long
    expect(trimEnd(pieces, 1, 5.5, 5)[1]!.end).toBe(2.5);
  });
  test("drop", () => {
    expect(dropPiece(pieces, 1)).toHaveLength(2);
  });
});

describe("recording over", () => {
  test("a new take lands on empty row untouched", () => {
    const out = layTake([{ take: 0, start: 0, end: 2, at: 0 }], 1, 3, 4);
    expect(out).toEqual([
      { take: 0, start: 0, end: 2, at: 0 },
      { take: 1, start: 0, end: 3, at: 4 },
    ]);
  });
  test("it trims what it covers at both ends and drops what it swallows", () => {
    const out = layTake(
      [
        { take: 0, start: 0, end: 3, at: 0 },
        { take: 0, start: 3, end: 4, at: 3.5 },
        { take: 0, start: 4, end: 8, at: 5 },
      ],
      1,
      4,
      2,
    );
    expect(out).toEqual([
      { take: 0, start: 0, end: 2, at: 0 },
      { take: 1, start: 0, end: 4, at: 2 },
      { take: 0, start: 5, end: 8, at: 6 },
    ]);
    expect(noOverlap(out)).toBe(true);
  });
  test("a take whose opening is skipped covers less of the row", () => {
    const out = layTake([{ take: 0, start: 0, end: 10, at: 0 }], 1, 2, 4, 0.5);
    expect(out[1]).toEqual({ take: 1, start: 0.5, end: 2, at: 4 });
    expect(out[2]).toEqual({ take: 0, start: 5.5, end: 10, at: 5.5 });
  });
  test("landing in the middle of one piece leaves both its ends", () => {
    const out = layTake([{ take: 0, start: 0, end: 10, at: 0 }], 1, 2, 4);
    expect(out.map((p) => [p.take, p.at, pieceEnd(p)])).toEqual([
      [0, 0, 4],
      [1, 4, 6],
      [0, 6, 10],
    ]);
  });
});

describe("the video's view", () => {
  test("pieces shift by startFrom; what hangs off either end is cut", () => {
    const out = piecesInVideo(
      [
        { take: 0, start: 0, end: 2, at: 0 },
        { take: 0, start: 2, end: 6, at: 3 },
        { take: 0, start: 6, end: 9, at: 9 },
      ],
      4,
      6,
    );
    expect(out).toEqual([
      { take: 0, start: 3, end: 6, at: 0 },
      { take: 0, start: 6, end: 7, at: 5 },
    ]);
  });
});

describe("words follow their piece", () => {
  const t = take(6, [
    ["So", 0.2, 0.4],
    ["he's", 0.5, 0.8],
    ["on", 0.9, 1.0],
    ["one", 1.1, 1.4],
    ["HP.", 1.5, 2.0],
    ["Nope.", 4.0, 4.6],
  ]);
  test("moved piece, moved words", () => {
    const words = placedWords({ takes: [t], captionNudgeMs: 0 }, [{ take: 0, start: 0, end: 6, at: 10 }]);
    expect(words.map((w) => [w.text, w.start])).toEqual([
      ["So", 10.2],
      ["he's", 10.5],
      ["on", 10.9],
      ["one", 11.1],
      ["HP.", 11.5],
      ["Nope.", 14],
    ]);
  });
  test("a split hands each half its own words; a dropped half takes its words with it", () => {
    const pieces = splitPiece([{ take: 0, start: 0, end: 6, at: 0 }], 3);
    const moved = movePiece(pieces, 1, 20);
    expect(placedWords({ takes: [t], captionNudgeMs: 0 }, moved).map((w) => [w.text, w.start, w.piece])).toEqual([
      ["So", 0.2, 0],
      ["he's", 0.5, 0],
      ["on", 0.9, 0],
      ["one", 1.1, 0],
      ["HP.", 1.5, 0],
      ["Nope.", 21, 1],
    ]);
    expect(placedWords({ takes: [t], captionNudgeMs: 0 }, dropPiece(pieces, 0)).map((w) => w.text)).toEqual(["Nope."]);
  });
  test("hidden words stay off the captions; the nudge shifts them all", () => {
    const hid: Take = { ...t, words: t.words.map((w, i) => (i === 0 ? { ...w, hidden: true } : w)) };
    const words = placedWords({ takes: [hid], captionNudgeMs: -100 }, [{ take: 0, start: 0, end: 6, at: 0 }]);
    expect(words[0]!.text).toBe("he's");
    expect(words[0]!.start).toBe(0.4);
    expect(placedWords({ takes: [hid], captionNudgeMs: 0 }, [{ take: 0, start: 0, end: 6, at: 0 }], { hidden: true })).toHaveLength(6);
  });
  test("a split asked for mid-word lands in the nearest gap", () => {
    const piece: Piece = { take: 0, start: 0, end: 6, at: 10 };
    // Inside "he's" (0.5–0.8): the gaps either side are at 0.45 and 0.85.
    expect(snapToGap(piece, t, 10.7)).toBe(10.85);
    expect(snapToGap(piece, t, 10.6)).toBe(10.45);
    // In the long silence, it stays where it was put.
    expect(snapToGap(piece, t, 13)).toBe(13);
  });
});

describe("ducking", () => {
  const pieces: Piece[] = [{ take: 0, start: 0, end: 2, at: 5 }];
  test("full level away from the voice, the dip while it speaks, eased between", () => {
    expect(duckAt(pieces, 0, 0.35)).toBe(1);
    expect(duckAt(pieces, 6, 0.35)).toBeCloseTo(0.35);
    const mid = duckAt(pieces, 4.875, 0.35, 0.25);
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(1);
    expect(duckAt(pieces, 7.3, 0.35)).toBe(1);
  });
  test("no voice, no dip", () => {
    expect(duckAt([], 3)).toBe(1);
  });
});

describe("pages", () => {
  const words = [
    { text: "So", start: 0.2, end: 0.4 },
    { text: "he's", start: 0.5, end: 0.8 },
    { text: "on", start: 0.9, end: 1.0 },
    { text: "one", start: 1.1, end: 1.4 },
    { text: "HP,", start: 1.5, end: 2.0 },
    { text: "and", start: 2.1, end: 2.3 },
    { text: "I", start: 2.3, end: 2.4 },
    { text: "think", start: 2.4, end: 2.7 },
    { text: "that's", start: 2.7, end: 3.0 },
    { text: "it.", start: 3.0, end: 3.3 },
    { text: "Nope.", start: 5.0, end: 5.6 },
  ];
  test("tiktok: three words at most, a new page after a sentence and after a pause", () => {
    const pages = pagesOf(words, "tiktok");
    expect(pages.map((p) => p.words.map((w) => w.text).join(" "))).toEqual(["So he's on", "one HP, and", "I think that's", "it.", "Nope."]);
    // A page hands over to the next without a gap while speech is continuous…
    expect(pages[0]!.end).toBe(pages[1]!.start);
    // …and clears during a silence rather than sitting there.
    expect(pages[3]!.end).toBeCloseTo(3.55);
    expect(pageAt(pages, 4.5)).toBeUndefined();
    expect(pageAt(pages, 5.2)!.words[0]!.text).toBe("Nope.");
  });
  test("regular: a sentence at a time", () => {
    const pages = pagesOf(words, "regular");
    expect(pages.map((p) => p.words.map((w) => w.text).join(" "))).toEqual(["So he's on one HP, and I think that's it.", "Nope."]);
  });
  test("regular: a long sentence turns the page at a comma once it's mostly full, and always before it overflows", () => {
    const long = "one two three four five six seven, eight nine ten eleven twelve thirteen fourteen fifteen sixteen".split(" ").map((text, i) => ({ text, start: i * 0.3, end: i * 0.3 + 0.25 }));
    const pages = pagesOf(long, "regular");
    expect(pages[0]!.words.map((w) => w.text).join(" ")).toBe("one two three four five six seven,");
    for (const p of pages) expect(p.words.map((w) => w.text).join(" ").length).toBeLessThanOrEqual(56);
  });
  test("regular: a breath ends the caption once there's a fair line up, rather than the character count doing it mid-phrase", () => {
    // No punctuation at all, as Whisper often writes speech: the pauses are all there is to go on.
    const said: [string, number, number][] = [
      ["captions", 5.32, 5.79], ["will", 5.79, 6.06], ["be", 6.06, 6.2], ["made", 6.2, 6.45], ["from", 6.45, 6.65], ["this", 6.65, 6.92],
      ["which", 7.32, 7.6], ["would", 7.6, 7.71], ["be", 7.71, 7.8], ["really", 7.8, 8.0], ["good", 8.0, 8.22],
      ["but", 9.07, 9.27], ["if", 9.27, 9.43], ["not", 9.43, 9.63],
    ];
    const pages = pagesOf(said.map(([text, start, end]) => ({ text, start, end })), "regular");
    expect(pages.map((p) => p.words.map((w) => w.text).join(" "))).toEqual(["captions will be made from this", "which would be really good", "but if not"]);
  });
  test("the lit word", () => {
    const page = pagesOf(words, "tiktok")[0]!;
    expect(activeWord(page, 0.1)).toBe(-1);
    expect(activeWord(page, 0.3)).toBe(0);
    expect(activeWord(page, 0.45)).toBe(0);
    expect(activeWord(page, 0.95)).toBe(2);
  });
  test("tiktok words lose trailing commas and stops, keep question marks", () => {
    expect(bareWord("HP,")).toBe("HP");
    expect(bareWord("it.")).toBe("it");
    expect(bareWord("really?")).toBe("really?");
  });
});
