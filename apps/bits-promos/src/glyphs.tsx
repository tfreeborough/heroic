/**
 * The glyph look's pieces for BITS (docs/design/desk-ascii-scripts.md),
 * shared by the Beats template and the card layer every other template
 * draws an edit's cards with (so the editor's preview shows the builds too).
 */
import type { BuildShow } from "@heroic/ascii-build/remotion";
import type { Playable, PlacedWord } from "@heroic/voiceover";
import { loadFont } from "@remotion/google-fonts/JetBrainsMono";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "800"], subsets: ["latin"] });
/** The glyphs' font. */
export const GLYPH_FAMILY = `"${fontFamily}", ui-monospace, monospace`;

/** A word as said, for matching a pulled word: lower case, letters and digits only. */
const bare = (w: string) => w.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "");

/**
 * An edit's build cards as the glyph layer takes them, each pulled word
 * timed to when it's said in that card (seconds from the card's start).
 * `words` are in video time; `startFrom` is the edit's second at video 0.
 */
export const buildShows = (seq: Playable | null, words: PlacedWord[], startFrom: number): BuildShow[] =>
  (seq?.overlay?.cards ?? []).flatMap((c) => {
    if (c.kind !== "build" || !c.src) return [];
    const pulls = (c.pulled ?? []).flatMap((want) => {
      const w = words.find((x) => x.start + startFrom >= c.at && x.start + startFrom < c.at + c.seconds && bare(x.text) === bare(want));
      return w ? [{ word: w.text.replace(/[^\p{L}\p{N}'’-]/gu, ""), at: w.start + startFrom - c.at }] : [];
    });
    return [{ id: c.id, src: c.src, seed: c.seed ?? 1, at: c.at, seconds: c.seconds, ...(pulls.length ? { pulls } : {}) }];
  });
