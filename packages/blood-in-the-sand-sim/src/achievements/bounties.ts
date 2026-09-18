/**
 * Deed bounties — the Glory a deed pays (bits-deed-glory.md, 2026-09-18).
 *
 * Every paying deed sits in one of eight BANDS, picked by how long or how
 * hard the deed is, never by feel. Rough guide (hours are ranked play, at
 * ~12 matches an hour):
 *
 *     5   a match or two — the first rung of a fast ladder
 *    10   your first session
 *    25   a few hours, or a nice moment most players will have
 *    50   ~10 hours, or a real skill feat
 *   100   ~25 hours, or a hard feat
 *   200   ~50–100 hours, a capstone, or a very hard feat
 *   400   hundreds of hours
 *   800   the summit — one Signet at the default exchange rate
 *
 * A ranked win pays 15–30, so the bands read as "a third of a win" up to
 * "about forty wins". Authoring stays with the tier (`rewards: [bounty(50)]`
 * next to its threshold); the type keeps every amount on a band, and the
 * tests in achievements.test.ts hold the rules: who may never be paid, that
 * ladders never step down, and the whole-board budget.
 */
import type { AchievementReward } from "@heroic/achievements";

export const BOUNTY_BANDS = [5, 10, 25, 50, 100, 200, 400, 800] as const;

export type BountyBand = (typeof BOUNTY_BANDS)[number];

export const bounty = (amount: BountyBand): AchievementReward => ({ kind: "glory", amount });

/** The Glory a deed pays — 0 for the many that pay a title or nothing. */
export const bountyOf = (def: { rewards?: readonly AchievementReward[] }): number =>
  (def.rewards ?? []).reduce((sum, r) => (r.kind === "glory" ? sum + r.amount : sum), 0);

/**
 * The ceiling on everything the paying boards can ever hand out, summed.
 * Deed Glory is a FINITE faucet on top of the endless one (match pay), so
 * the cap is what keeps the Armory worth buying from. New content that
 * pushes past it fails the suite — raise this on purpose, with the doc's
 * budget table open, never as a drive-by.
 */
export const BOUNTY_BUDGET = 9000;
