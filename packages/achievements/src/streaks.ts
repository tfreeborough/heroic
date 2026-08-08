/**
 * Streaks aren't additive counters — a win resets the loss streak and
 * vice-versa, and milestones read the HIGH-WATER value so "win 10 in a row"
 * survives the streak that later breaks. Four counters per streak family:
 * `<name>_current` / `<name>_best` for each side. The adapter folds these
 * absolute values into the after-counters it persists.
 */
import type { Counters } from "./types";

export const WIN_STREAK = "win_streak";
export const LOSS_STREAK = "loss_streak";

/** The four streak counters' new ABSOLUTE values after one match result. */
export const streakUpdates = (before: Counters, won: boolean): Record<string, number> => {
  const winNow = won ? (before[`${WIN_STREAK}_current`] ?? 0) + 1 : 0;
  const lossNow = won ? 0 : (before[`${LOSS_STREAK}_current`] ?? 0) + 1;
  return {
    [`${WIN_STREAK}_current`]: winNow,
    [`${WIN_STREAK}_best`]: Math.max(before[`${WIN_STREAK}_best`] ?? 0, winNow),
    [`${LOSS_STREAK}_current`]: lossNow,
    [`${LOSS_STREAK}_best`]: Math.max(before[`${LOSS_STREAK}_best`] ?? 0, lossNow),
  };
};
