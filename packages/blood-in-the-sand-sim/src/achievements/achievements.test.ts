import { describe, expect, test } from "bun:test";
import { evaluate, streakUpdates } from "@heroic/achievements";
import { ABILITY_IDS, WEAPON_IDS } from "../config";
import type { ArenaEvent } from "../events";
import { COUNTERS, SKIRMISH_COUNTER_PREFIX, UNDYING_STREAK, counterDeltas, undyingStreakUpdates } from "./counters";
import { ACHIEVEMENT_BOARDS, ACHIEVEMENT_DEFS, RANKED_BOARD } from "./defs";
import { ACHIEVEMENT_DEFS_2V2, RANKED_2V2_BOARD, TITLE_ONLY_2V2 } from "./defs2v2";
import { ACHIEVEMENT_DEFS_SKIRMISH, SKIRMISH_BOARD, SKIRMISH_TITLE_IDS } from "./defsSkirmish";
import { MatchStatsAccumulator, type MatchSummary, type MatchSummaryPlayer } from "./summary";

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

/** The Blood Tide stats at rest — a two-round match the tide never rose in
 * (no fightStart clocked → longestRoundSec stays null). */
const TIDE_ZERO = {
  tideRounds: 0,
  roundsPlayed: 2,
  tideTicks: 0,
  tideDeaths: 0,
  tideKills: 0,
  baptisms: 0,
  waistDeepWins: 0,
  tideDecidedWins: 0,
  lastGrainWins: 0,
  undertows: 0,
  eyeOfStorm: 0,
  longestRoundSec: null,
};

/** The skirmish round stats at rest for a 1v1 WINNER (the loser is the
 * runner-up of every round they lose — see the loser's expectation). */
