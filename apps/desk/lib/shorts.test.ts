import { describe, expect, test } from "bun:test";
import type { Word } from "@heroic/voiceover";
import { matchScript } from "./match";
import { findPart, measureLong, organiseCut } from "./organise";
import { type Cut, type Script, beatsFromRefs, emptyScript, excerpt, hookBeats, longEdits, nudgeShort, pieceText, refsLabel, refsOf, refsOfPieces, renderableShort, shortBeats, shortLabel, shortRefsLabel, shortSeconds, toggleSentence, withHook } from "./scripts";

const long: Cut = {
  id: "L",
  kind: "long",
  title: "Three things",
  beats: [
    { id: "b1", text: "One thing I got wrong.", seconds: 12 },
    { id: "b2", text: "Another thing I got wrong, and it cost me a month.", seconds: 18.4 },
    { id: "b3", text: "The third one is the one I'd warn you about." },
    { id: "b4", text: "And that's the lot.", seconds: 5 },
  ],
};
const s: Script = { ...emptyScript("s", "t"), long };

describe("shorts (desk-shorts.md § 1)", () => {
  test("an excerpt is the long beats word for word, each pointing back at its long beat", () => {
    const beats = excerpt(s, [2, 3]);
    expect(beats.map((b) => b.from)).toEqual(["b2", "b3"]);
    expect(beats.map((b) => b.text)).toEqual([long.beats[1]!.text, long.beats[2]!.text]);
    expect(new Set(beats.map((b) => b.id)).size).toBe(2);
  });
  test("its span and seconds come from the long beats (a beat never timed is guessed from its words)", () => {
    const c: Cut = { id: "c", kind: "short", title: "", beats: excerpt(s, [2, 3]) };
    expect(shortBeats(s, c)).toEqual([2, 3]);
    expect(shortSeconds(s, c)).toBe(Math.round(18.4 + 4)); // 11 words / 2.6 ≈ 4s
  });
  test("a nudge widens or narrows by one beat, and never runs off the long cut or past the other end", () => {
    const c: Cut = { id: "c", kind: "short", title: "", beats: excerpt(s, [2, 3]) };
    expect(shortBeats(s, nudgeShort(s, c, "start", 1))).toEqual([1, 2, 3]);
    expect(shortBeats(s, nudgeShort(s, c, "end", 1))).toEqual([2, 3, 4]);
    expect(shortBeats(s, nudgeShort(s, c, "start", -1))).toEqual([3]);
    const one = nudgeShort(s, c, "start", -1);
    expect(nudgeShort(s, one, "start", -1)).toBe(one);
    const wide = nudgeShort(s, c, "start", 1);
    expect(nudgeShort(s, wide, "start", 1)).toBe(wide);
    // Beats that stay keep their ids; only the new one is new.
    expect(wide.beats.slice(1)).toEqual(c.beats);
  });
  test("two runs: the label shows the join, a nudge never repeats a beat", () => {
    const c: Cut = { id: "c", kind: "short", title: "", beats: excerpt(s, [1, 3, 4]) };
    expect(shortLabel(shortBeats(s, c))).toBe("1 + 3–4");
    expect(nudgeShort(s, c, "start", 1)).toBe(c);
    expect(shortBeats(s, nudgeShort(s, c, "end", -1))).toEqual([1, 3]);
  });
  test("a nudge keeps the short's own beats (a hook) in front", () => {
    const c: Cut = { id: "c", kind: "short", title: "", beats: [{ id: "h", text: "I lost a month to this." }, ...excerpt(s, [2])] };
    const next = nudgeShort(s, c, "end", 1);
    expect(next.beats[0]).toEqual(c.beats[0]);
    expect(shortBeats(s, next)).toEqual([2, 3]);
  });
});

describe("hooks (desk-shorts.md § 2)", () => {
  test("a hook is the line on screen and a beat of its own in front; the beat keeps its id when the words change; empty takes it away", () => {
    const c: Cut = { id: "c", kind: "short", title: "", state: "kept", beats: excerpt(s, [2, 3]) };
    const a = withHook(c, "  I lost a month   to this. ");
    expect(a.hook).toBe("I lost a month to this.");
    expect(a.beats[0]!.from).toBeUndefined();
    expect(a.beats.slice(1)).toEqual(c.beats);
    const b = withHook(a, "I lost two months to this.");
    expect(b.beats[0]!.id).toBe(a.beats[0]!.id);
    expect(b.beats[0]!.changed).toBe(true);
    expect(withHook(b, "").beats).toEqual(c.beats);
    expect(hookBeats({ shorts: [b, { ...c, id: "d", state: "suggested" }] }).map((x) => x.beat.text)).toEqual(["I lost two months to this."]);
  });
});

