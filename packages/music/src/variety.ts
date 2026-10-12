/**
 * Keeps neighbouring saves from sounding alike. Left to the seed, each slot
 * rolled its style on its own, so the same one came up twice running about a
 * fifth of the time (10-12, three slow guitar-ish tunes in a row). Instead
 * each slot walks an endless run of shuffled decks (every style once per
 * deck), and takes the first that suits its mood, skipping the ones the two
 * slots either side would take. That brings a repeat within two slots down
 * to about 6% when the neighbours are only guessed. Given the styles the
 * last two slots actually got (`recent`, from the Desk's slot ledger), it
 * never repeats them unless the mood has nothing else.
 *
 * Before the deck, the save's own favourites get a say: the styles Claude
 * chose for it, best first (Autosave's desk.server.ts). The first of those
 * the neighbours didn't get wins; the deck only decides when none is left.
 *
 * The key and the tempo walk their own decks, so neighbours don't share
 * those either.
 */
import { mulberry } from "@heroic/ascii-build";
import { STYLE_NAMES, type StyleName, type Vary, stylesFor } from "./compose";
import type { Mood } from "./mood";

/** The i-th item of an endless run of shuffled decks; a deck never starts
 * on the item the one before it ended on. */
const deckAt = <T>(xs: readonly T[], salt: number, i: number): T => {
  const deck = (c: number) => {
    const r = mulberry(c * 977 + salt);
    const d = [...xs];
    for (let k = d.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [d[k], d[j]] = [d[j]!, d[k]!];
    }
    return d;
  };
  const n = xs.length;
  const c = Math.floor(i / n);
  const d = deck(c);
  if (c > 0 && n > 1 && d[0] === deck(c - 1)[n - 1]) [d[0], d[1]] = [d[1]!, d[0]!];
  return d[((i % n) + n) % n]!;
};

const SHIFTS = [-2, -1, 0, 1, 2];
/** Slow, middling, quick (with a little give either side). */
const PACES = [0.1, 0.5, 0.9];

/** The style, key and pace for a slot (1, 2, 3…). `take` 1, 2… is another go
 * at the same slot: the next suitable style along, a different key. `recent`:
 * the styles the slots before actually got, newest first, when known.
 * `preferred`: the save's own favourite styles, best first. */
export const slotVariety = (slot: number, mood: Mood, take = 0, recent: string[] = [], preferred: StyleName[] = []): Vary & { style: StyleName } => {
  const i = slot - 1;
  const suits = stylesFor(mood);
  const style = (at: number) => deckAt(STYLE_NAMES, 41, at);
  // Avoid what the two slots either side got (or would take, as far as we
  // know); if the mood has too few styles for that, ease off a step at a time.
  const before = recent.length ? recent.slice(0, 2) : [style(i - 1), style(i - 2)];
  // The save's favourites first, skipping only what the slots before really
  // got. A favourite needn't be on the mood's usual list: it was chosen for
  // this picture. `take` walks on through them, then into the deck.
  const favourites = preferred.filter((s) => STYLE_NAMES.includes(s) && !recent.slice(0, 2).includes(s));
  const fresh = (avoid: string[], nth: number) => {
    const picks: StyleName[] = [];
    for (let k = 0; k < 3 * STYLE_NAMES.length && picks.length <= nth; k++) {
      const s = style(i + k);
      if (suits.includes(s) && !avoid.includes(s) && !favourites.includes(s) && !picks.includes(s)) picks.push(s);
    }
    return picks[nth];
  };
  const nth = take - favourites.length;
  const chosen =
    favourites[take] ??
    fresh([...before, style(i + 1), style(i + 2)], nth) ??
    fresh(before, nth) ??
    fresh(before.slice(0, 1), nth) ??
    suits[take % suits.length]!;
  const give = (mulberry(slot * 13 + take * 7 + 5)() - 0.5) * 0.2;
  return {
    style: chosen,
    chimeShift: deckAt(SHIFTS, 73, i + take * 2),
    pace: Math.min(1, Math.max(0, deckAt(PACES, 19, i + take) + give)),
  };
};
