import { describe, expect, test } from "bun:test";
import { evaluate, streakUpdates } from "@heroic/achievements";
import { ABILITY_IDS, WEAPON_IDS } from "../config";
import type { ArenaEvent } from "../events";
import { COUNTERS, counterDeltas } from "./counters";
import { ACHIEVEMENT_BOARDS, ACHIEVEMENT_DEFS, RANKED_BOARD } from "./defs";
import { MatchStatsAccumulator, type MatchSummary } from "./summary";

/** A synthetic ranked 1v1: seat 0 (team 1, blade) beats seat 1 (team 2, bow). */
const play1v1 = (): MatchSummary => {
  const acc = new MatchStatsAccumulator([
    { id: 0, team: 1 },
    { id: 1, team: 2 },
  ]);
  const events: ArenaEvent[] = [
    { type: "roundStart", roundNumber: 1 },
    { type: "cast", playerId: 0, ability: "dash" },
    { type: "cast", playerId: 1, ability: "blood-font" },
    { type: "heal", targetId: 1, casterId: 1, amount: 30, x: 0, y: 0 },
    { type: "hit", attackerId: 0, targetId: 1, damage: 20, crit: false, lethal: false, x: 0, y: 0 },
    // A straw-man soak — must count for nobody (deployable ids live far
    // above the seat range).
    { type: "hit", attackerId: 1, targetId: 10_000, damage: 15, crit: false, lethal: false, x: 0, y: 0 },
    { type: "hit", attackerId: 0, targetId: 1, damage: 25, crit: true, lethal: true, x: 0, y: 0 },
    { type: "death", playerId: 1 },
    { type: "roundEnd", winnerTeam: 1, wins: [1, 0], standing: [{ id: 0, hpFrac: 1 }] },
    { type: "roundStart", roundNumber: 2 },
    { type: "cast", playerId: 0, ability: "dash" },
    { type: "hit", attackerId: 1, targetId: 0, damage: 12, crit: false, lethal: false, x: 0, y: 0 },
    { type: "hit", attackerId: 0, targetId: 1, damage: 40, crit: false, lethal: true, x: 0, y: 0 },
    { type: "death", playerId: 1 },
    { type: "roundEnd", winnerTeam: 1, wins: [2, 0], standing: [{ id: 0, hpFrac: 0.88 }] },
    { type: "matchEnd", winnerTeam: 1 },
  ];
  // Feed in two batches — the accumulator must not care how steps split.
  acc.ingest(events.slice(0, 8));
  acc.ingest(events.slice(8));
  return acc.summary({
    ranked: true,
    bracket: "1v1",
    teamSize: 1,
    winnerTeam: 1,
    players: [
      { id: 0, team: 1, weapon: "blade", bot: false },
      { id: 1, team: 2, weapon: "bow", bot: true },
    ],
  });
};

describe("MatchStatsAccumulator", () => {
  const summary = play1v1();

  test("tallies the winner's side", () => {
    expect(summary.stats[0]).toEqual({
      kills: 2,
      deaths: 0,
      damageDealt: 85,
      damageTaken: 12,
      healingReceived: 0,
      healingDealt: 0,
      reflects: 0,
      casts: { dash: 2 },
      roundsWon: 2,
      lastRoundHpFrac: 0.88,
    });
  });

  test("tallies the loser's side — deployable soaks count for nobody", () => {
    expect(summary.stats[1]).toEqual({
      kills: 0,
      deaths: 2,
      damageDealt: 12,
      damageTaken: 85,
      healingReceived: 30,
      healingDealt: 30, // the self-heal credits the caster too
      reflects: 0,
      casts: { "blood-font": 1 },
      roundsWon: 0,
      lastRoundHpFrac: null, // dead when the decider closed
    });
  });

  test("round score survives into the summary", () => {
    expect(summary.roundWins).toEqual([2, 0]);
  });
});

