import { unsaidLines } from "./doc";

/**
 * RESEARCH on a script (docs/design/desk-research.md): a few facts from
 * real sources, each one or two sentences pinned after one of Tom's own
 * sentences. They live here, not in the pasted text, so a re-paste from
 * the Google Doc can't wipe them: the script the rewrite reads is the
 * paste with the accepted ones WOVEN in after their anchors.
 *
 * This is the pure half (types, sentences, the weave, the quote check):
 * the page imports it too. The run itself is researcher.ts.
 */

/**
 * Which way a finding points. `supports` backs the point; `concedes` is
 * evidence against it that's weaker than the point (worth a "fair enough,
 * but…" line); `refutes` knocks the point down, so it's a note for Tom and
 * never goes in the script (Tom, 2026-10-17).
 */
export const STANCES = ["supports", "concedes", "refutes"] as const;
export type Stance = (typeof STANCES)[number];

/** offered: one of the best few, waiting on Tom. more: found, past the count. noted: a refutes Tom has seen. */
export const FINDING_STATUSES = ["offered", "more", "accepted", "rejected", "noted"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export type Finding = {
  id: string;
  /** Tom's sentence it goes after, exactly as it was in the paste. */
  anchor: string;
  /** The words to say (Tom's edit replaces Claude's). */
  text: string;
  /** One line for Tom on what was found (never read aloud). */
  note: string;
  stance: Stance;
  strength: "strong" | "fair";
  source: { url: string; title: string; publisher: string; date?: string };
  /** The source's own words. */
  quote: string;
  /** checked: the quote is on the page. unopened: the page couldn't be read here, so check it yourself. */
  check: "checked" | "unopened";
  /** A number in the words to say that isn't in the quote. */
  numberWarning?: string;
  status: FindingStatus;
};

export type ScriptResearch = {
  /** When the last run finished. */
  at: string;
  /** The paste it ran on. */
  source: string;
  findings: Finding[];
  /** Points nothing solid turned up for: Tom's sentence and what it claims. */
  unbacked: { anchor: string; claim: string }[];
  searches: number;
  /** Findings thrown out because the quote wasn't on the page. */
  dropped: number;
  /** Roughly what the run cost, in dollars (from the API's usage). */
  cost?: number;
};

/** A run in progress (or the one that just failed), for the page to show. */
export type ResearchState = { state: "running"; stage: string; startedAt: string } | { state: "failed"; error: string };

// ── how many ──

/** One addition per this many seconds spoken (Tom, 2026-10-17: scale with length). */
export const SECONDS_PER_FINDING = 120;
export const MAX_FINDINGS = 8;

/** How many findings a script of this many seconds spoken gets offered. */
export const findingsWanted = (seconds: number): number => Math.min(MAX_FINDINGS, Math.max(1, Math.round(seconds / SECONDS_PER_FINDING)));

// ── sentences ──

/** Lower case, letters and digits only, curly quotes straight: how two bits of text are compared. */
export const normal = (text: string): string =>
  text
    .toLowerCase()
    .replace(/&nbsp;| /g, " ")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/'/g, "")
    .replace(/[^a-z0-9%$£€.]+/g, " ")
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type Sentence = { text: string; start: number; end: number };

const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "*", "_"]);

/**
 * The paste as sentences, each with where it sits in the text. A sentence
 * ends at . ! ? or … (and any closing quote or bracket after) followed by a
 * space, or at a line break. "e.g." splits too: that's fine, because both
 * sides of every comparison are split the same way. A heading or one of
 * Tom's notes (a Doc's section title, its Sources list) isn't a sentence.
 */
export const sentences = (text: string): Sentence[] => {
  const out: Sentence[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const t = text.slice(start, end).trim();
    if (t) out.push({ text: t, start, end: start + text.slice(start, end).trimEnd().length });
    start = -1;
  };
  // Headings and Tom's notes (a Sources section) aren't said, so they're never sentences.
  const unsaid = unsaidLines(text);
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\n") {
      close(i);
      line++;
      continue;
    }
    if (start < 0) {
      if (/\s/.test(c)) continue;
      if (unsaid[line]) {
        const to = text.indexOf("\n", i);
        i = (to < 0 ? text.length : to) - 1;
        continue;
      }
      start = i;
    }
    if (c === "." || c === "!" || c === "?" || c === "…") {
      let j = i + 1;
      while (j < text.length && (text[j] === "." || text[j] === "!" || text[j] === "?" || text[j] === "…" || CLOSERS.has(text[j]!))) j++;
      if (j >= text.length || /\s/.test(text[j]!)) {
        close(j);
        i = j - 1;
      }
    }
  }
  close(text.length);
  return out;
};

/** The sentence in `list` that is `anchor` (punctuation and case aside). */
export const findSentence = (list: Sentence[], anchor: string): Sentence | undefined => {
  const a = normal(anchor);
  if (!a) return undefined;
  return list.find((s) => normal(s.text) === a);
};

// ── the weave ──

