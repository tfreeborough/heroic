import { describe, expect, test } from "bun:test";
import { visibility } from "./frontier";
import { latestUnlocks, nearlyThere } from "./progress";
import type { AchievementDef } from "./types";

type S = Record<string, never>;

const milestone = (id: string, counter: string, threshold: number, parent: string | null = null): AchievementDef<S> => ({
  id,
  board: "b",
  title: id,
  description: id,
  icon: id,
  parent,
  pos: { x: 0, y: 0 },
  trigger: { kind: "milestone", counter, threshold },
});

const feat = (id: string): AchievementDef<S> => ({
  id,
  board: "b",
  title: id,
  description: id,
  icon: id,
  parent: null,
  pos: { x: 0, y: 0 },
  trigger: { kind: "feat", test: () => true },
});

describe("nearlyThere", () => {
  const defs = [
    milestone("first", "matches", 1),
    milestone("wins-5", "wins", 5),
    milestone("wins-25", "wins", 25, "wins-5"),
    milestone("kills-10", "kills", 10),
    feat("flawless"),
  ];

  test("fresh player: every root milestone at 0, smallest goals first, feats never listed", () => {
    const vis = visibility(defs, new Set());
    const ids = nearlyThere(defs, vis, {}, 10).map((n) => n.def.id);
    expect(ids).toEqual(["first", "wins-5", "kills-10"]);
  });

  test("ranks by fraction, hides deeper tiers, honours the limit", () => {
    const vis = visibility(defs, new Set(["first"]));
    const rows = nearlyThere(defs, vis, { wins: 4, kills: 3 }, 1);
    expect(rows.map((n) => n.def.id)).toEqual(["wins-5"]);
    expect(rows[0]!.fraction).toBeCloseTo(0.8);
    expect(rows[0]!.value).toBe(4);
  });

  test("an unlocked deed leaves the list and its child steps up with the shared counter", () => {
    const vis = visibility(defs, new Set(["first", "wins-5"]));
    const rows = nearlyThere(defs, vis, { wins: 7 }, 10);
    expect(rows[0]!.def.id).toBe("wins-25");
    expect(rows[0]!.value).toBe(7);
    expect(rows.map((n) => n.def.id)).not.toContain("wins-5");
  });

  test("a counter past its threshold (not yet settled) never reads over 100%", () => {
    const vis = visibility(defs, new Set());
    const row = nearlyThere(defs, vis, { kills: 40 }, 10).find((n) => n.def.id === "kills-10")!;
    expect(row.value).toBe(10);
    expect(row.fraction).toBeLessThan(1);
  });
});

describe("latestUnlocks", () => {
  test("newest first, capped, input untouched", () => {
    const input = [
      { id: "a", unlockedAt: 10 },
      { id: "b", unlockedAt: 30 },
      { id: "c", unlockedAt: 20 },
    ];
    expect(latestUnlocks(input, 2).map((u) => u.id)).toEqual(["b", "c"]);
    expect(input[0]!.id).toBe("a");
  });
});
