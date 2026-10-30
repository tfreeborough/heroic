/** The tidy page's cutoff: a calendar day, read as midnight London time
 * (BST is close enough for a test-account sweep). Bad input falls back. */
export const DEFAULT_DAY = "2026-10-10";

export const cutoffOf = (raw: string | undefined): { day: string; cutoffS: number } => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw ?? "") ? raw! : DEFAULT_DAY;
  const ms = new Date(`${day}T00:00:00+01:00`).getTime();
  return Number.isFinite(ms) ? { day, cutoffS: Math.floor(ms / 1000) } : cutoffOf(DEFAULT_DAY);
};