const SKIRMISH_ZERO = {
  bestRoundKills: 0,
  roundsWonWithoutKilling: 0,
  untouchedRoundWins: 0,
  runnerUpRounds: 0,
  matchPointKills: 0,
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
      ...TIDE_ZERO,
      ...SKIRMISH_ZERO,
      bestRoundKills: 1,
      untouchedRoundWins: 1, // round 1: bob never landed a hit
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
      ...TIDE_ZERO,
      ...SKIRMISH_ZERO,
      runnerUpRounds: 2, // in a 1v1 the loser is second-to-last standing every round
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

  test("the boards are sealed — a skirmish match never fires a ranked deed, a ranked match never fires a skirmish one", () => {
    const ranked = new Set([RANKED_BOARD, RANKED_2V2_BOARD]);
    expect(ACHIEVEMENT_DEFS.every((d) => ranked.has(d.board) || d.board === SKIRMISH_BOARD)).toBe(true);
    expect(ACHIEVEMENT_DEFS_2V2.every((d) => d.board === RANKED_2V2_BOARD)).toBe(true);
    expect(ACHIEVEMENT_DEFS_SKIRMISH.every((d) => d.board === SKIRMISH_BOARD)).toBe(true);
    // A skirmish 1v1 between two humans: only skirmish-board deeds may fire.
    const skirmish: MatchSummary = {
      ...play1v1(),
      ranked: false,
      players: [
        { id: 0, team: 1, weapon: "blade", bot: false },
        { id: 1, team: 2, weapon: "bow", bot: false },
      ],
    };
    const fired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary: skirmish,
      playerKey: 0,
      before: {},
      after: counterDeltas(skirmish, 0),
      unlocked: new Set(),
    });
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((d) => d.board === SKIRMISH_BOARD)).toBe(true);
    // …and a ranked match fires nothing on the skirmish board.
    const rankedFired = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary: play1v1(),
      playerKey: 0,
      before: {},
      after: counterDeltas(play1v1(), 0),
      unlocked: new Set(),
    });
    expect(rankedFired.some((d) => d.board === SKIRMISH_BOARD)).toBe(false);
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

  test("secret deeds are a curated few — the punchlines, never anything that takes planning", () => {
    // achievements.md § reveal rule (2026-09-11): descriptions show from
    // the start; `secret` is reserved for deeds a player stumbles into.
    // Adding one here is a content decision — extend the list on purpose.
    const secret = ACHIEVEMENT_DEFS.filter((d) => d.secret === true).map((d) => d.id).sort();
    expect(secret).toEqual(
      [
        "loss-streak-3",
        "loss-streak-5",
        "loss-streak-10",
        "nobodys-hero",
        "taken-by-the-tide",
        "the-vulture",
        "always-the-bridesmaid",
        "nobody-wins",
      ].sort(),
    );
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

// ── The Blood Tide (bits-sands-deeds.md, 2026-09-09) ───────────────────────
import { TICK_RATE } from "../config";
import { TIDECALLER, TIDE_JOKE_IDS } from "./defs";
import { UNDERTOW_WINDOW_SEC, WAIST_DEEP_TICKS } from "./summary";

const SANDS = -1;
const tideTick = (targetId: number, lethal = false): ArenaEvent => ({
  type: "hit", attackerId: SANDS, targetId, damage: 4, crit: false, lethal, bleed: true, x: 0, y: 0,
});
const blow = (
  attackerId: number,
  targetId: number,
  lethal: boolean,
  tide?: { attackerOut: boolean; victimOut: boolean; p: number },
): ArenaEvent => ({ type: "hit", attackerId, targetId, damage: 30, crit: false, lethal, x: 0, y: 0, tide });

/** A 1v1 where seat 0 wins; the tide rises in every round. Each round is
 * a scripted shape so every closer can be pinned. */
const playTide = (): MatchSummary => {
  const acc = new MatchStatsAccumulator([
    { id: 0, team: 1 },
    { id: 1, team: 2 },
  ]);
  const t = (sec: number) => Math.round(sec * TICK_RATE);
  // Round 1 — Baptism: alice takes some ticks, kills bob from the blood
  // after the horn, past full close (The Last Grain too).
  acc.ingest([{ type: "roundStart", roundNumber: 1 }, { type: "fightStart" }], t(0));
  acc.ingest([{ type: "sandsStart", cx: 0, cy: 0, inside: [0] }], t(2));
  acc.ingest([tideTick(0), tideTick(0), tideTick(0)], t(3));
  acc.ingest([blow(0, 1, true, { attackerOut: true, victimOut: false, p: 1 }), { type: "death", playerId: 1 }], t(4));
  acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [1, 0], standing: [{ id: 0, hpFrac: 0.5 }] }], t(4));
  // Round 2 — Let the Tide Decide: alice never bleeds, bob drowns.
  acc.ingest([{ type: "roundStart", roundNumber: 2 }, { type: "fightStart" }], t(10));
  acc.ingest([{ type: "sandsStart", cx: 0, cy: 0, inside: [] }], t(12));
  acc.ingest([tideTick(1), tideTick(1, true), { type: "death", playerId: 1 }], t(15));
  acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [2, 0], standing: [{ id: 0, hpFrac: 1 }] }], t(15));
  // Round 3 — Waist Deep + Undertow: alice wades 20 ticks, shoves bob into
  // the blood, and he dies there 2 s later to her blade (in the round after
  // the horn: a tide kill for the chain).
  acc.ingest([{ type: "roundStart", roundNumber: 3 }, { type: "fightStart" }], t(20));
  acc.ingest([{ type: "sandsStart", cx: 0, cy: 0, inside: [] }], t(22));
  acc.ingest(Array.from({ length: WAIST_DEEP_TICKS }, () => tideTick(0)), t(24));
  acc.ingest([{ type: "sandsShove", byId: 0, victimId: 1 }], t(25));
  acc.ingest([blow(0, 1, true, { attackerOut: false, victimOut: true, p: 0.4 }), { type: "death", playerId: 1 }], t(27));
  acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [3, 0], standing: [{ id: 0, hpFrac: 0.2 }] }], t(27));
  acc.ingest([{ type: "matchEnd", winnerTeam: 1 }], t(27));
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

