import { describe, expect, test } from "bun:test";
import { evaluate, streakUpdates } from "@heroic/achievements";
import { ABILITY_IDS, WEAPON_IDS } from "../config";
import type { ArenaEvent } from "../events";
import { COUNTERS, UNDYING_STREAK, counterDeltas, undyingStreakUpdates } from "./counters";
import { ACHIEVEMENT_BOARDS, ACHIEVEMENT_DEFS, RANKED_BOARD } from "./defs";
import { ACHIEVEMENT_DEFS_2V2, RANKED_2V2_BOARD, TITLE_ONLY_2V2 } from "./defs2v2";
import { MatchStatsAccumulator, type MatchSummary } from "./summary";

/** The Wave-3 partnership stats at rest — every one is zero in a 1v1. */
const WAVE3_ZERO = {
  assists: 0,
  doubleKills: 0,
  clutchRounds: 0,
  lastRoundClutch: false,
  revengeKills: 0,
  swiftRevenges: 0,
  concertKills: 0,
  fastestKillSec: null,
  alliedHealing: 0,
};

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
      crits: 1,
      casts: { dash: 2 },
      roundsWon: 2,
      lastRoundHpFrac: 0.88,
      ...WAVE3_ZERO,
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
      crits: 0,
      casts: { "blood-font": 1 },
      roundsWon: 0,
      lastRoundHpFrac: null, // dead when the decider closed
      ...WAVE3_ZERO,
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
      "ranked_matches:1v1": 1,
      "ranked_wins:1v1": 1,
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
      "ranked_matches:1v1": 1,
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

  test("every def lives on a ranked board and the boards gate on ranked", () => {
    expect(ACHIEVEMENT_DEFS.every((d) => d.board === RANKED_BOARD || d.board === RANKED_2V2_BOARD)).toBe(true);
    expect(ACHIEVEMENT_DEFS_2V2.every((d) => d.board === RANKED_2V2_BOARD)).toBe(true);
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
    expect(ids).not.toContain("killing-blows-5"); // two kills ≠ five (first-win audit: no first-blood pop)
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

  test("Wave-2 feats fire on their exact shapes", () => {
    // A 2-1 comeback decider: seat 0 drops round 1, takes rounds 2 and 3,
    // finishing at 6% HP with heavy damage, ten crits, and seven reflects.
    const acc = new MatchStatsAccumulator([
      { id: 0, team: 1 },
      { id: 1, team: 2 },
    ]);
    const crit = (n: number): ArenaEvent[] =>
      Array.from({ length: n }, (): ArenaEvent => ({
        type: "hit", attackerId: 0, targetId: 1, damage: 60, crit: true, lethal: false, x: 0, y: 0,
      }));
    acc.ingest([
      { type: "roundEnd", winnerTeam: 2, wins: [0, 1], standing: [{ id: 1, hpFrac: 0.5 }] },
      ...crit(10), // 600 damage — with the 160 lethal below, 760 clears carnage's 750
      { type: "hit", attackerId: 0, targetId: 1, damage: 160, crit: false, lethal: true, x: 0, y: 0 },
      ...Array.from({ length: 7 }, (): ArenaEvent => ({ type: "reflect", playerId: 0, attackerId: 1, x: 0, y: 0 })),
      { type: "roundEnd", winnerTeam: 1, wins: [1, 1], standing: [{ id: 0, hpFrac: 0.3 }] },
      // The wound that makes it a 6% finish — 0 took real damage on the way.
      { type: "hit", attackerId: 1, targetId: 0, damage: 94, crit: false, lethal: false, x: 0, y: 0 },
      { type: "roundEnd", winnerTeam: 1, wins: [2, 1], standing: [{ id: 0, hpFrac: 0.06 }] },
      { type: "matchEnd", winnerTeam: 1 },
    ]);
    const summary = acc.summary({
      ranked: true, bracket: "1v1", teamSize: 1, winnerTeam: 1,
      players: [
        { id: 0, team: 1, weapon: "blade", bot: false },
        { id: 1, team: 2, weapon: "bow", bot: false },
      ],
    });
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary,
      playerKey: 0, before: {}, after: {}, unlocked: new Set(),
    }).map((d) => d.id);
    // The war story: comeback + decider-under-10% + carnage + crits + reflects…
    for (const id of ["by-a-thread", "never-doubted", "carnage", "killer-instinct", "return-to-sender", "the-old-ways"]) {
      expect(fired).toContain(id);
    }
    // …but NOT the sweep or the untouched run (a round was dropped, damage taken).
    expect(fired).not.toContain("flawless");
    expect(fired).not.toContain("not-a-scratch");
    // The loser fires nothing from this match.
    const loserFired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary,
      playerKey: 1, before: {}, after: {}, unlocked: new Set(),
    }).map((d) => d.id);
    for (const id of ["by-a-thread", "never-doubted", "still-standing", "flawless", "the-old-ways"]) {
      expect(loserFired).not.toContain(id);
    }
  });

  test("carnage never pops off a clean sweep — three overkill kills is not a bloodbath", () => {
    // The first-ranked-win audit (2026-08-25): a 3-0 on 100hp bodies credits
    // ~110 per kill (the lethal hit's overkill counts), so ANY 1v1 win used
    // to clear the old 300. A sweep's ~330 must stay under the bar — and so
    // must a heal-less five-round 1v1 war (max ≈ 530); a 2v2 carry clears it.
    const sweep = play1v1();
    sweep.stats[0]!.damageDealt = 335;
    const sweptFired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary: sweep,
      playerKey: 0, before: {}, after: {}, unlocked: new Set(),
    }).map((d) => d.id);
    expect(sweptFired).not.toContain("carnage");

    const war = play1v1();
    war.stats[0]!.damageDealt = 530;
    const warFired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary: war,
      playerKey: 0, before: {}, after: {}, unlocked: new Set(),
    }).map((d) => d.id);
    expect(warFired).not.toContain("carnage");

    const carry = play1v1();
    carry.stats[0]!.damageDealt = 750;
    const carryFired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary: carry,
      playerKey: 0, before: {}, after: {}, unlocked: new Set(),
    }).map((d) => d.id);
    expect(carryFired).toContain("carnage");
  });

  test("flawless is the sweep — and a swept loser never comebacks", () => {
    const summary = play1v1(); // 2-0 to team 1
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary,
      playerKey: 0, before: {}, after: {}, unlocked: new Set(),
    }).map((d) => d.id);
    expect(fired).toContain("flawless");
    expect(fired).not.toContain("still-standing"); // no longer the sweep's twin — it's a streak
    expect(fired).not.toContain("by-a-thread"); // no decider in a sweep
    expect(fired).not.toContain("never-doubted"); // won the opener
    expect(fired).not.toContain("the-old-ways"); // dash was cast
  });

  test("still standing is an undying streak — three deathless wins in a row, any death resets", () => {
    const sweep = play1v1(); // seat 0 wins 2-0 without dying
    // Two deathless wins banked; this sweep is the third.
    const before = { [`${UNDYING_STREAK}_current`]: 2, [`${UNDYING_STREAK}_best`]: 2 };
    const streak = undyingStreakUpdates(before, sweep, 0);
    expect(streak).toEqual({ [`${UNDYING_STREAK}_current`]: 3, [`${UNDYING_STREAK}_best`]: 3 });
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary: sweep,
      playerKey: 0, before, after: { ...before, ...streak }, unlocked: new Set(),
    }).map((d) => d.id);
    expect(fired).toContain("still-standing");

    // A win that cost a death breaks the run; the high-water survives.
    const bloodied = play1v1();
    bloodied.stats[0]!.deaths = 1;
    expect(undyingStreakUpdates(before, bloodied, 0)).toEqual({
      [`${UNDYING_STREAK}_current`]: 0,
      [`${UNDYING_STREAK}_best`]: 2,
    });
    // The loser never extends it.
    expect(undyingStreakUpdates({}, sweep, 1)[`${UNDYING_STREAK}_current`]).toBe(0);
    // Nothing fires on a first deathless win alone — 1 < 3.
    const first = evaluate({
      defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary: sweep,
      playerKey: 0, before: {}, after: undyingStreakUpdates({}, sweep, 0), unlocked: new Set(),
    }).map((d) => d.id);
    expect(first).not.toContain("still-standing");
  });

  test("lifeblood reads the single-match healing, not the lifetime counter", () => {
    const summary = play1v1();
    summary.stats[1]!.healingDealt = 200; // Wave 2: lifeblood reads healing DEALT
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

// ── Wave 3: the 2v2 board (achievements.md § Wave-3) ───────────────────────

/** Seat ids for the 2v2 war story: team 1 = 0 (me) + 1 (partner), team 2 =
 * 2 + 3. Ticks are 30/s. */
const TEAM_2V2 = [
  { id: 0, team: 1 as const },
  { id: 1, team: 1 as const },
  { id: 2, team: 2 as const },
  { id: 3, team: 2 as const },
];
const roster2v2 = (weapons: [string, string, string, string]) =>
  TEAM_2V2.map((p, i) => ({ ...p, weapon: weapons[i] as MatchSummary["players"][number]["weapon"], bot: false }));
const hit = (attackerId: number, targetId: number, damage: number, lethal = false): ArenaEvent => ({
  type: "hit", attackerId, targetId, damage, crit: false, lethal, x: 0, y: 0,
});
const kill = (attackerId: number, targetId: number): ArenaEvent[] => [hit(attackerId, targetId, 100, true), { type: "death", playerId: targetId }];

const fire2v2 = (summary: MatchSummary, playerKey: number, after: Record<string, number> = {}): string[] =>
  evaluate({ defs: ACHIEVEMENT_DEFS, boards: ACHIEVEMENT_BOARDS, summary, playerKey, before: {}, after, unlocked: new Set() }).map((d) => d.id);

describe("Wave-3 partnership stats", () => {
  test("assists credit the teammate who softened the kill; double kills and concert kills land", () => {
    const acc = new MatchStatsAccumulator(TEAM_2V2);
    acc.ingest([{ type: "roundStart", roundNumber: 1 }], 0);
    acc.ingest([{ type: "fightStart" }], 90);
    // Partner (1) softens 2, I (0) finish 2 at tick 120 — 1s into the fight.
    acc.ingest([hit(1, 2, 30)], 100);
    acc.ingest(kill(0, 2), 120);
    // Then I finish 3 too, 1.5 s later: a double kill for me, no concert (same killer).
    acc.ingest(kill(0, 3), 165);
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [1, 0], standing: [{ id: 0, hpFrac: 1 }, { id: 1, hpFrac: 1 }] }], 170);
    // Round 2: partner kills 2, I kill 3 within 2 s — in concert, both credited.
    acc.ingest([{ type: "roundStart", roundNumber: 2 }], 300);
    acc.ingest([{ type: "fightStart" }], 390);
    acc.ingest(kill(1, 2), 600);
    acc.ingest(kill(0, 3), 650);
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [2, 0], standing: [{ id: 0, hpFrac: 1 }, { id: 1, hpFrac: 1 }] }], 660);
    const s = acc.summary({ ranked: true, bracket: "2v2", teamSize: 2, winnerTeam: 1, players: roster2v2(["blade", "blade", "bow", "staff"]) });
    expect(s.stats[1]!.assists).toBe(1);
    expect(s.stats[0]!.assists).toBe(0);
    expect(s.stats[0]!.doubleKills).toBe(1);
    expect(s.stats[0]!.concertKills).toBe(1);
    expect(s.stats[1]!.concertKills).toBe(1);
    expect(s.stats[0]!.fastestKillSec).toBeCloseTo(1);
    expect(s.stats[0]!.kills).toBe(3);
    // Deltas carry the partnership counters + the per-bracket pair.
    const d = counterDeltas(s, 0);
    expect(d["ranked_wins:2v2"]).toBe(1);
    expect(d[COUNTERS.doubleKills]).toBe(1);
    expect(counterDeltas(s, 1)[COUNTERS.assists]).toBe(1);
    // The feats: ambush (1 s), in concert, matching set (blade + blade),
    // shieldwall (nobody on our side died), and the first-match root +
    // double-kill/first-win milestones on the crossing.
    const fired = fire2v2(s, 0, { ...d, "ranked_matches:2v2": 1 });
    for (const id of ["two-blades", "the-ambush", "in-concert", "matching-set", "shieldwall", "double-kills-1"]) {
      expect(fired).toContain(id);
    }
    expect(fired).not.toContain("even-split"); // 3 vs 1 kills
    expect(fired).not.toContain("along-for-the-ride");
    // A 1v1 summary never touches the 2v2 board — the gate holds.
    const solo = play1v1();
    expect(fire2v2(solo, 0, { "ranked_matches:2v2": 1 })).not.toContain("two-blades");
  });

  test("the clutch: partner falls against a full side, I win the round — and the decider version is The Last Word", () => {
    const acc = new MatchStatsAccumulator(TEAM_2V2);
    // Round 1 lost, so round 3 is a decider.
    acc.ingest([{ type: "roundStart", roundNumber: 1 }, { type: "fightStart" }], 0);
    acc.ingest(kill(2, 0), 100);
    acc.ingest(kill(3, 1), 120);
    acc.ingest([{ type: "roundEnd", winnerTeam: 2, wins: [0, 1], standing: [{ id: 2, hpFrac: 1 }, { id: 3, hpFrac: 1 }] }], 130);
    // Round 2: partner dies with both enemies alive; I kill both — a clutch.
    acc.ingest([{ type: "roundStart", roundNumber: 2 }, { type: "fightStart" }], 300);
    acc.ingest(kill(2, 1), 400);
    acc.ingest(kill(0, 2), 500); // avenged, 100 ticks = 3.3 s → swift
    acc.ingest(kill(0, 3), 700);
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [1, 1], standing: [{ id: 0, hpFrac: 0.4 }] }], 710);
    // Round 3: same again, but the enemies had already lost one when the partner fell — NOT a clutch…
    acc.ingest([{ type: "roundStart", roundNumber: 3 }, { type: "fightStart" }], 900);
    acc.ingest(kill(1, 3), 950);
    acc.ingest(kill(2, 1), 1000);
    acc.ingest(kill(0, 2), 1400); // revenge, but 400 ticks = 13 s → not swift
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [2, 1], standing: [{ id: 0, hpFrac: 0.2 }] }], 1410);
    const s = acc.summary({ ranked: true, bracket: "2v2", teamSize: 2, winnerTeam: 1, players: roster2v2(["hammer", "bow", "blade", "staff"]) });
    expect(s.stats[0]!.clutchRounds).toBe(1);
    expect(s.stats[0]!.lastRoundClutch).toBe(false);
    expect(s.stats[0]!.revengeKills).toBe(2);
    expect(s.stats[0]!.swiftRevenges).toBe(1);
    expect(s.stats[0]!.doubleKills).toBe(1);
    const fired = fire2v2(s, 0, counterDeltas(s, 0));
    expect(fired).toContain("clutch-rounds-1");
    expect(fired).toContain("swift-vengeance");
    expect(fired).not.toContain("the-last-word"); // the decider was 2v1 when the partner fell
    expect(fired).not.toContain("shieldwall"); // I died in round 1
    expect(fired).not.toContain("matching-set");

    // …and a decider that IS a clutch fires The Last Word.
    const decider = new MatchStatsAccumulator(TEAM_2V2);
    decider.ingest([{ type: "roundStart", roundNumber: 1 }, { type: "fightStart" }], 0);
    decider.ingest([{ type: "roundEnd", winnerTeam: 2, wins: [0, 1], standing: [] }], 10);
    decider.ingest([{ type: "roundStart", roundNumber: 2 }, { type: "fightStart" }], 20);
    decider.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [1, 1], standing: [] }], 30);
    decider.ingest([{ type: "roundStart", roundNumber: 3 }, { type: "fightStart" }], 40);
    decider.ingest(kill(3, 1), 50);
    decider.ingest(kill(0, 2), 60);
    decider.ingest(kill(0, 3), 70);
    decider.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [2, 1], standing: [{ id: 0, hpFrac: 0.1 }] }], 80);
    const ds = decider.summary({ ranked: true, bracket: "2v2", teamSize: 2, winnerTeam: 1, players: roster2v2(["hammer", "bow", "blade", "staff"]) });
    expect(ds.stats[0]!.lastRoundClutch).toBe(true);
    expect(fire2v2(ds, 0)).toContain("the-last-word");
  });

  test("the partnership feats: selfless, even split, the meat shield, and the two jokes", () => {
    const acc = new MatchStatsAccumulator(TEAM_2V2);
    acc.ingest([{ type: "roundStart", roundNumber: 1 }, { type: "fightStart" }], 0);
    acc.ingest([{ type: "heal", targetId: 1, casterId: 0, amount: 90, x: 0, y: 0 }, { type: "heal", targetId: 0, casterId: 0, amount: 500, x: 0, y: 0 }], 10);
    acc.ingest([hit(2, 0, 150), hit(3, 1, 50)], 20); // I soak 75%
    acc.ingest([...kill(0, 2), ...kill(1, 3)], 30);
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [1, 0], standing: [{ id: 0, hpFrac: 0.5 }, { id: 1, hpFrac: 0.8 }] }], 40);
    acc.ingest([{ type: "roundStart", roundNumber: 2 }, { type: "fightStart" }], 100);
    acc.ingest([{ type: "heal", targetId: 1, casterId: 0, amount: 60, x: 0, y: 0 }], 110);
    acc.ingest([...kill(0, 3), ...kill(1, 2)], 130);
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [2, 0], standing: [{ id: 0, hpFrac: 0.5 }, { id: 1, hpFrac: 0.8 }] }], 140);
    const s = acc.summary({ ranked: true, bracket: "2v2", teamSize: 2, winnerTeam: 1, players: roster2v2(["staff", "blade", "bow", "hammer"]) });
    expect(s.stats[0]!.alliedHealing).toBe(150); // the self-heal never counts
    expect(s.stats[0]!.healingDealt).toBe(650);
    const mine = fire2v2(s, 0);
    for (const id of ["selfless", "even-split", "the-meat-shield"]) expect(mine).toContain(id);
    expect(mine).not.toContain("along-for-the-ride"); // I dealt damage
    // Along for the Ride: a winner who dealt nothing.
    s.stats[1]!.damageDealt = 0;
    expect(fire2v2(s, 1)).toContain("along-for-the-ride");
    // Nobody's Hero: a LOSER who out-damaged the other three combined.
    const loss = { ...s, winnerTeam: 1 as const };
    loss.stats = { ...s.stats, 2: { ...s.stats[2]!, damageDealt: 1000 } };
    expect(fire2v2(loss, 2)).toContain("nobodys-hero");
    expect(fire2v2(loss, 3)).not.toContain("nobodys-hero");
  });

  test("the joke deeds only ever carry titles, and the 2v2 board's counters never move in a 1v1", () => {
    for (const def of ACHIEVEMENT_DEFS_2V2) {
      if (!TITLE_ONLY_2V2.has(def.id)) continue;
      for (const reward of def.rewards ?? []) expect(reward.kind).toBe("title");
    }
    // The crossing trap (achievements.md § M4 retired): a counter a 2v2
    // milestone reads must be untouched by a 1v1 delta, or its crossing is
    // consumed behind the gate and never fires.
    const soloDeltas = counterDeltas(play1v1(), 0);
    for (const def of ACHIEVEMENT_DEFS_2V2) {
      if (def.trigger.kind === "milestone") expect(soloDeltas[def.trigger.counter]).toBeUndefined();
    }
  });
});
