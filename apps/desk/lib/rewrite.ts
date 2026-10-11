/**
 * The Scripts tab's Claude calls: a pasted script → a long cut and some
 * short cuts, as beats, in Tom's voice; a re-paste → the cuts adjusted to
 * the change and nothing else; one beat or one cut redone to an
 * instruction; another short. Same client and shape as draft.ts (the
 * queue's words): structured output, the game's own voice from
 * desk.config, the key from ANTHROPIC_API_KEY in apps/desk/.env.
 *
 * Server only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type Beat, type BeatCard, type Cut, type Script, newId, tokens } from "./scripts";

export const hasClaude = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

/** What a game gives the rewriter: who's talking and how (desk.config `script.ai`). */
export type ScriptVoice = {
  /** One paragraph on the game and the person, for the model's own understanding. */
  about: string;
  /** The voice rules, plain prose. */
  rules: string;
  /** Lines actually written in the voice, if the game has none of the author's own scripts yet. Never invented ones. */
  examples?: string[];
  /** The fixed start of every sketch prompt (stage 3). */
  sketch?: string;
};

const MODEL = "claude-opus-5-5";

// ── output shapes ──

const BeatOut = z.object({ text: z.string().describe("The beat's words, as they'll be read aloud. One to three sentences.") });
const ShortBeatOut = z.object({
  text: z.string().describe("The beat's words. When sameAs is set, the long beat's exact words."),
  sameAs: z.number().nullable().describe("When this beat is a long beat read word for word: that beat's number (1 = the first long beat). null when the words are new or changed."),
});
const ShortOut = z.object({
  title: z.string().describe("The short's title, under 80 characters, no ALL CAPS, no hashtags."),
  hook: z.string().describe("The first thing said and the line on screen from the first frame: one sentence under 12 words that makes someone stay."),
  why: z.string().describe("One plain sentence on why this stands on its own as a video."),
  beats: z.array(ShortBeatOut).min(2),
});
const RewriteOut = z.object({
  longTitle: z.string().describe("The long video's title, under 80 characters, no ALL CAPS."),
  long: z.array(BeatOut).min(1).describe("The whole script, lightly edited to the voice, as beats in the author's order."),
  shorts: z.array(ShortOut).describe("As many shorts as the script naturally holds; may be one. Never pad."),
});

const KeptBeatOut = z.object({
  id: z.string().nullable().describe("The existing beat's id when this beat keeps that beat's place (words the same, or edited). null for a beat that is new."),
  text: z.string(),
});
const KeptShortBeatOut = KeptBeatOut.extend({ sameAs: z.number().nullable().describe("When this beat is a long beat read word for word: that beat's number in the NEW long cut. null otherwise.") });
const KeptShortOut = z.object({
  id: z.string().nullable().describe("The existing short's id when this is that short carried on; null for a new short."),
  title: z.string(),
  hook: z.string(),
  why: z.string(),
  beats: z.array(KeptShortBeatOut).min(2),
});
const AdjustOut = z.object({ longTitle: z.string(), long: z.array(KeptBeatOut).min(1), shorts: z.array(KeptShortOut) });

const OneBeatOut = z.object({ text: z.string() });
const CutOut = z.object({ title: z.string(), hook: z.string().nullable(), beats: z.array(BeatOut).min(1) });

// ── prompts ──

const BEAT_RULES = [
  "A BEAT is one thought: one to three sentences, roughly fifteen to forty words, a stretch that takes five to fifteen seconds to say. Every beat must read aloud on its own, because each is recorded on its own and a picture is hung on it.",
  "The long cut is the whole script, in the author's order, with every point kept. The job is a light edit to the voice, not a rewrite: keep the author's words wherever they already read well, fix what doesn't, and never invent a fact, a number or a feature that isn't in the source.",
  "A SHORT is a self-contained vertical video of forty-five to seventy-five seconds spoken (about a hundred and twenty to two hundred words). It opens with the hook, makes one point, and ends without a sign-off. Reuse long beats word for word wherever they stand alone (mark them sameAs), so one recording serves both cuts; write new words only for the opening, the joins and the close. Make as many shorts as the script naturally holds: one idea gives one short, three distinct points give three. Never pad a short with filler, and never make a short from a point that needs the rest of the script to make sense.",
].join("\n\n");

