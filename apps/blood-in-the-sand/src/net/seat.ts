/**
 * The seat the app last held, remembered ACROSS sockets and across app
 * restarts (bits-reconnect.md § app-restart rejoin, 2026-09-16). The server
 * keeps a mid-match seat warm behind its per-seat token (the body idles,
 * killable, until the match ends); before this the client only remembered
 * that token in module memory, so a socket blip needed a manual rejoin by
 * code — impossible for a ranked room, which shows no code — and a killed
 * app forgot the seat outright. Tom, 2026-09-16: "I myself have done it
 * before and accidentally left and there was no way to rejoin […] if the
 * game is still ongoing this is the first thing we should do for players
 * when coming back into the app."
 *
 * Write-through: an in-memory copy answers synchronously (the connection
 * manager decides at socket-open time, on the hot path), AsyncStorage holds
 * the durable copy. Stamped on every `welcome`, refreshed on a slow beat
 * while seated (so the TTL reads "last seen in the match", not "joined"),
 * and cleared on every DELIBERATE exit and every failed reclaim.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_SEAT = "bits.seat";

/** How stale a remembered seat may be before a launch stops even trying it.
 * A match with an idling body ends within minutes (the body dies every
 * round); a seat older than this is certainly gone, and the server would
 * say so — this only spares a pointless round trip on the connect screen. */
export const SEAT_TTL_MS = 30 * 60_000;

/** How often a live seat's `seenMs` is re-stamped to storage. */
export const SEAT_TOUCH_INTERVAL_MS = 15_000;

export interface StoredSeat {
  code: string;
  seatToken: string;
  /** The name the seat was claimed under — a skirmish reclaim re-sends it
   * (a ranked reclaim resumes the queue-verified identity regardless). */
  playerName: string;
  /** Non-null for a ranked room — the route the rejoin lands on, and the
   * `rankedMatch` the client restores (the welcome itself doesn't say). */
  ranked: { bracket: string } | null;
  /** Wall clock (Date.now()) we last knew the seat was live. */
  seenMs: number;
}

let memory: StoredSeat | null = null;
/** A forget that landed before the storage read did — the read must not
 * resurrect the seat it is about to find on disk. */
let forgotten = false;
/** Resolved once the storage read has landed; the in-memory copy is
 * authoritative from then on. */
let loaded: Promise<StoredSeat | null> | null = null;

const parse = (raw: string | null): StoredSeat | null => {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSeat>;
    if (
      typeof v.code !== "string" ||
      typeof v.seatToken !== "string" ||
      typeof v.playerName !== "string" ||
      typeof v.seenMs !== "number"
    ) {
      return null;
    }
    const ranked =
      v.ranked && typeof v.ranked === "object" && typeof v.ranked.bracket === "string" ? { bracket: v.ranked.bracket } : null;
    return { code: v.code, seatToken: v.seatToken, playerName: v.playerName, ranked, seenMs: v.seenMs };
  } catch {
    return null;
  }
};

/** The durable copy, read once per process; later calls answer from memory.
 * A seat past its TTL reads as none (and is swept from storage). */
export const loadStoredSeat = (): Promise<StoredSeat | null> => {
  loaded ??= AsyncStorage.getItem(KEY_SEAT)
    .then(parse)
    .catch(() => null)
    .then((seat) => {
      // A remember/forget that raced the read wins — memory is the truth
      // the moment anything writes it.
      if (memory !== null || forgotten) return memory;
      if (seat !== null && Date.now() - seat.seenMs > SEAT_TTL_MS) {
        void AsyncStorage.removeItem(KEY_SEAT).catch(() => {});
        return null;
      }
      memory = seat;
      return memory;
    });
  return loaded;
};

/** The seat as far as this process knows RIGHT NOW (null before the storage
 * read lands, or when there is none). */
export const peekSeat = (): StoredSeat | null => memory;

export const rememberSeat = (seat: Omit<StoredSeat, "seenMs">): void => {
  memory = { ...seat, seenMs: Date.now() };
  forgotten = false;
  void AsyncStorage.setItem(KEY_SEAT, JSON.stringify(memory)).catch(() => {});
};

/** Re-stamp the live seat's last-seen clock (throttled by the caller). */
export const touchSeat = (): void => {
  if (memory === null) return;
  memory = { ...memory, seenMs: Date.now() };
  void AsyncStorage.setItem(KEY_SEAT, JSON.stringify(memory)).catch(() => {});
};

export const forgetSeat = (): void => {
  memory = null;
  forgotten = true;
  void AsyncStorage.removeItem(KEY_SEAT).catch(() => {});
};
