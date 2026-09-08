import { describe, expect, test } from "bun:test";
import { noteSongPlayed, pickSong, RECENT_SONGS } from "./songRotation";

const pool = Array.from({ length: 23 }, (_, i) => `song${i}`);

/** A tiny deterministic LCG so a "random" run is repeatable. */
const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

describe("pickSong", () => {
  test("null on an empty pool", () => {
    expect(pickSong([], [], () => 0)).toBeNull();
  });

  test("never picks one of the recent songs", () => {
    const recent = pool.slice(0, RECENT_SONGS);
    const random = seeded(1);
    for (let i = 0; i < 500; i++) {
      const pick = pickSong(pool, recent, random);
      expect(pick).not.toBeNull();
      expect(recent).not.toContain(pick!);
    }
  });

  test("reaches every non-recent song", () => {
    const recent = pool.slice(0, RECENT_SONGS);
    const random = seeded(2);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(pickSong(pool, recent, random)!);
    expect(seen.size).toBe(pool.length - RECENT_SONGS);
  });

  test("random at the top of its range still lands inside the candidates", () => {
    expect(pool).toContain(pickSong(pool, [], () => 0.999999)!);
  });

  test("a pool no bigger than the list releases its OLDEST plays first", () => {
    const small = ["a", "b", "c"];
    // All three recent, oldest → newest: a, b, c. Only "a" may come back.
    expect(pickSong(small, ["a", "b", "c"], () => 0)).toBe("a");
    expect(pickSong(small, ["a", "b", "c"], () => 0.99)).toBe("a");
    // Recent entries that aren't in the pool are ignored when releasing.
    expect(pickSong(small, ["zzz", "a", "b", "c"], () => 0.5)).toBe("a");
  });

  test("a one-song pool always plays that song", () => {
    expect(pickSong(["only"], ["only"], () => 0.3)).toBe("only");
  });

  test("a long run over the real-sized pool keeps every song at least 12 plays apart", () => {
    const random = seeded(3);
    let recent: string[] = [];
    const lastPlayed = new Map<string, number>();
    for (let n = 0; n < 5000; n++) {
      const song = pickSong(pool, recent, random)!;
      const last = lastPlayed.get(song);
      if (last !== undefined) expect(n - last).toBeGreaterThan(RECENT_SONGS);
      lastPlayed.set(song, n);
      recent = noteSongPlayed(recent, song);
    }
    // And every song got its turn.
    expect(lastPlayed.size).toBe(pool.length);
  });
});

describe("noteSongPlayed", () => {
  test("appends newest last and trims to the limit", () => {
    let recent: string[] = [];
    for (let i = 0; i < RECENT_SONGS + 3; i++) recent = noteSongPlayed(recent, `song${i}`);
    expect(recent).toHaveLength(RECENT_SONGS);
    expect(recent[0]).toBe("song3");
    expect(recent[recent.length - 1]).toBe(`song${RECENT_SONGS + 2}`);
  });

  test("a repeat moves to the newest slot rather than duplicating", () => {
    expect(noteSongPlayed(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
  });

  test("does not mutate its input", () => {
    const before = ["a", "b"];
    noteSongPlayed(before, "c");
    expect(before).toEqual(["a", "b"]);
  });
});