describe("the Blood Tide stats", () => {
  const s = playTide();

  test("the accumulator reads every tide signal", () => {
    const a = s.stats[0]!;
    const b = s.stats[1]!;
    expect(a.tideRounds).toBe(3);
    expect(a.roundsPlayed).toBe(3);
    expect(a.tideTicks).toBe(3 + WAIST_DEEP_TICKS);
    expect(a.tideKills).toBe(2);
    expect(a.kills).toBe(2);
    expect(a.baptisms).toBe(1);
    expect(a.lastGrainWins).toBe(1);
    expect(a.tideDecidedWins).toBe(1);
    expect(a.waistDeepWins).toBe(1);
    expect(a.undertows).toBe(1);
    expect(a.eyeOfStorm).toBe(1);
    expect(a.longestRoundSec).toBe(7);
    expect(b.tideDeaths).toBe(1);
    expect(b.tideTicks).toBe(2);
    expect(b.deaths).toBe(3);
    // The tide's blows are nobody's damage dealt; they are the victim's
    // damage taken.
    expect(a.damageDealt).toBe(60);
    expect(b.damageTaken).toBe(60 + 8);
  });

  test("the tide's counters move — and stay at rest in a tideless match", () => {
    const d = counterDeltas(s, 0);
    expect(d[COUNTERS.sandsRounds]).toBe(3);
    expect(d[COUNTERS.sandsKills]).toBe(2);
    const quiet = counterDeltas(play1v1(), 0);
    expect(quiet[COUNTERS.sandsRounds]).toBeUndefined();
    expect(quiet[COUNTERS.sandsKills]).toBeUndefined();
  });

  test("the skill feats fire on their exact shapes — and never off a tideless first win", () => {
    const fired = (summary: MatchSummary, p: number) =>
      evaluate({
        defs: ACHIEVEMENT_DEFS,
        boards: ACHIEVEMENT_BOARDS,
        summary,
        playerKey: p,
        before: {},
        after: counterDeltas(summary, p),
        unlocked: new Set(),
      }).map((d) => d.id);
    const alice = fired(s, 0);
    for (const id of ["the-horn-sounds", "baptism", "the-last-grain", "let-the-tide-decide", "waist-deep", "undertow", "dry-feet"]) {
      expect(alice).toContain(id);
    }
    expect(alice).toContain("quicksand"); // 4 s / 5 s / 7 s — every round inside ten
    expect(alice).not.toContain("taken-by-the-tide");
    expect(alice).not.toContain("tidecaller"); // the chain top is far off
    const bob = fired(s, 1);
    expect(bob).toEqual(["sworn-to-the-sand", "the-horn-sounds"]); // the board root + the chapter root, nothing else
    // The tideless first win (play1v1) pops nothing from the chapter.
    const quiet = fired(play1v1(), 0);
    expect(quiet.some((id) => id.startsWith("tide") || ["baptism", "waist-deep", "quicksand", "dry-feet"].includes(id))).toBe(false);
  });

  test("Quicksand needs a clocked fight under ten seconds in EVERY round", () => {
    const quick = playTide(); // rounds ran 4 s / 5 s / 7 s
    expect(quick.stats[0]!.longestRoundSec).toBe(7);
    const q = ACHIEVEMENT_DEFS.find((d) => d.id === "quicksand")!;
    expect(q.trigger.kind).toBe("feat");
    if (q.trigger.kind !== "feat") return;
    expect(q.trigger.test(quick, 0)).toBe(true);
    expect(q.trigger.test(quick, 1)).toBe(false); // the loser never
    // No fightStart ever clocked → null → never pops (the clockless caller).
    expect(q.trigger.test(play1v1(), 0)).toBe(false);
  });

  test("Undertow's window: a body shoved in who dies later than the window is nobody's", () => {
    const acc = new MatchStatsAccumulator([
      { id: 0, team: 1 },
      { id: 1, team: 2 },
    ]);
    const t = (sec: number) => Math.round(sec * TICK_RATE);
    acc.ingest([{ type: "roundStart", roundNumber: 1 }, { type: "fightStart" }, { type: "sandsStart", cx: 0, cy: 0, inside: [] }], t(0));
    acc.ingest([{ type: "sandsShove", byId: 0, victimId: 1 }], t(1));
    acc.ingest([tideTick(1, true), { type: "death", playerId: 1 }], t(1 + UNDERTOW_WINDOW_SEC + 1));
    acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [1, 0], standing: [{ id: 0, hpFrac: 1 }] }], t(7));
    const s2 = acc.summary({ ranked: true, bracket: "1v1", teamSize: 1, winnerTeam: 1, players: [{ id: 0, team: 1, weapon: "blade", bot: false }, { id: 1, team: 2, weapon: "bow", bot: true }] });
    expect(s2.stats[0]!.undertows).toBe(0);
    expect(s2.stats[0]!.tideDecidedWins).toBe(1); // still the tide's kill, and alice stayed dry
  });

  test("Tidecaller: every skill feat + the chain top, never a joke; pays the title and the spell — and the jokes pay titles or nothing", () => {
    expect(TIDECALLER.trigger.kind).toBe("capstone");
    if (TIDECALLER.trigger.kind !== "capstone") return;
    const req = new Set(TIDECALLER.trigger.requires);
    for (const id of ["baptism", "waist-deep", "let-the-tide-decide", "quicksand", "the-last-grain", "undertow", "tide-kills-250"]) {
      expect(req.has(id)).toBe(true);
    }
    for (const joke of TIDE_JOKE_IDS) expect(req.has(joke)).toBe(false);
    expect(TIDECALLER.rewards).toEqual([{ kind: "title" }, { kind: "entitlement", itemId: "ability:call-the-tide" }]);
    for (const joke of TIDE_JOKE_IDS) {
      const def = ACHIEVEMENT_DEFS.find((d) => d.id === joke)!;
      expect((def.rewards ?? []).every((r) => r.kind === "title")).toBe(true);
    }
    // Two titles in the whole chapter (Tom, 2026-09-09).
    const chapter = ACHIEVEMENT_DEFS.filter((d) => d.id.startsWith("tide") || req.has(d.id) || TIDE_JOKE_IDS.includes(d.id) || d.id === "the-horn-sounds");
    const titled = chapter.filter((d) => (d.rewards ?? []).some((r) => r.kind === "title")).map((d) => d.id);
    expect(titled.sort()).toEqual(["dry-feet", "tidecaller"]);
  });
});

