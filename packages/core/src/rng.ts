/**
 * Deterministic, seedable PRNG (mulberry32). Pass one of these into anything
 * with randomness (combat rolls, spawns) so simulations are reproducible —
 * essential for replays, tests, and (later) lockstep networking.
 */
export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
}

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
};

/** Inclusive integer in [min, max]. */
export const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng.next() * (max - min + 1));
