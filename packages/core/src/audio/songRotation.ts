/**
 * Song rotation: which song plays next, given what's played lately. Pure —
 * the app's music module (`apps/blood-in-the-sand/src/audio/music.ts`) keeps
 * the recent list and the player; this just decides. Same shape as
 * `musicState`: state in, a pick out, no runtime.
 *
 * A per-match shuffled deck (v3) kept songs from repeating INSIDE a match but
 * said nothing across matches, so a fresh deal could open on the song the
 * last match closed with — and over an evening some songs came round far
 * more than others. Now every pick is uniform over the pool MINUS the last
 * {@link RECENT_SONGS} played, so a song sits out at least that many plays
 * before it can come back: natural spacing, no song hogging the arena.
 */

/** How many recently played songs are held out of the next pick. */
export const RECENT_SONGS = 12;

/**
 * Pick the next song: uniform over `pool` minus `recent` (oldest first,
 * newest last). If the recent list would rule out the whole pool (a pool no
 * bigger than the list), the OLDEST recent songs come back into contention
 * first, so a small pool still spaces its songs as far apart as it can.
 * `random` is a `Math.random`-style source; music never touches the sim rng.
 * Null only for an empty pool.
 */
export const pickSong = (
  pool: readonly string[],
  recent: readonly string[],
  random: () => number = Math.random,
): string | null => {
  if (pool.length === 0) return null;
  let held = recent;
  let candidates = pool.filter((s) => !held.includes(s));
  while (candidates.length === 0 && held.length > 0) {
    held = held.slice(1); // release the oldest and try again
    candidates = pool.filter((s) => !held.includes(s));
  }
  return candidates[Math.floor(random() * candidates.length) % candidates.length] ?? null;
};

/**
 * Record a play: `song` becomes the newest entry (moved, if already present),
 * and the list is trimmed to its last `limit` plays. Returns the new list.
 */
export const noteSongPlayed = (
  recent: readonly string[],
  song: string,
  limit: number = RECENT_SONGS,
): string[] => {
  const out = recent.filter((s) => s !== song);
  out.push(song);
  return out.length > limit ? out.slice(out.length - limit) : out;
};