/** Where an accepted finding ended up: in after its anchor, already in Tom's paste, or nowhere (its anchor's gone). */
export type Placement = "placed" | "inDoc" | "lost";

/** The words of `needle` appear, in order and together, in `hay`. */
const contains = (hay: string, needle: string): boolean => {
  const n = normal(needle);
  return Boolean(n) && ` ${normal(hay)} `.includes(` ${n} `);
};

/**
 * The paste with every accepted finding put in after its anchor (in the
 * order they're listed), and where each one went. A finding whose words
 * are already in the paste (Tom copied it into his doc) isn't put in
 * twice; one whose anchor isn't in the paste any more is lost.
 */
export const weave = (source: string, findings: Pick<Finding, "id" | "anchor" | "text" | "status" | "stance">[]): { text: string; placed: Map<string, Placement> } => {
  const placed = new Map<string, Placement>();
  const list = sentences(source);
  const inserts: { at: number; text: string; order: number }[] = [];
  findings.forEach((f, order) => {
    if (f.status !== "accepted" || f.stance === "refutes" || !f.text.trim()) return;
    if (contains(source, f.text)) return void placed.set(f.id, "inDoc");
    const s = findSentence(list, f.anchor);
    if (!s) return void placed.set(f.id, "lost");
    inserts.push({ at: s.end, text: f.text.trim(), order });
    placed.set(f.id, "placed");
  });
  // Back to front, so earlier offsets stay true; two on one anchor go in list order.
  inserts.sort((a, b) => b.at - a.at || b.order - a.order);
  let text = source;
  for (const x of inserts) text = `${text.slice(0, x.at)} ${x.text}${text.slice(x.at)}`;
  return { text, placed };
};

/** The script the rewrite reads: Tom's paste, plus the research he's accepted. */
export const wovenSource = (s: { source: string; research?: Pick<ScriptResearch, "findings"> }): string => (s.research?.findings.length ? weave(s.source, s.research.findings).text : s.source);

// ── the quote check ──

/** A web page as plain text: no scripts, styles or tags, the common entities decoded. */
export const pageText = (html: string): string =>
  html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|td|th|blockquote|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" })[e] ?? " ")
    .replace(/[ \t]+/g, " ");

/**
 * The quote is on the page: every piece of it (split at an ellipsis, so a
 * quote that skips words still counts) appears there word for word, case,
 * punctuation and curly quotes aside. A piece under three words proves
 * nothing, so it's skipped unless it's all there is.
 */
export const quoteOnPage = (quote: string, page: string): boolean => {
  const hay = ` ${normal(page)} `;
  const pieces = quote
    .split(/\.\.\.|…|\[\.\.\.\]|\[…\]/)
    .map(normal)
    .filter(Boolean);
  if (!pieces.length) return false;
  const real = pieces.filter((p) => p.split(" ").length >= 3);
  return (real.length ? real : pieces).every((p) => hay.includes(` ${p} `));
};

/** The numbers written in digits in a text: "1,200" → "1200", "40%" → "40". */
export const numbersIn = (text: string): string[] => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "").replace(/\.0+$/, ""));

/**
 * A number in the words to say that the quote doesn't have, for a
 * warning (the addition may round or restate, so it's a flag, not a drop).
 * Years in the quote's date or the words themselves aside.
 */
export const strayNumber = (text: string, quote: string, date = ""): string | undefined => {
  const known = new Set([...numbersIn(quote), ...numbersIn(date)]);
  return numbersIn(text).find((n) => !known.has(n));
};

// ── for the doc and the description ──

/** The order findings sit in the paste (by anchor), unanchored ones last. */
export const inScriptOrder = <F extends Pick<Finding, "anchor">>(source: string, findings: F[]): F[] => {
  const list = sentences(source);
  const at = (f: F) => findSentence(list, f.anchor)?.start ?? Infinity;
  return [...findings].sort((a, b) => at(a) - at(b));
};

/** Accepted findings that aren't in the paste yet, as lines Tom can put into his doc. */
export const forTheDoc = (source: string, findings: Finding[]): string => {
  const { placed } = weave(source, findings);
  return inScriptOrder(
    source,
    findings.filter((f) => placed.get(f.id) === "placed" || placed.get(f.id) === "lost"),
  )
    .map((f) => `After "${f.anchor}" add:\n${f.text}`)
    .join("\n\n");
};

/** The YouTube description's sources: one line per accepted finding, in script order. */
export const sourcesBlock = (source: string, findings: Finding[]): string => {
  const used = inScriptOrder(
    source,
    findings.filter((f) => f.status === "accepted" && f.stance !== "refutes"),
  );
  const seen = new Set<string>();
  const lines = used.flatMap((f) => {
    if (seen.has(f.source.url)) return [];
    seen.add(f.source.url);
    const year = /\b(19|20)\d{2}\b/.exec(f.source.date ?? "")?.[0];
    return [`${f.source.publisher}${f.source.title ? `, "${f.source.title}"` : ""}${year ? ` (${year})` : ""}: ${f.source.url}`];
  });
  return lines.length ? ["Sources", ...lines].join("\n") : "";
};
