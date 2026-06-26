import { describe, expect, test } from "bun:test";
import { initMusicState, stepMusicState } from "./musicState";

const HANGOVER = 4;
const DT = 1 / 60;

describe("stepMusicState", () => {
  test("starts idle", () => {
    expect(initMusicState().situation).toBe("idle");
  });

  test("switches to combat the moment an enemy engages", () => {
    const s = initMusicState();
    expect(stepMusicState(s, true, DT, HANGOVER)).toBe("combat");
  });

  test("holds combat through the hangover after disengaging", () => {
    const s = initMusicState();
    stepMusicState(s, true, DT, HANGOVER); // engage
    // Disengage and run for just under the hangover — still combat.
    let elapsed = 0;
    while (elapsed < HANGOVER - DT) {
      expect(stepMusicState(s, false, DT, HANGOVER)).toBe("combat");
      elapsed += DT;
    }
  });

  test("returns to idle once the hangover elapses", () => {
    const s = initMusicState();
    stepMusicState(s, true, DT, HANGOVER);
    for (let elapsed = 0; elapsed <= HANGOVER + DT; elapsed += DT) {
      stepMusicState(s, false, DT, HANGOVER);
    }
    expect(s.situation).toBe("idle");
    expect(s.hangover).toBe(0);
  });

  test("re-engaging mid-hangover refreshes it (no premature drop)", () => {
    const s = initMusicState();
    stepMusicState(s, true, DT, HANGOVER);
    // Wind most of the way down...
    for (let elapsed = 0; elapsed < HANGOVER - DT; elapsed += DT) {
      stepMusicState(s, false, DT, HANGOVER);
    }
    // ...then an enemy re-engages: hangover resets to full.
    expect(stepMusicState(s, true, DT, HANGOVER)).toBe("combat");
    expect(s.hangover).toBe(HANGOVER);
  });

  test("stays idle when never in combat", () => {
    const s = initMusicState();
    for (let i = 0; i < 100; i++) expect(stepMusicState(s, false, DT, HANGOVER)).toBe("idle");
  });
});
