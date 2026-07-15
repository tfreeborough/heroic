/**
 * The icon set, derived from the game itself: ids, names and categories come
 * straight from the sim's WEAPONS/ABILITIES tables, so adding a weapon or
 * ability to Blood in the Sand automatically adds its row here — nothing to
 * maintain in the Forge beyond an art subject line (ICON_SUBJECTS overlay in
 * forge/styleBible.ts; rows without one are flagged in the panel).
 *
 * Browser-side ONLY: this module imports the sim package, which must never be
 * pulled into forge/plugin.ts (that file is bundled into vite.config, where a
 * workspace TS dependency chain doesn't reliably resolve).
 */
import {
  ABILITIES,
  ABILITY_IDS,
  WEAPONS,
  WEAPON_IDS,
} from "@heroic/blood-in-the-sand-sim";
import { ICON_SUBJECTS, type IconCategory } from "../../forge/styleBible";

export interface IconSetEntry {
  /** File + game id — a WeaponId or AbilityId, verbatim. */
  id: string;
  name: string;
  category: IconCategory;
  subject: string;
  /** No hand-written subject yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

const entry = (id: string, name: string, category: IconCategory): IconSetEntry => {
  const subject = ICON_SUBJECTS[id];
  return {
    id,
    name,
    category,
    subject: subject ?? `a bold emblem representing "${name}"`,
    missingSubject: subject === undefined,
  };
};

/** Weapons first, then abilities by category — the panel's display order. */
export const buildIconSet = (): IconSetEntry[] => [
  ...WEAPON_IDS.map((id) => entry(id, WEAPONS[id].name, "weapon")),
  ...(["offensive", "defensive", "support"] as const).flatMap((cat) =>
    ABILITY_IDS.filter((id) => ABILITIES[id].category === cat).map((id) =>
      entry(id, ABILITIES[id].name, cat),
    ),
  ),
];
