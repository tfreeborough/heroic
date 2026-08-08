/**
 * The deed-icon set (achievements.md § icon art) — derived from the sim's
 * ACHIEVEMENT_DEFS like iconSet.ts derives from the roster: chain tiers
 * share one icon, so the set is the UNIQUE icon keys, and a new deed family
 * in defs.ts grows its own row here automatically (flagged until a subject
 * is written in DEED_SUBJECTS).
 *
 * The per-ability cast chains and per-weapon round chains are EXCLUDED by
 * construction: in-game they reuse the already-forged loadout icons
 * (src/deeds/deedIcons.ts maps them) — recognition beats novelty, and it
 * saves ~45 generations.
 *
 * Browser-side ONLY (imports the sim package — must never reach
 * forge/plugin.ts, which is bundled into vite.config).
 */
import { ACHIEVEMENT_DEFS } from "@heroic/blood-in-the-sand-sim";
import { DEED_SUBJECTS } from "../../forge/styleBible";

export interface DeedSetEntry {
  /** File + save id — the `icon` key in the defs (and DEED_ICONS). */
  id: string;
  name: string;
  subject: string;
  /** No hand-written subject yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

/** Icon keys whose art comes from the loadout set, not the forge. */
const reusesLoadoutIcon = (icon: string): boolean =>
  icon.startsWith("deed-casts-") || icon.startsWith("deed-rounds-");

export const buildDeedSet = (): DeedSetEntry[] =>
  [...new Set(ACHIEVEMENT_DEFS.map((d) => d.icon))]
    .filter((icon) => !reusesLoadoutIcon(icon))
    .map((id) => {
      const subject = DEED_SUBJECTS[id];
      const name = `${id.replace(/^deed-/, "").replace(/-/g, " ")} deed`;
      return {
        id,
        name,
        subject: subject ?? `a bold illustration for the "${name}" achievement`,
        missingSubject: subject === undefined,
      };
    });
