/**
 * The rating and payout math (bits-ranked.md) — pure functions, no DB, no IO.
 * The game server is the only caller that matters, but keeping this a leaf
 * module means the numbers are unit-testable against fixtures and nothing
 * ever re-implements them.
 *
 * Elo in one line: the gap between two ratings converts to an expected win
 * chance E, and the winner takes K × (1 − E) points off the loser — a lot for
 * an upset, almost nothing for a stomp.
 */

/** Zero-sum around the start, so this is pure presentation — 1500 is the
 * chess convention and puts the top tier at a number that sounds like one. */
export const RATING_START = 1500;
/** A backstop far below the realistic range (~1100–2200), not a mechanic. */
export const RATING_FLOOR = 800;
/** First N matches in a bracket run the hot K — placements. */
export const PLACEMENT_MATCHES = 10;
export const K_PLACEMENT = 40;
export const K_SETTLED = 20;

/** Chance (0..1) that `rating` beats `opponent`. Equal → 0.5; +200 → ~0.76. */
export const expectedScore = (rating: number, opponent: number): number =>
  1 / (1 + 10 ** ((opponent - rating) / 400));

/** Each side uses its OWN K — a placement player moves fast even against a
 * settled one. `matchesPlayed` = that player's wins + losses in the bracket. */
export const kFactor = (matchesPlayed: number): number =>
  matchesPlayed < PLACEMENT_MATCHES ? K_PLACEMENT : K_SETTLED;

export interface RatingUpdateInput {
  rating: number;
  opponent: number;
  /** This player's prior wins + losses in the bracket this season. */
  matchesPlayed: number;
  won: boolean;
}

/** The post-match rating, rounded to an integer and floored. */
export const updateRating = ({ rating, opponent, matchesPlayed, won }: RatingUpdateInput): number => {
  const e = expectedScore(rating, opponent);
  const next = Math.round(rating + kFactor(matchesPlayed) * ((won ? 1 : 0) - e));
  return Math.max(RATING_FLOOR, next);
};

// ── tiers ──────────────────────────────────────────────────────────────────

/** Bands over the number, presentation only — no gameplay effect, no
 * promotion matches (bits-ranked.md § Tiers). Ordered by ascending floor. */
export const TIERS = [
  { name: "Initiate", floor: 0 },
  { name: "Pit Fighter", floor: 1300 },
  { name: "Blooded", floor: 1400 },
  { name: "Gladiator", floor: 1500 },
  { name: "Veteran", floor: 1600 },
  { name: "Champion", floor: 1700 },
  { name: "Warlord", floor: 1850 },
  { name: "Immortal", floor: 2000 },
] as const;

export type TierName = (typeof TIERS)[number]["name"];

export const tierFor = (rating: number): TierName => {
  let tier: TierName = TIERS[0].name;
  for (const t of TIERS) if (rating >= t.floor) tier = t.name;
  return tier;
};

// ── Glory payouts ──────────────────────────────────────────────────────────

/** Floor-plus-bonus, never a visible penalty: a stomp pays the bare floor, an
 * even fight ~50% over it, a big upset roughly double. Tuned numbers are
 * server-side by design (monetisation.md) — these are the defaults. */
export const GLORY_WIN_FLOOR = 15;
export const GLORY_WIN_RANGE = 15;
/** Participation — playing ranked always pays something. */
export const GLORY_LOSS = 5;

export const winnerGlory = (winnerRating: number, loserRating: number): number =>
  Math.round(GLORY_WIN_FLOOR + GLORY_WIN_RANGE * (1 - expectedScore(winnerRating, loserRating)));

export const loserGlory = (): number => GLORY_LOSS;
