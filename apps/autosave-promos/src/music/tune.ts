/**
 * A save's generated music, from its props: which tune it is, the file it
 * lives in, and the chime that goes with it. Shared by the video (Save.tsx),
 * the Desk (desk.templates.ts, desk.server.ts) and the generator
 * (scripts/music.ts), so they always agree.
 *
 * The tune comes from the SLOT (slots never repeat, so neither do tunes);
 * `tuneTake` 1, 2… asks the same slot for another; `tuneStyle` can pin a
 * style. The mood and the save's favourite styles are Claude's choice from
 * the picture and words (desk.server.ts, stored in the save's sidecar; the
 * Desk lays them on as `tuneMood` / `tuneStyles`). The style, key and tempo
 * rotate slot to slot (@heroic/music variety.ts) so neighbours don't sound
 * alike. The length + memory set the timing, so the file name carries a hash
 * of those too: edit the memory and it's a new file (the old one would land
 * "Save complete" in the wrong place).
 */
import { timeline } from "../timeline";
import { MOODS, type Mood, STYLE_NAMES, type StyleName, compose, musicSeed, slotVariety } from "@heroic/music";

/** The `music` prop's value for "generate this save's own". */
export const TUNE = "@tune";
/** Where generated tunes live, under public/music/. */
export const TUNE_DIR = "generated";
/** Bumped when the composer changes what a slot gets, so the Desk makes the
 * tune again instead of reusing the old file (3 = 10-12 Claude chooses). */
const COMPOSER = 3;

export type TuneProps = {
  slot: number;
  tuneTake?: number;
  tuneStyle?: string;
  /** The styles the last two slots got, newest first, comma separated (the
   * Desk fills it from the slot ledger) so this one doesn't repeat them. */
  tuneAvoid?: string;
  /** Claude's choice for this save: its mood, and its favourite styles, best first, comma separated. */
  tuneMood?: string;
  tuneStyles?: string;
  seconds: number;
  memory: string;
};

/** FNV-1a: a short, stable hash for the file name. */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

const styleOf = (p: TuneProps): StyleName | undefined => (STYLE_NAMES.includes(p.tuneStyle as StyleName) ? (p.tuneStyle as StyleName) : undefined);
const list = (s?: string) => (s ?? "").split(",").filter(Boolean);

/** The file under public/music/ that holds these props' tune. */
export const tuneFile = (p: TuneProps) => {
  const words = fnv(JSON.stringify([COMPOSER, p.tuneAvoid ?? "", p.tuneMood ?? "", p.tuneStyles ?? "", p.seconds, p.memory]));
  return `${TUNE_DIR}/slot${p.slot}-t${p.tuneTake ?? 0}-${styleOf(p) ?? "auto"}-${words}.wav`;
};

/** The tune's score (no sound yet: cheap enough to call in the browser), or
 * null while the save's music hasn't been chosen. */
export const tuneFor = (p: TuneProps) => {
  if (!MOODS.includes(p.tuneMood as Mood)) return null;
  const mood = p.tuneMood as Mood;
  const seed = musicSeed(p.slot, p.tuneTake ?? 0);
  const tl = timeline(p.seconds, p.memory);
  const vary = slotVariety(p.slot, mood, p.tuneTake ?? 0, list(p.tuneAvoid), list(p.tuneStyles) as StyleName[]);
  const score = compose(seed, mood, { seconds: p.seconds, buildEnd: tl.buildEnd, saved: tl.saved, exitStart: tl.exit.start }, styleOf(p) ?? vary.style, vary);
  return { seed, score, file: tuneFile(p) };
};

/** The save chime moved into a tune's key (scripts/chimes.ts makes these). */
export const chimeFile = (shift: number) => (shift ? `sfx/chime-${shift > 0 ? "up" : "down"}${Math.abs(shift)}.wav` : "sfx/chime.mp3");
