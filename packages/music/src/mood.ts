/**
 * Reads a save's words for a mood, so its music fits the memory. Plain word
 * lists, no model: free, instant and the same answer every time. The memory
 * line counts most, then the title and tagline, then the journal.
 */
import { mulberry } from "@heroic/ascii-build";

/** The six loading-screen moods, then seven for telling a story (the Desk's glyph videos, desk-ascii-scripts.md).
 * Only the first six have words: a save's mood is read from its words, a script beat's is set by its plan. */
export const MOODS = ["cosy", "wistful", "wonder", "night", "playful", "tender", "focus", "curious", "tense", "eerie", "driving", "melancholy", "triumph"] as const;
export type Mood = (typeof MOODS)[number];

/** Word beginnings: "remember" also catches "remembered". */
const WORDS: Record<Mood, string[]> = {
  cosy: ["home", "kitchen", "tea", "fire", "warm", "blanket", "sofa", "christmas", "bake", "cake", "toast", "sunday", "shed", "garden", "slipper", "pub", "cafe", "soup", "kettle", "biscuit", "jumper", "allotment", "cat"],
  wistful: ["old", "remember", "memor", "gone", "last", "childhood", "grandad", "grandma", "nan", "gran", "dad", "mum", "brother", "sister", "school", "disk", "floppy", "tape", "photo", "letter", "desktop", "summer", "ago", "never", "miss", "before", "used", "once", "years", "back then"],
  wonder: ["castle", "mountain", "star", "sky", "sea", "ocean", "island", "dragon", "magic", "forest", "map", "lighthouse", "tower", "ruin", "temple", "quest", "kingdom", "moon", "aurora", "comet", "ship", "sail", "journey", "distance", "horizon", "valley", "wizard", "legend"],
  night: ["night", "quiet", "alone", "rain", "empty", "dark", "cold", "late", "3am", "sleepless", "street", "lamp", "bus", "train", "station", "hours", "fog", "snow", "waiting", "midnight", "insomnia", "window"],
  playful: ["game", "coin", "arcade", "play", "win", "score", "level", "boss", "cheat", "race", "bike", "kite", "football", "toy", "lego", "silly", "laugh", "party", "birthday", "puppy", "chess", "dog", "beach", "joystick", "console", "player"],
  tender: ["baby", "sleeping", "newborn", "hold", "hand", "love", "wedding", "born", "shoulder", "lullaby", "cradle", "hug", "first steps", "daughter", "son", "asleep", "cuddle"],
  focus: [],
  curious: [],
  tense: [],
  eerie: [],
  driving: [],
  melancholy: [],
  triumph: [],
};

/** The moods a save with no telling words falls back to: the loading-screen defaults. */
const FALLBACK: Mood[] = ["cosy", "wistful", "wonder"];

export type SaveWords = { memory: string; title?: string; tagline?: string; journal?: string };
export type MoodReading = { mood: Mood; scores: Record<Mood, number>; why: string[] };

const hits = (text: string, stems: string[]) => {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  return stems.filter((s) => lower.includes(` ${s}`));
};

export const readMood = (w: SaveWords, seed: number): MoodReading => {
  const parts: [string, number][] = [
    [w.memory, 3],
    [w.title ?? "", 2],
    [w.tagline ?? "", 1.5],
    [w.journal ?? "", 0.5],
  ];
  const scores = Object.fromEntries(MOODS.map((m) => [m, 0])) as Record<Mood, number>;
  const why: string[] = [];
  for (const m of MOODS) {
    for (const [text, weight] of parts) {
      const found = hits(text, WORDS[m]);
      scores[m] += found.length * weight;
      for (const f of found) if (!why.includes(`${f}→${m}`)) why.push(`${f}→${m}`);
    }
  }
  const best = Math.max(...MOODS.map((m) => scores[m]));
  // A tie goes to the seed, as does a save with nothing to go on.
  const pool = best > 0 ? MOODS.filter((m) => scores[m] === best) : FALLBACK;
  const mood = pool[Math.floor(mulberry(seed * 7 + 3)() * pool.length)]!;
  if (best === 0) why.push(`no mood words, seed picked ${mood}`);
  return { mood, scores, why };
};