describe("Wave-2 events", () => {
  test("healing credits its caster — a font healing an ally is the caster's healing done", () => {
    const acc = new MatchStatsAccumulator([
      { id: 0, team: 1 },
      { id: 1, team: 1 },
    ]);
    acc.ingest([{ type: "heal", targetId: 1, casterId: 0, amount: 45, x: 0, y: 0 }]);
    const s = acc.summary({ ranked: true, bracket: "2v2", teamSize: 2, winnerTeam: 1, players: [
      { id: 0, team: 1, weapon: "staff", bot: false },
      { id: 1, team: 1, weapon: "blade", bot: false },
    ]});
    expect(s.stats[0]!.healingDealt).toBe(45);
    expect(s.stats[0]!.healingReceived).toBe(0);
    expect(s.stats[1]!.healingDealt).toBe(0);
    expect(s.stats[1]!.healingReceived).toBe(45);
    // The counter follows the CASTER (Wave 2 semantics switch).
    expect(counterDeltas(s, 0)[COUNTERS.healingDone]).toBe(45);
    expect(counterDeltas(s, 1)[COUNTERS.healingDone]).toBeUndefined();
  });

  test("reflects count for the reflector only", () => {
    const acc = new MatchStatsAccumulator([
      { id: 0, team: 1 },
      { id: 1, team: 2 },
    ]);
    acc.ingest([
      { type: "reflect", playerId: 0, attackerId: 1, x: 0, y: 0 },
      { type: "reflect", playerId: 0, attackerId: 1, x: 0, y: 0 },
    ]);
    const s = acc.summary({ ranked: true, bracket: "1v1", teamSize: 1, winnerTeam: 1, players: [
      { id: 0, team: 1, weapon: "blade", bot: false },
      { id: 1, team: 2, weapon: "bow", bot: false },
    ]});
    expect(s.stats[0]!.reflects).toBe(2);
    expect(s.stats[1]!.reflects).toBe(0);
  });

  test("lastRoundHpFrac is overwritten each round — the final ingest holds the decider", () => {
    const acc = new MatchStatsAccumulator([
      { id: 0, team: 1 },
      { id: 1, team: 2 },
    ]);
    acc.ingest([
      { type: "roundEnd", winnerTeam: 1, wins: [1, 0], standing: [{ id: 0, hpFrac: 0.9 }] },
      { type: "roundEnd", winnerTeam: 2, wins: [1, 1], standing: [{ id: 1, hpFrac: 0.4 }] },
      { type: "roundEnd", winnerTeam: 1, wins: [2, 1], standing: [{ id: 0, hpFrac: 0.06 }] },
    ]);
    const s = acc.summary({ ranked: true, bracket: "1v1", teamSize: 1, winnerTeam: 1, players: [
      { id: 0, team: 1, weapon: "hammer", bot: false },
      { id: 1, team: 2, weapon: "staff", bot: false },
    ]});
    // The "win the decider under 10%" shape: won the match, alive under 0.1.
    expect(s.stats[0]!.lastRoundHpFrac).toBeCloseTo(0.06);
    expect(s.stats[1]!.lastRoundHpFrac).toBeNull();
  });
});

describe("counterDeltas", () => {
  const summary = play1v1();

  test("winner's deltas", () => {
    expect(counterDeltas(summary, 0)).toEqual({
      [COUNTERS.rankedMatches]: 1,
      [COUNTERS.rankedWins]: 1,
      [COUNTERS.killingBlows]: 2,
      [COUNTERS.damageDealt]: 85,
      "rounds_won:blade": 2,
      "cast:dash": 2,
    });
  });

  test("loser's deltas omit zeros and skip the wins counter", () => {
    const deltas = counterDeltas(summary, 1);
    expect(deltas).toEqual({
      [COUNTERS.rankedMatches]: 1,
      [COUNTERS.damageDealt]: 12,
      [COUNTERS.healingDone]: 30,
      "cast:blood-font": 1,
    });
    expect(deltas[COUNTERS.rankedWins]).toBeUndefined();
    expect(deltas["rounds_won:bow"]).toBeUndefined();
  });
});

