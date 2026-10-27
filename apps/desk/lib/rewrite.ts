/**
 * The Scripts tab's Claude calls: a pasted script → the long cut, as
 * beats, in Tom's voice; a re-paste → the cut adjusted to the change and
 * nothing else; one beat or the cut redone to an instruction; the picture
 * plan (docs/design/desk-ascii-scripts.md); the shorts found inside the
 * long video (docs/design/desk-shorts.md). Writing shorts of their own is
 * parked (decision 1 there): those calls stay but nothing presses them. Same client and shape as draft.ts (the
 * queue's words): structured output, the game's own voice from
 * desk.config, the key from ANTHROPIC_API_KEY in apps/desk/.env.
 *
 * Server only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type Beat, type BeatMood, type Cut, SCORE_MOODS, SHORT_MAX, SHORT_MIN, type Script, newId, picturesWanted, spokenSeconds, tokens, type ShortPost } from "./scripts";

export const hasClaude = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

/** What a game gives the rewriter: who's talking and how (desk.config `script.ai`). */
export type ScriptVoice = {
  /** One paragraph on the game and the person, for the model's own understanding. */
  about: string;
  /** The voice rules, plain prose. */
  rules: string;
  /** Lines actually written in the voice, if the game has none of the author's own scripts yet. Never invented ones. */
  examples?: string[];
  /** The picture style, added to every picture prompt (default: the chiaroscuro film still, cards.ts). */
  picture?: string;
};

export const MODEL = "claude-opus-5-5";

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
  longTitle: z.string().describe("The video's title, under 80 characters, no ALL CAPS."),
  long: z.array(BeatOut).min(1).describe("The whole script, lightly edited to the voice, as beats in the author's order."),
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
  "A BEAT is one thought: two to four sentences, roughly thirty to fifty-five words, a stretch that takes ten to twenty seconds to say. Don't split a thought just to keep beats short: each beat is a picture on screen, and pictures that change too often feel rushed. Every beat must read aloud on its own, because each is recorded on its own and a picture is hung on it.",
  "The long cut is the whole script, in the author's order, with every point kept. The job is a light edit to the voice, not a rewrite: keep the author's words wherever they already read well, fix what doesn't, and never invent a fact, a number or a feature that isn't in the source.",
  "The script may be markdown from the author's Google Doc. A line starting with # is a section heading: it is never read aloud and never becomes a beat or part of one (the pictures step uses headings for chapters). The author's notes (a Sources list, anything quoted with >) are already left out. **Bold** and *italics* are the author's emphasis: the words stay, the marks go.",
].join("\n\n");

const SHORT_RULES = [
  "A SHORT is a self-contained vertical video of forty-five to seventy-five seconds spoken (about a hundred and twenty to two hundred words). It opens with the hook, makes one point, and ends without a sign-off. Reuse long beats word for word wherever they stand alone (mark them sameAs), so one recording serves both cuts; write new words only for the opening, the joins and the close. Make as many shorts as the script naturally holds: one idea gives one short, three distinct points give three. Never pad a short with filler, and never make a short from a point that needs the rest of the script to make sense.",
].join("\n\n");

/** The rewrite's system prompt: who's talking, their own scripts in full, the voice rules. Research (researcher.ts) writes its additions in it too. */
export const system = (v: ScriptVoice, samples: string[], shorts = false): string =>
  [
    shorts
      ? "You edit video scripts for the one person who made the game, for videos they will read aloud themselves. A long video for YouTube (five minutes and up, landscape) and short vertical videos (TikTok, YouTube Shorts, Reels) come from one script."
      : "You edit video scripts for the one person who made the game, for videos they will read aloud themselves: a long video for YouTube (five minutes and up, landscape), one picture on screen per beat.",
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
    ...(shorts ? ["", SHORT_RULES] : []),
  ].join("\n");

const client = () => new Anthropic();
export const ask = async <T extends z.ZodTypeAny>(sys: string, user: string, out: T, effort: "low" | "medium" | "high" = "high", onUsage?: (u: Anthropic.Usage) => void): Promise<z.infer<T>> => {
  const res = await client()
    .messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort, format: zodOutputFormat(out) },
      system: sys,
      messages: [{ role: "user", content: user }],
    })
    .catch((e: unknown) => {
      // The SDK parses the JSON before we see the stop reason, so a reply cut
      // off at the cap surfaces as a parse error. Say what happened.
      if (e instanceof Anthropic.AnthropicError && !(e instanceof Anthropic.APIError)) throw new Error("Claude's reply was cut off before the end (too much to say in one call); try again with less");
      throw e;
    });
  onUsage?.(res.usage);
  if (res.stop_reason === "refusal") throw new Error("Claude declined to work on this one");
  if (res.stop_reason === "max_tokens") throw new Error("the script is too long for one call; split it in two");
  const parsed = res.parsed_output as z.infer<T> | null;
  if (!parsed) throw new Error(`nothing usable came back (stop reason ${res.stop_reason})`);
  return parsed;
};

const clean = (s: string) => s.replace(/—/g, ", ").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
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

/** The first rewrite: source → the long cut. */
export const rewriteScript = async (v: ScriptVoice, source: string, samples: string[]): Promise<Pick<Script, "long" | "shorts">> => {
  const out = await ask(system(v, samples), ["The script, as the author wrote it:", "", source.trim(), "", "Write the long cut as beats."].join("\n"), RewriteOut);
  const long: Cut = { id: newId(), kind: "long", title: clean(out.longTitle), beats: out.long.map((b) => ({ id: newId(), text: clean(b.text) })) };
  return { long, shorts: [] };
};

