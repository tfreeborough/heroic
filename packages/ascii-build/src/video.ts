/**
 * The timings of a glyph video's set pieces (docs/design/desk-ascii-scripts.md),
 * shared by the template that draws them and the Desk that lays out edits
 * and writes the YouTube chapter timestamps around them.
 */

/** Seconds of title before the first beat: the title builds out of glyphs and falls into the first picture. */
export const COLD_OPEN = 4.5;
/** Seconds of silence organise leaves for a chapter card. */
export const CHAPTER_CARD = 3.5;
/** Seconds the end card runs: the reel (3s), the mosaic, the channel name and sign-off (by ~9s), then a hold for YouTube's end-screen elements. */
export const END_CARD = 20;

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

/**
 * YouTube's chapter list for the description: "0:00 Name" lines, video
 * time (the cold open counted in). YouTube wants 0:00 first, at least three
 * and each at least ten seconds, so anything short of that gives "".
 * `chapters` are edit seconds; one at 0 names the opening, else "Intro" does.
 */
export const youtubeChapters = (chapters: { name: string; at: number }[]): string => {
  const list = chapters.map((c) => ({ name: c.name, at: c.at <= 0.01 ? 0 : c.at + COLD_OPEN }));
  if (!list.length || list[0]!.at > 0) list.unshift({ name: "Intro", at: 0 });
  if (list.length < 3 || list.some((c, i) => i && c.at - list[i - 1]!.at < 10)) return "";
  return list.map((c) => `${clock(c.at)} ${c.name}`).join("\n");
};
