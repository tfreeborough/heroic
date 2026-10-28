import { describe, expect, test } from "bun:test";
import { cleanDocMarkdown, docHeadings, docTitle, forRewrite, spokenText, stripMarks } from "./doc";
import { sentences, weave } from "./research";

// Roughly what Google's markdown export looks like: escaped stops and dashes, bold headings, an inline image with its base64 at the bottom.
const EXPORT = `# **How does cheating work?**

Most cheats aren't clever\\. They're *patient*\\.
They wait for a server that trusts them\\.

## Client broadcast

In **client broadcast** every player tells everyone else what happened \\- and nobody checks\\. A cheat costs \\$30\\.

![][image1]

* It's cheap
* It's fast

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk>
`;

describe("cleanDocMarkdown", () => {
  const md = cleanDocMarkdown(EXPORT);
  test("undoes the escapes and drops images and their data", () => {
    expect(md).toContain("Most cheats aren't clever. They're *patient*.");
    expect(md).toContain("what happened - and nobody checks. A cheat costs $30.");
    expect(md).not.toContain("image1");
    expect(md).not.toContain("base64");
  });
  test("keeps headings, bold and lists; no trailing spaces or piled-up blank lines", () => {
    expect(md).toStartWith("# **How does cheating work?**");
    expect(md).toContain("## Client broadcast");
    expect(md).toContain("* It's cheap");
    expect(md).not.toMatch(/[ \t]$/m);
    expect(md).not.toContain("\n\n\n");
  });
});

describe("what's said", () => {
  const md = cleanDocMarkdown(EXPORT);
  test("spokenText drops the headings and the marks", () => {
    const said = spokenText(md);
    expect(said).not.toContain("Client broadcast\n");
    expect(said).not.toContain("How does cheating work");
    expect(said).toContain("They're patient.");
    expect(said).toContain("In client broadcast every player");
    expect(said).not.toContain("*");
  });

  test("stripMarks leaves lone asterisks and snake_case alone", () => {
    expect(stripMarks("5 * 3 is my_var_name")).toBe("5 * 3 is my_var_name");
    expect(stripMarks("a [link](https://x.y) and __bold__")).toBe("a link and bold");
  });

  test("headings aren't sentences, so research never anchors to one", () => {
    const list = sentences(md).map((s) => s.text);
    expect(list.some((t) => t.includes("Client broadcast") && t.startsWith("#"))).toBe(false);
    expect(list[0]).toBe("Most cheats aren't clever.");
  });

  test("an addition weaves in after a sentence with marks in it", () => {
    const f = { id: "a", anchor: "They're patient.", text: "Added.", status: "accepted" as const, stance: "supports" as const };
    expect(weave(md, [f]).text).toContain("They're *patient*. Added.");
  });
});

describe("headings for chapters", () => {
  test("each heading with the start of what's said after it", () => {
    expect(docHeadings(cleanDocMarkdown(EXPORT))).toEqual([
      { heading: "How does cheating work?", before: "Most cheats aren't clever. They're patient." },
      { heading: "Client broadcast", before: "In client broadcast every player tells everyone else what happened - and nobody checks." },
    ]);
  });
  test("a heading with nothing after it is skipped", () => {
    expect(docHeadings("Words.\n\n# The end")).toEqual([]);
  });
  test("the export's extension comes off the name", () => {
    expect(docTitle("How does cheating work in multiplayer games?.md")).toBe("How does cheating work in multiplayer games?");
  });
});

// The shapes Tom's real Docs have (pulled 2026-10-17): an older Doc with bold lines for sections, a newer one with a Sources list.
const OLDER = `**How does cheating work in multiplayer games?**

Have you ever wondered why some games have cheaters?

**Client Broadcast**  
Client broadcast is all about peer to peer \\+ trust\\.

**That's the whole trick.**
`;
const NEWER = `# **Why Most Mobile Games Fail — Script**

## **Outro**

Thanks for watching\\!

## **Sources (for the video description)**

> * [2025 App Store Transparency Report (Apple)](https://images.apple.com/legal/app-store/transparency/2025/)  
> * [Liftoff Casual Gaming Apps Report 2023](https://gamedevreports.substack.com/p/liftoff)
`;

describe("Tom's real Docs", () => {
  test("a short bold-only line is a heading; a bold sentence that ends in a stop is said", () => {
    const md = cleanDocMarkdown(OLDER);
    expect(md).toStartWith("## How does cheating work in multiplayer games?");
    expect(md).toContain("## Client Broadcast\nClient broadcast is all about peer to peer + trust.");
    expect(md).toContain("**That's the whole trick.**");
    expect(spokenText(md)).toContain("That's the whole trick.");
    expect(docHeadings(md).map((h) => h.heading)).toEqual(["How does cheating work in multiplayer games?", "Client Broadcast"]);
  });

  test("a Sources section is never said, never rewritten, never a sentence, never a chapter", () => {
    const md = cleanDocMarkdown(NEWER);
    expect(spokenText(md)).toBe("Thanks for watching!");
    expect(forRewrite(md)).not.toContain("Sources");
    expect(forRewrite(md)).not.toContain("http");
    expect(forRewrite(md)).toContain("## **Outro**");
    expect(sentences(md).map((x) => x.text)).toEqual(["Thanks for watching!"]);
    expect(docHeadings(md).map((h) => h.heading)).toEqual(["Outro"]);
  });

  test("forRewrite of a plain paste is the paste", () => {
    const paste = "One line.\n\nAnother line.";
    expect(forRewrite(paste)).toBe(paste);
  });
});
