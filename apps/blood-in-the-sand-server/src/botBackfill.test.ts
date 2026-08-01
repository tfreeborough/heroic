import { describe, expect, test } from "bun:test";
import { RATING_FLOOR } from "@heroic/blood-in-the-sand-persistence";
import {
  BotIdentityBook,
  botBackfillConfigFromEnv,
  botDeadline,
  botSubjectId,
  difficultyForRating,
  fuzzedQueueSize,
  generateBotName,
  mirrorRating,
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

  test("generated names fit the wire cap", () => {
    let rolls = 0;
    const rand = () => {
      // Deterministic pseudo-random walk over the whole pattern space.
      rolls += 1;
      return (rolls * 0.6180339887) % 1;
    };
    for (let i = 0; i < 500; i++) {
      const name = generateBotName(rand);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(16);
    }
  });

  test("the book avoids an account's recent names and live in-use names", () => {
    let n = 0;
    // A generator that yields A, B, C, … deterministically per call.
    const book = new BotIdentityBook(() => `Name${n++}`);
    const rand = randOf(0);
    const first = book.pick("acct", rand);
    const second = book.pick("acct", rand);
    expect(second).not.toBe(first); // in-use AND recent
    book.release(first);
    // Released but still recent for THIS account → still avoided…
    const third = book.pick("acct", rand);
    expect(third).not.toBe(first);
    // …but another account may draw it.
    n = 0; // reset the generator so Name0 comes up again
    const other = book.pick("other", rand);
    expect(other).toBe(first);
  });

  test("the ring forgets after 10 names", () => {
    let n = 0;
    const book = new BotIdentityBook(() => `Name${n++}`);
    const rand = randOf(0);
    const first = book.pick("acct", rand);
    book.release(first);
    for (let i = 0; i < 10; i++) book.release(book.pick("acct", rand));
    n = 0; // Name0 next — first fell off the 10-ring, so it may serve again
    expect(book.pick("acct", rand)).toBe(first);
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
