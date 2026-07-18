/**
 * The sprite set. The title-screen fighter rows derive from the sim's own
 * WEAPONS table (`title-<weaponId>` — the iconSet pattern), so adding a
 * weapon to Blood in the Sand automatically adds its title fighter here,
 * flagged until an art subject is written in SPRITE_SUBJECTS
 * (forge/styleBible.ts). Any SPRITE_SUBJECTS id outside that convention
 * (one-off splashes etc.) appears as a static extra row.
 *
 * Browser-side ONLY: imports the sim package, which must never be pulled
 * into forge/plugin.ts (bundled into vite.config — iconSet's rule).
 */
import { WEAPONS, WEAPON_IDS } from "@heroic/blood-in-the-sand-sim";
import { SPRITE_SUBJECTS } from "../../forge/styleBible";

export interface SpriteSetEntry {
  /** File + save id, kebab-case (e.g. "title-blade"). */
  id: string;
  name: string;
  subject: string;
  /** No hand-written subject yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

export const buildSpriteSet = (): SpriteSetEntry[] => {
  const weapons: SpriteSetEntry[] = WEAPON_IDS.map((weaponId) => {
    const id = `title-${weaponId}`;
    const subject = SPRITE_SUBJECTS[id];
    return {
      id,
      name: `title · ${WEAPONS[weaponId].name}`,
      subject: subject ?? `a gladiator wielding ${WEAPONS[weaponId].name}, full side profile facing right`,
      missingSubject: subject === undefined,
    };
  });
  const covered = new Set(weapons.map((e) => e.id));
  const extras: SpriteSetEntry[] = Object.entries(SPRITE_SUBJECTS)
    .filter(([id]) => !covered.has(id))
    .map(([id, subject]) => ({ id, name: id.replace(/-/g, " "), subject, missingSubject: false }));
  return [...weapons, ...extras];
};