// ── The skirmish board (bits-skirmish-deeds.md, 2026-09-09) ────────────────

const human = (id: number, team: number, weapon: MatchSummaryPlayer["weapon"] = "blade", abilities?: string[]): MatchSummaryPlayer => ({
  id,
  team: team as MatchSummaryPlayer["team"],
  weapon,
  bot: false,
  ...(abilities ? { abilities: abilities as MatchSummaryPlayer["abilities"] } : {}),
});

const fireFor = (summary: MatchSummary, seat: number, before: Record<string, number> = {}): string[] => {
  const after = { ...before };
  for (const [k, v] of Object.entries(counterDeltas(summary, seat))) after[k] = (after[k] ?? 0) + v;
  return evaluate({
    defs: ACHIEVEMENT_DEFS,
    boards: ACHIEVEMENT_BOARDS,
    summary,
    playerKey: seat,
    before,
    after,
    unlocked: new Set(),
  }).map((d) => d.id);
};

/** A scripted 6-way brawl (first to 2), six humans, seat 0 takes it 2–1:
 * round 1 seat 0 kills all five (seat 5 last); round 2 seat 2 kills seat 0
 * (who sat on match point), the tide takes everyone but seat 1 (seat 5
 * last again); round 3 seat 0 sweeps again, seat 5 last again. */