const system = (v: ScriptVoice, samples: string[]): string =>
  [
    "You edit video scripts for the one person who made the game, for videos they will read aloud themselves. A long video for YouTube (five minutes and up, landscape) and short vertical videos (TikTok, YouTube Shorts, Reels) come from one script.",
    "",
    `About the game and the person (for you, not for the script): ${v.about}`,
    "",
    ...(samples.length
      ? [
          "THE AUTHOR'S OWN SCRIPTS, in full, so you can hear exactly how they write. Their voice is these, not a tidier or more polished version of these. Match their sentence length, their asides, their way into a point, the words they reach for.",
          ...samples.map((s, i) => `--- script ${i + 1} ---\n${s}\n--- end ---`),
          "",
        ]
      : []),
    "The voice, in rules:",
    v.rules,
    ...(v.examples?.length && !samples.length ? ["", "Lines written in that voice:", ...v.examples.map((e) => `- ${e}`)] : []),
    "",
    "THE DEFAULT IS THE AUTHOR'S WORDS, WORD FOR WORD. A sentence that reads fine aloud comes back exactly as written. Change a sentence only when it would trip the author reading it (it runs on, it repeats a point, a word nobody says out loud), and then change as little of it as will fix that. Never add a flourish, a joke, a summary or a transition the author didn't write. A short's new words (its opening, its joins) are built from phrases the author already uses.",
    "",
    "Hard rules: first person singular, British spelling, everyday words, no em dashes, no ALL CAPS, no exclamation marks, no three-beat slogans, no coined aphorisms, no emoji, no hashtags, no headings or labels inside a beat, nothing in brackets that isn't to be read aloud. Spoken English: contractions are fine, a sentence can start with And or But.",
    "",
    BEAT_RULES,
  ].join("\n");

const client = () => new Anthropic();
const ask = async <T extends z.ZodTypeAny>(sys: string, user: string, out: T, effort: "low" | "medium" | "high" = "high"): Promise<z.infer<T>> => {
  const res = await client().messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort, format: zodOutputFormat(out) },
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined to work on this one");
  if (res.stop_reason === "max_tokens") throw new Error("the script is too long for one call; split it in two");
  const parsed = res.parsed_output as z.infer<T> | null;
  if (!parsed) throw new Error(`nothing usable came back (stop reason ${res.stop_reason})`);
  return parsed;
};

const clean = (s: string) => s.replace(/—/g, ", ").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => tokens(a).join(" ") === tokens(b).join(" ");

const numbered = (c: Cut, withIds: boolean) => c.beats.map((b, i) => `${i + 1}. ${withIds ? `[${b.id}] ` : ""}${b.text}`).join("\n");
const describeShort = (c: Cut, withIds: boolean) =>
  [`SHORT${withIds ? ` [${c.id}]` : ""}: ${c.title}`, `hook: ${c.hook ?? ""}`, ...c.beats.map((b, i) => `${i + 1}. ${withIds ? `[${b.id}] ` : ""}${b.from ? `(same as long beat ${b.from}) ` : ""}${b.text}`)].join("\n");

/** Output beats → beats with ids; a short beat that is a long beat word for word carries that beat's id in `from`. */
const toShortBeats = (long: Beat[], beats: { text: string; sameAs: number | null; id?: string | null }[], keepIds = false): Beat[] =>
  beats.map((b) => {
    const idx = b.sameAs !== null && b.sameAs !== undefined ? Math.round(b.sameAs) - 1 : -1;
    const ref = idx >= 0 && idx < long.length && same(long[idx]!.text, b.text) ? long[idx] : undefined;
    const id = keepIds && b.id ? b.id : newId();
    return ref ? { id, text: ref.text, from: ref.id } : { id, text: clean(b.text) };
  });

// ── the calls ──

/** The first rewrite: source → long cut + shorts. */
export const rewriteScript = async (v: ScriptVoice, source: string, samples: string[]): Promise<Pick<Script, "long" | "shorts">> => {
  const out = await ask(system(v, samples), ["The script, as the author wrote it:", "", source.trim(), "", "Write the long cut as beats, then the shorts."].join("\n"), RewriteOut);
  const long: Cut = { id: newId(), kind: "long", title: clean(out.longTitle), beats: out.long.map((b) => ({ id: newId(), text: clean(b.text) })) };
  const shorts: Cut[] = out.shorts.map((s) => ({ id: newId(), kind: "short", title: clean(s.title), hook: clean(s.hook), why: clean(s.why), beats: toShortBeats(long.beats, s.beats) }));
  return { long, shorts };
};

