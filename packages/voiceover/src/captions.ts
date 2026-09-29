/**
 * Words → what's on screen. A PAGE is one screenful of caption: the words
 * shown together and the span they're up for.
 *
 *  - tiktok: a few words at a time, the spoken one lit.
 *  - regular: a subtitle, a phrase at a time, changing at pauses, the
 *    spoken word picked out in colour.
 */
import type { CaptionStyle } from "./types";

export type CaptionWord = { text: string; start: number; end: number };
export type Page = { start: number; end: number; words: CaptionWord[] };

export type PageRules = {
  /** Most words on screen at once. */
  maxWords: number;
  /** Most characters on screen at once (spaces included). */
  maxChars: number;
  /** A silence this long (seconds) always starts a new page. */
  gap: number;
  /** How long a page lingers after its last word, if nothing replaces it. */
  hold: number;
};

export const PAGE_RULES: Record<Exclude<CaptionStyle, "off">, PageRules> = {
  tiktok: { maxWords: 3, maxChars: 18, gap: 0.35, hold: 0.25 },
  regular: { maxWords: 14, maxChars: 56, gap: 0.7, hold: 0.5 },
};

const endsSentence = (text: string) => /[.!?…]["')\]]?$/.test(text.trim());
const endsClause = (text: string) => /[,;:]["')\]]?$/.test(text.trim());

export const pagesOf = (words: CaptionWord[], style: Exclude<CaptionStyle, "off">, rules: PageRules = PAGE_RULES[style]): Page[] => {
  const pages: Page[] = [];
  let cur: CaptionWord[] = [];
  const chars = (ws: CaptionWord[]) => ws.reduce((n, w) => n + w.text.trim().length, 0) + Math.max(0, ws.length - 1);
  const flush = () => {
    if (cur.length) pages.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (!w.text.trim()) continue;
    const last = cur[cur.length - 1];
    if (last) {
      const full = cur.length >= rules.maxWords || chars([...cur, w]) > rules.maxChars;
      const paused = w.start - last.end >= rules.gap;
      // A subtitle also turns the page at a comma once it's mostly full, so lines break where speech does.
      const clause = style === "regular" && endsClause(last.text) && chars(cur) >= rules.maxChars * 0.6;
      // …and at a shorter pause once there's a fair line up, so a breath ends the caption rather than the character count.
      const breath = style === "regular" && w.start - last.end >= rules.gap / 2 && chars(cur) >= rules.maxChars * 0.4;
      if (full || paused || endsSentence(last.text) || clause || breath) flush();
    }
    cur.push(w);
  }
  flush();
  // Each page stays up until the next one, or lingers `hold` after its last word.
  return pages.map((p, i) => {
    const next = pages[i + 1];
    const linger = p.end + rules.hold;
    return { ...p, end: next ? Math.min(Math.max(p.end, next.start), linger) : linger };
  });
};

export const pageAt = (pages: Page[], t: number): Page | undefined => pages.find((p) => t >= p.start && t < p.end);

/** The word being said at `t` on a page; before the first, none. After a word ends it stays lit until the next starts. */
export const activeWord = (page: Page, t: number): number => {
  let active = -1;
  page.words.forEach((w, i) => {
    if (t >= w.start) active = i;
  });
  return active;
};

/** TikTok captions read as speech, not prose: no trailing commas or full stops. Questions keep their mark. */
export const bareWord = (text: string): string => text.trim().replace(/[.,;:]+$/g, "");
