import { describe, expect, test } from "bun:test";
import { type Finding, findingsWanted, forTheDoc, pageText, quoteOnPage, sentences, sourcesBlock, strayNumber, weave, wovenSource } from "./research";

const PASTE = `Most indie games never make their money back. That's the bit nobody tells you.

I spent two years on Blood in the Sand before anyone played it. "Was it worth it?" Probably not, on paper!
And yet I'd do it again`;

const finding = (over: Partial<Finding>): Finding => ({
  id: "f1",
  anchor: "Most indie games never make their money back.",
  text: "One survey found half of indie developers earn under a thousand dollars from their first game.",
  note: "",
  stance: "supports",
  strength: "strong",
  source: { url: "https://example.com/survey", title: "The survey", publisher: "Example", date: "2025" },
  quote: "half of respondents earned less than $1,000",
  check: "checked",
  status: "accepted",
  ...over,
});

describe("sentences", () => {
  test("splits at stops, line breaks and closing quotes, keeping where each sits", () => {
    const list = sentences(PASTE);
    expect(list.map((s) => s.text)).toEqual([
      "Most indie games never make their money back.",
      "That's the bit nobody tells you.",
      "I spent two years on Blood in the Sand before anyone played it.",
      '"Was it worth it?"',
      "Probably not, on paper!",
      "And yet I'd do it again",
    ]);
    for (const s of list) expect(PASTE.slice(s.start, s.end)).toBe(s.text);
  });

  test("a decimal isn't a sentence end", () => {
    expect(sentences("It made 2.5 times more. Then it stopped.").map((s) => s.text)).toEqual(["It made 2.5 times more.", "Then it stopped."]);
  });
});

describe("weave", () => {
  test("an accepted finding goes in after its anchor", () => {
    const { text, placed } = weave(PASTE, [finding({})]);
    expect(text).toStartWith("Most indie games never make their money back. One survey found half of indie developers earn under a thousand dollars from their first game. That's the bit");
    expect(placed.get("f1")).toBe("placed");
  });

  test("offered, rejected and refuting findings stay out", () => {
    for (const f of [finding({ status: "offered" }), finding({ status: "rejected" }), finding({ stance: "refutes" })]) expect(weave(PASTE, [f]).text).toBe(PASTE);
  });

  test("an anchor that differs only in case and punctuation still matches", () => {
    const { placed } = weave(PASTE, [finding({ anchor: "most indie games never make their money back" })]);
    expect(placed.get("f1")).toBe("placed");
  });

  test("words Tom already copied into his doc aren't put in twice", () => {
    const pasted = PASTE.replace("back.", "back. One survey found half of indie developers earn under a thousand dollars from their first game.");
    const { text, placed } = weave(pasted, [finding({})]);
    expect(text).toBe(pasted);
    expect(placed.get("f1")).toBe("inDoc");
  });

  test("an anchor Tom has cut makes the finding lost", () => {
    const { text, placed } = weave(PASTE.replace("Most indie games never make their money back. ", ""), [finding({})]);
    expect(placed.get("f1")).toBe("lost");
    expect(text).not.toContain("One survey");
  });

  test("two on one anchor go in list order; others keep their places", () => {
    const fs = [finding({ id: "a", text: "First." }), finding({ id: "b", text: "Second." }), finding({ id: "c", anchor: "Probably not, on paper!", text: "Third." })];
    const { text } = weave(PASTE, fs);
    expect(text).toContain("money back. First. Second. That's");
    expect(text).toContain("on paper! Third.\nAnd yet");
  });

  test("the last sentence (no stop) is an anchor too", () => {
    const { text } = weave(PASTE, [finding({ anchor: "And yet I'd do it again", text: "Last." })]);
    expect(text).toEndWith("And yet I'd do it again Last.");
  });

  test("wovenSource without research is the paste", () => {
    expect(wovenSource({ source: PASTE })).toBe(PASTE);
    expect(wovenSource({ source: PASTE, research: { findings: [finding({})] } })).toContain("One survey");
  });
});

describe("the quote check", () => {
  const page = pageText(`<html><head><style>p{}</style><script>var x = "half of respondents";</script></head>
    <body><p>In 2024, <b>half</b> of respondents earned less than&nbsp;$1,000 from their first game.</p>
    <p>Only 12% earned over $100,000. Most said they&rsquo;d do it again.</p></body></html>`);

  test("finds a quote across tags and entities, case and curly quotes aside", () => {
    expect(quoteOnPage("Half of respondents earned less than $1,000", page)).toBe(true);
    expect(quoteOnPage("Most said they'd do it again.", page)).toBe(true);
  });

  test("a quote that skips words with an ellipsis counts", () => {
    expect(quoteOnPage("half of respondents earned less than $1,000 … Only 12% earned over $100,000", page)).toBe(true);
  });

  test("a changed number fails", () => {
    expect(quoteOnPage("Only 15% earned over $100,000", page)).toBe(false);
    expect(quoteOnPage("half of respondents earned less than $10,000", page)).toBe(false);
  });

  test("words only in a script tag don't count", () => {
    expect(pageText('<script>var x = "never on the page at all";</script><p>hi</p>')).not.toContain("never on the page");
  });

  test("a number in the words to say that the quote hasn't got is flagged", () => {
    expect(strayNumber("Only 12 percent ever earn over 100,000 dollars.", "Only 12% earned over $100,000")).toBeUndefined();
    expect(strayNumber("Only 20 percent earn over 100,000 dollars.", "Only 12% earned over $100,000")).toBe("20");
    expect(strayNumber("A 2024 survey found 12 percent…", "Only 12% earned", "2024-03-01")).toBeUndefined();
  });
});

describe("how many", () => {
  test("one per two minutes spoken, at least one, at most eight", () => {
    expect(findingsWanted(30)).toBe(1);
    expect(findingsWanted(5 * 60)).toBe(3);
    expect(findingsWanted(10 * 60)).toBe(5);
    expect(findingsWanted(60 * 60)).toBe(8);
  });
});

describe("for the doc and the description", () => {
  test("copy for the doc lists what isn't in the paste yet, in script order", () => {
    const fs = [finding({ id: "b", anchor: "Probably not, on paper!", text: "Later." }), finding({ id: "a" }), finding({ id: "c", status: "offered", text: "Not yet." })];
    const out = forTheDoc(PASTE, fs);
    expect(out.indexOf("One survey")).toBeLessThan(out.indexOf("Later."));
    expect(out).not.toContain("Not yet.");
    expect(out).toContain('After "Most indie games never make their money back." add:');
  });

  test("sources: accepted ones, one line per page, with the year", () => {
    const out = sourcesBlock(PASTE, [finding({}), finding({ id: "x" }), finding({ id: "r", stance: "refutes", source: { url: "https://no.example", title: "", publisher: "No" } })]);
    expect(out).toBe('Sources\nExample, "The survey" (2025): https://example.com/survey');
  });
});
