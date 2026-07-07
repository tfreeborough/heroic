// The character save layer (docs/design/progression.md): the roster is the
// save unit. Persisted per character: class, level, XP and Talents taken —
// gear, gold, lives and checkpoints join the record as those systems land.
// Storage is roster-shaped (array + activeId) from day one so the fallen/
// revive roster screen slots in without a migration, even though v1 UI only
// ever surfaces the active character. Same AsyncStorage pattern as
// src/settings/settings.ts: versioned key, defaults merged on load.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ClassId } from "@heroic/core";

export interface CharacterRecord {
  /** Stable identity — also the seed key for this character's talent offers. */
  id: string;
  classId: ClassId;
  level: number;
  /** XP into the current level (progression/xp.ts owns the curve). */
  xp: number;
  /** Owned TalentTier ids, in pick order. */
  talents: string[];
  createdAt: number;
}

export interface CharacterRoster {
  characters: CharacterRecord[];
  activeId: string | null;
}

export const EMPTY_ROSTER: CharacterRoster = { characters: [], activeId: null };

/** A fresh level-1 record for a new run. */
export const newCharacter = (classId: ClassId): CharacterRecord => ({
  id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  classId,
  level: 1,
  xp: 0,
  talents: [],
  createdAt: Date.now(),
});

/** Versioned so a future record-shape change can migrate rather than corrupt. */
const STORAGE_KEY = "characters:v1";

/** Field-fill one stored record over a fresh one, so new fields default cleanly. */
const fillRecord = (stored: Partial<CharacterRecord>): CharacterRecord | null => {
  if (typeof stored.id !== "string" || typeof stored.classId !== "string") return null;
  return {
    ...newCharacter(stored.classId as ClassId),
    ...stored,
    id: stored.id,
    talents: Array.isArray(stored.talents) ? stored.talents.filter((t) => typeof t === "string") : [],
  };
};

/** Read the persisted roster; anything corrupt falls back to empty rather than crashing. */
export const loadRoster = async (): Promise<CharacterRoster> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_ROSTER;
    const parsed = JSON.parse(raw) as Partial<CharacterRoster>;
    const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
      .map(fillRecord)
      .filter((c): c is CharacterRecord => c !== null);
    const activeId =
      typeof parsed.activeId === "string" && characters.some((c) => c.id === parsed.activeId)
        ? parsed.activeId
        : null;
    return { characters, activeId };
  } catch {
    return EMPTY_ROSTER;
  }
};

/** Best-effort persist; a failed write just means this change won't survive a restart. */
export const saveRoster = async (roster: CharacterRoster): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(roster));
  } catch {
    // ignore — non-fatal
  }
};
