/**
 * The Scripts tab's Claude calls: a pasted script → the long cut, as
 * beats, in Tom's voice; a re-paste → the cut adjusted to the change and
 * nothing else; one beat or the cut redone to an instruction; the picture
 * plan (docs/design/desk-ascii-scripts.md). Shorts are parked (decision 1
 * there): the calls that make them stay for later but nothing presses them. Same client and shape as draft.ts (the
 * queue's words): structured output, the game's own voice from
 * desk.config, the key from ANTHROPIC_API_KEY in apps/desk/.env.
 *
 * Server only.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type Beat, type BeatMood, type Cut, SCORE_MOODS, type Script, newId, picturesWanted, spokenSeconds, tokens } from "./scripts";

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
  "A BEAT is one thought: one to three sentences, roughly fifteen to forty words, a stretch that takes five to fifteen seconds to say. Every beat must read aloud on its own, because each is recorded on its own and a picture is hung on it.",
  "The long cut is the whole script, in the author's order, with every point kept. The job is a light edit to the voice, not a rewrite: keep the author's words wherever they already read well, fix what doesn't, and never invent a fact, a number or a feature that isn't in the source.",
].join("\n\n");

const SHORT_RULES = [
  "A SHORT is a self-contained vertical video of forty-five to seventy-five seconds spoken (about a hundred and twenty to two hundred words). It opens with the hook, makes one point, and ends without a sign-off. Reuse long beats word for word wherever they stand alone (mark them sameAs), so one recording serves both cuts; write new words only for the opening, the joins and the close. Make as many shorts as the script naturally holds: one idea gives one short, three distinct points give three. Never pad a short with filler, and never make a short from a point that needs the rest of the script to make sense.",
].join("\n\n");

const system = (v: ScriptVoice, samples: string[], shorts = false): string =>
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

// ── the picture plan ──

const PictureItemOut = z.object({
  n: z.number().describe("The beat's number in the list given."),
  pictures: z
    .array(z.string())
    .min(1)
    .max(2)
    .describe("One picture prompt; two only when the beat is marked LONG (the second follows the first while the beat is still being said: the same moment from another angle, or what it leads to)."),
  mood: z.enum(SCORE_MOODS).describe("What the music under this beat should feel like."),
  intensity: z.number().describe("0 to 1: how much is going on in the music. Most beats sit between 0.2 and 0.6; save 0.8 and up for the real peaks."),
  lift: z.boolean().describe("True only for the one or two beats that are the turn of the whole video (the music steps up a key). Almost always false."),
  pulled: z.array(z.string()).describe("Zero or one word, copied exactly as it appears in the beat, that the point turns on (a number, a name, a 'never'). Give one in roughly one beat in four, only where the word really is the point, never in two beats running. Empty for the rest."),
  chapter: z.string().nullable().describe("When a new chapter starts at this beat: its name, two to four words, plain, no numbering. null otherwise."),
});
const PicturesOut = z.object({ items: z.array(PictureItemOut) });

const PICTURE_RULES = [
  "You plan the pictures for a video one person made about making their game. Every beat of the script gets a picture on screen while it's said. Each picture is turned into ASCII art (built out of typed characters, light becoming glyphs, shadow becoming empty screen), so it must read as strong shapes of light against darkness.",
  "A picture prompt describes ONE scene as a still from a film: the subject, what it's doing, where the light falls from, the camera's angle and distance. One or two sentences, concrete and visual. No words, letters, numbers, screens full of text or UI in the picture (they turn to mush as glyphs). No style words (woodcut, ink, chiaroscuro): the style is added for you. Never a flat diagram or an icon.",
  "Show the beat's point as a moment, often a metaphor: a bug hunt can be a figure with a lantern in a cave; balancing a weapon can be a blacksmith weighing a blade. The game itself can appear (its arena, its fighters) when the beat is about it. Keep recurring subjects the same from picture to picture (the same person, the same arena, the same objects), so the video feels like one world, and let an image from early on come back when its idea does.",
  "Vary the framing down the video: close-ups, wide shots, from above, from low down. Never two pictures in a row with the same framing and subject.",
  `Moods for the music: ${SCORE_MOODS.join(", ")}. focus is for explaining how something works (the most common), curious for a question or a what-if, tense for a problem, eerie for something wrong or strange, driving for momentum and getting work done, melancholy for something lost or cut, triumph for the payoff; the first six are the soft ones. Neighbouring beats usually share a mood or move to a near one; a jump is for a real turn in the story.`,
  "Chapters: only when the video is long enough (the total is given). A chapter is a real turn in the story, never just a new paragraph. At most one every three minutes of speaking, so a ten minute video has three or four. When there are chapters, the first beat starts the first one. When the total is under six minutes, give no chapters at all.",
].join("\n\n");

export type PicturePlan = { prompts: string[]; mood: BeatMood; pulled: string[]; chapter?: string };

/** A picture plan for every beat given, by number: prompts (two for a LONG beat), the mood under it, a pulled word, a chapter. */
export const planPictures = async (v: ScriptVoice, title: string, beats: { n: number; text: string }[], all: { n: number; text: string }[]): Promise<Map<number, PicturePlan>> => {
  const sys = [`About the game and the person: ${v.about}`, "", PICTURE_RULES].join("\n");
  const total = all.reduce((t, b) => t + spokenSeconds(b.text), 0);
  const want = new Set(beats.map((b) => b.n));
  const user = [
    `The video: "${title}". About ${Math.round(total / 60)} minutes spoken (${total} seconds).`,
    "",
    "The whole script, beat by beat (roughly how long each takes to say in brackets; LONG = give two pictures):",
    ...all.map((b) => `${b.n}. (${spokenSeconds(b.text)}s${picturesWanted(b.text) > 1 ? ", LONG" : ""}) ${b.text}`),
    "",
    want.size === all.length ? "Give one item for every beat, by number." : `Give items only for these beats, by number: ${[...want].join(", ")}. The rest are already planned and are here for context.`,
  ].join("\n");
  const out = await ask(sys, user, PicturesOut, "medium");
  const plan = new Map<number, PicturePlan>();
  // A pulled word only lands if it's rare: never two beats running (the earlier one keeps it).
  let lastPulled = -9;
  for (const it of [...out.items].sort((a, b) => a.n - b.n)) {
    const n = Math.round(it.n);
    const beat = beats.find((b) => b.n === n);
    if (!beat) continue;
    const prompts = it.pictures.map(clean).filter(Boolean).slice(0, picturesWanted(beat.text));
    if (!prompts.length) continue;
    // A pulled word must really be in the beat (it's spelt from what's said).
    const said = new Set(tokens(beat.text));
    let pulled = it.pulled.map((w) => w.trim()).filter((w) => w && tokens(w).length === 1 && said.has(tokens(w)[0]!)).slice(0, 1);
    if (pulled.length && n - lastPulled < 2) pulled = [];
    if (pulled.length) lastPulled = n;
    plan.set(n, {
      prompts,
      mood: { mood: it.mood, intensity: Math.max(0, Math.min(1, it.intensity)), ...(it.lift ? { lift: true } : {}) },
      pulled,
      ...(it.chapter?.trim() ? { chapter: clean(it.chapter) } : {}),
    });
  }
  return plan;
};