describe("Wave-1 defs", () => {
  test("every weapon and ability has a hand-authored chain — new roster content fails here until its chain is written", () => {
    const ids = [...new Set(ACHIEVEMENT_DEFS.map((d) => d.id))];
    for (const w of WEAPON_IDS) {
      expect(ids.some((id) => id.startsWith(`rounds-${w}-`))).toBe(true);
    }
    for (const a of ABILITY_IDS) {
      expect(ids.some((id) => id.startsWith(`casts-${a}-`))).toBe(true);
    }
  });

  test("no two board nodes overlap — authored positions stay legible", () => {
    // Node radii from the map (root 34, others 26) + a 6px breathing gap.
    const radius = (d: (typeof ACHIEVEMENT_DEFS)[number]): number => (d.parent === null ? 34 : 26);
    const collisions: string[] = [];
    for (let i = 0; i < ACHIEVEMENT_DEFS.length; i++) {
      for (let j = i + 1; j < ACHIEVEMENT_DEFS.length; j++) {
        const a = ACHIEVEMENT_DEFS[i]!;
        const b = ACHIEVEMENT_DEFS[j]!;
        const need = radius(a) + radius(b) + 6;
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < need) {
          collisions.push(`${a.id} <-> ${b.id}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  test("every deed appears in exactly one chapter", async () => {
    const { ACHIEVEMENT_CHAPTERS } = await import("./defs");
    const chapterIds = ACHIEVEMENT_CHAPTERS.flatMap((c) => [...c.ids]);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    expect(chapterIds.length).toBe(ACHIEVEMENT_DEFS.length);
    const known = new Set(ACHIEVEMENT_DEFS.map((d) => d.id));
    for (const id of chapterIds) expect(known.has(id)).toBe(true);
  });

  test("ids are unique and every parent exists", () => {
    const ids = new Set(ACHIEVEMENT_DEFS.map((d) => d.id));
    expect(ids.size).toBe(ACHIEVEMENT_DEFS.length);
    for (const def of ACHIEVEMENT_DEFS) {
      if (def.parent !== null) expect(ids.has(def.parent)).toBe(true);
      expect(ACHIEVEMENT_BOARDS[def.board]).toBeDefined();
    }
  });

  test("every def lives on the ranked board and the board gates on ranked", () => {
    expect(ACHIEVEMENT_DEFS.every((d) => d.board === RANKED_BOARD)).toBe(true);
    // Deeds are RANKED-ONLY (decided 2026-08-08; a skirmish-counting pass
    // was built and reverted the same day): a non-ranked summary awards
    // NOTHING — sound because non-ranked applies don't exist, so no counter
    // crossing can ever be consumed behind this gate. If that changes,
    // milestones must be exempted from `accepts` (see evaluate()).
    const skirmish = { ...play1v1(), ranked: false };
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary: skirmish,
      playerKey: 0,
      before: {},
      after: counterDeltas(skirmish, 0),
      unlocked: new Set(),
    });
    expect(fired).toHaveLength(0);
  });

  test("a first ranked win pops the right deeds", () => {
    const summary = play1v1();
    const deltas = counterDeltas(summary, 0);
    const after = { ...deltas, ...streakUpdates({}, true) };
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary,
      playerKey: 0,
      before: {},
      after,
      unlocked: new Set(),
    });
    const ids = fired.map((d) => d.id);
    expect(ids).toContain("sworn-to-the-sand"); // first match
    expect(ids).toContain("killing-blows-1"); // first blood
    expect(ids).not.toContain("ranked-wins-5"); // one win ≠ five
    expect(ids).not.toContain("not-a-scratch"); // took 12 damage
  });

  test("the untouched feat fires only on an untouched WIN", () => {
    const summary = play1v1();
    summary.stats[0]!.damageTaken = 0;
    const winnerFired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary,
      playerKey: 0,
      before: {},
      after: {},
      unlocked: new Set(),
    }).map((d) => d.id);
    expect(winnerFired).toContain("not-a-scratch");
    // The loser taking zero damage (hypothetically) must not fire it.
    summary.stats[1]!.damageTaken = 0;
    const loserFired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary,
      playerKey: 1,
      before: {},
      after: {},
      unlocked: new Set(),
    }).map((d) => d.id);
    expect(loserFired).not.toContain("not-a-scratch");
  });

  test("lifeblood reads the single-match healing, not the lifetime counter", () => {
    const summary = play1v1();
    summary.stats[1]!.healingReceived = 200;
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary,
      playerKey: 1,
      before: {},
      after: {},
      unlocked: new Set(),
    }).map((d) => d.id);
    expect(fired).toContain("lifeblood");
  });

  test("loss-streak deeds never pay Glory or items — a throw must earn nothing farmable", () => {
    // Joke TITLES are allowed (Fossil Record — the wearable punchline, Tom
    // 2026-08-04); anything with material value is not.
    for (const def of ACHIEVEMENT_DEFS) {
      if (!def.id.startsWith("loss-streak")) continue;
      for (const reward of def.rewards ?? []) {
        expect(reward.kind).toBe("title");
      }
    }
  });
});
