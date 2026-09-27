/**
 * The challenge board (bits-challenges.md, 2026-09-26): one deed per
 * challenge — its first clear IS the deed, and the deed's bounty IS the
 * Glory the challenge pays. That routes challenge Glory through the one
 * pipeline that already exists (applyMatchAchievements: idempotent per
 * player per deed, so a clear can only ever pay once), instead of a second
 * payout path. On top: the first-clear root, a title per tier cleared, the
 * clear-them-all capstone, and one joke for the stubborn. No copy or
 * threshold names a count (Tom 2026-09-27): the catalogue grows, so every
 * tier threshold derives from CHALLENGES.
 *
 * Every milestone here reads a `challenge:` counter that ONLY the API's
 * report adapter writes (challengeCountersAfter, below) — a match settle
 * never moves one (counterDeltas returns nothing for a challenge summary),
 * so the board's `accepts` gate is sound the same way skirmish's is.
 *
 * Board positions live east of skirmish (x ≥ 4200) — the overlap test is
 * global. Titles are placeholders in the house voice; Tom renames freely.
 */
import type { BoardDef, Counters } from "@heroic/achievements";
import { CHALLENGES, CHALLENGE_TIERS, challengeById, type ChallengeTier } from "../challenges";
import { bounty } from "./bounties";
import { CHALLENGE_COUNTER_PREFIX } from "./counters";
import type { BitsAchievementDef } from "./defs";
import type { MatchSummary } from "./summary";

export const CHALLENGE_BOARD = "challenges";

export const CHALLENGE_BOARD_DEF: BoardDef<MatchSummary> = {
  id: CHALLENGE_BOARD,
  accepts: (s) => s.challenge !== undefined,
};

/** The counter keys — the adapter's and the deeds' shared vocabulary. */
export const CHALLENGE_COUNTERS = {
  /** Times this challenge was cleared. */
  clears: (id: string): string => `${CHALLENGE_COUNTER_PREFIX}${id}:clears`,
  /** Attempts at this challenge — every round that went active and ended
   * without the win, plus the clearing run. Client-reported, absolute. */
  attempts: (id: string): string => `${CHALLENGE_COUNTER_PREFIX}${id}:attempts`,
  /** Distinct challenges cleared. */
  cleared: `${CHALLENGE_COUNTER_PREFIX}cleared`,
  /** Distinct challenges of a tier cleared. */
  tierCleared: (tier: ChallengeTier): string => `${CHALLENGE_COUNTER_PREFIX}tier:${tier}:cleared`,
  /** Attempts across every challenge. */
  attemptsTotal: `${CHALLENGE_COUNTER_PREFIX}attempts`,
} as const;

/**
 * Fold one client report into a player's counters (absolute values, the
 * persistence shape). `attempts` is the client's running total for that
 * challenge — it only ever moves up here (a stale or replayed report can't
 * lower it), and the aggregates are recomputed from the per-challenge keys
 * so they can never drift. Unknown ids are ignored (an older server than
 * the client). Returns the full "after" map.
 */
export const challengeCountersAfter = (
  before: Counters,
  report: { id: string; cleared: boolean; attempts: number },
): Record<string, number> => {
  const after: Record<string, number> = { ...before };
  const def = challengeById(report.id);
  if (!def) return after;
  const attempts = Math.max(0, Math.floor(report.attempts));
  after[CHALLENGE_COUNTERS.attempts(def.id)] = Math.max(before[CHALLENGE_COUNTERS.attempts(def.id)] ?? 0, attempts);
  if (report.cleared) after[CHALLENGE_COUNTERS.clears(def.id)] = (before[CHALLENGE_COUNTERS.clears(def.id)] ?? 0) + 1;
  let cleared = 0;
  let attemptsTotal = 0;
  const perTier: Record<ChallengeTier, number> = { easy: 0, medium: 0, hard: 0, deathwish: 0 };
  for (const c of CHALLENGES) {
    if ((after[CHALLENGE_COUNTERS.clears(c.id)] ?? 0) > 0) {
      cleared += 1;
      perTier[c.tier] += 1;
    }
    attemptsTotal += after[CHALLENGE_COUNTERS.attempts(c.id)] ?? 0;
  }
  after[CHALLENGE_COUNTERS.cleared] = cleared;
  after[CHALLENGE_COUNTERS.attemptsTotal] = attemptsTotal;
  for (const tier of CHALLENGE_TIERS) after[CHALLENGE_COUNTERS.tierCleared(tier)] = perTier[tier];
  return after;
};

/** The summary the adapter evaluates a report against — nothing but the
 * board gate reads it (every challenge deed is a milestone or capstone). */
