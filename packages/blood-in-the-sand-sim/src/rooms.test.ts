import { describe, expect, test } from "bun:test";
import { createRng } from "@heroic/core";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_EMPTY_GRACE_MS,
  canJoin,
  generateRoomCode,
  sanitizePasscode,
  sanitizeRoomName,
  sanitizeTeamSize,
  shouldCollect,
} from "./rooms";

describe("room codes", () => {
  test("codes use the unambiguous alphabet at the fixed length", () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(new Set(), () => rng.next());
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  test("collisions with existing codes are retried away", () => {
    const rng = createRng(2);
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode(existing, () => rng.next());
      expect(existing.has(code)).toBe(false);
      existing.add(code);
    }
  });
});

describe("name/passcode hygiene", () => {
  test("room names trim, clamp, and fall back", () => {
    expect(sanitizeRoomName("  Fight Club  ", "x")).toBe("Fight Club");
    expect(sanitizeRoomName("a".repeat(40), "x")).toHaveLength(16);
    expect(sanitizeRoomName("", "tom's room")).toBe("tom's room");
    expect(sanitizeRoomName(undefined, "tom's room")).toBe("tom's room");
  });

  test("blank passcodes mean no lock", () => {
    expect(sanitizePasscode("  ")).toBeNull();
    expect(sanitizePasscode(undefined)).toBeNull();
    expect(sanitizePasscode(" hunter2 ")).toBe("hunter2");
  });

  test("team sizes clamp to the 1v1–4v4 menu, defaulting to 1v1", () => {
    expect(sanitizeTeamSize(1)).toBe(1);
    expect(sanitizeTeamSize(4)).toBe(4);
    expect(sanitizeTeamSize(0)).toBe(1);
    expect(sanitizeTeamSize(5)).toBe(1);
    expect(sanitizeTeamSize(2.5)).toBe(1);
    expect(sanitizeTeamSize("3")).toBe(1);
    expect(sanitizeTeamSize(undefined)).toBe(1);
  });
});

describe("join rules", () => {
  const base = { freeSeatInLobby: true, disconnectedSeat: false, passcode: null, offeredPass: null };

  test("open room with a free lobby seat admits", () => {
    expect(canJoin(base)).toBe("ok");
  });

  test("the passcode gates everything", () => {
    expect(canJoin({ ...base, passcode: "pw" })).toBe("wrong passcode");
    expect(canJoin({ ...base, passcode: "pw", offeredPass: "nope" })).toBe("wrong passcode");
    expect(canJoin({ ...base, passcode: "pw", offeredPass: "pw" })).toBe("ok");
  });

  test("a disconnected seat admits even with no free lobby seat (rejoin-resume)", () => {
    expect(canJoin({ ...base, freeSeatInLobby: false, disconnectedSeat: true })).toBe("ok");
  });

  test("no seat at all is full", () => {
    expect(canJoin({ ...base, freeSeatInLobby: false })).toBe("room full");
  });
});

describe("GC policy", () => {
  test("occupied rooms are never collected", () => {
    expect(shouldCollect(1, 0, ROOM_EMPTY_GRACE_MS * 10)).toBe(false);
  });

  test("empty rooms survive the grace window, then go", () => {
    expect(shouldCollect(0, 1000, 1000 + ROOM_EMPTY_GRACE_MS - 1)).toBe(false);
    expect(shouldCollect(0, 1000, 1000 + ROOM_EMPTY_GRACE_MS)).toBe(true);
    expect(shouldCollect(0, null, 999_999)).toBe(false); // never marked empty
  });
});
