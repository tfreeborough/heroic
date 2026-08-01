/**
 * The rank-badge set (bits-ranked.md § tiers): one heraldic emblem per tier.
 * Like the mode set this derives from nothing in the sim — the tier list is a
 * hand-mirror of TIERS in the persistence package's elo.ts (a product
 * decision, checked in as BADGE_KEYS) — flagged until a subject is written in
 * BADGE_SUBJECTS (forge/styleBible.ts). Kept in src/forge for symmetry with
 * the other set builders.
 */
import { BADGE_ACCENTS, BADGE_KEYS, BADGE_SUBJECTS, type BadgeAccent } from "../../forge/styleBible";

export interface BadgeSetEntry {
  /** File + save id — the kebab-case tier name (RANK_BADGES key in RankedScreen). */
  id: string;
  name: string;
  subject: string;
  /** The tier's dominant colour — the at-a-glance rank signal the template
   * floods the shield with (undefined only for an ad-hoc unlisted id). */
  accent: BadgeAccent | undefined;
  /** No hand-written subject yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

/** "pit-fighter" → "Pit Fighter badge". */
const titleCase = (id: string): string =>
  id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export const buildBadgeSet = (): BadgeSetEntry[] =>
  BADGE_KEYS.map((id) => {
    const subject = BADGE_SUBJECTS[id];
    return {
      id,
      name: `${titleCase(id)} badge`,
      subject: subject ?? `a round gladiator shield rank badge for the ${titleCase(id)} tier`,
      accent: BADGE_ACCENTS[id],
      missingSubject: subject === undefined,
    };
  });
