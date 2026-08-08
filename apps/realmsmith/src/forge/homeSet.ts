/**
 * The home-backdrop set: full-bleed portrait scenes for the HomeScreen
 * (one today; future splash/loading scenes appear by appending a key +
 * subject in forge/styleBible.ts). The modeSet pattern — a hand-authored
 * checked-in list, flagged until its subject is written in HOME_SUBJECTS.
 */
import { HOME_KEYS, HOME_SUBJECTS } from "../../forge/styleBible";

export interface HomeSetEntry {
  /** File + save id — the key in src/screens/homeArt.ts's HOME_ART. */
  id: string;
  name: string;
  subject: string;
  /** No hand-written subject yet — the panel flags it and uses the fallback. */
  missingSubject: boolean;
}

export const buildHomeSet = (): HomeSetEntry[] =>
  HOME_KEYS.map((id) => {
    const subject = HOME_SUBJECTS[id];
    return {
      id,
      name: `${id} backdrop`,
      subject: subject ?? `a tall desert arena scene for the ${id} screen backdrop`,
      missingSubject: subject === undefined,
    };
  });
