/**
 * Frontier reveal (achievements.md § map): unlocked nodes show full art,
 * their immediate children show as tap-to-peek silhouettes, anything deeper
 * is invisible — the map literally grows. Computed per board by the caller
 * passing only that board's defs (visibility never crosses boards).
 */
import type { AchievementDef, NodeVisibility } from "./types";

export const visibility = <S>(
  defs: readonly AchievementDef<S>[],
  unlocked: ReadonlySet<string>,
): Map<string, NodeVisibility> => {
  const out = new Map<string, NodeVisibility>();
  for (const def of defs) {
    out.set(
      def.id,
      unlocked.has(def.id)
        ? "unlocked"
        : def.parent === null || unlocked.has(def.parent)
          ? "frontier"
          : "hidden",
    );
  }
  return out;
};
