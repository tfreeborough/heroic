import { describe, expect, test } from "bun:test";
import { sourcesList, sourcesMarkdown } from "./scripts";

// Shaped like the "Is This Slop?" Doc (10-27): quoted on-screen lists inside chapters, a Sources section of
// quoted markdown links, one with brackets in its URL, one doubled up when it was copied, one with a Docs escape.
const SOURCE = `## Chapter 2: Like CGI

Two questions.

> 1. Are old school practical effects still used in filmmaking?
> 2. Did studios get better at when and where they used CGI?

## Sources (for the video description)

> * [RollerCoaster Tycoon (Wikipedia)](https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_(video_game))
> * [Over 18,000 games have come to Steam in 2025 (KitGuru)](https://www.kitguru.net/page/49/!https:/www.kitguru.net/gaming/matthew-wilson/over-18000-games-have-come-to-steam-in-2025/)
> * [Report: AAA games now cost \\$300+ million (Dark Horizons)](https://www.darkhorizons.com/?p=190830)
> * Wayback copy: https://web.archive.org/web/2024/https://example.com/post.
> * Just a note to myself
`;

const finding = (url: string, status: "accepted" | "rejected", title = "A finding") =>
  ({ status, stance: "supports", source: { url, title, publisher: "PC Gamer" } }) as never;

describe("sourcesList", () => {
  const list = sourcesList({ source: SOURCE, research: { findings: [finding("https://pcgamer.com/a", "accepted"), finding("https://pcgamer.com/b", "rejected")] } as never });

  test("every source is a link: notes and on-screen lists without one are left out", () => {
    expect(list.every((x) => /^https?:\/\/[^\s]+\.[^\s]+/.test(x.url))).toBe(true);
    expect(list.map((x) => x.title).join(" ")).not.toMatch(/practical effects|get better|note to myself/);
  });

  test("brackets inside a URL survive, and come out percent-encoded", () => {
    expect(list[0]).toEqual({ title: "RollerCoaster Tycoon (Wikipedia)", url: "https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_(video_game)" });
    expect(sourcesMarkdown(list)).toContain("- [RollerCoaster Tycoon (Wikipedia)](https://en.wikipedia.org/wiki/RollerCoaster_Tycoon_%28video_game%29)");
  });

  test("a doubled-up copied link keeps the real address", () => {
    expect(list[1]!.url).toBe("https://www.kitguru.net/gaming/matthew-wilson/over-18000-games-have-come-to-steam-in-2025/");
  });

  test("Docs escapes come off titles", () => {
    expect(list[2]!.title).toBe("Report: AAA games now cost $300+ million (Dark Horizons)");
  });

  test("an archive link keeps its inner address, bare URLs lose trailing stops", () => {
    expect(list[3]).toEqual({ title: "Wayback copy", url: "https://web.archive.org/web/2024/https://example.com/post" });
  });

  test("accepted findings join, rejected ones don't", () => {
    expect(list.map((x) => x.url)).toContain("https://pcgamer.com/a");
    expect(list.map((x) => x.url)).not.toContain("https://pcgamer.com/b");
    expect(list).toHaveLength(5);
  });

  test("every markdown line is a well-formed link", () => {
    const lines = sourcesMarkdown(list).split("\n").slice(2);
    for (const l of lines) expect(l).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^\s()]+\)$/);
  });
});
