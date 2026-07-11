/**
 * Room-registry rules, kept pure so `bun test packages` covers them: code
 * generation, name/passcode hygiene, join validation, and the GC policy. The
 * server holds the actual Map<code, Room> and the clock; these functions only
 * decide. Rooms live purely in server memory by design — a room is exactly as
 * ephemeral as the match inside it (decided 2026-07-09, no DB).
 */

/** Unambiguous room-code alphabet: no I/O/0/1 lookalikes. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

/** Griefing/memory bound — creation is rejected past this. */
export const MAX_ROOMS = 20;

/** Empty rooms linger this long before the sweep collects them. */
export const ROOM_EMPTY_GRACE_MS = 2 * 60_000;

const MAX_NAME = 16;
const MAX_PASSCODE = 16;

/**
 * A fresh code not already in `existing`. `rand` is injected (0..1) so tests
 * can be deterministic. Collisions just retry — at 24⁴ ≈ 330k codes and a cap
 * of 20 rooms, the loop terminates in practice on the first draw.
 */
export const generateRoomCode = (existing: ReadonlySet<string>, rand: () => number): string => {
  for (;;) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)]!;
    }
    if (!existing.has(code)) return code;
  }
};

export const sanitizeRoomName = (name: unknown, fallback: string): string => {
  const t = (typeof name === "string" ? name : "").trim().slice(0, MAX_NAME);
  return t || fallback;
};

/** Empty/whitespace passcode means "no lock". */
export const sanitizePasscode = (pass: unknown): string | null => {
  const t = (typeof pass === "string" ? pass : "").trim().slice(0, MAX_PASSCODE);
  return t || null;
};

export type JoinVerdict = "ok" | "wrong passcode" | "room full";

export interface JoinCheck {
  /** A free (null) seat exists AND the room is in the lobby phase. */
  freeSeatInLobby: boolean;
  /** A seated-but-disconnected player exists (mid-match rejoin target). */
  disconnectedSeat: boolean;
  passcode: string | null;
  offeredPass: string | null;
}

/**
 * Join rules: the passcode gates everything; a free lobby seat OR a
 * disconnected seat (rejoin-and-resume, any phase) admits you.
 */
export const canJoin = (check: JoinCheck): JoinVerdict => {
  if (check.passcode !== null && check.passcode !== (check.offeredPass ?? "")) {
    return "wrong passcode";
  }
  if (check.freeSeatInLobby || check.disconnectedSeat) return "ok";
  return "room full";
};

/** GC policy: collect once a room has been empty past the grace window. */
export const shouldCollect = (
  connectedCount: number,
  emptySinceMs: number | null,
  nowMs: number,
): boolean =>
  connectedCount === 0 && emptySinceMs !== null && nowMs - emptySinceMs >= ROOM_EMPTY_GRACE_MS;
