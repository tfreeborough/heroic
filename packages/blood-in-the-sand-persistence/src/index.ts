export { createDb, ensureSchema, type Db } from "./db";
export { registerPlayer, findPlayerByToken, type Registration } from "./players";
export { gloryBalance, recordGlory, type GloryEntry } from "./glory";
export {
  RATING_START,
  RATING_FLOOR,
  PLACEMENT_MATCHES,
  K_PLACEMENT,
  K_SETTLED,
  GLORY_WIN_FLOOR,
  GLORY_WIN_RANGE,
  GLORY_LOSS,
  TIERS,
  expectedScore,
  kFactor,
  updateRating,
  tierFor,
  winnerGlory,
  loserGlory,
  type RatingUpdateInput,
  type TierName,
} from "./elo";
export {
  getRating,
  recordRankedMatch,
  leaderboard,
  rankedSummary,
  type RankedRating,
  type RankedMatchInput,
  type RankedMatchResult,
  type RankedSideResult,
  type LeaderboardEntry,
} from "./ranked";
