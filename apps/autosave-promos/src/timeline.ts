/**
 * When things happen in a Save video, in seconds. Its own file so the music
 * generator (src/music/, run outside Remotion) can use it too.
 */

/** Seconds to read a memory once it's revealed (about 18 characters a second). */
export const readingTime = (memory: string) => Math.min(5, Math.max(2, memory.trim().length / 18));

/** Extra seconds on the finished picture and memory before it drops away (Tom, 10-10). */
export const HOLD = 1;

/** When everything happens, in seconds, for a video this long. A long
 * memory finishes the build earlier so there's time to read it before the
 * loop comes round (it's on screen from its reveal until the rewind). */
export const timeline = (seconds: number, memory = "") => {
  // The hold is added to the 15s shape, so a 16s video builds as long as a 15s one did.
  const buildEnd = Math.min((seconds - HOLD) * 0.68, seconds - HOLD - 3 - readingTime(memory));
  const saved = buildEnd + 0.9;
  return {
    buildStart: 0.35,
    buildEnd,
    /** The bar reads 99% from the last glyph until here. */
    full: saved - 0.15,
    saved,
    exit: { start: seconds - 2.3, end: seconds - 0.25 },
    /** The opening line comes back for the loop. */
    rewind: seconds - 0.7,
  };
};
