import { describe, expect, test } from "bun:test";
import { cutSeconds, joinOverlap, makeCut, mergeSegments, outStarts, remapPieces, remapTime, sameCut, toOutput, toSource, wholeCut } from "./cut";
import type { Piece } from "./types";

// A 30s recording with 10–16 and 22–24 cut away, joins of 0.4s.
const cut = makeCut(
  [
    { start: 0, end: 10 },
    { start: 16, end: 22 },
    { start: 24, end: 30 },
  ],
  0.4,
);

describe("a cut", () => {
  test("pieces play end to end, each join overlapping", () => {
    expect(outStarts(cut)).toEqual([0, 9.6, 15.2]);
    expect(cutSeconds(cut)).toBe(21.2);
  });
  test("pieces that touch are one piece: a split alone is not a join", () => {
    expect(mergeSegments([{ start: 0, end: 4 }, { start: 4, end: 9 }, { start: 12, end: 15 }])).toEqual([{ start: 0, end: 9 }, { start: 12, end: 15 }]);
    expect(makeCut([{ start: 0, end: 4 }, { start: 4, end: 9 }], 0.4)).toEqual(wholeCut(9));
  });
  test("segments carry a start and an end and nothing else (they're written into the clip's sidecar)", () => {
    const kept = [{ start: 0, end: 4, kept: true }, { start: 6, end: 9, kept: true }];
    expect(makeCut(kept, 0.4).segments).toEqual([{ start: 0, end: 4 }, { start: 6, end: 9 }]);
  });
  test("a join is never longer than half a piece, never under a tenth", () => {
    expect(joinOverlap([{ start: 0, end: 10 }, { start: 12, end: 12.5 }], 0.4)).toBe(0.25);
    expect(joinOverlap([{ start: 0, end: 10 }, { start: 12, end: 12.1 }], 0.4)).toBe(0.1);
    expect(joinOverlap([{ start: 0, end: 10 }], 0.4)).toBe(0);
  });
});

describe("between the clocks", () => {
  test("output → source", () => {
    expect(toSource(cut, 5)).toBe(5);
    expect(toSource(cut, 9.6)).toBe(16); // the join: the arriving piece
    expect(toSource(cut, 12)).toBe(18.4);
    expect(toSource(cut, 20)).toBe(28.8);
    expect(toSource(cut, 25)).toBe(33.8); // past the end: keeps counting
  });
  test("source → output; what was cut away lands on the join", () => {
    expect(toOutput(cut, 5)).toBe(5);
    expect(toOutput(cut, 18.4)).toBe(12);
    expect(toOutput(cut, 13)).toBe(9.6);
    expect(toOutput(cut, 23)).toBe(15.2);
    expect(toOutput(cut, 33.8)).toBe(25);
  });
  test("there and back", () => {
    for (const t of [0, 3.3, 9.7, 14, 15.2, 21]) expect(toOutput(cut, toSource(cut, t))).toBeCloseTo(t, 3);
  });
});

describe("the voice follows the footage", () => {
  const whole = wholeCut(30);
  const voice: Piece[] = [
    { take: 0, start: 0, end: 3, at: 2 },
    { take: 0, start: 3, end: 5, at: 17 },
    { take: 1, start: 0, end: 4, at: 25 },
  ];
  test("cut footage out of the middle and the voice after it moves up by as much", () => {
    const out = remapPieces(voice, whole, cut);
    expect(out.map((p) => p.at)).toEqual([2, 10.6, 16.2]);
    // Still over the same footage.
    expect(out.map((p) => toSource(cut, p.at))).toEqual([2, 17, 25]);
  });
  test("put the footage back and the voice goes back", () => {
    expect(remapPieces(remapPieces(voice, whole, cut), cut, whole).map((p) => p.at)).toEqual([2, 17, 25]);
  });
  test("voice over footage that was cut away waits at the join", () => {
    const out = remapPieces([{ take: 0, start: 0, end: 2, at: 12 }], whole, cut);
    expect(out[0]!.at).toBe(9.6);
  });
  test("pieces pushed together queue up, never overlap", () => {
    const out = remapPieces(
      [
        { take: 0, start: 0, end: 3, at: 11 },
        { take: 0, start: 3, end: 5, at: 14.5 },
      ],
      whole,
      cut,
    );
    expect(out.map((p) => p.at)).toEqual([9.6, 12.6]);
  });
  test("a piece past the end of the clip stays past it", () => {
    expect(remapPieces([{ take: 0, start: 0, end: 2, at: 31 }], whole, cut)[0]!.at).toBe(22.2);
  });
  test("the playhead too", () => {
    expect(remapTime(17, whole, cut)).toBe(10.6);
  });
  test("same cut", () => {
    expect(sameCut(cut, makeCut(cut.segments, 0.4))).toBe(true);
    expect(sameCut(cut, makeCut(cut.segments, 0.2))).toBe(false);
    expect(sameCut(cut, whole)).toBe(false);
  });
});
