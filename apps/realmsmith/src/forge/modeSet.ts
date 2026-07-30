/**
 * The mode-card set (bits-mode-select.md): one landscape scene per card on
 * the mode-select screen. Unlike icons/sounds this derives from nothing in
 * the sim — the modes are a hand-authored product decision — so the set IS
 * the checked-in MODE_KEYS list, flagged until a subject is written in
 * MODE_SUBJECTS (forge/styleBible.ts). Kept in src/forge for symmetry with
 * the other set builders, though it needs no sim import.
 */
import { MODE_KEYS, MODE_SUBJECTS } from "../../forge/styleBible";

export interface ModeSetEntry {
  /** File + save id — the ModeKey in ModeSelectScreen.tsx's MODE_ART. */
  id: string;
  name: string;
  subject: string;
  /** No hand-written subject yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

export const buildModeSet = (): ModeSetEntry[] =>
  MODE_KEYS.map((id) => {
    const subject = MODE_SUBJECTS[id];
    // "bracket-1v1" → "1v1 bracket card" (the ranked screen's cards ride
    // this same scene pipeline — see MODE_KEYS in forge/styleBible.ts).
    const name = id.startsWith("bracket-") ? `${id.slice("bracket-".length)} bracket card` : `${id} card`;
    return {
      id,
      name,
      subject: subject ?? `a wide desert arena scene for the ${name}`,
      missingSubject: subject === undefined,
    };
  });
