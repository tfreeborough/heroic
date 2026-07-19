/**
 * Room-registry rules, kept pure so `bun test packages` covers them: code
 * generation, name/passcode hygiene, join validation, and the GC policy. The
 * server holds the actual Map<code, Room> and the clock; these functions only
 * decide. Rooms live purely in server memory by design — a room is exactly as
 * ephemeral as the match inside it (decided 2026-07-09, no DB).
 */
import { MAX_TEAM_SIZE, type TeamSize } from "./config";

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

/** Host's room-size pick; anything off the menu falls back to 1v1. */
export const sanitizeTeamSize = (v: unknown): TeamSize =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_TEAM_SIZE
    ? (v as TeamSize)
    : 1;

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

/**
 * Who holds the crown, given the currently CONNECTED seated player ids. The
 * host is sticky — it never moves while its holder is still connected and
 * seated; only when they're gone does it hand off, to the lowest remaining id
 * (deterministic + stable, so it doesn't reshuffle as others come and go).
 * Returns null when nobody's left to hold it — the caller closes the room.
 * (Reverses the v7 "host leaving closes the room" rule, protocol v14.)
 */
export const nextHost = (connectedSeatedIds: readonly number[], currentHostId: number): number | null => {
  if (connectedSeatedIds.includes(currentHostId)) return currentHostId;
  if (connectedSeatedIds.length === 0) return null;
  return Math.min(...connectedSeatedIds);
};

/** GC policy: collect once a room has been empty past the grace window. */
export const shouldCollect = (
  connectedCount: number,
  emptySinceMs: number | null,
  nowMs: number,
): boolean =>
  connectedCount === 0 && emptySinceMs !== null && nowMs - emptySinceMs >= ROOM_EMPTY_GRACE_MS;
