/**
 * The celebrated set (achievements.md § unlock ceremony): which deed
 * unlocks THIS DEVICE has already played the ceremony for. Unlocks are
 * persisted server-side at settle regardless of delivery — this local set
 * is how the moment is never lost: the deeds screen (M3) diffs
 * /achievements/me against it and replays the full ceremony for anything
 * missed (a disconnect mid-plate, an app death), then marks it here.
 *
 * Device-local like settings.ts — a reinstall replays old ceremonies once,
 * which beats the alternative (a server-side "seen" flag) costing a write
 * path for a purely presentational concern.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bits.deedsCelebrated";

/** In-memory mirror so rapid marks (2–3 cards per ceremony) never race the
 * storage round-trip — loaded once, then storage only ever follows it. */
let cache: Set<string> | null = null;

const load = async (): Promise<Set<string>> => {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    cache = new Set();
  }
  return cache;
};

export const loadCelebratedDeeds = (): Promise<Set<string>> => load();

/** Fire-and-forget — callers are mid-ceremony and never wait on storage. */
export const markDeedsCelebrated = (ids: readonly string[]): void => {
  if (ids.length === 0) return;
  void (async () => {
    const set = await load();
    for (const id of ids) set.add(id);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
    } catch {
      // Storage refusing is survivable — worst case the ceremony replays.
    }
  })();
};
