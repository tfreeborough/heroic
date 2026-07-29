import { describe, expect, test } from "bun:test";
import {
  RATING_FLOOR,
  expectedScore,
  kFactor,
  loserGlory,
  tierFor,
  updateRating,
  winnerGlory,
} from "./elo";

describe("expected score", () => {
  test("equal ratings are a coin flip", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });

  test("a 200-point edge is roughly 3:1", () => {
    expect(expectedScore(1700, 1500)).toBeCloseTo(0.76, 2);
    expect(expectedScore(1500, 1700)).toBeCloseTo(0.24, 2);
  });

  test("the two sides' chances always sum to 1", () => {
    for (const [a, b] of [[1500, 1500], [1500, 1900], [1234, 1789]] as const) {
      expect(expectedScore(a, b) + expectedScore(b, a)).toBeCloseTo(1, 10);
    }
  });
});

describe("K schedule", () => {
  test("placements run hot, then settle", () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(9)).toBe(40);
    expect(kFactor(10)).toBe(20);
    expect(kFactor(500)).toBe(20);
  });
});

describe("rating updates", () => {
  test("an even placement win moves +20, a settled one +10", () => {
    expect(updateRating({ rating: 1500, opponent: 1500, matchesPlayed: 0, won: true })).toBe(1520);
    expect(updateRating({ rating: 1500, opponent: 1500, matchesPlayed: 50, won: true })).toBe(1510);
  });

  test("losses mirror wins at equal ratings", () => {
    expect(updateRating({ rating: 1500, opponent: 1500, matchesPlayed: 50, won: false })).toBe(1490);
  });

  test("an upset pays big, a stomp pays scraps", () => {
    // 1500 beats 1900 (E ≈ 0.09): almost the full K.
    expect(updateRating({ rating: 1500, opponent: 1900, matchesPlayed: 50, won: true })).toBe(1518);
    // 1900 beats 1500: barely moves.
    expect(updateRating({ rating: 1900, opponent: 1500, matchesPlayed: 50, won: true })).toBe(1902);
  });

  test("nobody rates below the floor", () => {
    expect(updateRating({ rating: 805, opponent: 805, matchesPlayed: 0, won: false })).toBe(RATING_FLOOR);
  });
});

describe("tiers", () => {
  test("band edges land where the doc says", () => {
    expect(tierFor(1299)).toBe("Initiate");
    expect(tierFor(1300)).toBe("Pit Fighter");
    expect(tierFor(1450)).toBe("Blooded");
    expect(tierFor(1500)).toBe("Gladiator");
    expect(tierFor(1600)).toBe("Veteran");
    expect(tierFor(1700)).toBe("Champion");
    expect(tierFor(1850)).toBe("Warlord");
    expect(tierFor(1999)).toBe("Warlord");
    expect(tierFor(2000)).toBe("Immortal");
  });
});

describe("Glory payouts", () => {
  test("floor-plus-bonus: stomp ≈ floor, even ≈ +50%, upset ≈ double", () => {
    expect(winnerGlory(1900, 1500)).toBe(16); // stomp
    expect(winnerGlory(1500, 1500)).toBe(23); // even fight
    expect(winnerGlory(1500, 1900)).toBe(29); // upset
  });

  test("losers always take the participation payout", () => {
    expect(loserGlory()).toBe(5);
  });
});
