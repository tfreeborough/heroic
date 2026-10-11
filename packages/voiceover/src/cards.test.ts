import { describe, expect, test } from "bun:test";
import { type Sequence, cardAt, cardEnd, cardOf, emptySequence, fitCard, moveCard, placeCard, removeCards, sequenceSeconds, shiftClips, snapPoints, splitCardAt, trimCardEnd, trimCardStart } from "./sequence";

const base = (): Sequence => emptySequence("e", "Edit");
const text = (t: string, seconds = 4) => cardOf("text", { text: t }, seconds);

describe("cards on the overlay track", () => {
  test("a card lands where asked and the sequence is as long as it", () => {
    const s = placeCard(base(), text("one"), 2);
    expect(s.overlay?.cards.length).toBe(1);
    expect(s.overlay!.cards[0]!.at).toBe(2);
    expect(sequenceSeconds(s)).toBe(6);
  });

  test("cards never overlap: dropped onto a card, the second goes to the nearest free spot", () => {
    const a = placeCard(base(), text("a"), 0);
    const b = placeCard(a, text("b"), 1);
    expect(b.overlay!.cards.map((c) => c.at)).toEqual([0, 4]);
  });

  test("dropped near the end of a gap, a card slides back so it fits whole", () => {
    let s = placeCard(base(), text("a", 4), 0);
    s = placeCard(s, text("b", 4), 10);
    s = placeCard(s, text("c", 4), 9); // 4..10 is free; at 9 it would hit b
    expect(s.overlay!.cards.find((x) => x.text === "c")!.at).toBe(6);
  });

  test("a card that fits nowhere at its length is cut down to the gap", () => {
    let s = placeCard(base(), text("a", 4), 0);
    s = placeCard(s, text("b", 4), 6);
    // Two seconds free between them: a four-second card asked for at 4 becomes a two-second one.
    s = placeCard(s, text("c", 4), 4);
    const c = s.overlay!.cards.find((x) => x.text === "c")!;
    expect(c.at).toBe(4);
    expect(c.seconds).toBe(2);
  });

  test("dropped onto a card with no gap anywhere but the end: it goes on the end", () => {
    let s = placeCard(base(), text("a", 4), 0);
    s = placeCard(s, text("b", 4), 4);
    s = placeCard(s, text("c", 4), 2);
    expect(s.overlay!.cards.map((c) => [c.text, c.at])).toEqual([["a", 0], ["b", 4], ["c", 8]]);
  });

  test("a sliver of a gap takes nothing", () => {
    let s = placeCard(base(), text("a", 4), 0);
    s = placeCard(s, text("b", 4), 4.1);
    s = placeCard(s, text("c", 4), 4.05);
    expect(s.overlay!.cards.length).toBe(2);
  });

  test("move stops at a neighbour, trims stop at slivers and neighbours", () => {
    let s = placeCard(base(), text("a", 4), 0);
    s = placeCard(s, text("b", 4), 6);
    const b = s.overlay!.cards[1]!;
    s = moveCard(s, b.id, 3); // wants 3, a ends at 4
    expect(s.overlay!.cards[1]!.at).toBe(4);
    s = trimCardStart(s, b.id, 2); // can't go into a
    expect(s.overlay!.cards[1]!.at).toBe(4);
    s = trimCardEnd(s, b.id, 100); // nothing after it: it may grow
    expect(cardEnd(s.overlay!.cards[1]!)).toBe(100);
    s = trimCardEnd(s, s.overlay!.cards[0]!.id, 100); // a stops at b
    expect(cardEnd(s.overlay!.cards[0]!)).toBe(4);
  });

  test("the end trim grows freely when nothing follows", () => {
    let s = placeCard(base(), text("a", 4), 0);
    s = trimCardEnd(s, s.overlay!.cards[0]!.id, 9);
    expect(s.overlay!.cards[0]!.seconds).toBe(9);
  });

  test("split makes two of the same content; the left keeps the id", () => {
    let s = placeCard(base(), text("a", 4), 0);
    const id = s.overlay!.cards[0]!.id;
    s = splitCardAt(s, 1);
    expect(s.overlay!.cards.length).toBe(2);
    expect(s.overlay!.cards[0]!.id).toBe(id);
    expect(s.overlay!.cards[0]!.seconds).toBe(1);
    expect(s.overlay!.cards[1]!.at).toBe(1);
    expect(s.overlay!.cards[1]!.seconds).toBe(3);
    expect(s.overlay!.cards[1]!.text).toBe("a");
    expect(cardAt(s, 2.5)?.id).toBe(s.overlay!.cards[1]!.id);
  });

  test("cards move with a selection, and block it like audio", () => {
    let s = placeCard(base(), text("a", 2), 0);
    s = placeCard(s, text("b", 2), 5);
    const [a, b] = s.overlay!.cards;
    const moved = shiftClips(s, [a!.id], 2);
    expect(moved.overlay!.cards[0]!.at).toBe(2);
    // a can't go past b: it gets as far as it can.
    const blocked = shiftClips(s, [a!.id], 4);
    expect(blocked.overlay!.cards[0]!.at).toBeCloseTo(3, 1);
    expect(blocked.overlay!.cards[1]!.at).toBe(5);
    expect(b!.at).toBe(5);
  });

  test("snap points include the cards' edges; remove takes them out", () => {
    let s = placeCard(base(), text("a", 2), 1);
    expect(snapPoints(s, [])).toEqual([0, 1, 3]);
    expect(fitCard(s, 1.6, 1)).toBe(3);
    s = removeCards(s, [s.overlay!.cards[0]!.id]);
    expect(s.overlay!.cards.length).toBe(0);
  });
});
