import { describe, expect, test } from "bun:test";
import { lookFromSeed } from "@heroic/ascii-build";
import { lookFor } from "../../autosave-promos/src/Save";
import { CHAPTER_GAP, LONG_BEAT, allowedChapters, castIn, castRefOf, pictureStyleOf, picturesWanted } from "./scripts";

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
  test("Tom's own chapters show however short the video or close together", () => {
    const beats = [beat("a", 60, "One"), beat("b", 60, "Two"), beat("c", 60, "Three"), beat("d", 60, "Four"), beat("e", 60, "Five")];
    expect([...allowedChapters(beats)]).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("never two within the gap: the first wins", () => {
    const beats = [beat("a", CHAPTER_GAP - 4, "One"), beat("b", 60, "Too soon"), beat("c", 60, "Two")];
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

describe("film stills: style and cast (11-05)", () => {
  const cast = [
    { name: "The Music Box", look: "A small plain wooden box the size of a loaf of bread with a brass crank handle on one side and a hinged lid that opens on a brass cylinder." },
    { name: "The Deluxe Music Box", look: "The same wooden music box grown bulky and ugly, bristling with a brass coin slot, a padlock on its crank, a bolted advert placard inside the lid and riveted metal bands." },
    { name: "The Girl", look: "A girl of about nine with two long braids and a pinafore dress over a short-sleeved blouse." },
  ];

  test("the prompt writer's list wins while the prompt is the one it was listed for", () => {
    const p = { prompt: "Close on a hand on a crank.", cast: ["The Music Box"], castFor: "Close on a hand on a crank." };
    expect(castIn(p, cast)).toEqual(["The Music Box"]);
    // Edited since: the list no longer counts, the words do.
    expect(castIn({ ...p, prompt: "An empty street at night." }, cast)).toEqual([]);
  });

  test("an older or edited prompt finds the cast whose looks it writes out, the deluxe box over the plain one", () => {
    const prompt = `${cast[2]!.look.replace(/\.$/, "")} frowns at ${cast[1]!.look.charAt(0).toLowerCase()}${cast[1]!.look.slice(1)}`;
    expect(castIn({ prompt }, cast).sort()).toEqual(["The Deluxe Music Box", "The Girl"]);
  });

  test("a script with woodcut pictures stays woodcut; a new one is conté; a set style wins", () => {
    const beat = (made: boolean) => ({ id: "b", text: "", pictures: [{ prompt: "x", candidates: made ? ["cards/a.png"] : [], look: 1 }] });
    const long = (made: boolean) => ({ id: "l", kind: "long" as const, title: "", beats: [beat(made)] });
    expect(pictureStyleOf({ long: long(true) } as never)).toBe("woodcut");
    expect(pictureStyleOf({ long: long(false) } as never)).toBe("conte");
    expect(pictureStyleOf({ long: long(true), pictureStyle: "film" } as never)).toBe("film");
  });

  test("a reference only counts for the look and the style it was made for", () => {
    const ref = { look: cast[2]!.look, candidates: ["cards/g.png"], chosen: "cards/g.png" };
    // An older reference with no style was a film still.
    const film = { pictureStyle: "film" as const, castRefs: { "The Girl": ref } };
    expect(castRefOf(film, cast[2]!)).toBe("cards/g.png");
    expect(castRefOf(film, { ...cast[2]!, look: "A girl in a raincoat." })).toBeUndefined();
    expect(castRefOf({ pictureStyle: "conte", castRefs: { "The Girl": ref } }, cast[2]!)).toBeUndefined();
    expect(castRefOf({ pictureStyle: "conte", castRefs: { "The Girl": { ...ref, style: "conte" as const } } }, cast[2]!)).toBe("cards/g.png");
  });
});

describe("a page save keeps the picture style (11-05)", () => {
  test("every style the Desk knows survives updateScript, and nothing else does", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveScript, updateScript, readScript } = await import("./scriptsStore");
    const { PICTURE_STYLES, emptyScript } = await import("./scripts");
    const root = mkdtempSync(join(tmpdir(), "desk-style-"));
    try {
      const g = { id: "t", root, rendersDir: "r" } as unknown as Parameters<typeof saveScript>[0];
      saveScript(g, { ...emptyScript("k", "t"), pictureStyle: "film" });
      for (const style of Object.keys(PICTURE_STYLES) as (keyof typeof PICTURE_STYLES)[]) {
        updateScript(g, "k", { pictureStyle: style });
        expect(readScript(g, "k")!.pictureStyle).toBe(style);
      }
      updateScript(g, "k", { pictureStyle: "watercolour" as never });
      expect(readScript(g, "k")!.pictureStyle).toBe("woodcut");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