const playBrawl = (): MatchSummary => {
  const ids = [0, 1, 2, 3, 4, 5];
  const acc = new MatchStatsAccumulator(ids.map((id) => ({ id, team: (id + 1) as MatchSummaryPlayer["team"] })), { winsToTake: 2 });
  const sweep = (killer: number, order: number[]): ArenaEvent[] =>
    order.flatMap((v) => kill(killer, v));
  const tideKill = (v: number): ArenaEvent[] => [
    { type: "hit", attackerId: -1, targetId: v, damage: 100, crit: false, lethal: true, bleed: true, x: 0, y: 0 },
    { type: "death", playerId: v },
  ];
  const wins = (...w: number[]): number[] => w;
  acc.ingest([
    { type: "roundStart", roundNumber: 1 },
    { type: "fightStart" },
    ...sweep(0, [1, 2, 3, 4, 5]),
    { type: "roundEnd", winnerTeam: 1, wins: wins(1, 0, 0, 0, 0, 0), standing: [{ id: 0, hpFrac: 1 }] },
    { type: "roundStart", roundNumber: 2 },
    { type: "fightStart" },
    ...kill(2, 0),
    ...tideKill(2),
    ...tideKill(3),
    ...tideKill(4),
    ...tideKill(5),
    { type: "roundEnd", winnerTeam: 2, wins: wins(1, 1, 0, 0, 0, 0), standing: [{ id: 1, hpFrac: 1 }] },
    { type: "roundStart", roundNumber: 3 },
    { type: "fightStart" },
    ...sweep(0, [1, 2, 3, 4, 5]),
    { type: "roundEnd", winnerTeam: 1, wins: wins(2, 1, 0, 0, 0, 0), standing: [{ id: 0, hpFrac: 0.5 }] },
    { type: "matchEnd", winnerTeam: 1 },
  ], 10);
  return acc.summary({
    ranked: false,
    bracket: null,
    teamSize: 1,
    teamCount: 6,
    winnerTeam: 1,
    players: ids.map((id) => human(id, id + 1)),
  });
};

/** A team-shaped skirmish summary with no events — the loadout and room
 * predicates only read the players and the room block. Team 1 wins. */
const teamSummary = (
  players: MatchSummaryPlayer[],
  room: MatchSummary["room"] = null,
  roundWinners: MatchSummary["roundWinners"] = [1, 1, 1],
): MatchSummary => {
  const acc = new MatchStatsAccumulator(players.map((p) => ({ id: p.id, team: p.team })));
  acc.ingest([{ type: "roundEnd", winnerTeam: 1, wins: [3, 0], standing: [] }]);
  const teamSize = players.length / 2;
  return { ...acc.summary({ ranked: false, bracket: null, teamSize, winnerTeam: 1, players, room }), roundWinners };
};