/** A re-paste: the cuts adjusted to what changed in the source, every unchanged beat kept as it is (same id, same words). */
export const adjustScript = async (v: ScriptVoice, samples: string[], oldSource: string, newSource: string, long: Cut, shorts: Cut[]): Promise<Pick<Script, "long" | "shorts">> => {
  const user = [
    "The author has changed their script since the cuts below were made. Adjust the cuts to the change and nothing else: every beat whose point didn't change keeps its id and its exact words (even if you'd now phrase it differently); a beat whose point changed keeps its id with new words; a point that's gone is dropped; a new point becomes a new beat (id null) in its place. Shorts the same: a short whose points still stand keeps its id; one built on a point that's gone is dropped; a new point may earn a new short.",
    "",
    "THE SCRIPT BEFORE:",
    oldSource.trim(),
    "",
    "THE SCRIPT NOW:",
    newSource.trim(),
    "",
    `THE LONG CUT NOW (title: ${long.title}):`,
    numbered(long, true),
    "",
    ...(shorts.length ? ["THE SHORTS NOW:", ...shorts.map((s) => describeShort(s, true)), ""] : []),
    "Return the long cut and the shorts, adjusted.",
  ].join("\n");
  const out = await ask(system(v, samples), user, AdjustOut);
  const oldBeat = new Map(long.beats.map((b) => [b.id, b]));
  const newLong: Cut = {
    ...long,
    title: clean(out.longTitle) || long.title,
    beats: out.long.map((b) => {
      const was = b.id ? oldBeat.get(b.id) : undefined;
      if (was && same(was.text, b.text)) return { ...was, changed: was.changed };
      return { id: was ? was.id : newId(), text: clean(b.text), changed: true };
    }),
  };
  const oldShort = new Map(shorts.map((s) => [s.id, s]));
  const newShorts: Cut[] = out.shorts.map((s) => {
    const was = s.id ? oldShort.get(s.id) : undefined;
    const wasBeat = new Map((was?.beats ?? []).map((b) => [b.id, b]));
    const beats = toShortBeats(newLong.beats, s.beats, true).map((b, i) => {
      const prev = s.beats[i]?.id ? wasBeat.get(s.beats[i]!.id!) : undefined;
      if (b.from) return b;
      if (prev && same(prev.text, b.text)) return { ...prev, from: undefined };
      return { ...b, changed: true };
    });
    return { id: was?.id ?? newId(), kind: "short", title: clean(s.title), hook: clean(s.hook), why: clean(s.why), beats };
  });
  return { long: newLong, shorts: newShorts };
};

/** One beat written again to an instruction, the rest of the cut for context. */
export const redoBeat = async (v: ScriptVoice, samples: string[], cut: Cut, beat: Beat, instruction: string): Promise<string> => {
  const user = [
    `The ${cut.kind} cut, for context (title: ${cut.title}):`,
    numbered(cut, false),
    "",
    `Write beat ${cut.beats.findIndex((b) => b.id === beat.id) + 1} again. The author says: ${instruction.trim() || "try it another way"}`,
    "Only that beat. Keep it one thought, and keep every fact in it.",
  ].join("\n");
  const out = await ask(system(v, samples), user, OneBeatOut, "medium");
  return clean(out.text);
};

/** A whole cut written again to an instruction. A short gets the long cut to borrow from. */
export const redoCut = async (v: ScriptVoice, samples: string[], source: string, long: Cut | undefined, cut: Cut, instruction: string): Promise<Cut> => {
  const user = [
    "The script, as the author wrote it:",
    source.trim(),
    "",
    ...(cut.kind === "short" && long ? [`THE LONG CUT (title: ${long.title}):`, numbered(long, false), ""] : []),
    `THE ${cut.kind.toUpperCase()} CUT NOW (title: ${cut.title}${cut.hook ? `; hook: ${cut.hook}` : ""}):`,
    numbered(cut, false),
    "",
    `Write this ${cut.kind} cut again. The author says: ${instruction.trim() || "try it another way"}`,
    cut.kind === "short" ? "Return the title, the hook and the beats. Where a beat is a long beat word for word, use those exact words." : "Return the title and the beats; hook is null for the long cut.",
  ].join("\n");
  const out = await ask(system(v, samples), user, CutOut);
  const beats: Beat[] = out.beats.map((b) => {
    const text = clean(b.text);
    const ref = cut.kind === "short" ? long?.beats.find((x) => same(x.text, text)) : undefined;
    return ref ? { id: newId(), text: ref.text, from: ref.id } : { id: newId(), text };
  });
  return { ...cut, title: clean(out.title) || cut.title, ...(cut.kind === "short" ? { hook: clean(out.hook ?? "") } : {}), beats };
};