export const challengeSummary = (id: string, playerId = 0): MatchSummary => ({
  ranked: false,
  challenge: id,
  bracket: null,
  teamSize: 1,
  teamCount: 2,
  room: null,
  winnerTeam: 1,
  roundWins: [1, 0],
  roundWinners: [1],
  players: [{ id: playerId, team: 1, weapon: null, bot: false }],
  stats: {},
});

const X0 = 4200;
const STEP = 70;
/** The middle of the clear-deed row — root and capstone sit under it. */
const MID = (CHALLENGES.length - 1) / 2;

/** The root: your first clear, any challenge. */
const AGAINST_THE_ODDS: BitsAchievementDef = {
  id: "against-the-odds",
  board: CHALLENGE_BOARD,
  title: "Against the odds",
  description: "Clear your first challenge.",
  icon: "deed-challenge-first",
  parent: null,
  pos: { x: X0 + STEP * MID, y: 0 },
  rewards: [{ kind: "title" }],
  trigger: { kind: "milestone", counter: CHALLENGE_COUNTERS.cleared, threshold: 1 },
};

/** One per challenge — the clear pays the challenge's band, once. */
export const CHALLENGE_CLEAR_DEEDS: readonly BitsAchievementDef[] = CHALLENGES.map((c, i) => ({
  id: `challenge-${c.id}`,
  board: CHALLENGE_BOARD,
  title: c.name,
  description: `Clear "${c.name}": ${c.premise}.`,
  icon: `deed-challenge-${c.tier}`,
  parent: AGAINST_THE_ODDS.id,
  pos: { x: X0 + STEP * i, y: -130 },
  rewards: [bounty(c.glory)],
  trigger: { kind: "milestone", counter: CHALLENGE_COUNTERS.clears(c.id), threshold: 1 },
}));

const TIER_TITLES: Record<ChallengeTier, { title: string; description: string }> = {
  easy: { title: "Warmed up", description: "Clear every easy challenge." },
  medium: { title: "Getting somewhere", description: "Clear every medium challenge." },
  hard: { title: "Hard as nails", description: "Clear every hard challenge." },
  deathwish: { title: "Deathwish", description: "Clear every deathwish challenge." },
};

const TIER_DEEDS: readonly BitsAchievementDef[] = CHALLENGE_TIERS.map((tier, i) => ({
  id: `challenge-tier-${tier}`,
  board: CHALLENGE_BOARD,
  title: TIER_TITLES[tier].title,
  description: TIER_TITLES[tier].description,
  icon: `deed-challenge-${tier}`,
  parent: AGAINST_THE_ODDS.id,
  pos: { x: X0 + STEP * (2 + i * 2), y: 130 },
  rewards: [{ kind: "title" }],
  trigger: {
    kind: "milestone",
    counter: CHALLENGE_COUNTERS.tierCleared(tier),
    threshold: CHALLENGES.filter((c) => c.tier === tier).length,
  },
}));

/** Every challenge. Pays the title AND the Hammerfall finisher (Tom,
 * 2026-09-27) — the wardrobe piece worn where others see it. It rides the
 * client-trusted /challenges/report path; accepted by decision ("it's just a
 * finisher"). */
const ALL_CLEARED: BitsAchievementDef = {
  id: "challenge-all",
  board: CHALLENGE_BOARD,
  title: "Nothing left to prove",
  description: "Clear every challenge.",
  icon: "deed-challenge-capstone",
  parent: AGAINST_THE_ODDS.id,
  pos: { x: X0 + STEP * MID, y: 260 },
  rewards: [{ kind: "title" }, { kind: "entitlement", itemId: "finisher:hammerfall" }],
  trigger: { kind: "capstone", requires: CHALLENGE_CLEAR_DEEDS.map((d) => d.id) },
};

/** The joke: a hundred attempts, cleared or not. Titles-or-nothing. */
const STUBBORN: BitsAchievementDef = {
  id: "challenge-stubborn",
  board: CHALLENGE_BOARD,
  title: "Stubborn",
  description: "A hundred attempts at the challenges. Cleared or not.",
  secret: true,
  icon: "deed-challenge-stubborn",
  parent: AGAINST_THE_ODDS.id,
  pos: { x: X0 + STEP * (CHALLENGES.length - 1), y: 260 },
  rewards: [{ kind: "title" }],
  trigger: { kind: "milestone", counter: CHALLENGE_COUNTERS.attemptsTotal, threshold: 100 },
};

export const ACHIEVEMENT_DEFS_CHALLENGES: readonly BitsAchievementDef[] = [
  AGAINST_THE_ODDS,
  ...CHALLENGE_CLEAR_DEEDS,
  ...TIER_DEEDS,
  ALL_CLEARED,
  STUBBORN,
];

export const CHAPTER_CHALLENGES = {
  id: "against-the-odds",
  title: "Against the Odds",
  ids: ACHIEVEMENT_DEFS_CHALLENGES.map((d) => d.id),
} as const;