describe("the skirmish board", () => {
  test("one other human in the room — a lone human versus bots earns nothing, two humans earn Well Met on any sides", () => {
    const vsBot: MatchSummary = { ...play1v1(), ranked: false }; // seat 1 is a bot in play1v1
    expect(fireFor(vsBot, 0)).toEqual([]);
    const vsHuman: MatchSummary = { ...vsBot, players: [human(0, 1), human(1, 2, "bow")] };
    expect(fireFor(vsHuman, 0)).toContain("well-met");
    // Two friends on ONE side against bots is company (Tom, 2026-09-10) —
    // it counts, and the bot-sensitive deeds still hold themselves back.
    const sameSide = teamSummary([human(0, 1), human(1, 1), { id: 2, team: 2, weapon: "bow", bot: true }, { id: 3, team: 2, weapon: "bow", bot: true }]);
    expect(fireFor(sameSide, 0)).toContain("well-met");
    expect(fireFor(sameSide, 0)).not.toContain("open-house");
    expect(fireFor(sameSide, 0)).not.toContain("full-house");
  });

  test("the counter namespace — skirmish deltas never touch a ranked counter and vice versa", () => {
    const rankedDeltas = counterDeltas(play1v1(), 0);
    expect(Object.keys(rankedDeltas).some((k) => k.startsWith(SKIRMISH_COUNTER_PREFIX))).toBe(false);
    const skirmishDeltas = counterDeltas({ ...play1v1(), ranked: false }, 0);
    expect(Object.keys(skirmishDeltas).length).toBeGreaterThan(0);
    expect(Object.keys(skirmishDeltas).every((k) => k.startsWith(SKIRMISH_COUNTER_PREFIX))).toBe(true);
    const brawlDeltas = counterDeltas(playBrawl(), 0);
    expect(brawlDeltas[COUNTERS.skirmishBrawlMatches]).toBe(1);
    // Every milestone reads a counter only ITS board's summaries can move.
    for (const def of ACHIEVEMENT_DEFS) {
      if (def.trigger.kind !== "milestone") continue;
      const skirmishCounter = def.trigger.counter.startsWith(SKIRMISH_COUNTER_PREFIX);
      expect(skirmishCounter).toBe(def.board === SKIRMISH_BOARD);
    }
  });

  test("the board pays nothing material — one title, no Glory, no items", () => {
    for (const def of ACHIEVEMENT_DEFS_SKIRMISH) {
      const rewards = def.rewards ?? [];
      if (SKIRMISH_TITLE_IDS.has(def.id)) {
        expect(rewards.length).toBeGreaterThan(0);
        for (const r of rewards) expect(r.kind).toBe("title");
      } else {
        expect(rewards).toEqual([]);
      }
    }
  });

  test("the brawl: clean house, the vulture, untouchable, not today, always the bridesmaid", () => {
    const s = playBrawl();
    expect(s.stats[0]!.bestRoundKills).toBe(5);
    expect(s.stats[0]!.roundsWon).toBe(2);
    expect(s.stats[1]!.roundsWonWithoutKilling).toBe(1);
    expect(s.stats[1]!.untouchedRoundWins).toBe(1);
    expect(s.stats[2]!.matchPointKills).toBe(1);
    expect(s.stats[5]!.runnerUpRounds).toBe(3);
    const winner = fireFor(s, 0);
    expect(winner).toEqual(expect.arrayContaining(["well-met", "six-enter", "one-leaves", "six-strangers", "clean-house"]));
    expect(winner).not.toContain("the-vulture");
    expect(winner).toContain("untouchable"); // rounds 1 and 3: nobody laid a hand on seat 0
    const survivor = fireFor(s, 1);
    expect(survivor).toEqual(expect.arrayContaining(["the-vulture", "untouchable"]));
    expect(survivor).not.toContain("one-leaves");
    expect(fireFor(s, 2)).toContain("not-today");
    expect(fireFor(s, 0)).not.toContain("not-today");
    const bridesmaid = fireFor(s, 5);
    expect(bridesmaid).toContain("always-the-bridesmaid");
    expect(fireFor(s, 4)).not.toContain("always-the-bridesmaid");
    expect(winner).not.toContain("nobody-wins");
  });

  test("party tricks: doppelganger needs eight people on one weapon; uniform and the full set read your side", () => {
    const eight = (weapons: MatchSummaryPlayer["weapon"][]) =>
      weapons.map((w, i) => human(i, i < 4 ? 1 : 2, w));
    const allBlade = teamSummary(eight(["blade", "blade", "blade", "blade", "blade", "blade", "blade", "blade"]));
    expect(fireFor(allBlade, 0)).toEqual(expect.arrayContaining(["doppelganger", "full-house", "uniform"]));
    const loser = fireFor(allBlade, 7);
    expect(loser).toContain("doppelganger"); // fires for all eight, win or lose
    expect(loser).toContain("full-house");
    expect(loser).not.toContain("uniform");
    const oneBot = teamSummary([...eight(Array(7).fill("blade")), { id: 7, team: 2, weapon: "blade", bot: true }]);
    expect(fireFor(oneBot, 0)).not.toContain("doppelganger");
    expect(fireFor(oneBot, 0)).not.toContain("full-house");
    const fullSet = teamSummary(eight(["blade", "bow", "staff", "hammer", "blade", "blade", "blade", "bow"]));
    expect(fireFor(fullSet, 0)).toContain("the-full-set");
    expect(fireFor(fullSet, 0)).not.toContain("uniform");
    expect(fireFor(fullSet, 4)).not.toContain("the-full-set"); // losers don't, and their side isn't four-different anyway
  });

  test("party tricks: mirror mirror, the gentlemen's agreement, nobody wins", () => {
    const mirror = teamSummary([human(0, 1, "bow", ["dash", "blood-font", "sandtrap"]), human(1, 2, "bow", ["sandtrap", "dash", "blood-font"])]);
    expect(fireFor(mirror, 0)).toContain("mirror-mirror");
    expect(fireFor(mirror, 1)).toContain("mirror-mirror");
    const notMirror = teamSummary([human(0, 1, "bow", ["dash", "blood-font", "sandtrap"]), human(1, 2, "bow", ["dash", "blood-font", "harpoon"])]);
    expect(fireFor(notMirror, 0)).not.toContain("mirror-mirror");
    // Four fighters, nobody cast: the agreement. One cast anywhere breaks it.
    const quiet = teamSummary([human(0, 1), human(1, 1), human(2, 2), human(3, 2)]);
    expect(fireFor(quiet, 0)).toContain("gentlemens-agreement");
    const acc = new MatchStatsAccumulator([0, 1, 2, 3].map((id) => ({ id, team: (id < 2 ? 1 : 2) as MatchSummaryPlayer["team"] })));
    acc.ingest([{ type: "cast", playerId: 3, ability: "dash" }, { type: "roundEnd", winnerTeam: 1, wins: [3, 0], standing: [] }]);
    const loud = acc.summary({ ranked: false, bracket: null, teamSize: 2, winnerTeam: 1, players: [human(0, 1), human(1, 1), human(2, 2), human(3, 2)] });
    expect(fireFor(loud, 0)).not.toContain("gentlemens-agreement");
    // A drawn round in the record is Nobody Wins for everyone who was there.
    const draw = teamSummary([human(0, 1), human(1, 2, "bow")], null, [0, 1, 1, 1]);
    expect(fireFor(draw, 1)).toContain("nobody-wins");
    expect(fireFor(quiet, 0)).not.toContain("nobody-wins");
  });

  test("good company: the room block drives the friends deeds", () => {
    const room = { locked: true, hostSeat: 0, matchIndex: 3, grudgeSeats: [0], bothSidesSeats: [1] };
    const s = teamSummary([human(0, 1), human(1, 1), human(2, 2, "bow"), human(3, 2, "bow")], room);
    const host = fireFor(s, 0);
    expect(host).toEqual(expect.arrayContaining(["behind-closed-doors", "grudge-match", "one-more", "open-house"]));
    expect(host).not.toContain("both-sides-now");
    const mate = fireFor(s, 1);
    expect(mate).toContain("both-sides-now");
    expect(mate).not.toContain("grudge-match");
    expect(mate).not.toContain("open-house");
    // Losers: no closed doors, no grudge; One More is for everyone present.
    const loser = fireFor(s, 2);
    expect(loser).toContain("one-more");
    expect(loser).not.toContain("behind-closed-doors");
    // The Regulars chain crosses on the adapter-written companion counter.
    const regular = fireFor(s, 0, { [COUNTERS.skirmishCompanionBest]: 4 });
    expect(regular).not.toContain("regulars-5");
    const after = evaluate({
      defs: ACHIEVEMENT_DEFS,
      boards: ACHIEVEMENT_BOARDS,
      summary: s,
      playerKey: 0,
      before: { [COUNTERS.skirmishCompanionBest]: 4 },
      after: { [COUNTERS.skirmishCompanionBest]: 5, [COUNTERS.skirmishMatches]: 1 },
      unlocked: new Set(["well-met"]),
    }).map((d) => d.id);
    expect(after).toContain("regulars-5");
  });
});
