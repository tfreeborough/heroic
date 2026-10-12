import { describe, expect, test } from "bun:test";
import { lookFromSeed } from "@heroic/ascii-build";
import { lookFor } from "../../autosave-promos/src/Save";
import { CHAPTER_GAP, CHAPTERS_FROM, LONG_BEAT, allowedChapters, picturesWanted } from "./scripts";

/** A beat that takes about `seconds` to say (2.6 words a second). */
const said = (seconds: number) => Array.from({ length: Math.round(seconds * 2.6) }, () => "word").join(" ");
const beat = (id: string, seconds: number, chapter?: string) => ({ id, text: said(seconds), chapter });

describe("pictures", () => {
  test("a long beat wants a second picture", () => {
    expect(picturesWanted(said(LONG_BEAT - 2))).toBe(1);
    expect(picturesWanted(said(LONG_BEAT + 5))).toBe(2);
  });

  test("a look seed shuffles exactly as the Save template's does", () => {
    for (const seed of [1, 7, 42, 999, 9999]) expect(lookFromSeed(seed)).toEqual(lookFor({ seed, arrival: "shuffle", order: "shuffle" }));
  });
});

describe("chapters", () => {
  test("none in a short video", () => {
    const beats = [beat("a", 60, "Start"), beat("b", CHAPTERS_FROM - 120, "Later")];
    expect(allowedChapters(beats).size).toBe(0);
  });

  test("never two within the gap: the first wins", () => {
    const beats = [beat("a", 60, "One"), beat("b", CHAPTER_GAP - 30, "Too soon"), beat("c", 120, "Two"), beat("d", 300)];
    expect([...allowedChapters(beats)]).toEqual(["a", "c"]);
  });
});

describe("the review's diff", () => {
  test("a paragraph split over beats isn't shown as cut, a real cut is", async () => {
    const { cutDiff } = await import("./scripts");
    const source = "First I built the map. Then I added monsters. This sentence was dropped. Finally I added quests.";
    const fits = cutDiff(source, ["First I built the map.", "Then I added monsters.", "Finally I added quests."]);
    const struck = fits.flatMap((f) => f.ops.filter((o) => o.kind === "removed").map((o) => o.text));
    expect(struck).toEqual(["This sentence was dropped."]);
    // Keep mine gives a beat back its own words, not the whole paragraph.
    expect(fits[0]!.span).toBe("First I built the map.");
  });
});
