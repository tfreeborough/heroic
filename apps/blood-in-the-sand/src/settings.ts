/**
 * Device-local player settings (AsyncStorage). Settings are read at the point
 * of use (e.g. GameScreen loads lefty mode on mount — i.e. at match start),
 * so the settings page never needs to push state into live screens.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ABILITIES,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_IDS,
  LOADOUT_ABILITY_COUNT,
  WEAPONS,
  type AbilityId,
  type DifficultyId,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";

/** Lefty mode: buttons on the LEFT, the movement region fills from the right. */
const KEY_LEFTY = "bits.lefty";

export const loadLefty = async (): Promise<boolean> => (await AsyncStorage.getItem(KEY_LEFTY)) === "1";

export const saveLefty = (on: boolean): void => {
  void AsyncStorage.setItem(KEY_LEFTY, on ? "1" : "0");
};

/** The last loadout a player armed with — the wizard's RUN IT BACK offer.
 * Device-local like everything here; validated against the live roster on
 * load so a removed weapon/ability can never resurrect. */
const KEY_LAST_LOADOUT = "bits.lastLoadout";

export interface SavedLoadout {
  weapon: WeaponId;
  abilities: AbilityId[];
}

export const loadLastLoadout = async (): Promise<SavedLoadout | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_LOADOUT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLoadout;
    if (!(parsed.weapon in WEAPONS)) return null;
    if (!Array.isArray(parsed.abilities) || parsed.abilities.length !== LOADOUT_ABILITY_COUNT) return null;
    if (parsed.abilities.some((a) => !(a in ABILITIES))) return null;
    if (new Set(parsed.abilities).size !== parsed.abilities.length) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveLastLoadout = (loadout: SavedLoadout): void => {
  void AsyncStorage.setItem(KEY_LAST_LOADOUT, JSON.stringify(loadout));
};

/** The practice lobby's bot difficulty pick (bot-brains.md step 5) —
 * remembered so climbing the ladder doesn't mean re-picking every visit.
 * Validated against the live tier list on load. */
const KEY_BOT_DIFFICULTY = "bits.botDifficulty";

export const loadBotDifficulty = async (): Promise<DifficultyId> => {
  const raw = await AsyncStorage.getItem(KEY_BOT_DIFFICULTY);
  return raw !== null && (DIFFICULTY_IDS as readonly string[]).includes(raw)
    ? (raw as DifficultyId)
    : DEFAULT_DIFFICULTY;
};

export const saveBotDifficulty = (difficulty: DifficultyId): void => {
  void AsyncStorage.setItem(KEY_BOT_DIFFICULTY, difficulty);
};
