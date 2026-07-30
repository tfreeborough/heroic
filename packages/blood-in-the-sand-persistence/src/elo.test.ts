import { describe, expect, test } from "bun:test";
import {
  RATING_FLOOR,
  RUNGS,
  TIER_GRACE,
  displayFloorOf,
  displayRungFor,
  displayTierFor,
  expectedScore,
  kFactor,
  loserGlory,
  nextTierAbove,
  rungAbove,
  rungFor,
  tierFloorOf,
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
    expect(tierFor(1450)).toBe("Gladiator");
    expect(tierFor(1599)).toBe("Gladiator");
    expect(tierFor(1600)).toBe("Champion");
    expect(tierFor(1750)).toBe("Warlord");
    expect(tierFor(1899)).toBe("Warlord");
    expect(tierFor(1900)).toBe("Immortal");
  });

  test("the ladder walks upward and tops out", () => {
    expect(nextTierAbove("Initiate")).toEqual({ name: "Pit Fighter", floor: 1300 });
    expect(nextTierAbove("Gladiator")).toEqual({ name: "Champion", floor: 1600 });
    expect(nextTierAbove("Immortal")).toBeNull();
    expect(tierFloorOf("Champion")).toBe(1600);
  });
});

describe("divisions (the 14-rung ladder)", () => {
  test("exactly 14 rungs: single ends, III/II/I through the middle", () => {
    expect(RUNGS).toHaveLength(14);
    expect(RUNGS[0]).toEqual({ tier: "Initiate", division: null, floor: 0 });
    expect(RUNGS[13]).toEqual({ tier: "Immortal", division: null, floor: 1900 });
    // Floors ascend strictly — no dead or overlapping rungs.
    for (let i = 1; i < RUNGS.length; i++) expect(RUNGS[i]!.floor).toBeGreaterThan(RUNGS[i - 1]!.floor);
  });

  test("every division is exactly 50 points wide", () => {
    for (let i = 2; i < RUNGS.length - 1; i++) {
      expect(RUNGS[i]!.floor - RUNGS[i - 1]!.floor).toBe(50);
    }
  });

  test("division floors land where the approved table says", () => {
    expect(rungFor(1349)).toEqual({ tier: "Pit Fighter", division: 3, floor: 1300 });
    expect(rungFor(1350)).toEqual({ tier: "Pit Fighter", division: 2, floor: 1350 });
    expect(rungFor(1400)).toEqual({ tier: "Pit Fighter", division: 1, floor: 1400 });
    expect(rungFor(1500)).toEqual({ tier: "Gladiator", division: 2, floor: 1500 }); // the fresh start
    expect(rungFor(1749)).toEqual({ tier: "Champion", division: 1, floor: 1700 });
    expect(rungFor(1850)).toEqual({ tier: "Warlord", division: 1, floor: 1850 });
  });

  test("rungAbove climbs across tier boundaries and stops at the summit", () => {
    expect(rungAbove(rungFor(1550))).toEqual({ tier: "Champion", division: 3, floor: 1600 });
    expect(rungAbove(rungFor(0))).toEqual({ tier: "Pit Fighter", division: 3, floor: 1300 });
    expect(rungAbove(rungFor(2000))).toBeNull();
  });

  test("Initiate's display floor is synthetic; every other rung measures from its own", () => {
    expect(displayFloorOf(rungFor(900))).toBe(1150); // one tier-width under Pit Fighter
    expect(displayFloorOf(rungFor(1500))).toBe(1500);
    expect(displayFloorOf(rungFor(2000))).toBe(1900);
  });

  test("grace holds the tier at its entry division; divisions inside a tier move freely", () => {
    // Champion peak, dipped to 1560: badge holds → Champion III shown.
    expect(displayRungFor(1560, 1620)).toEqual({ tier: "Champion", division: 3, floor: 1600 });
    // Same rating without the peak: honest Gladiator I.
    expect(displayRungFor(1560, 1560)).toEqual({ tier: "Gladiator", division: 1, floor: 1550 });
    // Inside a tier there is NO division grace: 1550 → I, 1549 → II, even off a higher peak.
    expect(displayRungFor(1549, 1590)).toEqual({ tier: "Gladiator", division: 2, floor: 1500 });
  });
});

describe("display tier (sticky-badge grace)", () => {
  test("without a higher peak the display tier IS the raw tier", () => {
    expect(displayTierFor(1550, 1550)).toBe("Gladiator");
    expect(displayTierFor(1250, 1250)).toBe("Initiate");
  });

  test("an earned tier holds through a dip inside the grace band", () => {
    // Reached Champion (peak 1620), slipped to 1560 — still shows Champion…
    expect(displayTierFor(1560, 1620)).toBe("Champion");
    expect(displayTierFor(1600 - TIER_GRACE, 1620)).toBe("Champion");
    // …until the rating falls past the grace line.
    expect(displayTierFor(1600 - TIER_GRACE - 1, 1620)).toBe("Gladiator");
  });

  test("grace never lifts a tier the peak never reached", () => {
    // 1560 with a 1560 peak: Champion's floor is 40 away, no badge.
    expect(displayTierFor(1560, 1560)).toBe("Gladiator");
  });

  test("grace chains down one step at a time, not to the top earned tier only", () => {
    // Peak 1920 (Immortal), rating 1710: Immortal's grace is long gone, but
    // Warlord (floor 1750) was also earned and 1710 is inside ITS grace.
    expect(displayTierFor(1710, 1920)).toBe("Warlord");
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
