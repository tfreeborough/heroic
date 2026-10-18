/**
 * The research run (docs/design/desk-research.md), server side. One press
 * on a finished draft:
 *
 *   1. SEARCH: Claude reads the draft as numbered sentences, picks the
 *      points worth backing up, and works the web (search + fetch, both
 *      Anthropic's server tools) into a plain-text report of findings,
 *      each with the source's own words.
 *   2. WRITE: a second call turns the report into findings, the words to
 *      say written in Tom's voice (the rewrite's own system prompt).
 *   3. CHECK: every quote is looked for on its page: the text the fetch
 *      tool brought back in step 1, or the Desk's own fetch of the URL.
 *      A quote that isn't there is dropped and never shown.
 *
 * Runs in the background (a few minutes); the page polls researchState.
 * Accepted and rejected findings from an earlier run carry over.
 */
import type Anthropic from "@anthropic-ai/sdk";
import AnthropicClient from "@anthropic-ai/sdk";
import { z } from "zod";
import type { GameConfig } from "../game";
import { type Finding, type FindingStatus, type ResearchState, type ScriptResearch, FINDING_STATUSES, STANCES, findingsWanted, normal, pageText, quoteOnPage, sentences, strayNumber } from "./research";
import { MODEL, ask, hasClaude, system } from "./rewrite";
import { spokenText, stripMarks } from "./doc";
import { newId, spokenSeconds } from "./scripts";
import { readScript, saveScript, voiceSamples } from "./scriptsStore";

// ── state ──

const runs = new Map<string, ResearchState>();
/** What a script's research run is doing (nothing once it's finished and saved). */
export const researchState = (id: string): ResearchState | undefined => runs.get(id);

// ── what good looks like ──

/** Claude's judgement on sources (Tom, 2026-10-17: "use your best judgement on what to trust"). */
const SOURCE_RULES = [
  "WHAT COUNTS AS A SOURCE, best first:",
  "1. Primary: the original survey, study, report or dataset; a platform's own published figures (Valve/Steam, Apple, Google, Epic, Microsoft, Sony, Nintendo); company filings and earnings; a developer's own postmortem, blog, talk (GDC Vault and the like) or interview about their own game; peer-reviewed research.",
  "2. Established journalism and trade press that did the reporting or names its primary source: Game Developer, GamesIndustry.biz, PocketGamer.biz, Mobilegamer.biz, PC Gamer, Eurogamer, Rock Paper Shotgun, Polygon, Kotaku, The Verge, Ars Technica, Wired, the BBC, the Guardian, Reuters, Bloomberg, the FT. When an article cites a survey or study, go and find the original and use that if you can open it.",
  "3. Data trackers (VG Insights, Gamalytic, SteamDB, Sensor Tower, Newzoo's free summaries and the like) only for figures nobody publishes directly, and only as estimates: say so.",
  "Never use: SEO listicles and 'statistics' roundup sites that don't link the primary source (follow the link instead), content farms, AI-written summaries, Wikipedia itself (follow its citation), Reddit or forum posts (unless it's the developer talking about their own game), or a press release selling the thing the claim is about.",
  "Recent wins where things change: for anything about the market, sales, players or money, prefer the last three years; an older source only when it's still the definitive one, and then its year matters.",
].join("\n");

const searchSystem = (about: string) =>
  [
    "You research facts for a video script. One person wrote the script about making their game and will read it aloud on YouTube. Your job is to find a few real, checkable facts that back up their points, or that a fair viewer would raise against them, so the video lands harder and nobody can catch it out.",
    "",
    `About the game and the person: ${about}`,
    "",
    SOURCE_RULES,
    "",
    "HOW TO WORK:",
    "- Read the whole draft first. Pick the spots where a real fact would help most: a claim stated as true (a number, a 'most', a 'nobody', a 'always'), or a general line where a specific fact would hit harder. Skip the author's own story (what they did, felt or decided): that's theirs, not something to source.",
    "- For each spot, search, then OPEN the page with web_fetch and read it. Copy the quote from the page itself, never from a search snippet or from memory. The quote must be the page's exact words, numbers exactly as written; it will be checked against the page and dropped if it isn't there.",
    "- Look for evidence against the point as well as for it. If something cuts against it, say how badly: does it weaken the point (concedes) or knock it down altogether (refutes)?",
    "- Quality over quantity. A spot with nothing solid is reported as unbacked, never filled with a weak source.",
    "",
    "WHEN YOU'RE DONE, write the report, and only the report, in exactly this shape (one block per finding, best first, then one block per spot with nothing solid):",
    "",
    "FINDING",
    "sentence: <the number of the author's sentence it goes after>",
    "stance: supports | concedes | refutes",
    "strength: strong | fair",
    "url: <the page you opened>",
    "title: <the page's title>",
    "publisher: <who published it>",
    "date: <when, as precise as the page says, or unknown>",
    "quote: <one to three sentences copied exactly from the page>",
    "shows: <one plain line on what this tells the viewer>",
    "END",
    "",
    "UNBACKED",
    "sentence: <number>",
    "claim: <what the sentence claims, in a few words>",
    "END",
  ].join("\n");

