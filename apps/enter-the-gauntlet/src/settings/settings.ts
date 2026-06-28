// Player-tunable settings, persisted to device storage. This is the first slice
// of a save layer: meta-progression (Glory, lives, respawn point — see
// docs/design/progression.md) will reuse the same AsyncStorage-backed pattern,
// so the load/save helpers are kept generic and versioned by key.

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface GameSettings {
  /** Master volume, 0..1 — scales music *and* SFX. */
  masterVolume: number;
  /** Music bed volume, 0..1 (under master). */
  musicVolume: number;
  /** Sound-effects volume, 0..1 (under master). */
  sfxVolume: number;
  /** Silence everything regardless of the volumes above. */
  muted: boolean;
  /**
   * Left-handed control layout. Default (false) is right-handed: movement stick
   * on the right, action buttons on the left. When true the two swap (stick left,
   * actions right). Not an axis inversion — the stick still reads thumb-offset as
   * direction; only which side of the deck each cluster sits on changes.
   */
  leftHanded: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 1,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  muted: false,
  leftHanded: false,
};

/** Versioned so a future settings-shape change can migrate rather than corrupt. */
const STORAGE_KEY = "settings:v1";

/** Read persisted settings, merged over defaults so new fields fill in cleanly. */
export const loadSettings = async (): Promise<GameSettings> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    // Corrupt/unavailable storage falls back to defaults rather than crashing.
    return DEFAULT_SETTINGS;
  }
};

/** Best-effort persist; a failed write just means this change won't survive a restart. */
export const saveSettings = async (settings: GameSettings): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore — non-fatal
  }
};
