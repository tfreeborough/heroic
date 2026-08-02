import { describe, expect, test } from "bun:test";
import { RATING_FLOOR } from "@heroic/blood-in-the-sand-persistence";
import {
  BotIdentityBook,
  ONLINE_COUNT,
  ROSTER,
  botBackfillConfigFromEnv,
  botDeadline,
  botSubjectId,
  difficultyForRating,
  fuzzedQueueSize,
  mirrorRating,
  onlineNames,
} from "./botBackfill";

/** Deterministic rand: cycles the given values. */
const randOf = (...values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("config", () => {
  test("defaults: on, 15–25s, ±50", () => {
    const cfg = botBackfillConfigFromEnv({});
    expect(cfg).toEqual({ enabled: true, minWaitMs: 15_000, maxWaitMs: 25_000, ratingJitter: 50 });
  });

  test("kill switch spellings", () => {
    for (const off of ["0", "off", "false", "OFF", " False "]) {
      expect(botBackfillConfigFromEnv({ RANKED_BOT_BACKFILL: off }).enabled).toBe(false);
    }
    for (const on of [undefined, "1", "on", "yes"]) {
      expect(botBackfillConfigFromEnv({ RANKED_BOT_BACKFILL: on }).enabled).toBe(true);
    }
  });

  test("waits parse, and max never sits below min", () => {
    const cfg = botBackfillConfigFromEnv({ RANKED_BOT_MIN_WAIT_MS: "2000", RANKED_BOT_MAX_WAIT_MS: "1000" });
    expect(cfg.minWaitMs).toBe(2000);
    expect(cfg.maxWaitMs).toBe(2000);
    expect(botBackfillConfigFromEnv({ RANKED_BOT_MIN_WAIT_MS: "garbage" }).minWaitMs).toBe(15_000);
  });

  test("deadline is jittered inside [min, max]", () => {
    const cfg = botBackfillConfigFromEnv({});
    expect(botDeadline(1000, cfg, randOf(0))).toBe(16_000);
    expect(botDeadline(1000, cfg, randOf(1))).toBe(26_000);
    expect(botDeadline(1000, cfg, randOf(0.5))).toBe(21_000);
  });
});

describe("difficultyForRating", () => {
  test("band edges", () => {
    expect(difficultyForRating(800)).toBe("novice");
    expect(difficultyForRating(1199)).toBe("novice");
    expect(difficultyForRating(1200)).toBe("average");
    expect(difficultyForRating(1349)).toBe("average");
    expect(difficultyForRating(1350)).toBe("experienced");
    expect(difficultyForRating(1449)).toBe("experienced");
    expect(difficultyForRating(1450)).toBe("skilled");
    expect(difficultyForRating(1500)).toBe("skilled"); // the start rating
    expect(difficultyForRating(1599)).toBe("skilled");
    expect(difficultyForRating(1600)).toBe("adept");
    expect(difficultyForRating(1749)).toBe("adept");
    expect(difficultyForRating(1750)).toBe("masterful");
    expect(difficultyForRating(1899)).toBe("masterful");
    expect(difficultyForRating(1900)).toBe("inhuman");
    expect(difficultyForRating(2049)).toBe("inhuman");
    expect(difficultyForRating(2050)).toBe("godlike");
  });
});

describe("mirrorRating", () => {
  test("uniform inside ± jitter", () => {
    expect(mirrorRating(1500, 50, randOf(0))).toBe(1450);
    expect(mirrorRating(1500, 50, randOf(1))).toBe(1550);
    expect(mirrorRating(1500, 50, randOf(0.5))).toBe(1500);
  });

  test("clamps to the rating floor", () => {
    expect(mirrorRating(RATING_FLOOR + 10, 50, randOf(0))).toBe(RATING_FLOOR);
  });
});

describe("bot identity", () => {
  test("subject ids are namespaced and unique", () => {
    const a = botSubjectId();
    expect(a.startsWith("bot:")).toBe(true);
    expect(botSubjectId()).not.toBe(a);
  });

  test("the roster is 96 unique names inside the wire cap", () => {
    expect(ROSTER).toHaveLength(96);
    expect(new Set(ROSTER).size).toBe(ROSTER.length);
    for (const name of ROSTER) {
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("roster rotation", () => {
  const HOUR = 3_600_000;

  test("four online; two clock off at the top of each hour", () => {
    const now = onlineNames(0);
    expect(now).toHaveLength(ONLINE_COUNT);
    const next = onlineNames(HOUR);
    expect(now.filter((n) => next.includes(n))).toHaveLength(2);
  });

  test("every name works one 2-hour shift per cycle", () => {
    const cycleHours = ROSTER.length / 2; // 2 fresh names an hour
    const hoursOnline = new Map<string, number[]>();
    for (let h = 0; h < cycleHours; h++) {
      for (const name of onlineNames(h * HOUR)) {
        hoursOnline.set(name, [...(hoursOnline.get(name) ?? []), h]);
      }
    }
    expect(hoursOnline.size).toBe(ROSTER.length); // the whole book cycles
    for (const hours of hoursOnline.values()) {
      expect(hours).toHaveLength(2);
      // Consecutive — one shift, not two visits. The ring's first two names
      // work the cycle-wrapping night shift (hours [0, cycleHours-1]).
      expect([1, cycleHours - 1]).toContain(hours[1]! - hours[0]!);
    }
  });

  test("pure in wall-clock time — a restart changes nothing", () => {
    expect(onlineNames(5 * HOUR + 123)).toEqual(onlineNames(5 * HOUR + 456_789));
  });
});

describe("BotIdentityBook", () => {
  const NOW = 12 * 3_600_000; // mid-day, mid-ring
  const pick = (book: BotIdentityBook, acct = "acct", rating = 1500, now = NOW, rand = randOf(0.5)) =>
    book.pick(acct, rating, 50, now, rand);

  test("serves from the online window, never the same name twice in a row", () => {
    const book = new BotIdentityBook();
    const online = onlineNames(NOW);
    const first = pick(book);
    expect(online).toContain(first.name);
    book.release(first.name);
    const second = pick(book);
    expect(second.name).not.toBe(first.name);
    book.release(second.name);
    // A re-match with a game in between is allowed — small-population feel.
    expect(pick(book).name).toBe(first.name);
  });

  test("concurrent matches never share a name; exhaustion pulls names online early", () => {
    const book = new BotIdentityBook();
    const online = onlineNames(NOW);
    const served = Array.from({ length: 6 }, (_, i) => pick(book, `acct${i}`).name);
    expect(new Set(served).size).toBe(6); // all live at once, all distinct
    // The first four are the online window; the overflow came off the ring
    // just past it — tomorrow's names logging on early.
    expect(served.slice(0, ONLINE_COUNT).sort()).toEqual([...online].sort());
    for (const name of served.slice(ONLINE_COUNT)) expect(online).not.toContain(name);
  });

  test("a name keeps a coherent rating for its whole shift", () => {
    const book = new BotIdentityBook();
    const first = pick(book, "a", 1500, NOW, randOf(0.5)); // anchors at the mirror (=1500)
    expect(first.rating).toBe(1500);
    book.release(first.name);
    // Another account, a plausible rating away: same name, drifted-not-mirrored.
    const again = pick(book, "b", 1560, NOW + 60_000, randOf(0.5));
    expect(again.name).toBe(first.name);
    expect(Math.abs(again.rating - first.rating)).toBeLessThanOrEqual(8);
  });

  test("an implausible rating gap gets a different name, not a jumped rating", () => {
    const book = new BotIdentityBook();
    const first = pick(book, "a", 1500);
    book.release(first.name);
    const stranger = pick(book, "b", 1900); // 400 away — Vex can't suddenly be 1900
    expect(stranger.name).not.toBe(first.name);
    expect(Math.abs(stranger.rating - 1900)).toBeLessThanOrEqual(50);
  });

  test("the shift's anchor expires with the shift", () => {
    const book = new BotIdentityBook();
    const first = pick(book, "a", 1500, NOW);
    book.release(first.name);
    // Two hours on: the shift is over; the same slot re-anchors fresh.
    const later = pick(book, "b", 1900, NOW + 2 * 3_600_000 + 60_000);
    expect(Math.abs(later.rating - 1900)).toBeLessThanOrEqual(50);
  });
});

describe("queue-size fuzz", () => {
  test("never shows the lonely queue", () => {
    for (let t = 0; t < 10 * 60_000; t += 30_000) {
      expect(fuzzedQueueSize(0, "1v1", t)).toBeGreaterThanOrEqual(1);
      expect(fuzzedQueueSize(1, "1v1", t)).toBeGreaterThanOrEqual(2);
    }
  });

  test("pure in (size, bracket, time) — status and info agree", () => {
    expect(fuzzedQueueSize(2, "1v1", 123_456)).toBe(fuzzedQueueSize(2, "1v1", 123_456));
  });

  test("varies slowly over minutes", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 7 * 60_000; t += 60_000) seen.add(fuzzedQueueSize(0, "1v1", t));
    expect(seen.size).toBeGreaterThan(1); // it moves…
    expect(fuzzedQueueSize(0, "1v1", 0)).toBe(fuzzedQueueSize(0, "1v1", 5_000)); // …but not tick to tick
  });
});