// ── output shape for step 2 ──

const FindingOut = z.object({
  sentence: z.number().describe("The number of the author's sentence this goes after, from the report."),
  stance: z.enum(STANCES),
  strength: z.enum(["strong", "fair"]),
  text: z
    .string()
    .describe("The words the author will say, straight after their sentence: one or two sentences in their voice. Empty for refutes (a refutes is never said)."),
  note: z.string().describe("One plain line for the author on what this source shows (not read aloud)."),
  url: z.string(),
  title: z.string(),
  publisher: z.string(),
  date: z.string().nullable().describe("When it was published, as the report gives it; null when unknown."),
  quote: z.string().describe("The quote, copied character for character from the report."),
});
const WriteOut = z.object({
  findings: z.array(FindingOut).describe("Every finding in the report that is worth using, best first."),
  unbacked: z.array(z.object({ sentence: z.number(), claim: z.string() })),
});

const ADDITION_RULES = [
  "You're turning a research report into additions for the author's script. Each addition is said straight after one of their sentences and must read as if they wrote it: same voice, same rhythm, plain spoken English.",
  "- Name the source the way a person would out loud: 'a GDC survey last year found…', 'Valve's own numbers show…', 'the developer of X said in their postmortem…'. Never a URL, never 'according to a source'.",
  "- Say numbers the way you'd say them aloud, but never change what they are. Round only the way the quote allows ('just under half' for 48%).",
  "- Use only what the report says. Never add a fact, a number or a claim that isn't in its quote.",
  "- supports: the fact, said plainly, in a way that backs up the sentence before it.",
  "- concedes: a fair 'to be fair…' line that gives the other side its due and names the source. Don't argue back for the author beyond what their own script goes on to say.",
  "- refutes: no words to say (text empty). The note tells the author plainly what the source says against their point.",
  "- One or two sentences, never more. No em dashes, no exclamation marks, British spelling.",
  "- Drop any finding whose quote doesn't actually support what the addition would say, and any that repeats another.",
].join("\n");

// ── the calls ──

const client = () => new AnthropicClient();

/** Opus 5.5 list prices, dollars per million tokens, and a web search each. */
const PRICE = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5, search: 0.01 };
type Spend = { cost: number; searches: number };
const spend = (u: Anthropic.Usage, s: Spend) => {
  s.cost += ((u.input_tokens ?? 0) * PRICE.in + (u.output_tokens ?? 0) * PRICE.out + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) / 1e6;
  const n = u.server_tool_use?.web_search_requests ?? 0;
  s.searches += n;
  s.cost += n * PRICE.search;
};

/** A URL as two fetches of the same page would agree on it. */
const pageKey = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url;
  }
};

