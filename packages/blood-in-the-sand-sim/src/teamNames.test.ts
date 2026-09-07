/**
 * Team factions (bits-bot-backfill.md § team identity): two distinct names per
 * room, derived from the seed alone — reproducible, and never touching the
 * gameplay RNG stream.
 */
import { describe, expect, test } from "bun:test";
import { pickTeamNames, TEAM_NAMES } from "./teamNames";
import { createSim } from "./sim";
import type { ZoneFile } from "@heroic/core";

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

describe("pickTeamNames", () => {
  test("enough variety to feel fresh (the whole point)", () => {
    expect(TEAM_NAMES.length).toBeGreaterThanOrEqual(64);
    expect(new Set(TEAM_NAMES).size).toBe(TEAM_NAMES.length); // all distinct
  });

  test("no colour words — colour is allegiance, name is identity", () => {
    const banned = /\b(red|blue|crimson|azure|scarlet|cobalt|vermilion|sapphire)\b/i;
    for (const n of TEAM_NAMES) expect(n).not.toMatch(banned);
  });

  test("the two sides are always distinct", () => {
    for (let seed = 0; seed < 500; seed++) {
      const [a, b] = pickTeamNames(seed);
      expect(a).not.toBe(b);
      expect(TEAM_NAMES).toContain(a!);
      expect(TEAM_NAMES).toContain(b!);
    }
  });

  test("brawl's six are all distinct, in-pool, and extend the classic pair", () => {
    for (let seed = 0; seed < 500; seed++) {
      const six = pickTeamNames(seed, 6);
      expect(six).toHaveLength(6);
      expect(new Set(six).size).toBe(6);
      for (const n of six) expect(TEAM_NAMES).toContain(n);
      // The same room seed names teams 1 and 2 identically in either shape.
      expect(six.slice(0, 2)).toEqual(pickTeamNames(seed));
    }
  });

  test("deterministic: same seed → same pairing", () => {
    expect(pickTeamNames(12345)).toEqual(pickTeamNames(12345));
    expect(pickTeamNames(12345, 6)).toEqual(pickTeamNames(12345, 6));
    // Negative/huge seeds (Date.now()>>>0 can be anything) still land in-range.
    expect(pickTeamNames(-7)).toEqual(pickTeamNames(-7));
    const [a, b] = pickTeamNames(4_294_967_295);
    expect(TEAM_NAMES).toContain(a!);
    expect(a).not.toBe(b);
  });

  test("a room wears its names from creation, drawn without touching the RNG", () => {
    const sim = createSim(makeZone(), 0xd15ea5e, 2);
    expect(sim.state.teamNames).toEqual(pickTeamNames(0xd15ea5e));
    // Team-name selection must not have consumed the gameplay RNG stream (else
    // it would perturb spawn coin-flips / bot loadout draws).
    expect(sim.state.rngDraws).toBe(0);
  });
});
