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
/** First N matches in a bracket run the hot K — placements. Retuned
 * 2026-08-02 (Tom: two divisions in a day-one session felt cheap): settled
 * play moves ~7–8 a game against an even opponent, placements ~12 — fast
 * enough to calibrate, slow enough that the climb is the game. */
export const PLACEMENT_MATCHES = 10;
export const K_PLACEMENT = 24;
export const K_SETTLED = 15;

/** Chance (0..1) that `rating` beats `opponent`. Equal → 0.5; +200 → ~0.76. */
export const expectedScore = (rating: number, opponent: number): number =>
  1 / (1 + 10 ** ((opponent - rating) / 400));

/** A team's strength for the expected-score math (bits-ranked.md § team
 * brackets): the mean of its members' bracket ratings. A 1v1 "team" is the
 * player — the mean of one. */
export const teamMean = (ratings: readonly number[]): number =>
  ratings.reduce((sum, r) => sum + r, 0) / ratings.length;

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
 * promotion matches (bits-ranked.md § Tiers). Ordered by ascending floor.
 * Six tiers (revised 2026-07-30 from eight): the middle four are 150 wide so
 * their thirds — the divisions — are a uniform 50 points, ~7 net wins each
 * (Tom: 33-pt divisions promoted in 2 wins, which felt cheap). */
export const TIERS = [
  { name: "Initiate", floor: 0 },
  { name: "Pit Fighter", floor: 1300 },
  { name: "Gladiator", floor: 1450 },
  { name: "Champion", floor: 1600 },
  { name: "Warlord", floor: 1750 },
  { name: "Immortal", floor: 1900 },
] as const;

export type TierName = (typeof TIERS)[number]["name"];

export const tierFor = (rating: number): TierName => {
  let tier: TierName = TIERS[0].name;
  for (const t of TIERS) if (rating >= t.floor) tier = t.name;
  return tier;
};

export const tierFloorOf = (tier: TierName): number => TIERS.find((t) => t.name === tier)!.floor;

/** The tier above `tier`, or null at the top of the ladder. */
export const nextTierAbove = (tier: TierName): { name: TierName; floor: number } | null => {
  const i = TIERS.findIndex((t) => t.name === tier);
  const next = TIERS[i + 1];
  return next ? { name: next.name, floor: next.floor } : null;
};

// ── divisions ──────────────────────────────────────────────────────────────

/** One rung of the 20-step ladder (bits-ranked.md § divisions): a tier plus
 * a division inside it — 3 is the entry division, 1 sits just under the next
 * tier. The open-ended tiers (Initiate, Immortal) are single rungs, so
 * `division` is null there. */
export interface Rung {
  tier: TierName;
  division: 1 | 2 | 3 | null;
  floor: number;
}

/** The full ladder, ascending — derived from TIERS so the tier bands stay
 * the single source of truth: each middle tier splits evenly into III/II/I
 * (Tom, 2026-07-30: division rank-ups every ~7 net wins keep the climb
 * visible without feeling cheap). 1 + 4×3 + 1 = 14. */
export const RUNGS: readonly Rung[] = TIERS.flatMap((t, i): Rung[] => {
  const next = TIERS[i + 1];
  if (i === 0 || !next) return [{ tier: t.name, division: null, floor: t.floor }];
  const span = next.floor - t.floor;
  return [3, 2, 1].map((division, j) => ({
    tier: t.name,
    division: division as 1 | 2 | 3,
    floor: t.floor + Math.round((span * j) / 3),
  }));
});

export const rungFor = (rating: number): Rung => {
  let rung: Rung = RUNGS[0]!;
  for (const r of RUNGS) if (rating >= r.floor) rung = r;
  return rung;
};

/** The rung above, or null at the summit. */
export const rungAbove = (rung: Rung): Rung | null => {
  const i = RUNGS.findIndex((r) => r.tier === rung.tier && r.division === rung.division);
  return RUNGS[i + 1] ?? null;
};

/**
 * The floor the progress bar measures from. Initiate's true floor is 0 (the
 * rung is bottomless), which would render a nearly-full bar that barely moves
 * — so its DISPLAY floor sits one division-width stack (150, a tier's span)
 * under Pit Fighter. Below that the client hides the bar entirely rather
 * than show an empty one (Tom, 2026-07-30): no progress claims while the
 * rating sits under the displayed rank's floor.
 */
export const displayFloorOf = (rung: Rung): number =>
  rung.floor > 0 ? rung.floor : RUNGS[1]!.floor - 150;

/** How far a displayed tier stretches below its floor before it lets go. */
export const TIER_GRACE = 50;

/**
 * The tier we SHOW (bits-ranked.md § display v2): an earned tier — one the
 * season peak actually reached — sticks until the rating falls TIER_GRACE
 * below its floor, so a player bouncing across a boundary never watches
 * their title flap. The rating shown beside it stays the honest number;
 * only the title is sticky, and only downward.
 */
export const displayTierFor = (rating: number, peak: number): TierName => {
  let tier: TierName = TIERS[0].name;
  for (const t of TIERS) {
    if (rating >= t.floor || (peak >= t.floor && rating >= t.floor - TIER_GRACE)) tier = t.name;
  }
  return tier;
};

/**
 * The rung we SHOW. Grace is a TIER-level mercy only: the badge is the
 * emotional boundary, so it sticks (displayTierFor), while divisions inside
 * a tier move freely in both directions — frequent movement is their whole
 * job. While grace holds a tier the raw rating has slipped under, the rung
 * shown is that tier's entry division.
 */
export const displayRungFor = (rating: number, peak: number): Rung => {
  const tier = displayTierFor(rating, peak);
  if (tierFor(rating) === tier) return rungFor(rating);
  return RUNGS.find((r) => r.tier === tier)!;
};

/**
 * Did the DISPLAYED rank move between two rating/peak states? Compares
 * display rungs (grace included), so a dip a sticky badge absorbs is `null`
 * — no demotion moment fires for a badge that never visibly changed. Drives
 * the `rankChange` field on settle results (rank_up / rank_down audio).
 */
export const rankChangeBetween = (
  before: { rating: number; peak: number },
  after: { rating: number; peak: number },
): "up" | "down" | null => {
  const idx = (r: Rung): number => RUNGS.findIndex((x) => x.tier === r.tier && x.division === r.division);
  const a = idx(displayRungFor(before.rating, before.peak));
  const b = idx(displayRungFor(after.rating, after.peak));
  return b > a ? "up" : b < a ? "down" : null;
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