/** Step 1: the search loop. The report, and the text of every page the fetch tool read (to check quotes against). */
const search = async (about: string, numbered: string, want: number, avoid: string, spent: Spend, stage: (s: string) => void): Promise<{ report: string; pages: Map<string, string> }> => {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        "The draft, sentence by sentence:",
        "",
        numbered,
        "",
        `Find up to ${want + 3} findings, best first: the author will use about ${want}. Fewer is fine when the good ones run out.`,
        ...(avoid ? ["", avoid] : []),
      ].join("\n"),
    },
  ];
  const tools: Anthropic.ToolUnion[] = [
    { type: "web_search_20260209", name: "web_search", max_uses: Math.min(30, want * 4 + 6) },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: Math.min(25, want * 3 + 6), max_content_tokens: 30000 },
  ];
  const pages = new Map<string, string>();
  const texts: string[] = [];
  for (let turn = 0; turn < 8; turn++) {
    const res = await client()
      // Cached: the search loop re-reads the draft and every page so far on each step, and caching makes the re-reads a tenth of the price.
      .messages.stream({ model: MODEL, max_tokens: 32000, cache_control: { type: "ephemeral" }, output_config: { effort: "high" }, system: searchSystem(about), tools, messages })
      .finalMessage();
    spend(res.usage, spent);
    for (const b of res.content) {
      if (b.type === "text") texts.push(b.text);
      if (b.type === "web_fetch_tool_result" && b.content.type === "web_fetch_result" && b.content.content.source.type === "text") pages.set(pageKey(b.content.url), b.content.content.source.data);
    }
    stage(`searching (${spent.searches} search${spent.searches === 1 ? "" : "es"}, ${pages.size} page${pages.size === 1 ? "" : "s"} read)`);
    if (res.stop_reason === "refusal") throw new Error("Claude declined to research this one");
    if (res.stop_reason !== "pause_turn") break;
    // The server's tool loop paused: hand its turn back and it carries on where it was.
    messages.push({ role: "assistant", content: res.content });
  }
  const report = texts.join("\n").trim();
  if (!/FINDING|UNBACKED/.test(report)) throw new Error("the research came back without a report; try again");
  return { report, pages };
};

/** Step 3: is the quote on the page? Checked against what the fetch tool read, else the Desk fetches it. */
const checkQuote = async (url: string, quote: string, pages: Map<string, string>): Promise<"checked" | "unopened" | "missing"> => {
  const seen = pages.get(pageKey(url));
  if (seen && quoteOnPage(quote, seen)) return "checked";
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/html|text|xml|json/.test(type)) return seen ? "missing" : "unopened";
    const page = pageText(await res.text());
    if (quoteOnPage(quote, page)) return "checked";
    // A page that came back nearly empty is drawn by script, or a wall: it can't be read here, so it's not proof the quote is wrong.
    return seen || normal(page).length > 1500 ? "missing" : "unopened";
  } catch {
    return seen ? "missing" : "unopened";
  }
};