/** One more short, about what the author says (or whatever's left uncovered). */
export const anotherShort = async (v: ScriptVoice, samples: string[], source: string, long: Cut, shorts: Cut[], instruction: string): Promise<Cut> => {
  const user = [
    "The script, as the author wrote it:",
    source.trim(),
    "",
    `THE LONG CUT (title: ${long.title}):`,
    numbered(long, true),
    "",
    ...(shorts.length ? ["THE SHORTS ALREADY MADE (don't repeat them):", ...shorts.map((s) => describeShort(s, false)), ""] : []),
    `Write one more short. The author says: ${instruction.trim() || "about whatever the existing shorts leave out"}`,
  ].join("\n");
  const out = await ask(system(v, samples), user, ShortOut);
  return { id: newId(), kind: "short", title: clean(out.title), hook: clean(out.hook), why: clean(out.why), beats: toShortBeats(long.beats, out.beats) };
};

// ── the visual plan ──

const PlanItemOut = z.object({
  n: z.number().describe("The beat's number in the list given."),
  kind: z.enum(["text", "sketch", "broll", "none"]).describe("text: a few words on screen carry it. sketch: a simple picture says it faster. broll: real footage should carry it (the maker films it). none: what's on screen stays."),
  text: z.string().describe("kind text: two to six words, the point of the beat, as they'd sit on screen. Otherwise empty."),
  prompt: z.string().describe("kind sketch: what to draw, one plain sentence, a single subject, no words in the picture, no style words (the style is fixed). Otherwise empty."),
  note: z.string().describe("kind broll: what to film, concrete enough to go and get it (which screen, which match, what happens). Otherwise empty."),
});
const PlanOut = z.object({ items: z.array(PlanItemOut) });

const PLAN_RULES = [
  "You plan what's on screen while each beat is read. The videos are one person talking about making their game: the picture is there to help the words land, never to compete with them.",
  "Use text when the beat makes a point worth seeing written (a claim, a number, a name, a turn in the argument). Use a sketch when a simple drawing explains faster than words (a shape, a layout, a before and after, a thing being described). Use broll when the beat talks about something that exists and can be shown: the game, the code, the tool, a match. Use none when the beat carries straight on from the one before and a new picture would be noise.",
  "A sketch prompt describes ONE simple subject in one sentence, as a line drawing would show it. No text in the picture, no style words, no colours. Roughly one beat in three or four earns a sketch; the rest are text, broll or none. Never two sketches in a row unless both are needed.",
  "A text card is two to six words, never a sentence from the beat copied out, no full stop. Vary: a label, a number, a question, the key phrase.",
  "A broll note says what to film and where to find it, so the maker can go and record it without thinking.",
].join("\n\n");

/** A visual for every beat given (the long cut's, and a short's own beats), by number. */
export const planVisuals = async (v: ScriptVoice, beats: { n: number; text: string }[]): Promise<Map<number, BeatCard>> => {
  const sys = [`About the game and the person: ${v.about}`, "", PLAN_RULES].join("\n");
  const user = ["The beats, in order:", ...beats.map((b) => `${b.n}. ${b.text}`), "", "Give one item per beat, every beat, by number."].join("\n");
  const out = await ask(sys, user, PlanOut, "medium");
  const plan = new Map<number, BeatCard>();
  for (const it of out.items) {
    const n = Math.round(it.n);
    if (!beats.some((b) => b.n === n)) continue;
    const card: BeatCard = it.kind === "text" ? { kind: "text", text: clean(it.text) } : it.kind === "sketch" ? { kind: "sketch", prompt: clean(it.prompt) } : it.kind === "broll" ? { kind: "broll", note: clean(it.note) } : { kind: "none" };
    plan.set(n, card);
  }
  return plan;
};