describe("a short's own edit (desk-shorts.md § 3)", () => {
  const pictured: Cut = {
    ...long,
    beats: long.beats.map((b, i) => ({ ...b, chapter: i === 1 ? "Mistakes" : undefined, mood: { mood: "focus", intensity: 0.5 }, pulled: ["thing"], pictures: [{ prompt: "p", candidates: [`cards/${b.id}.png`], chosen: `cards/${b.id}.png`, look: i + 1 }] })),
  };
  const ps: Script = { ...emptyScript("s", "t"), long: pictured, gap: 0.3 };
  test("excerpt beats look through to their long beats' pictures and moods, chapters stay out, the hook borrows the first picture", () => {
    const c = withHook({ id: "c", kind: "short", title: "", beats: excerpt(ps, [2, 3]) }, "Here's the one that cost a month.");
    const r = renderableShort(ps, c);
    expect(r.beats.map((b) => b.pictures?.[0]?.chosen)).toEqual(["cards/b2.png", "cards/b2.png", "cards/b3.png"]);
    expect(r.beats.map((b) => b.chapter)).toEqual([undefined, undefined, undefined]);
    expect(r.beats[0]!.pulled).toBeUndefined();
    expect(r.beats[1]!.pulled).toEqual(["thing"]);
    expect(r.beats.map((b) => b.mood?.mood)).toEqual(["focus", "focus", "focus"]);
    // The words, ids and `from` are untouched: the takes still read it.
    expect(r.beats.map((b) => [b.id, b.from, b.text])).toEqual(c.beats.map((b) => [b.id, b.from, b.text]));
  });
  test("organised, the hook and the first beat share one build that runs through both", () => {
    const said = (text: string, from = 0, step = 0.3): Word[] => text.split(/\s+/).map((w, i) => ({ text: w, start: from + i * step, end: from + (i + 1) * step - 0.05 }));
    const hook = "Here's the one that cost a month.";
    const c = withHook({ id: "c", kind: "short", title: "", beats: excerpt(ps, [2, 3]) }, hook);
    const s2: Script = { ...ps, shorts: [c], takes: [{ file: "voice/takes/t1.wav", seconds: 40, recordedAt: "", words: said(`${hook} ${long.beats[1]!.text} ${long.beats[2]!.text}`, 1), transcribed: true }] };
    const covers = new Map(s2.takes.map((t) => [t.file, matchScript(t, s2)]));
    const { seq, missing, conflicts, laid } = organiseCut(s2, renderableShort(s2, c), covers, { id: "x", name: "x" });
    expect(missing).toEqual([]);
    expect(conflicts).toEqual([]);
    const builds = seq.overlay!.cards.filter((k) => k.kind === "build");
    expect(builds.map((k) => k.src)).toEqual(["cards/b2.png", "cards/b3.png"]);
    // One build from the hook's start until the next picture arrives (cards run up to the next card), pulled words carried over.
    expect(builds[0]!.at).toBe(0);
    expect(builds[0]!.seconds).toBeCloseTo(laid[2]!.at, 2);
    expect(laid[2]!.at).toBeGreaterThan(laid[1]!.at + laid[1]!.seconds);
    expect(builds[0]!.pulled).toEqual(["thing"]);
    expect(seq.overlay!.cards.some((k) => k.kind === "chapter")).toBe(false);
  });
  test("the long video's edits are told apart from the shorts' own", () => {
    expect(longEdits({ sequences: [{ id: "a", cut: "L", run: 1, at: "", missing: 0, conflicts: 0 }, { id: "b", cut: "c", run: 1, at: "", missing: 0, conflicts: 0, short: "c" }] }).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("by sentence (desk-shorts.md § 6)", () => {
  const said = (text: string, from = 0, step = 0.3): Word[] => text.split(/\s+/).map((w, i) => ({ text: w, start: from + i * step, end: from + (i + 1) * step - 0.05 }));
  const L: Cut = {
    id: "L",
    kind: "long",
    title: "Clones",
    beats: [
      { id: "c1", text: "I spent a year on this game. It was hard going." },
      { id: "c2", text: "Then the clones arrived. They copied everything I made. And that's what we're going to do with our game." },
      { id: "c3", text: "So I hid fake details in it. The copycats copied those too." },
    ],
  };
  const all = L.beats.map((b) => b.text).join(" ");
  const base: Script = { ...emptyScript("s", "t"), long: L, gap: 0.3, takes: [{ file: "voice/takes/t1.wav", seconds: 60, recordedAt: "", words: said(all, 1), transcribed: true }] };
  const coversOf = (x: Script) => new Map(x.takes.map((t) => [t.file, matchScript(t, x)]));
  const measured: Script = { ...base, long: { ...L, beats: measureLong(base, coversOf(base)) } };

  test("a long beat is measured into its sentences as recorded, their seconds adding up to about the beat's", () => {
    const b2 = measured.long!.beats[1]!;
    expect(b2.sentences!.map((x) => x.text)).toEqual(["Then the clones arrived.", "They copied everything I made.", "And that's what we're going to do with our game."]);
    const sum = b2.sentences!.reduce((n, x) => n + x.seconds, 0);
    expect(Math.abs(sum - b2.seconds!)).toBeLessThan(0.3);
  });

  test("pieces read as sentence numbers, whole beats stay whole, and the label says which", () => {
    const refs = refsOfPieces(measured, [
      { from: "2.1", to: "2.2" },
      { from: "3", to: "3" },
    ])!;
    expect(refs).toEqual([{ n: 2, k: 1 }, { n: 2, k: 2 }, { n: 3, k: 1 }, { n: 3, k: 2 }]);
    const beats = beatsFromRefs(measured, refs);
    expect(beats.map((b) => [b.from, b.part?.first, b.part?.last])).toEqual([["c2", 1, 2], ["c3", undefined, undefined]]);
    expect(beats[0]!.part!.said).toBe("Then the clones arrived. They copied everything I made.");
    const c: Cut = { id: "x", kind: "short", title: "", beats };
    // 2.1–2.2 runs straight on into 3? No: 2.3 sits between, so it's two pieces.
    expect(shortRefsLabel(measured, c)).toBe("2.1–2.2 + 3");
    expect(refsLabel(measured, [{ n: 1, k: 1 }, { n: 1, k: 2 }, { n: 2, k: 1 }])).toBe("1.1–2.1");
    expect(refsLabel(measured, refsOfPieces(measured, [{ from: "1", to: "2" }])!)).toBe("1–2");
    expect(refsOfPieces(measured, [{ from: "2.3", to: "2.1" }])).toBeUndefined();
    expect(refsOfPieces(measured, [{ from: "2.9", to: "2.9" }])).toBeUndefined();
    expect(pieceText(measured, beats[1]!)).toBe(L.beats[2]!.text);
  });

  test("a sentence toggles out and back, the beat splitting round it and joining again with its id", () => {
    const c: Cut = { id: "x", kind: "short", title: "", beats: excerpt(measured, [2]) };
    const id = c.beats[0]!.id;
    const out = toggleSentence(measured, c, { n: 2, k: 3 });
    expect(out.beats.map((b) => [b.id, b.part?.first, b.part?.last])).toEqual([[id, 1, 2]]);
    const mid = toggleSentence(measured, c, { n: 2, k: 2 });
    expect(mid.beats.map((b) => [b.part?.first, b.part?.last])).toEqual([[1, 1], [3, 3]]);
    expect(shortRefsLabel(measured, mid)).toBe("2.1 + 2.3");
    const back = toggleSentence(measured, mid, { n: 2, k: 2 });
    expect(back.beats.map((b) => [b.from, b.part])).toEqual([["c2", undefined]]);
    expect(back.beats[0]!.id).toBe(id);
    // The last sentence never goes.
    const one = toggleSentence(measured, toggleSentence(measured, out, { n: 2, k: 2 }), { n: 2, k: 1 });
    expect(refsOf(measured, one)).toEqual([{ n: 2, k: 1 }]);
  });

  test("a nudge moves a sentence at a time, across into the next beat", () => {
    const c: Cut = { id: "x", kind: "short", title: "", beats: beatsFromRefs(measured, refsOfPieces(measured, [{ from: "2.1", to: "2.2" }])!) };
    expect(shortRefsLabel(measured, nudgeShort(measured, c, "end", 1))).toBe("2");
    expect(shortRefsLabel(measured, nudgeShort(measured, c, "start", 1))).toBe("1.2–2.2");
    expect(shortRefsLabel(measured, nudgeShort(measured, c, "end", -1))).toBe("2.1");
  });

  test("organised, a part is only its sentences, a skipped line is left out, and the seconds match", () => {
    const c: Cut = { id: "x", kind: "short", title: "", beats: beatsFromRefs(measured, refsOfPieces(measured, [{ from: "2.1", to: "2.2" }, { from: "3.1", to: "3.2" }])!) };
    const s2: Script = { ...measured, shorts: [c] };
    const { seq, missing, laid } = organiseCut(s2, c, coversOf(s2), { id: "x", name: "x" });
    expect(missing).toEqual([]);
    const words = s2.takes[0]!.words;
    const heard = seq.audio[0]!.clips.flatMap((k) => words.filter((w) => w.start >= k.start - 1e-3 && w.end <= k.end + 1e-3).map((w) => w.text));
    expect(heard.join(" ")).toBe("Then the clones arrived. They copied everything I made. So I hid fake details in it. The copycats copied those too.");
    expect(Math.abs(laid[0]!.seconds - shortSeconds(s2, { beats: [c.beats[0]!] }))).toBeLessThan(1);
  });

  test("a jump forward inside one take carries none of the beats between", () => {
    const c: Cut = { id: "x", kind: "short", title: "", beats: excerpt(measured, [1, 3]) };
    const s2: Script = { ...measured, shorts: [c] };
    const { seq } = organiseCut(s2, c, coversOf(s2), { id: "x", name: "x" });
    const words = s2.takes[0]!.words;
    const heard = seq.audio[0]!.clips.flatMap((k) => words.filter((w) => w.start >= k.start - 1e-3 && w.end <= k.end + 1e-3).map((w) => w.text)).join(" ");
    expect(heard).not.toContain("clones");
    expect(heard).toContain("hard going.");
    expect(heard).toContain("copied those too.");
  });

  test("a part is found again by its words after a re-trim moves the sentences, and is missing once they're gone", () => {
    const sents = [{ text: "Um." }, { text: "Then the clones arrived." }, { text: "They copied everything I made." }];
    expect(findPart(sents, { first: 1, last: 2, said: "Then the clones arrived. They copied everything I made." })).toEqual({ first: 1, last: 2 });
    expect(findPart([{ text: "Something else entirely." }], { first: 1, last: 1, said: "Then the clones arrived." })).toBeUndefined();
  });

  test("a part's render pulls only the words it says", () => {
    const pl: Script = { ...measured, long: { ...measured.long!, beats: measured.long!.beats.map((b) => ({ ...b, pulled: ["clones", "game"] })) } };
    const c: Cut = { id: "x", kind: "short", title: "", beats: beatsFromRefs(pl, refsOfPieces(pl, [{ from: "2.1", to: "2.2" }])!) };
    const r = renderableShort(pl, c);
    expect(r.beats[0]!.pulled).toEqual(["clones"]);
    expect(r.beats[0]!.sentences).toBeUndefined();
  });
});

describe("a page save keeps the § 6 fields (desk-shorts.md § 6)", () => {
  test("parts, sentences, bin reasons and reshapes survive updateScript", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveScript, updateScript, readScript } = await import("./scriptsStore");
    const root = mkdtempSync(join(tmpdir(), "desk-store-"));
    try {
      const g = { id: "t", root, rendersDir: "r" } as unknown as Parameters<typeof saveScript>[0];
      saveScript(g, { ...emptyScript("k", "t"), long });
      const measuredLong: Cut = { ...long, beats: long.beats.map((b) => (b.id === "b2" ? { ...b, sentences: [{ text: "Another thing I got wrong,", seconds: 2 }, { text: "and it cost me a month.", seconds: 3 }] } : b)) };
      const short: Cut = { id: "x", kind: "short", title: "T", state: "binned", binReason: "ends flat", reshapedFrom: "y", beats: [{ id: "p", text: "", from: "b2", part: { first: 2, last: 2, said: "and it cost me a month." } }] };
      updateScript(g, "k", { long: measuredLong, shorts: [short] });
      const back = readScript(g, "k")!;
      expect(back.long!.beats[1]!.sentences).toEqual(measuredLong.beats[1]!.sentences!);
      expect(back.shorts[0]!.beats[0]!.part).toEqual({ first: 2, last: 2, said: "and it cost me a month." });
      expect(back.shorts[0]!.binReason).toBe("ends flat");
      expect(back.shorts[0]!.reshapedFrom).toBe("y");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
