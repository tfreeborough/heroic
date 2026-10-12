/**
 * A save's generated music, from its props: which tune it is, the file it
 * lives in, and the chime that goes with it. Shared by the video (Save.tsx),
 * the Desk (desk.templates.ts, desk.server.ts) and the generator
 * (scripts/music.ts), so they always agree.
 *
 * The tune comes from the SLOT (slots never repeat, so neither do tunes);
 * `tuneTake` 1, 2… asks the same slot for another; `tuneStyle` can pin a
 * style. The words set the mood, and the length + memory set the timing, so
 * the file name carries a hash of those too: edit the memory and it's a new
 * file (the old one would land "Save complete" in the wrong place).
 */
import { timeline } from "../timeline";
import { STYLE_NAMES, type StyleName, compose, musicSeed } from "@heroic/music";
import { readMood } from "@heroic/music";

/** The `music` prop's value for "generate this save's own". */
export const TUNE = "@tune";
/** Where generated tunes live, under public/music/. */
export const TUNE_DIR = "generated";

export type TuneProps = {
  slot: number;
  tuneTake?: number;
  tuneStyle?: string;
  seconds: number;
  memory: string;
  title?: string;
  tagline?: string;
  journal?: string;
};

/** FNV-1a: a short, stable hash for the file name. */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

const styleOf = (p: TuneProps): StyleName | undefined => (STYLE_NAMES.includes(p.tuneStyle as StyleName) ? (p.tuneStyle as StyleName) : undefined);

/** The file under public/music/ that holds these props' tune. */
export const tuneFile = (p: TuneProps) => {
  const words = fnv(JSON.stringify([p.seconds, p.memory, p.title ?? "", p.tagline ?? "", p.journal ?? ""]));
  return `${TUNE_DIR}/slot${p.slot}-t${p.tuneTake ?? 0}-${styleOf(p) ?? "auto"}-${words}.wav`;
};

/** The tune's score (no sound yet: cheap enough to call in the browser). */
export const tuneFor = (p: TuneProps) => {
  const seed = musicSeed(p.slot, p.tuneTake ?? 0);
  const reading = readMood({ memory: p.memory, title: p.title, tagline: p.tagline, journal: p.journal }, seed);
  const tl = timeline(p.seconds, p.memory);
  const score = compose(seed, reading.mood, { seconds: p.seconds, buildEnd: tl.buildEnd, saved: tl.saved, exitStart: tl.exit.start }, styleOf(p));
  return { seed, score, reading, file: tuneFile(p) };
};

/** The save chime moved into a tune's key (scripts/chimes.ts makes these). */
export const chimeFile = (shift: number) => (shift ? `sfx/chime-${shift > 0 ? "up" : "down"}${Math.abs(shift)}.wav` : "sfx/chime.mp3");
