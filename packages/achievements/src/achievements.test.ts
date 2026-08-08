import { describe, expect, test } from "bun:test";
import { milestoneChain } from "./chain";
import { evaluate } from "./evaluate";
import { visibility } from "./frontier";
import { streakUpdates } from "./streaks";
import type { AchievementDef, BoardDef } from "./types";

/** A toy game summary — the engine never looks inside it. */
interface Summary {
  ranked: boolean;
  healed: Record<number, number>;
}

const BOARDS: Record<string, BoardDef<Summary>> = {
  ranked: { id: "ranked", accepts: (s) => s.ranked },
  open: { id: "open" },
};

const milestone = (id: string, counter: string, threshold: number, board = "ranked"): AchievementDef<Summary> => ({
  id,
  board,
  title: id,
  description: id,
  icon: id,
  parent: null,
  pos: { x: 0, y: 0 },
  trigger: { kind: "milestone", counter, threshold },
});

const feat = (id: string, test: (s: Summary, p: number) => boolean): AchievementDef<Summary> => ({
  id,
  board: "ranked",
  title: id,
  description: id,
  icon: id,
  parent: null,
  pos: { x: 0, y: 0 },
  trigger: { kind: "feat", test },
});

const rankedSummary: Summary = { ranked: true, healed: { 0: 250, 1: 40 } };

describe("evaluate", () => {
  test("milestone fires exactly on the crossing", () => {
    const defs = [milestone("wins-5", "wins", 5)];
    const base = { defs, boards: BOARDS, summary: rankedSummary, playerKey: 0, unlocked: new Set<string>() };
    expect(evaluate({ ...base, before: { wins: 3 }, after: { wins: 4 } })).toHaveLength(0);
    expect(evaluate({ ...base, before: { wins: 4 }, after: { wins: 5 } })).toHaveLength(1);
    // Already past — a later match must never re-fire it.
    expect(evaluate({ ...base, before: { wins: 5 }, after: { wins: 6 } })).toHaveLength(0);
    // A jump across the threshold still fires (0 → 7 crosses 5).
    expect(evaluate({ ...base, before: {}, after: { wins: 7 } })).toHaveLength(1);
  });

  test("several tiers can fire in one evaluation", () => {
    const defs = [milestone("k-1", "kills", 1), milestone("k-3", "kills", 3), milestone("k-10", "kills", 10)];
    const fired = evaluate({
      defs,
      boards: BOARDS,
      summary: rankedSummary,
      playerKey: 0,
      before: {},
      after: { kills: 4 },
      unlocked: new Set(),
    });
    expect(fired.map((d) => d.id)).toEqual(["k-1", "k-3"]);
  });

  test("feats run only while locked, for the right player", () => {
    const defs = [feat("healer", (s, p) => (s.healed[p] ?? 0) >= 200)];
    const base = { defs, boards: BOARDS, summary: rankedSummary, before: {}, after: {} };
    expect(evaluate({ ...base, playerKey: 0, unlocked: new Set<string>() })).toHaveLength(1);
    expect(evaluate({ ...base, playerKey: 1, unlocked: new Set<string>() })).toHaveLength(0);
    expect(evaluate({ ...base, playerKey: 0, unlocked: new Set(["healer"]) })).toHaveLength(0);
  });

  test("the board's context gate holds — and an unknown board fails closed", () => {
    const skirmish: Summary = { ranked: false, healed: { 0: 999 } };
    const defs = [feat("healer", () => true), milestone("orphan", "wins", 1, "no-such-board")];
    const fired = evaluate({
      defs,
      boards: BOARDS,
      summary: skirmish,
      playerKey: 0,
      before: {},
      after: { wins: 5 },
      unlocked: new Set(),
    });
    expect(fired).toHaveLength(0);
  });

  test("already-unlocked milestones never re-award even when crossing math says fire", () => {
    const defs = [milestone("wins-5", "wins", 5)];
    const fired = evaluate({
      defs,
      boards: BOARDS,
      summary: rankedSummary,
      playerKey: 0,
      before: { wins: 4 },
      after: { wins: 5 },
      unlocked: new Set(["wins-5"]),
    });
    expect(fired).toHaveLength(0);
  });
});

describe("streakUpdates", () => {
  test("a win extends the win streak, breaks the loss streak, high-waters best", () => {
    const after = streakUpdates({ win_streak_current: 2, win_streak_best: 4, loss_streak_current: 0 }, true);
    expect(after).toEqual({
      win_streak_current: 3,
      win_streak_best: 4,
      loss_streak_current: 0,
      loss_streak_best: 0,
    });
  });

  test("best only moves when the current run passes it", () => {
    const after = streakUpdates({ win_streak_current: 4, win_streak_best: 4 }, true);
    expect(after.win_streak_current).toBe(5);
    expect(after.win_streak_best).toBe(5);
  });

  test("a loss mirrors", () => {
    const after = streakUpdates({ win_streak_current: 7, win_streak_best: 7, loss_streak_best: 1 }, false);
    expect(after.win_streak_current).toBe(0);
    expect(after.win_streak_best).toBe(7); // the broken run's high-water survives
    expect(after.loss_streak_current).toBe(1);
    expect(after.loss_streak_best).toBe(1);
  });
});

describe("milestoneChain", () => {
  test("tiers link parent→child, space along the step, and share the icon", () => {
    const chain = milestoneChain<Summary>({
      board: "ranked",
      idBase: "ranked-wins",
      counter: "ranked_wins",
      tiers: [
        { threshold: 5, title: "Blooded", description: "Win 5 ranked matches" },
        {
          threshold: 25,
          title: "Proven",
          description: "Win 25 ranked matches",
          rewards: [{ kind: "glory", amount: 50 }, { kind: "title" }],
        },
        { threshold: 50, title: "Feared", description: "Win 50 ranked matches" },
      ],
      icon: "deed-wins",
      parent: "first-match",
      origin: { x: 100, y: 0 },
      step: { x: 0, y: 80 },
    });
    expect(chain.map((d) => d.id)).toEqual(["ranked-wins-5", "ranked-wins-25", "ranked-wins-50"]);
    expect(chain.map((d) => d.parent)).toEqual(["first-match", "ranked-wins-5", "ranked-wins-25"]);
    expect(chain[2]!.pos).toEqual({ x: 100, y: 160 });
    expect(new Set(chain.map((d) => d.icon)).size).toBe(1);
    // Per-tier authoring rides through: titles and reward STACKS live on
    // the tier (glory + wearable title on one deed).
    expect(chain[1]!.title).toBe("Proven");
    expect(chain[1]!.rewards).toEqual([{ kind: "glory", amount: 50 }, { kind: "title" }]);
    expect(chain[0]!.rewards).toBeUndefined();
  });
});

describe("visibility", () => {
  test("unlocked → full, children of unlocked → frontier, deeper → hidden", () => {
    const chain = milestoneChain<Summary>({
      board: "ranked",
      idBase: "w",
      counter: "wins",
      tiers: [1, 2, 3].map((threshold) => ({ threshold, title: `${threshold}`, description: `${threshold}` })),
      icon: "i",
      origin: { x: 0, y: 0 },
      step: { x: 1, y: 0 },
    });
    const vis = visibility(chain, new Set(["w-1"]));
    expect(vis.get("w-1")).toBe("unlocked");
    expect(vis.get("w-2")).toBe("frontier");
    expect(vis.get("w-3")).toBe("hidden");
  });

  test("roots are always at least frontier", () => {
    const root = milestone("root", "wins", 1);
    expect(visibility([root], new Set()).get("root")).toBe("frontier");
  });
});