const run = async (g: GameConfig, id: string) => {
  const stage = (s: string) => runs.set(id, { state: "running", stage: s, startedAt: (runs.get(id) as { startedAt?: string })?.startedAt ?? new Date().toISOString() });
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  const v = g.script!.ai;
  const source = s.source;
  const list = sentences(source);
  if (!list.length) throw new Error("paste the script first");
  const want = findingsWanted(spokenSeconds(spokenText(source)));
  const numbered = list.map((x, i) => `${i + 1}. ${stripMarks(x.text)}`).join("\n");
  const kept = (s.research?.findings ?? []).filter((f) => f.status === "accepted" || f.status === "rejected");
  const avoid = kept.length
    ? [
        "Already handled in an earlier run (don't find these again):",
        ...kept.map((f) => `- ${f.status === "accepted" ? "in the script" : "turned down by the author"}: ${f.source.url} (${f.note || f.text})`),
      ].join("\n")
    : "";
  const spent: Spend = { cost: 0, searches: 0 };

  stage("reading the draft");
  const { report, pages } = await search(v.about, numbered, want, avoid, spent, stage);

  stage("writing the additions in your voice");
  const written = await ask(
    [system(v, voiceSamples(g, id)), "", "", ADDITION_RULES].join("\n"),
    ["THE AUTHOR'S DRAFT, sentence by sentence:", numbered, "", "THE RESEARCH REPORT:", report, "", "Write the findings and the unbacked list."].join("\n"),
    WriteOut,
    "high",
    (u) => spend(u, spent),
  );

  stage("checking every quote is on its page");
  const seenKeys = new Set(kept.map((f) => normal(f.quote)));
  let dropped = 0;
  const checked = await Promise.all(
    written.findings.map(async (f) => {
      const anchor = list[Math.round(f.sentence) - 1]?.text;
      const quote = f.quote.trim();
      const text = f.stance === "refutes" ? "" : f.text.replace(/—/g, ", ").replace(/\s+/g, " ").trim();
      if (!anchor || !quote || !/^https?:\/\//.test(f.url) || (f.stance !== "refutes" && !text)) return null;
      if (seenKeys.has(normal(quote))) return null;
      seenKeys.add(normal(quote));
      const check = await checkQuote(f.url, quote, pages);
      if (check === "missing") {
        dropped++;
        console.warn(`⚠ research ${id}: quote not found on ${f.url}: "${quote.slice(0, 80)}"`);
        return null;
      }
      const date = f.date?.trim() && !/^unknown$/i.test(f.date.trim()) ? f.date.trim() : undefined;
      const stray = text ? strayNumber(text, quote, date) : undefined;
      const out: Finding = {
        id: newId(),
        anchor,
        text,
        note: f.note.trim(),
        stance: f.stance,
        strength: f.strength,
        source: { url: f.url.trim(), title: f.title.trim(), publisher: f.publisher.trim(), ...(date ? { date } : {}) },
        quote,
        check,
        ...(stray ? { numberWarning: stray } : {}),
        status: "offered",
      };
      return out;
    }),
  );
  // The best few are offered (Claude ranked them); the rest wait under "more". Everything against the point is shown.
  let offered = 0;
  const fresh = checked.flatMap((f): Finding[] => {
    if (!f) return [];
    if (f.stance === "refutes") return [f];
    return [{ ...f, status: offered++ < want ? "offered" : "more" }];
  });
  const research: ScriptResearch = {
    at: new Date().toISOString(),
    source,
    findings: [...kept, ...fresh],
    unbacked: written.unbacked.flatMap((u) => {
      const anchor = list[Math.round(u.sentence) - 1]?.text;
      return anchor ? [{ anchor, claim: u.claim.trim() }] : [];
    }),
    searches: spent.searches,
    dropped,
    cost: Math.round(spent.cost * 100) / 100,
  };
  // Saved onto the script as it is now: Tom may have typed while it ran.
  const now = readScript(g, id);
  if (!now) throw new Error("the script was deleted while it was being researched");
  saveScript(g, { ...now, research });
};

/** Start a research run in the background. Answers at once. */
export const startResearch = (g: GameConfig, id: string): ResearchState => {
  if (!hasClaude()) throw new Error("no ANTHROPIC_API_KEY in apps/desk/.env");
  if (!g.script?.ai) throw new Error(`${g.name} has no script voice (script.ai in its desk.config)`);
  const s = readScript(g, id);
  if (!s) throw new Error(`no script ${id}`);
  if (!s.source.trim()) throw new Error("paste the script first");
  const cur = runs.get(id);
  if (cur?.state === "running") return cur;
  const state: ResearchState = { state: "running", stage: "starting", startedAt: new Date().toISOString() };
  runs.set(id, state);
  void run(g, id).then(
    () => runs.delete(id),
    (e: Error) => {
      console.warn(`⚠ research ${id}: ${e.message}`);
      runs.set(id, { state: "failed", error: e.message });
    },
  );
  return state;
};

/** Tom's call on one finding: its status, his words, or a new anchor (a lost one put back). Answers with the research. */
export const decide = (g: GameConfig, id: string, findingId: string, d: { status?: string; text?: string; anchor?: string }): ScriptResearch => {
  const s = readScript(g, id);
  if (!s?.research) throw new Error("no research on this script yet");
  const f = s.research.findings.find((x) => x.id === findingId);
  if (!f) throw new Error("that finding isn't there any more");
  const next: Finding = { ...f };
  if (d.status !== undefined) {
    if (!FINDING_STATUSES.includes(d.status as FindingStatus)) throw new Error(`no such status ${d.status}`);
    if (d.status === "accepted" && f.stance === "refutes") throw new Error("something against the point is a note, not a line in the script");
    next.status = d.status as FindingStatus;
  }
  if (d.text !== undefined && f.stance !== "refutes") {
    const text = String(d.text).replace(/\s+/g, " ").trim().slice(0, 600);
    if (!text) throw new Error("an addition needs some words");
    next.text = text;
    const stray = strayNumber(text, f.quote, f.source.date);
    if (stray) next.numberWarning = stray;
    else delete next.numberWarning;
  }
  if (d.anchor !== undefined) {
    const at = sentences(s.source).find((x) => x.text === d.anchor);
    if (!at) throw new Error("that sentence isn't in the script");
    next.anchor = at.text;
  }
  const research = { ...s.research, findings: s.research.findings.map((x) => (x.id === findingId ? next : x)) };
  saveScript(g, { ...s, research });
  return research;
};
