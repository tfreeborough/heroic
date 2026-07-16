/**
 * Team sizes (pvp-arena.md, 2026-07-16): the host picks 1v1–4v4 at creation,
 * joiners are randomly placed but BALANCED (join the smaller side, sim-rng
 * coin-flip on ties), teammates spawn in a spaced formation line, and a round
 * only closes on a full team wipe.
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { PLAYER_RADIUS, TICK_DT } from "./config";
import { checkRoundOver, resetForRound } from "./round";
import { addPlayer, createSim, type ArenaSim } from "./sim";
import { seatedPlayers, teamCounts, type RoundPhase } from "./state";

const makeZone = (): ZoneFile => ({
  format: 1,
  id: "test-arena",
  name: "Test Arena",
  band: 1,
  size: { cols: 8, rows: 8 },
  tileSize: 64,
  chunkTiles: 8,
  tileset: "placeholder",
  layers: { floor: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 1)) },
  collision: { rects: [] },
  breakables: [],
  objects: [
    { id: "spawn-t1", kind: "playerSpawn", x: 96, y: 256, props: { team: 1 } },
    { id: "spawn-t2", kind: "playerSpawn", x: 416, y: 256, props: { team: 2 } },
  ],
});

const seatAll = (sim: ArenaSim, count: number): void => {
  for (let i = 0; i < count; i++) addPlayer(sim, `p${i}`);
};

describe("random-balanced team assignment", () => {
  test("a full 4v4 room always splits 4/4, and the first two joiners oppose", () => {
    // Many seeds, not one — the balance rule must hold regardless of flips.
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createSim(makeZone(), seed, 4);
      seatAll(sim, 8);
      expect(teamCounts(sim.state)).toEqual([4, 4]);
      expect(sim.state.players[1]!.team).not.toBe(sim.state.players[0]!.team);
    }
  });

  test("no side ever leads by more than one mid-fill", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createSim(makeZone(), seed, 4);
      for (let i = 0; i < 8; i++) {
        addPlayer(sim, `p${i}`);
        const [n1, n2] = teamCounts(sim.state);
        expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("same seed + same join order → identical teams (deterministic)", () => {
    const a = createSim(makeZone(), 0xb100d, 3);
    const b = createSim(makeZone(), 0xb100d, 3);
    seatAll(a, 6);
    seatAll(b, 6);
    expect(seatedPlayers(a.state).map((p) => p.team)).toEqual(seatedPlayers(b.state).map((p) => p.team));
    expect(a.state.rngDraws).toBe(b.state.rngDraws); // the flips ride the counting rng
  });
});

describe("formation spawns", () => {
  test("teammates never stack: everyone spawns spaced and inside the zone", () => {
    const sim = createSim(makeZone(), 7, 4);
    seatAll(sim, 8);
    resetForRound(sim, []);
    const players = seatedPlayers(sim.state);
    for (const p of players) {
      expect(p.mover.pos.x).toBeGreaterThan(0);
      expect(p.mover.pos.x).toBeLessThan(sim.zone.size.x);
      expect(p.mover.pos.y).toBeGreaterThan(0);
      expect(p.mover.pos.y).toBeLessThan(sim.zone.size.y);
      for (const q of players) {
        if (q.id <= p.id) continue;
        const dist = Math.hypot(p.mover.pos.x - q.mover.pos.x, p.mover.pos.y - q.mover.pos.y);
        expect(dist).toBeGreaterThanOrEqual(PLAYER_RADIUS * 2);
      }
    }
  });
});

describe("round over at size", () => {
  test("a 4v4 round closes only on the full team wipe", () => {
    const sim = createSim(makeZone(), 7, 4);
    const phase = (): RoundPhase => sim.state.round.phase;
    seatAll(sim, 8);
    resetForRound(sim, []);
    sim.state.round.phase = "active";
    const enemies = seatedPlayers(sim.state).filter((p) => p.team === 2);
    expect(enemies.length).toBe(4);
    for (const p of enemies.slice(0, 3)) p.alive = false;
    checkRoundOver(sim, []);
    expect(phase()).toBe("active"); // one still stands
    enemies[3]!.alive = false;
    checkRoundOver(sim, []);
    expect(phase()).toBe("roundEnd");
    expect(sim.state.round.lastWinner).toBe(1);
    expect(sim.state.round.wins).toEqual([1, 0]);
  });
});

// TICK_DT imported to keep parity with sibling test files' stepping helpers if
// these suites grow a machine-driven case later.
void TICK_DT;