/** A re-paste: the cuts adjusted to what changed in the source, every unchanged beat kept as it is (same id, same words). */
export const adjustScript = async (v: ScriptVoice, samples: string[], oldSource: string, newSource: string, long: Cut, shorts: Cut[]): Promise<Pick<Script, "long" | "shorts">> => {
  const user = [
    "The author has changed their script since the cuts below were made. Adjust the cuts to the change and nothing else: every beat whose point didn't change keeps its id and its exact words (even if you'd now phrase it differently); a beat whose point changed keeps its id with new words; a point that's gone is dropped; a new point becomes a new beat (id null) in its place.",
    shorts.length ? "Shorts the same: a short whose points still stand keeps its id; one built on a point that's gone is dropped; a new point may earn a new short." : "There are no shorts: return an empty list for them.",
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
  const out = await ask(system(v, samples, shorts.length > 0), user, AdjustOut);
  const oldBeat = new Map(long.beats.map((b) => [b.id, b]));
  const newLong: Cut = {
    ...long,
    title: clean(out.longTitle) || long.title,
    beats: out.long.map((b) => {
      const was = b.id ? oldBeat.get(b.id) : undefined;
      if (was && same(was.text, b.text)) return { ...was, changed: was.changed };
      // Its point changed: new words, and its pictures (kept) want a look.
      return was ? { ...was, text: clean(b.text), changed: true, card: undefined, ...(was.pictures ? { pictures: was.pictures.map((p) => ({ ...p, check: true })) } : {}) } : { id: newId(), text: clean(b.text), changed: true };
    }),
  };
  const oldShort = new Map(shorts.map((s) => [s.id, s]));
  const newShorts: Cut[] = (shorts.length ? out.shorts : []).map((s) => {
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
  const out = await ask(system(v, samples, cut.kind === "short"), user, OneBeatOut, "medium");
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
  const out = await ask(system(v, samples, cut.kind === "short"), user, CutOut);
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
  const out = await ask(system(v, samples, true), user, ShortOut);
  return { id: newId(), kind: "short", title: clean(out.title), hook: clean(out.hook), why: clean(out.why), beats: toShortBeats(long.beats, out.beats) };
};

// ── finding the shorts in the long video (docs/design/desk-shorts.md § 1) ──
//
// Nothing is written here: a short is a run of the long cut's beats as
// recorded, so the calls only pick runs and say why. Two calls: a finder
// that's generous, and a judge that isn't (a finder approves its own
// picks). The hooks come later (§ 2), with their own voice handling.

const FoundShortOut = z.object({
  beats: z.array(z.number()).min(1).describe("The long beats in the short, by number, in the order they're said: one run of consecutive beats, or two runs with one jump between them."),
  join: z.string().nullable().describe("With two runs: why the jump reads as if it were written that way (what the last beat before it sets up, what the first after it answers). null for one run."),
  carry: z.string().nullable().describe("When the short starts one beat after its natural opener because that opener leans on the long video: what the hook has to say for the first beat to land, as content in one plain sentence (the claim or question the dropped beat made), not a hook draft. null when the first beat stands with no help."),
  title: z.string().describe("A working title for the short, under 60 characters, plain, no ALL CAPS, no hashtags."),
  why: z.string().describe("One plain sentence: what makes this stand on its own, and (over a minute) what keeps someone watching to the end."),
});
const FindShortsOut = z.object({ shorts: z.array(FoundShortOut).describe("Every run worth judging, best first.") });

const FIND_RULES = [
  `You find the SHORTS inside a long video one person made about making their game: short vertical videos for TikTok, YouTube Shorts, Reels and X, cut straight out of the long recording. Nothing is rewritten and nothing is re-recorded. A short is made of beats of the long cut said exactly as they are: one run of consecutive beats, or two runs with a single jump, ${SHORT_MIN} to ${SHORT_MAX} seconds spoken by the timings given. Each short will open with a hook line of a few seconds, recorded separately later. The point of a short is that someone who has never heard of this person watches to the end and goes to the profile to see who they are.`,
  "A run is worth offering when: it STANDS ALONE (a viewer who hasn't heard the rest follows every sentence, the first included: a sentence that gestures at something outside the run, a this, that or it, a 'whenever this comes up', sounds like the middle of a conversation even with a hook in front of it, so it can't open a short and can't be in one); it has a PAYOFF (ends on a point, a reveal or a punchline, never mid-argument); it has THE PERSON IN IT (an opinion, an admission, a mistake, a real number, something they tried; a run that only explains how something works is the weakest kind); and it's ONE thing. A jump is for one purpose only: a payoff separated from its setup by a digression. Both runs must read as one piece of speech; never jump to collect good lines.",
  "When a run's natural opener leans like that, don't bin the run and don't keep the beat: START ONE BEAT LATER and say in carry what the hook has to tell the viewer for that first beat to land (the thing the dropped beat said), so a beat that begins with 'But that's like saying' or 'So' reads as the answer to the hook. Only when the next beat does read that way; otherwise the run isn't one.",
  "Length is never the aim. A self-contained story of eighty seconds beats a thirty second fragment. A run that only reaches the window by taking in a beat that doesn't belong is out. Shorts may overlap by a beat, never share most of their beats. A beat marked NOT RECORDED can't be in a short. Offer everything worth judging, best first; a stricter judge reads them after you.",
  "Titles and reasons are in the author's register: plain, first person where it fits, nothing that reads like marketing. A title is read by a stranger with no context, who takes every word in its everyday sense: it names the thing itself (the cut Steam takes of a sale, not 'the discount', which a reader takes as a sale price) and says what the short is about, never a shorthand that only makes sense once you've watched.",
].join("\n\n");

const JudgedOut = z.object({
  n: z.number().describe("The candidate's number."),
  score: z.number().describe("1 to 10: how sure you are a stranger watches to the end and taps the profile. 8 and up is a short worth posting; 5 to 7 is a maybe; under 5 is not."),
  verdict: z.enum(["pass", "fail"]).describe("pass only at 7 and up with no fault below."),
  problem: z.string().nullable().describe("A fail: the one thing that most stops it, in a plain sentence, quoting the line where it's a line. null for a pass."),
  title: z.string().nullable().describe("A clearer title, when the candidate's could be taken two ways by a stranger (a word with an everyday meaning in this world, like a discount that reads as a sale price) or doesn't say what the short is about. Plain, under 60 characters, no ALL CAPS. null to keep the title as it is."),
  check: z.string().nullable().describe("A pass that only works with its hook carrying something: what the hook has to say, as content, in one plain sentence (the candidate's own carry line, corrected if it's wrong). null when the first beat stands on its own."),
});
const JudgeOut = z.object({ judged: z.array(JudgedOut) });

const JUDGE_RULES = [
  "You judge candidate shorts cut from a long video one person made about making their game. You're not the one who picked them and you owe them nothing. Read each as a stranger scrolling who has never heard of this person and will never see the long video: you have the words exactly as they'll be heard, nothing else, except that a hook line of a few seconds, recorded later, will open each one. Where a candidate says what its hook will carry, judge its first beat as if a line saying that had just been said: an answer that begins 'But that's like saying' or 'So' can land then. A first sentence that gestures at something the hook didn't say (a this, that, it, a 'whenever this comes up') still sounds like the middle of a conversation, hook or not.",
  "The bar is: would that stranger watch to the end and then tap the profile to see who this is. Fail a candidate for any one of these: any sentence that leans on something outside it that the hook won't have said (a this, that, it, these, a name or term the long video introduced earlier, an argument it's answering); no payoff (it ends mid-argument, or on a conclusion to something the viewer didn't hear); nobody in it (it explains how something works and the person never shows: no opinion, admission, number of their own, or thing they did); two things, not one; a jump between runs that doesn't read as one piece of speech; a beat that's there only to make the length. Score honestly across the whole set: most sets have a few sevens and eights and some fours.",
  "Read each title too, as that stranger: every word in its everyday sense, nothing from the long video. When a title could be taken another way or doesn't say what the short is about, give a plain one that does.",
  "Reasons are one plain sentence each, in everyday words.",
].join("\n\n");

type Found = z.infer<typeof FoundShortOut>;
type Judged = z.infer<typeof JudgedOut>;
export type ShortVerdict = Found & Omit<Judged, "n">;

/** The author's past calls (desk-shorts.md: keeps and bins feed back), for both calls. */
export type ShortTaste = { kept: string[]; binned: string[] };
const tasteLines = (taste: ShortTaste): string[] =>
  taste.kept.length || taste.binned.length
    ? [
        "THE AUTHOR'S OWN CALLS ON EARLIER SHORTS are the standard. Shorts they kept:",
        ...(taste.kept.length ? taste.kept.map((t) => `- ${t}`) : ["- (none yet)"]),
        "Shorts they binned:",
        ...(taste.binned.length ? taste.binned.map((t) => `- ${t}`) : ["- (none yet)"]),
        "",
      ]
    : [];

/** The long cut's beats as recorded, with the shorts already offered, → candidate shorts, judged. */
export const findShorts = async (
  v: ScriptVoice,
  long: Cut,
  timed: { n: number; text: string; seconds?: number }[],
  offered: { beats: number[]; title: string; state: string }[],
  taste: ShortTaste,
): Promise<ShortVerdict[]> => {
  const total = timed.reduce((n, b) => n + (b.seconds ?? 0), 0);
  const about = [`About the game and the person (for you, not for the script): ${v.about}`, "", "The voice, in rules:", v.rules, ""];
  const cut = [`THE LONG CUT (title: ${long.title}; ${Math.round(total / 60)} minutes recorded), each beat with how long it runs as recorded:`, ...timed.map((b) => `${b.n}. [${b.seconds !== undefined ? `${Math.round(b.seconds)}s` : "NOT RECORDED"}] ${b.text}`), ""];
  const user = [
    ...cut,
    ...tasteLines(taste),
    ...(offered.length ? ["ALREADY OFFERED (never offer these again, nor a short that's mostly the same beats):", ...offered.map((o) => `beats ${o.beats.join(", ")}: ${o.title} (${o.state})`), ""] : []),
    offered.length ? "Find the shorts worth judging that haven't been offered." : "Find the shorts worth judging.",
  ].join("\n");
  const found = await ask([...about, FIND_RULES].join("\n"), user, FindShortsOut);
  const okRun = (ns: number[]) => {
    if (!ns.length || ns.some((n) => !Number.isInteger(n) || n < 1 || n > timed.length || timed[n - 1]!.seconds === undefined)) return false;
    if (new Set(ns).size !== ns.length) return false;
    let jumps = 0;
    for (let i = 1; i < ns.length; i++) if (ns[i] !== ns[i - 1]! + 1) jumps++;
    return jumps <= 1;
  };
  const cands = found.shorts.filter((x) => okRun(x.beats)).map((x) => ({ ...x, title: clean(x.title), why: clean(x.why), join: x.join ? clean(x.join) : null, carry: x.carry ? clean(x.carry) : null }));
  if (!cands.length) return [];
  const judgeUser = [
    "THE CANDIDATES, each exactly as it will be heard:",
    ...cands.flatMap((c, i) => [`--- candidate ${i + 1}: "${c.title}" (${Math.round(c.beats.reduce((n, b) => n + (timed[b - 1]!.seconds ?? 0), 0))}s)${c.carry ? ` · the hook will carry: ${c.carry}` : ""} ---`, ...c.beats.map((n) => timed[n - 1]!.text), ""]),
    ...tasteLines(taste),
    "Judge every candidate.",
  ].join("\n");
  const { judged } = await ask([...about, JUDGE_RULES].join("\n"), judgeUser, JudgeOut);
  const byN = new Map(judged.map((j) => [Math.round(j.n), j]));
  return cands.flatMap((c, i) => {
    const j = byN.get(i + 1);
    if (!j) return [];
    const score = Math.max(1, Math.min(10, Math.round(j.score)));
    return [{ ...c, title: j.title ? clean(j.title) : c.title, score, verdict: j.verdict === "pass" && score >= 7 ? "pass" : "fail", problem: j.problem ? clean(j.problem) : null, check: j.check ? clean(j.check) : c.carry }];
  });
};

// ── the hooks (docs/design/desk-shorts.md § 2, "The hook's voice") ──
//
// The most hype-prone line in the pipeline, so: the author's own words
// first, the rewrite's full voice context, kinds not examples, banned
// categories, a literal check by a second pass, and the hooks the author
// chose before as the standard.

const HookDraftOut = z.object({
  text: z.string().describe("The hook: one sentence, under about ten words, as it would be said."),
  from: z.number().nullable().describe("When it's a line the author already wrote, lifted word for word or trimmed: that long beat's number. null for new words."),
});
const HooksForOut = z.object({ n: z.number().describe("The short's number."), drafts: z.array(HookDraftOut).min(3).max(3) });
const HooksOut = z.object({ shorts: z.array(HooksForOut) });

const HOOK_RULES = [
  "You write the HOOK for each short: the first thing said, a few seconds, recorded by the author on its own and on screen while it's said. Then the short's first beat follows. A viewer who has never heard of this person decides in the first three seconds whether to stay. They stay for a real person saying something real, in their own words, not for volume.",
  "THE AUTHOR'S OWN WORDS FIRST. Before writing anything, look for a line the author already wrote that would open the short: often the payoff said flat as a claim, from the short itself or anywhere in the long cut. Lift it word for word, or trim it, and give its beat number. Write new words only when nothing fits, and build them from phrases the author uses. Of the three drafts, at least one is a lifted line when any line in the script could do it.",
  "WHAT GRABS, IN THIS AUTHOR'S REGISTER: something specific (a real number, a real thing they did, a real mistake); an honest admission; an opinion stated plainly that some people would disagree with; the problem stated flat, with dry understatement rather than exaggeration. One sentence, under about ten words, said the way they talk.",
  "WHEN A SHORT SAYS WHAT ITS HOOK HAS TO CARRY, the hook says that thing, in the author's words, so the short's first beat reads as the answer to it. Never repeat the short's own first sentence.",
  "BANNED, as kinds: telling the viewer to watch, wait, stay or listen; superlatives and hype words the author doesn't use; promises about what they're about to see or won't believe; a cliffhanger made for its own sake; trend formats (POV, 'did you know', 'nobody talks about', 'here's why', 'let's talk about'); a question aimed at the viewer that nobody would really ask; anything a stranger could have said about any game; ALL CAPS; exclamation marks.",
  "A STRANGER READS IT LITERALLY: every word in its everyday sense, nothing from the long video. It has to say what the short is about to someone with no context (name the thing itself, not a shorthand that only lands once you've watched).",
].join("\n\n");

const HookCheckOut = z.object({
  n: z.number(),
  k: z.number().describe("The draft's number within the short, 1 to 3."),
  verdict: z.enum(["keep", "replace"]),
  text: z.string().nullable().describe("The replacement when the verdict is replace, written to the same rules; null to keep."),
});
const HookChecksOut = z.object({ checks: z.array(HookCheckOut) });
const HOOK_CHECK = [
  "You check hook lines someone drafted for this author's shorts. For each draft, two questions. One: would it sound odd said out loud by the person in those scripts, to a mate? Anything with a sales voice, a shout, a format, a flourish they'd never use. Two: does a stranger, taking every word in its everyday sense and knowing nothing of the long video, get what the short is about from this line alone?",
  "A line lifted from the author's own script gets the second question just the same: in the long video it had its context, here it has none, so a word whose everyday meaning differs from what the script meant by it (a price word, a trade word, a shorthand for the thing the video is about) fails the stranger even though the author said it. Replace it with the thing named plainly, keeping the author's shape of sentence.",
  "Keep a draft that passes both. Replace one that fails either, with a line that passes, in the author's words (lifting a line of theirs where one fits). Change nothing that passes.",
].join("\n\n");

export type HookDraft = { text: string; source: string };

/** The kept shorts → three hook drafts each, checked by a second pass. */
export const draftHooks = async (
  v: ScriptVoice,
  samples: string[],
  long: Cut,
  shorts: { n: number; title: string; beats: string[]; carry?: string }[],
  chosen: string[],
): Promise<Map<number, HookDraft[]>> => {
  const sys = [system(v, samples), "", HOOK_RULES].join("\n");
  const user = [
    `THE LONG CUT (title: ${long.title}), for lines to lift:`,
    numbered(long, false),
    "",
    ...(chosen.length ? ["HOOKS THE AUTHOR CHOSE BEFORE, the standard (their picks, some their own rewrites):", ...chosen.map((h) => `- ${h}`), ""] : []),
    "THE SHORTS, each exactly as it will be heard after its hook:",
    ...shorts.flatMap((c) => [`--- short ${c.n}: "${c.title}"${c.carry ? ` · the hook has to carry: ${c.carry}` : ""} ---`, ...c.beats, ""]),
    "Write three hooks for every short.",
  ].join("\n");
  const out = await ask(sys, user, HooksOut);
  const label = (from: number | null) => (from !== null && Number.isInteger(from) && from >= 1 && from <= long.beats.length ? `your line, beat ${from}` : "new words");
  const drafts = new Map<number, HookDraft[]>();
  for (const x of out.shorts) {
    const ds = x.drafts.map((d) => ({ text: clean(d.text), source: label(d.from) })).filter((d) => d.text);
    if (ds.length) drafts.set(Math.round(x.n), ds);
  }
  if (!drafts.size) return drafts;
  // The literal check, on the drafts as a stranger and as a mate.
  const checkUser = [
    "THE DRAFTS:",
    ...[...drafts].flatMap(([n, ds]) => {
      const c = shorts.find((x) => x.n === n);
      return [`--- short ${n}: "${c?.title ?? ""}"${c?.carry ? ` · the hook has to carry: ${c.carry}` : ""} ---`, `(the short then opens: ${c?.beats[0]?.slice(0, 160) ?? ""})`, ...ds.map((d, k) => `${k + 1}. ${d.text}  [${d.source}]`), ""];
    }),
    "Check every draft.",
  ].join("\n");
  const { checks } = await ask([system(v, samples), "", HOOK_CHECK].join("\n"), checkUser, HookChecksOut, "low");
  for (const ch of checks) {
    const ds = drafts.get(Math.round(ch.n));
    const k = Math.round(ch.k) - 1;
    if (!ds || !ds[k] || ch.verdict !== "replace" || !ch.text?.trim()) continue;
    ds[k] = { text: clean(ch.text), source: "new words (checked)" };
  }
  return drafts;
};

// ── the picture plan ──

// ── the story: one call over every beat (docs/design/desk-ascii-scripts.md § Pictures) ──
//
// The pictures are decided once, here, where the whole script is in view:
// the world, its cast, the chapters, and for every beat one short line
// saying what we see. The prompts are then written from those lines a batch
// at a time, so no batch is choosing what a picture shows.

const StoryItemOut = z.object({
  n: z.number().describe("The beat's number."),
  scene: z
    .string()
    .describe(
      "What we SEE while this beat is said, in the video's world: the subject and what it's doing, one short sentence. A shot, never a summary of the beat's point. Name the cast member or place it shows. When it brings back an earlier picture, say so by beat number. A beat marked LONG gets two pictures: name both moments, the second after a semicolon.",
    ),
  mood: z.enum(SCORE_MOODS).describe("What the music under this beat should feel like."),
  intensity: z.number().describe("0 to 1: how much is going on in the music. Most beats sit between 0.2 and 0.6; save 0.8 and up for the real peaks."),
  lift: z.boolean().describe("True only for the one or two beats that are the turn of the whole video (the music steps up a key). Almost always false."),
  pulled: z.array(z.string()).describe("Zero or one word, copied exactly as it appears in the beat, that the point turns on (a number, a name, a 'never'). Give one in roughly one beat in four, only where the word really is the point, never in two beats running. Empty for the rest."),
  chapter: z.string().nullable().describe("When a new chapter starts at this beat: its name, two to four words, plain, no numbering. null otherwise."),
});
const CastOut = z.object({
  name: z.string().describe("A short handle for you to plan with. It never goes in a prompt on its own."),
  look: z.string().describe("What it literally looks like, so an image model that has never read the script draws the same thing every time: for a person, age, build, hair, clothes and one thing that marks them out; for a place or object, its shape, size, material and what lights it. One sentence, no colours, nothing the eye can't see."),
});
const StoryOut = z.object({
  theme: z.string().describe("The video's world, decided before any scene: the setting, its people, its era, its light, in one or two sentences, and which idea in the script it stands for. When the world is given, copy it back exactly."),
  look: z.string().describe("What the world LOOKS like, for an image model that never sees the theme or the script: the genre named plainly, the era, the buildings, materials, clothing, technology and light sources, in one or two literal sentences. Only things that can be drawn: no story, no ideas, no feelings, no colours, and none of what the pictures must avoid (weather, mist, smoke, crowds, fine texture), since it goes with every picture. When the look is given, copy it back exactly."),
  cast: z.array(CastOut).describe("Every character, place and object that comes back in more than one scene, each with its fixed look. When a cast is given, copy every one back exactly and add only new ones."),
  items: z.array(StoryItemOut),
});

/** What every picture prompt must survive: the image model sees the look line and this one prompt, nothing else, and takes every word literally. */
const PROMPT_LITERAL = [
  "THE IMAGE MODEL KNOWS NOTHING BUT THE PROMPT. Each picture is made on its own by an image model that's given the style, the world's look and that one prompt: never the script, the theme, the cast list or any other picture. It takes every word literally. So:",
  "- Every prompt stands alone. Never lean on another picture or on the story: nothing it hasn't been told about in this prompt (no 'the' for something introduced elsewhere, no 'again', 'same', 'still', 'rival', 'her', 'his'). A cast member is written out with their look, word for word, every time they appear.",
  "- Say what things literally look like. Never a label, coined word or genre shorthand that only makes sense with the story, and never an adjective meant as mood: a word like dark, black, dead or cold is drawn as exactly what it says.",
  "- Show the world in every prompt: at least one concrete detail from its look in the scene, so nothing could be taken for another era or genre.",
  "- The picture is black and white. Never name a colour: say what's bright, what's lit and what falls into shadow, and name each light source as a thing that glows.",
  "- Dark builds as empty screen, so the thing that matters is always lit. Never describe the subject as black or dark, and a silhouette only when something bright behind it shows its outline.",
  "- One frozen instant. Nothing that takes time to see: no change, before and after, 'slowly', 'about to', one thing turning into another, no comparing, deciding or remembering. A feeling is shown by a pose, a gesture or a face.",
].join("\n");

/** What a picture can be, given it ends up as glyphs: the story keeps to this when choosing scenes, the prompts when telling them. */
const GLYPH_RULES =
  "EVERY PICTURE MUST READ AS GLYPHS. About 280 characters across the screen is all the detail there is, so: one subject (two at most) that fills at least a third of the frame, in big simple shapes, lit by one strong light against darkness. Close-ups and medium shots carry most of the video. A wide shot is one big clear silhouette or shape against a lit sky, doorway or window, never a scene full of small things. Never: crowds, fleets, queues or rows of many small things, fine textures (nets, mesh, rain, snow, fog, smoke, foliage, crowds of stars), anything tiny that carries the point (a small figure far away, a coin, a ring, a key in a big scene), or a picture whose point depends on reading a detail. If the beat's point needs many things (thousands of games, a packed market), show one of them close, standing for the rest. No words, letters, numbers, screens full of text or UI in the picture (they turn to mush as glyphs).";

const STORY_RULES = [
  "You plan the pictures for a video one person made about making their game: the story told in pictures while they talk. Every beat of the script gets a picture on screen while it's said (two for a long one). Each picture is turned into ASCII art (built out of typed characters, light becoming glyphs, shadow becoming empty screen). You decide WHAT every picture shows; someone else writes each picture's full prompt from your line later, so your lines are the one place the whole story is held together.",
  "Every video has its own world, and every picture lives in it. Find it in this script before planning a single scene: read what the script is really arguing (what's at stake, who is up against what, what it feels like to be in the author's shoes) and pick a setting where that same struggle plays out, then run with it like a film director would. It must belong to this script and no other: if the same world would fit any video about making games, it's the wrong one. Real, historical, everyday or science fiction all work, as long as every beat can be shown in it. Swords, castles and fantasy are the obvious picks, so take them only when this script really calls for them. In the theme, name the world and say which idea in the script it stands for. Then write down what the world looks like (the look) and its cast.",
  "Show each beat's point as a moment in that world, often a metaphor. Give the world recurring characters, places and objects (the cast) and keep them the same from scene to scene, so the video feels like one story told in pictures: a thread the viewer can follow, with an image from early on coming back when its idea does (say which beat it's from). Even a beat about the game itself is shown in the video's world, never as the game.",
  "THE SCENE LINE IS A SHOT, NOT A SUMMARY. One short sentence saying what is literally in the picture: who or what, doing what, where. Never what the beat is about, never a feeling or an idea on its own (a feeling is a pose, a gesture, a face). Name the cast member or place by its cast name so the prompt writer looks up its look. Don't write the light, the camera or the style: that's the prompt writer's job. Vary what's shown down the video: never two beats running with the same subject doing the same thing, unless it's a deliberate return.",
  GLYPH_RULES,
  `Moods for the music: ${SCORE_MOODS.join(", ")}. focus is for explaining how something works (the most common), curious for a question or a what-if, tense for a problem, eerie for something wrong or strange, driving for momentum and getting work done, melancholy for something lost or cut, triumph for the payoff; the first six are the soft ones. Neighbouring beats usually share a mood or move to a near one; a jump is for a real turn in the story.`,
  "Chapters: only when the video is long enough (the total is given). A chapter is a real turn in the story, never just a new paragraph. At most one every three minutes of speaking, so a ten minute video has three or four. When there are chapters, the first beat starts the first one. When the total is under six minutes, give no chapters of your own. These rules are for chapters you come up with; the author's own headings (below) get theirs regardless.",
].join("\n\n");

export type StoryLine = { scene: string; mood: BeatMood; pulled: string[]; chapter?: string };

/** The story: the world and a scene line (plus mood, pulled word, chapter) for every beat, in one call. */
export const planStory = async (
  v: ScriptVoice,
  title: string,
  all: { n: number; text: string }[],
  headings: { heading: string; before: string }[] = [],
  world: World = { theme: "", look: "", cast: [] },
): Promise<{ world: World; lines: Map<number, StoryLine> }> => {
  const { theme } = world;
  const total = all.reduce((t, b) => t + spokenSeconds(b.text), 0);
  const user = [
    `The video: "${title}". About ${Math.round(total / 60)} minutes spoken (${total} seconds).`,
    "",
    theme.trim() ? `The video's world is already set, so every scene lives in it: ${theme.trim()}` : "Pick the video's world first (theme), then plan every scene in it.",
    ...(theme.trim() && world.look.trim() ? [`Its look is set too: ${world.look.trim()}`] : theme.trim() ? ["Write its look for that world."] : []),
    ...(theme.trim() && world.cast.length ? ["Its cast so far (copy these back exactly, add any new ones):", ...world.cast.map((c) => `- ${c.name}: ${c.look}`)] : []),
    "",
    "The whole script, beat by beat (roughly how long each takes to say in brackets; LONG = two pictures, so two moments):",
    ...all.map((b) => `${b.n}. (${spokenSeconds(b.text)}s${picturesWanted(b.text) > 1 ? ", LONG" : ""}) ${b.text}`),
    "",
    ...(headings.length
      ? [
          "The author's own section headings from their Doc, each with the start of what's said after it. A heading usually means a chapter starts at the beat that says those words: name the chapter from the heading (cut to two to four words if it's longer). Keep every one, however short the video or close together they are: the author chose them. Only skip a heading that's plainly not a section (a title, a note to self).",
          ...headings.map((h) => `- "${h.heading}", before: "${h.before}…"`),
          "",
        ]
      : []),
    "Give one item for every beat, by number.",
  ].join("\n");
  const out = await ask(STORY_RULES, user, StoryOut, "medium");
  // A look or cast member already set is kept as it stands (Tom may have written it); Claude only adds.
  const look = (theme.trim() && world.look.trim()) || clean(out.look);
  const kept = theme.trim() ? world.cast : [];
  const cast = [...kept, ...out.cast.map((c) => ({ name: clean(c.name), look: clean(c.look) })).filter((c) => c.name && c.look && !kept.some((k) => same(k.name, c.name)))];
  const next: World = { theme: theme.trim() || clean(out.theme), look, cast };
  const lines = new Map<number, StoryLine>();
  // A pulled word only lands if it's rare: never two beats running (the earlier one keeps it).
  let lastPulled = -9;
  for (const it of [...out.items].sort((a, b) => a.n - b.n)) {
    const n = Math.round(it.n);
    const beat = all.find((b) => b.n === n);
    const scene = clean(it.scene);
    if (!beat || !scene) continue;
    // A pulled word must really be in the beat (it's spelt from what's said).
    const said = new Set(tokens(beat.text));
    let pulled = it.pulled.map((w) => w.trim()).filter((w) => w && tokens(w).length === 1 && said.has(tokens(w)[0]!)).slice(0, 1);
    if (pulled.length && n - lastPulled < 2) pulled = [];
    if (pulled.length) lastPulled = n;
    lines.set(n, {
      scene,
      mood: { mood: it.mood, intensity: Math.max(0, Math.min(1, it.intensity)), ...(it.lift ? { lift: true } : {}) },
      pulled,
      ...(it.chapter?.trim() ? { chapter: clean(it.chapter) } : {}),
    });
  }
  return { world: next, lines };
};

// ── the prompts: each beat's scene line told in full, a batch of beats a call ──

const PromptsOut = z.object({
  items: z.array(
    z.object({
      n: z.number().describe("The beat's number."),
      pictures: z
        .array(z.string())
        .min(1)
        .max(2)
        .describe("One picture prompt; two only when the beat is marked LONG (the second follows the first while the beat is still being said: the second moment the scene line names, or the same moment from another angle)."),
    }),
  ),
});

const PROMPT_RULES = [
  "You write the picture prompts for a video one person made about making their game. The story has already been decided: every beat has a scene line saying what its picture shows, in the video's world, with a cast whose looks are fixed. Your job is the telling of each scene, never the choosing: write the scene the line names, with its subject and moment exactly as given, and never swap in a different idea. Each picture is turned into ASCII art (built out of typed characters, light becoming glyphs, shadow becoming empty screen), so it must read as strong shapes of light against darkness.",
  "A picture prompt describes ONE scene as a still from a film: the subject, what it's doing, where the light falls from, the camera's angle and distance. Two or three sentences, concrete and visual. No style words (woodcut, ink, chiaroscuro): the style is added for you. Never a flat diagram or an icon.",
  PROMPT_LITERAL,
  GLYPH_RULES,
  "Vary the light as the world allows (a window, a screen, a fire, a doorway, headlights, the low sun, a desk lamp): it shouldn't be the same lamp in every picture.",
  "Vary the framing down the video: close-ups, medium shots, from above, from low down, the odd wide shot. Never two pictures in a row with the same framing and subject. The prompts already written for other beats are shown so yours sit beside them; a scene that brings an earlier picture back keeps that picture's subject and place, told afresh in full.",
].join("\n\n");

/** Each given beat's scene told as a full prompt (two for a LONG beat), by beat number, checked as the image model will read them. */
export const writePrompts = async (
  v: ScriptVoice,
  title: string,
  beats: { n: number; text: string; scene: string }[],
  all: { n: number; text: string; scene: string; prompts: string[] }[],
  world: World,
): Promise<Map<number, string[]>> => {
  const want = new Set(beats.map((b) => b.n));
  const user = [
    `The video: "${title}".`,
    "",
    `The video's world: ${world.theme.trim() || "(not named)"}`,
    `Its look, which goes to the image model with every picture: ${world.look.trim() || "(none)"}`,
    ...(world.cast.length ? ["Its cast (write a cast member's look out word for word whenever they're in the picture):", ...world.cast.map((c) => `- ${c.name}: ${c.look}`)] : []),
    "",
    "The story, beat by beat: the words said, what the picture shows (LONG = two pictures), and the prompt where one's written already:",
    ...all.map((b) =>
      [
        `${b.n}. (${spokenSeconds(b.text)}s${picturesWanted(b.text) > 1 ? ", LONG" : ""}) ${b.text}`,
        `   shows: ${b.scene || "(no scene line: a scene that fits the story)"}`,
        ...(!want.has(b.n) ? b.prompts.map((p, i) => `   prompt${b.prompts.length > 1 ? ` ${i + 1}` : ""}: ${p || "(none yet)"}`) : []),
      ].join("\n"),
    ),
    "",
    `Write the prompts for these beats, by number: ${[...want].join(", ")}.`,
  ].join("\n");
  const out = await ask(PROMPT_RULES, user, PromptsOut, "medium");
  const plan = new Map<number, string[]>();
  for (const it of out.items) {
    const n = Math.round(it.n);
    const beat = beats.find((b) => b.n === n);
    if (!beat) continue;
    const prompts = it.pictures.map(clean).filter(Boolean).slice(0, picturesWanted(beat.text));
    if (prompts.length) plan.set(n, prompts);
  }
  // Every prompt read once more as the image model will read it, before a penny goes on pictures.
  const checked = await checkPrompts(world, [...plan].flatMap(([n, p]) => p.map((prompt, k) => ({ key: `${n}:${k}`, beat: beats.find((b) => b.n === n)!.text, prompt }))));
  for (const [n, p] of plan) plan.set(n, p.map((prompt, k) => checked.get(`${n}:${k}`) ?? prompt));
  return plan;
};

const OnePromptOut = z.object({ prompt: z.string().describe("The new picture prompt: one scene as a film still, two or three sentences, standing alone, no style words, no words in the picture.") });

/** One picture's prompt written again (to an instruction, or just differently), the whole script and the other pictures' prompts for context. */
export const redoPicturePrompt = async (
  v: ScriptVoice,
  title: string,
  beats: { n: number; text: string; scene: string; prompts: string[] }[],
  n: number,
  k: number,
  instruction: string,
  world: World = { theme: "", look: "", cast: [] },
): Promise<string> => {
  // No game blurb here: it pulled every picture towards gladiators. The script says what the video is about.
  const sys = PROMPT_RULES;
  const { theme } = world;
  const beat = beats.find((b) => b.n === n);
  if (!beat) throw new Error("that beat isn't in the script");
  const current = beat.prompts[k] ?? "";
  const user = [
    `The video: "${title}".`,
    ...(theme.trim() ? [`The video's world: ${theme.trim()}`] : []),
    ...(world.look.trim() ? [`Its look: ${world.look.trim()}`] : []),
    ...(world.cast.length ? ["Its cast (write a cast member's look out word for word whenever they're in the picture):", ...world.cast.map((c) => `- ${c.name}: ${c.look}`)] : []),
    "",
    "The story, beat by beat: the words, what the picture shows, and each picture's prompt as it stands (keep the new one in the same world):",
    ...beats.map((b) => [`${b.n}. ${b.text}`, `   shows: ${b.scene || "(no scene line)"}`, ...b.prompts.map((p, i) => `   prompt${b.prompts.length > 1 ? ` ${i + 1}` : ""}: ${p || "(none yet)"}`)].join("\n")),
    "",
    `Write a new prompt for beat ${n}${beat.prompts.length > 1 ? `, picture ${k + 1} (${k ? "the second half of the beat" : "the first half of the beat"})` : ""}.`,
    current ? `The prompt now, which the author wants replaced: ${current}` : "",
    instruction.trim()
      ? `The author says: ${instruction.trim()} (If that changes what the picture shows, follow the author over the scene line.)`
      : beat.scene
        ? "Tell the same scene afresh and stronger: another angle, another light, another instant within it. Not a literal illustration of the words."
        : "Make it a different, stronger idea than the one now: a scene that shows the beat's point at a glance, not a literal illustration of its words.",
  ]
    .filter(Boolean)
    .join("\n");
  const out = await ask(sys, user, OnePromptOut, "medium");
  const prompt = clean(out.prompt);
  return (await checkPrompts(world, [{ key: "one", beat: beat.text, prompt }])).get("one") ?? prompt;
};

// ── the literal reader: every prompt checked before it costs a picture ──

/** The world every picture lives in: the story (theme), what it looks like (sent with every picture) and the recurring cast. */
export type World = { theme: string; look: string; cast: { name: string; look: string }[] };

const CheckOut = z.object({
  items: z.array(
    z.object({
      key: z.string().describe("The prompt's key, as given."),
      problems: z.array(z.string()).describe("What the image model would get wrong, one short line each. Empty when the prompt is fine."),
      prompt: z.string().describe("The prompt fixed, or copied back exactly when there are no problems."),
    }),
  ),
});

const CHECK_RULES = [
  "You check picture prompts before they're paid for. Each one goes to an image model with a fixed style (a black and white print, one strong light carving the subject out of darkness) and one line describing the world's look, and nothing else. It has never seen the script, the story, the cast list or the other pictures, and it takes every word literally. Read each prompt exactly as that model would, picture what it would actually draw, and fix the prompt wherever that's not what was meant. The beat it's for is given so you know what was meant; the model never sees it.",
  "What goes wrong:",
  "- A word drawn literally that was meant as mood, genre or a label (a 'dark' or 'black' subject comes out as a dark block; a coined or genre word comes out as whatever it most plainly names).",
  "- Something the model hasn't been told about in this prompt: 'the' for a thing introduced elsewhere, 'again', 'same', 'still', 'rival', a pronoun with nobody named. Write it out in full; for a cast member, use their look word for word.",
  "- A colour named. The picture is black and white: say what's bright, lit or in shadow, and name the light source as something that glows.",
  "- The subject unlit, black, or a silhouette with nothing bright behind it. Dark builds as empty screen, so the thing that matters must be lit.",
  "- Time or thought: change, before and after, 'slowly', 'about to', comparing, deciding, remembering. Make it one frozen instant; a feeling is a pose, a gesture or a face.",
  "- Fine texture or tiny things: rain, snow, fog, smoke, crowds, nets, mesh, rows of many small things, or a small detail that carries the point. Swap for one big clear shape.",
  "- Words, letters, numbers or screens of text in the picture.",
  "- Nothing in the scene says which world it is: add one concrete detail from the look (never its weather or texture).",
  "- More than two subjects, or a subject too small to fill a third of the frame.",
  "When you fix one, keep its idea, subject, framing and light, change only what's wrong, and keep it to two or three sentences with no style words. A prompt with no problems is copied back exactly.",
].join("\n");

/** Every prompt read as the image model will read it (only the look line beside it); returns each one fixed, by key. */
export const checkPrompts = async (world: World, items: { key: string; beat: string; prompt: string }[]): Promise<Map<string, string>> => {
  const out = new Map<string, string>();
  if (!items.length) return out;
  const user = [
    `The look line every picture gets: ${world.look.trim() || "(none)"}`,
    ...(world.cast.length ? ["", "The cast, each with the look to write out word for word wherever they appear:", ...world.cast.map((c) => `- ${c.name}: ${c.look}`)] : []),
    "",
    "The prompts:",
    ...items.map((it) => `[${it.key}] beat: "${it.beat}"\n   prompt: ${it.prompt}`),
    "",
    "Check every one, by key.",
  ].join("\n");
  const res = await ask(CHECK_RULES, user, CheckOut, "medium");
  for (const it of res.items) {
    const was = items.find((x) => x.key === it.key);
    const fixed = clean(it.prompt);
    if (!was || !fixed) continue;
    if (it.problems.length) console.log(`  picture ${it.key}: ${it.problems.join("; ")}`);
    out.set(it.key, fixed);
  }
  return out;
};

// ── the thumbnail (docs/design/desk-thumbnails.md) ──

const ThumbIdeaOut = z.object({
  prompt: z.string().describe("The picture: one scene as a film still, one or two sentences, no style words, no words in the picture."),
  words: z.string().describe("Up to four words on the thumbnail, as the author would say them (they're set in capitals). Empty for none."),
  accent: z.enum(["red", "white"]).describe("The words' colour: red for danger, alarm, fear or a problem; white for calm, wonder or a plain statement."),
  why: z.string().describe("One plain sentence: why someone scrolling past would stop for this one."),
});
const ThumbsOut = z.object({ ideas: z.array(ThumbIdeaOut) });

const THUMB_RULES = [
  "You come up with YouTube thumbnails for a long video one person made about making their game. Each thumbnail is one picture turned into ASCII art (built out of typed characters in matrix green: light becomes glyphs, shadow becomes empty black), plus at most a few words. Most people see it about 360 pixels wide on a phone, and as small as 168 pixels in the up next list.",
  "The thumbnail and the title are a pair. The picture makes someone stop scrolling and the title tells them what it is. Never illustrate the title literally: make the viewer ask a question that the video answers.",
  "The picture is ONE subject, close or extremely close, filling most of the frame, in big simple shapes that read at a tiny size. A human with a clear, strong feeling (shock, dread, glee, a sly look) reads fastest. Something hidden, watching or wrong makes people need to know. The strongest of all is an eye or a face looking straight down the lens, half hidden. Describe it as a film still: the subject, what it's doing, where the light falls from, how close the camera is. No words, letters, numbers or screens full of UI in the picture (they turn to mush as glyphs). No style words (woodcut, ink, chiaroscuro): the style is added for you.",
  "The words are all that's on the thumbnail besides the picture: zero to four of them. They add to the title and never repeat it: a twist, a stake, a reaction. Shorter hits harder: two or three words read at feed size, a whole sentence doesn't. Plain spoken words the author would actually say. No hashtags, no exclamation marks, no emoji, and nothing the video doesn't deliver. When an idea has words, its prompt must keep one side of the frame (about a third of it) in solid black shadow, with the subject on the other side, so the words have somewhere to go.",
  "Give three ideas that are really different from each other: a different subject, framing and feeling. At least one is a face or an eye with a clear feeling looking at the viewer. At least one has no words at all.",
].join("\n\n");

export type ThumbIdeaPlan = { prompt: string; words: string; accent: "red" | "white"; why: string };

/** Three thumbnail ideas for the long video, different from the ones it already has (to Tom's instruction, if any). */
export const planThumbnails = async (v: ScriptVoice, title: string, beats: { text: string; prompts: string[] }[], had: { prompt: string; words: string }[], instruction: string): Promise<ThumbIdeaPlan[]> => {
  const sys = [`About the game and the person: ${v.about}`, "", THUMB_RULES].join("\n");
  const user = [
    `The video's title: "${title}".`,
    "",
    "The script, beat by beat, with the picture each beat shows in the video (the thumbnail can come from the same world, but needn't):",
    ...beats.map((b, i) => [`${i + 1}. ${b.text}`, ...b.prompts.filter(Boolean).map((p) => `   picture: ${p}`)].join("\n")),
    "",
    ...(had.length ? ["Ideas it already has (give different ones):", ...had.map((h) => `- ${h.prompt}${h.words ? ` [words: ${h.words}]` : " [no words]"}`), ""] : []),
    ...(instruction.trim() ? [`The author says: ${instruction.trim()}`] : []),
    "Give three ideas.",
  ].join("\n");
  const out = await ask(sys, user, ThumbsOut, "medium");
  return out.ideas
    .slice(0, 3)
    .map((t) => ({ prompt: clean(t.prompt), words: clean(t.words).split(/\s+/).filter(Boolean).slice(0, 4).join(" ").replace(/[!#]/g, ""), accent: t.accent, why: clean(t.why) }))
    .filter((t) => t.prompt);
};

// ── the YouTube page: the top of the description and the tags ──

const YouTubeOut = z.object({
  description: z.string().describe("The top of the description: two or three short sentences, about 250 characters at most, first person."),
  tags: z.array(z.string()).describe("Ten to fifteen tags, lower case, most specific first."),
});

const YOUTUBE_RULES = [
  "You write the top of a YouTube description and the tags for a long video one person made. The author pastes your lines at the very top of the description, the chapter timestamps go under them, and their own links and the rest go under those. So write only the part about this video: nothing about subscribing, links, socials, the channel or what's coming next.",
  "The description: two or three short sentences, about 250 characters at most. The first sentence matters most: YouTube shows only about the first 120 characters in search and above the 'more' fold, so it says what this video is actually about, specifically, in the words someone would type to find it. It adds to the title and never repeats it word for word. Promise only what the video delivers. Never start with 'In this video'.",
  "Write it the way the author talks in the script: first person singular, plain everyday words, British spelling. No em dashes, no exclamation marks, no ALL CAPS, no emoji, no hashtags, no three-beat slogans, no clickbait.",
  "The tags: ten to fifteen, lower case, no hashtags, most specific first. The video's own topic in the ways people actually search for it, then the wider subject, then the broad ones (game development, indie game dev, devlog). Leave the game's name out: it's added for you. No tag longer than four words, and all of them together under 400 characters.",
].join("\n\n");

export type YouTubeText = { description: string; tags: string };

/** The top of the long video's description and its tags (to Tom's instruction, if any; `had` = what's there now). */
export const writeYouTube = async (v: ScriptVoice, game: string, title: string, beats: string[], chapters: string[], had: YouTubeText | undefined, instruction: string): Promise<YouTubeText> => {
  const sys = [`About the game and the person: ${v.about}`, "", "How they talk:", v.rules, "", YOUTUBE_RULES].join("\n");
  const user = [
    `The video's title: "${title}".`,
    ...(chapters.length ? ["", `Its chapters: ${chapters.join(" / ")}.`] : []),
    "",
    "What's said in it, beat by beat:",
    ...beats.map((b, i) => `${i + 1}. ${b}`),
    "",
    ...(had?.description ? [`What's there now, which the author wants replaced:\n${had.description}\nTags: ${had.tags}`, ""] : []),
    ...(instruction.trim() ? [`The author says: ${instruction.trim()}`] : []),
    "Write the top of the description and the tags.",
  ].join("\n");
  const out = await ask(sys, user, YouTubeOut, "medium");
  // YouTube caps the tags at 500 characters (a tag with a space counts its quotes): keep whole tags under that.
  // The game's name always goes in, just before the broad ones at the end.
  const wanted = out.tags.map((x) => clean(x).toLowerCase().replace(/[#,<>"]/g, "").trim()).filter(Boolean);
  wanted.splice(Math.max(0, wanted.length - 3), 0, game.toLowerCase());
  const tags: string[] = [];
  let length = 0;
  for (const t of wanted) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (tags.includes(t) || length + cost > 500) continue;
    tags.push(t);
    length += cost;
  }
  return { description: clean(out.description).replace(/!/g, "."), tags: tags.join(", ") };
};

// ── a short's post copy (docs/design/desk-shorts.md § 5) ──

const ShortPostOut = z.object({
  title: z.string().describe("The title for YouTube Shorts: sentence case, under 70 characters, the words that matter first."),
  description: z.string().describe("The description, the same on every platform: one or two plain sentences, no hashtags. Under 280 characters."),
  tags: z.array(z.string()).describe("Eight to twelve tags for YouTube Studio, lower case, most specific first."),
});

const SHORT_POST_RULES = [
  "You write the title, description and tags for a short vertical video (TikTok, YouTube Shorts, Instagram Reels, X) cut out of a longer video one person made about making their game. The short opens with a hook line the author says to camera; the rest is a run of the long video said exactly as recorded. The point of the short is that a stranger watches to the end and follows: the words frame what they're about to hear, they don't oversell it.",
  "The title: for YouTube Shorts. Sentence case, under 70 characters, specific, the words that matter first. It can lean on the hook but never repeats it word for word. No ALL CAPS words, no exclamation marks, no em dashes, no emoji, no hashtags, no clickbait phrases, nothing in brackets.",
  "The description is the same on every platform, so it has to fit X: under 280 characters. One or two plain sentences in the author's voice saying what this is, adding to the hook rather than restating it. No hashtags anywhere: the author doesn't use them. Promise only what the short delivers. Never start with 'In this video' or 'In this short'. No emoji.",
  "Write it the way the author talks: first person singular, plain everyday words, British spelling. No em dashes, no exclamation marks, no ALL CAPS, no three-beat slogans, no coined aphorisms.",
  "The tags: eight to twelve, lower case, no hashtags, most specific first. The short's own topic in the ways people search for it, then the wider subject, then the broad ones (game development, indie game dev, devlog). Leave the game's name out: it's added for you. No tag longer than four words.",
].join("\n\n");

/** Hashtags out of a description (Tom, 2026-10-26: the platforms don't care any more), and the gap they leave. */
export const stripHashtags = (s: string) => s.replace(/(^|\s)#[\w-]+/g, "").replace(/\s+/g, " ").trim();

/** A short's title, description and tags (to Tom's instruction, if any; `had` = what's there now). */
export const writeShortPost = async (v: ScriptVoice, game: string, longTitle: string, short: { title: string; hook: string; why?: string; beats: string[] }, had: ShortPost | undefined, instruction: string): Promise<ShortPost> => {
  const sys = [`About the game and the person: ${v.about}`, "", "How they talk:", v.rules, "", SHORT_POST_RULES].join("\n");
  const user = [
    `The long video it's cut from: "${longTitle}".`,
    `The short's working title: "${short.title}".`,
    `Its hook, said first: "${short.hook}".`,
    ...(short.why ? [`Why it works as a short: ${short.why}`] : []),
    "",
    "What's said in it after the hook, beat by beat:",
    ...short.beats.map((b, i) => `${i + 1}. ${b}`),
    "",
    ...(had ? [`What's there now, which the author wants replaced:\nTitle: ${had.title}\n${had.description}\nTags: ${had.tags}`, ""] : []),
    ...(instruction.trim() ? [`The author says: ${instruction.trim()}`] : []),
    "Write the title, the description and the tags.",
  ].join("\n");
  const out = await ask(sys, user, ShortPostOut, "medium");
  const wanted = out.tags.map((x) => clean(x).toLowerCase().replace(/[#,<>"]/g, "").trim()).filter(Boolean);
  wanted.splice(Math.max(0, wanted.length - 3), 0, game.toLowerCase());
  const tags: string[] = [];
  let length = 0;
  for (const t of wanted) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (tags.includes(t) || length + cost > 500) continue;
    tags.push(t);
    length += cost;
  }
  return { title: clean(out.title).replace(/!/g, ".").slice(0, 100), description: stripHashtags(clean(out.description).replace(/!/g, ".")).slice(0, 280), tags: tags.join(", ") };
};

// ── titles to test (docs/design/desk-thumbnails.md) ──

const TitlesOut = z.object({
  titles: z.array(z.object({ text: z.string().describe("The title, sentence case, under 60 characters."), why: z.string().describe("One plain sentence to the author, calling them you: why someone scrolling would click it.") })),
});

const TITLE_RULES = [
  "You write YouTube titles for a long video one person made about making their game. The author tests up to three titles in YouTube's Test & compare, which picks the one people end up watching longest. So a title that gets the click and then disappoints loses: it has to hook and the video has to deliver it.",
  "A hook makes someone scrolling need to know: a stake, a surprise, a specific number, something the author got wrong or learnt the hard way, a claim that goes against what people assume, a question they've wondered about themselves. Specific beats vague. The author's own experience is the strongest thing they have over a big channel.",
  "Under 60 characters, so a phone shows all of it, with the words that matter first. Sentence case. Plain words the author would actually say, British spelling. No ALL CAPS words, no exclamation marks, no em dashes, no emoji, no hashtags, no clickbait phrases (you won't believe, shocking, insane), no brackets tacked on the end.",
  "The thumbnail sits beside the title: the title never repeats the thumbnail's words, it adds to them.",
  "Give three titles that try really different angles from each other and from the ones it already has. One of them can stay close to the working title and just sharpen it.",
].join("\n\n");

/** Three titles to test (to Tom's instruction, if any), different from the working one and the ones already there. */
export const planTitles = async (v: ScriptVoice, title: string, beats: string[], chapters: string[], thumbWords: string[], had: string[], instruction: string): Promise<{ text: string; why: string }[]> => {
  const sys = [`About the game and the person: ${v.about}`, "", "How they talk:", v.rules, "", TITLE_RULES].join("\n");
  const user = [
    `The working title: "${title}".`,
    ...(chapters.length ? ["", `Its chapters: ${chapters.join(" / ")}.`] : []),
    "",
    "What's said in it, beat by beat:",
    ...beats.map((b, i) => `${i + 1}. ${b}`),
    "",
    ...(thumbWords.length ? [`Words on the thumbnails being tried: ${thumbWords.map((w) => `"${w}"`).join(", ")}.`, ""] : []),
    ...(had.length ? ["Titles it already has (give different ones):", ...had.map((h) => `- ${h}`), ""] : []),
    ...(instruction.trim() ? [`The author says: ${instruction.trim()}`] : []),
    "Give three titles.",
  ].join("\n");
  const out = await ask(sys, user, TitlesOut, "medium");
  return out.titles
    .slice(0, 3)
    .map((t) => ({ text: clean(t.text).replace(/!/g, "").replace(/^["']|["']$/g, ""), why: clean(t.why) }))
    .filter((t) => t.text);
};

// ── the write-up: the long video as an article for the site's dev log (docs/design/desk-writeup.md) ──

const ArticleOut = z.object({
  title: z.string().describe("The article's title: what it is actually about, in the words someone would type to find it. Sentence case, under 70 characters."),
  description: z.string().describe("One or two sentences, under 160 characters, on what the article covers, specifically. Never starts with 'In this article'."),
  slug: z.string().describe("The URL: three to six lower-case words from the title joined by hyphens, no filler words, ascii only."),
  body: z.string().describe("The article, as markdown: paragraphs, ## headings between sections, - lists where the script lists. No title line at the top."),
});

export type Article = z.infer<typeof ArticleOut>;

const ARTICLE_RULES = [
  "You turn the script of a long YouTube video one person made about making their game into an article for their own website. The article goes on a page with the video at the top, but the reader is someone who found the page by searching, not someone watching, so the article has to stand on its own. Nothing in it refers to the video, to watching, to the screen, to what is being shown, to subscribing, liking, commenting, links below, the channel, or earlier or later videos. Where the script says 'as you can see' or 'here's what that looks like', say the thing in words instead, from what the script says about it.",
  "It is the author's writing, taken from spoken to written, not a new piece. Keep every point and the author's order. Keep their sentences wherever they read fine on the page; change a sentence only where spoken rhythm doesn't read (a false start, a run-on, 'so', 'right', 'okay'), and then change as little of it as will fix that. Never add a fact, a number, a feature or a claim that isn't in the script. Never add an introduction saying what the article covers, a summary at the end, a sign-off, or a transition the author didn't write. Start with the first real point. End with the last real point.",
  "Sections get ## headings in plain words, sentence case: the script's chapters if there are any, otherwise one every three to six paragraphs, and none at all for a short piece. Paragraphs of two to five sentences. A list only where the script lists things. No bold or italics for emphasis, no title line. Markdown only: paragraphs, ## headings, - lists.",
  "Hard rules: first person singular, British spelling, everyday words, no em dashes, no ALL CAPS, no exclamation marks, no three-beat slogans, no coined aphorisms, no emoji, no hashtags.",
  "The title is for search, so it says what the piece is actually about in the words people would type, and it reads well written down (a title that only works beside a thumbnail doesn't). The description adds to the title; it never repeats it.",
  "The author's sources are listed under the article by the tool afterwards, so write no Sources, References or Links section and no footnotes.",
].join("\n\n");

/** The long cut as an article (to Tom's instruction, if any; `had` = what's there now, which he wants done again). */
export const writeArticle = async (v: ScriptVoice, game: string, samples: string[], title: string, beats: string[], chapters: string[], had: Pick<Article, "title" | "body"> | undefined, instruction: string): Promise<Article> => {
  const sys = [
    `About the game and the person (for you, not for the article): ${v.about}`,
    "",
    ...(samples.length
      ? [
          "THE AUTHOR'S OWN SCRIPTS, in full, so you can hear exactly how they write. Their voice is these, not a tidier version of these.",
          ...samples.map((s, i) => `--- script ${i + 1} ---\n${s}\n--- end ---`),
          "",
        ]
      : []),
    "The voice, in rules:",
    v.rules,
    "",
    ARTICLE_RULES,
  ].join("\n");
  const user = [
    `The game: ${game}. The video's title: "${title}".`,
    ...(chapters.length ? ["", `Its chapters, in order: ${chapters.join(" / ")}.`] : []),
    "",
    "The script, beat by beat, as it was read aloud:",
    ...beats.map((b, i) => `${i + 1}. ${b}`),
    "",
    ...(had ? [`What was written last time, which the author wants done again:\n# ${had.title}\n${had.body}`, ""] : []),
    ...(instruction.trim() ? [`The author says: ${instruction.trim()}`] : []),
    "Write the article.",
  ].join("\n");
  const out = await ask(sys, user, ArticleOut, "high");
  return {
    title: clean(out.title).replace(/!/g, "").slice(0, 120),
    description: clean(out.description).replace(/!/g, ".").slice(0, 300),
    slug: out.slug,
    body: out.body.replace(/—/g, ",").replace(/^#\s+.*\n+/, "").trim(),
  };
};
