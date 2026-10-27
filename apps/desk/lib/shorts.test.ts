import { describe, expect, test } from "bun:test";
import type { Word } from "@heroic/voiceover";
import { matchScript } from "./match";
import { organiseCut } from "./organise";
import { type Cut, type Script, emptyScript, excerpt, hookBeats, longEdits, nudgeShort, renderableShort, shortBeats, shortLabel, shortSeconds, withHook } from "./scripts";

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