const OnePromptOut = z.object({ prompt: z.string().describe("The new picture prompt: one scene as a film still, one or two sentences, no style words, no words in the picture.") });

/** One picture's prompt written again (to an instruction, or just differently), the whole script and the other pictures' prompts for context. */
export const redoPicturePrompt = async (
  v: ScriptVoice,
  title: string,
  beats: { n: number; text: string; prompts: string[] }[],
  n: number,
  k: number,
  instruction: string,
): Promise<string> => {
  const sys = [`About the game and the person: ${v.about}`, "", PICTURE_RULES].join("\n");
  const beat = beats.find((b) => b.n === n);
  if (!beat) throw new Error("that beat isn't in the script");
  const current = beat.prompts[k] ?? "";
  const user = [
    `The video: "${title}".`,
    "",
    "The script, beat by beat, with each picture's prompt as it stands (keep the new one in the same world):",
    ...beats.map((b) => [`${b.n}. ${b.text}`, ...b.prompts.map((p, i) => `   picture${b.prompts.length > 1 ? ` ${i + 1}` : ""}: ${p || "(none yet)"}`)].join("\n")),
    "",
    `Write a new prompt for beat ${n}${beat.prompts.length > 1 ? `, picture ${k + 1} (${k ? "the second half of the beat" : "the first half of the beat"})` : ""}.`,
    current ? `The prompt now, which the author wants replaced: ${current}` : "",
    instruction.trim() ? `The author says: ${instruction.trim()}` : "Make it a different, stronger idea than the one now: a scene that shows the beat's point at a glance, not a literal illustration of its words.",
  ]
    .filter(Boolean)
    .join("\n");
  const out = await ask(sys, user, OnePromptOut, "medium");
  return clean(out.prompt);
};
