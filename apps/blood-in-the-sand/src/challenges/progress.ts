/**
 * Challenge progress (bits-challenges.md): attempts and clears per
 * challenge, on this device. An attempt is every round that went active —
 * a death, a draw, or leaving mid-round all count; the clearing run counts
 * too, so "cleared on attempt 31" reads straight off the tally. The server
 * mirrors the same numbers through /challenges/report (the deeds counters),
 * and a reinstall adopts the server's copy (adoptServerCounters) so the
 * brag number survives the phone.
 *
 * Device-local like the celebrated set (deeds/celebrated.ts): an in-memory
 * mirror, loaded once, storage only ever following it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CHALLENGES, CHALLENGE_COUNTERS } from "@heroic/blood-in-the-sand-sim";

const KEY = "bits.challenges";

export interface ChallengeProgress {
  attempts: number;
  clears: number;
  /** The attempt the first clear landed on (the share-card number), or null. */
  firstClearAttempt: number | null;
}

export type ChallengeProgressMap = Record<string, ChallengeProgress>;

const EMPTY: ChallengeProgress = { attempts: 0, clears: 0, firstClearAttempt: null };

let cache: ChallengeProgressMap | null = null;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const l of listeners) l();
};

const load = async (): Promise<ChallengeProgressMap> => {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const map: ChallengeProgressMap = {};
    if (parsed && typeof parsed === "object") {
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!v || typeof v !== "object") continue;
        const p = v as Partial<ChallengeProgress>;
        map[id] = {
          attempts: typeof p.attempts === "number" ? Math.max(0, Math.floor(p.attempts)) : 0,
          clears: typeof p.clears === "number" ? Math.max(0, Math.floor(p.clears)) : 0,
          firstClearAttempt: typeof p.firstClearAttempt === "number" ? p.firstClearAttempt : null,
        };
      }
    }
    cache = map;
  } catch {
    cache = {};
  }
  return cache;
};

const persist = (): void => {
  if (!cache) return;
  void AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {
    // Storage refusing is survivable — the in-memory tally stands for the session.
  });
};

export const loadChallengeProgress = (): Promise<ChallengeProgressMap> => load();

/** The cached copy — {} before the first load resolves. */
export const peekChallengeProgress = (): ChallengeProgressMap => cache ?? {};

export const progressOf = (map: ChallengeProgressMap, id: string): ChallengeProgress => map[id] ?? EMPTY;

/** Subscribe to changes (a screen re-reading after a match). */
export const onChallengeProgress = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** A round went active. Returns the new attempt count for the challenge. */
export const noteChallengeAttempt = async (id: string): Promise<number> => {
  const map = await load();
  const cur = map[id] ?? EMPTY;
  map[id] = { ...cur, attempts: cur.attempts + 1 };
  persist();
  notify();
  return map[id].attempts;
};

/** The round was won. Returns the attempt it landed on. */
export const noteChallengeClear = async (id: string): Promise<number> => {
  const map = await load();
  const cur = map[id] ?? EMPTY;
  map[id] = {
    ...cur,
    clears: cur.clears + 1,
    firstClearAttempt: cur.firstClearAttempt ?? Math.max(1, cur.attempts),
  };
  persist();
  notify();
  return map[id].firstClearAttempt ?? cur.attempts;
};

/** Fold the server's `challenge:` counters in (a reinstall, a second
 * device): attempts and clears take the larger of the two, never less. */
export const adoptServerCounters = async (counters: Record<string, number>): Promise<void> => {
  const map = await load();
  let changed = false;
  for (const c of CHALLENGES) {
    const attempts = counters[CHALLENGE_COUNTERS.attempts(c.id)] ?? 0;
    const clears = counters[CHALLENGE_COUNTERS.clears(c.id)] ?? 0;
    if (attempts === 0 && clears === 0) continue;
    const cur = map[c.id] ?? EMPTY;
    const next: ChallengeProgress = {
      attempts: Math.max(cur.attempts, attempts),
      clears: Math.max(cur.clears, clears),
      firstClearAttempt: cur.firstClearAttempt ?? (clears > 0 ? Math.max(1, attempts) : null),
    };
    if (next.attempts !== cur.attempts || next.clears !== cur.clears || next.firstClearAttempt !== cur.firstClearAttempt) {
      map[c.id] = next;
      changed = true;
    }
  }
  if (changed) {
    persist();
    notify();
  }
};

/** Dev only: forget every tally. */
export const forgetChallengeProgress = async (): Promise<void> => {
  cache = {};
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // survivable
  }
  notify();
};
