/**
 * The queue's words, written by Claude when a key is present: the variable
 * part of a post (the lead line, one sentence of context, a question for
 * the comments, a few title options) in the game's own voice. The fixed
 * part — the game line, the ask, the hashtags — stays code (the game's
 * `post.ai.boilerplate`), so every post pitches the same thing the same way.
 *
 * Server only. The key comes from ANTHROPIC_API_KEY (apps/desk/.env, which
 * Bun loads on its own; gitignored). Without it, nothing here is called.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const hasClaude = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

/** What a game gives the drafter: who's talking and how (desk.config `post.ai`). */
export type AiVoice = {
  /** One paragraph on the game, for the model's own understanding — not pasted into posts. */
  about: string;
  /** The voice rules, plain prose. */
  rules: string;
  /** Lines actually written in the voice, so the model hears it. */
  examples: string[];
  /** Appended, verbatim, to every description after the drafted part. */
  boilerplate: string;
  /** Appended to the title where it fits in 100 characters, e.g. "Blood in the Sand". */
  titleSuffix?: string;
};

/** What we know about the video being posted. */
export type DraftInput = {
  template: string;
  /** The hook / line on the video (a hook clip's own variant, not the whole `a | b | c`). */
  hook: string;
  /** The recording's note from its sidecar, if any: what happens in the clip. */
  note: string;
  /** For a spotlight: the item and its codex quote. */
  item?: { name: string; tagline: string };
};

export type AiDraft = { title: string; titleOptions: string[]; description: string };

const Out = z.object({
  lead: z.string().describe("The first line of the caption: the hook, or a sharper version of it. One sentence, under 90 characters, no hashtags."),
  context: z.string().describe("One plain sentence under the lead saying what's happening in the clip. Empty string if nothing is known."),
  question: z.string().describe("One short question for the comments, about a choice a player would argue over. Ends with a question mark."),
  titles: z.array(z.string()).min(3).max(4).describe("Three or four title options for YouTube Shorts, each under 80 characters, no hashtags, no ALL CAPS, each taking a different angle."),
});

const system = (v: AiVoice): string =>
  [
    "You write the caption and title for a short vertical video (TikTok, YouTube Shorts, Instagram Reels) posted by the one person who made the game.",
    "",
    `About the game (for you, not for the post): ${v.about}`,
    "",
    "The voice:",
    v.rules,
    "",
    "Lines written in that voice, so you can hear it:",
    ...v.examples.map((e) => `- ${e}`),
    "",
    "Hard rules: first person singular, British spelling, everyday words, no em dashes, no ALL CAPS, no exclamation marks, no three-beat slogans, no emoji, no hashtags (they are added separately), never invent features or numbers that aren't in the input. Vary your angle between calls: outcome, unfair rule, a question, the maker talking.",
  ].join("\n");

const user = (i: DraftInput): string =>
  [
    `Template: ${i.template}`,
    i.hook ? `Hook on the video: ${i.hook}` : "Hook on the video: (none)",
    i.item ? `The item shown: ${i.item.name}. Its codex line: ${i.item.tagline}` : "",
    i.note ? `What happens in the clip (the maker's own note): ${i.note}` : "",
    "",
    "Write the lead, the context sentence, the comments question, and the title options.",
  ]
    .filter((l) => l !== "")
    .join("\n");

/** Draft with Claude. Throws on API failure; the caller keeps its template words. */
export const draftWithClaude = async (v: AiVoice, input: DraftInput): Promise<AiDraft> => {
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2048,
    output_config: { effort: "low", format: zodOutputFormat(Out) },
    system: system(v),
    messages: [{ role: "user", content: user(input) }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined to draft this one");
  const out = res.parsed_output;
  if (!out) throw new Error(`no draft came back (stop reason ${res.stop_reason})`);
  const clean = (s: string) => s.replace(/—/g, ",").replace(/\s+/g, " ").trim();
  const titleOptions = out.titles.map(clean).filter(Boolean);
  const withSuffix = (t: string) => (v.titleSuffix && `${t} | ${v.titleSuffix}`.length <= 100 ? `${t} | ${v.titleSuffix}` : t.slice(0, 100));
  const description = [clean(out.lead), clean(out.context), clean(out.question), v.boilerplate.trim()].filter(Boolean).join("\n\n");
  return { title: withSuffix(titleOptions[0] ?? clean(out.lead)), titleOptions: titleOptions.map(withSuffix), description };
};
