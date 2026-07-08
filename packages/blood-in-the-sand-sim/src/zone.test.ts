import { describe, expect, test } from "bun:test";
import { distanceToAabb, segmentClear } from "@heroic/core";
import { PLAYER_RADIUS } from "./config";
import { addPlayer, createSim, deriveArenaZone } from "./sim";
import { ARENA_00 } from "./zone";

describe("arena-00", () => {
  test("derives a playable zone with both team spawns", () => {
    const zone = deriveArenaZone(ARENA_00);
    expect(zone.id).toBe("arena-00");
    expect(zone.size).toEqual({ x: 1024, y: 1024 });
    expect(zone.spawns[0]).toEqual({ x: 128, y: 512 });
    expect(zone.spawns[1]).toEqual({ x: 896, y: 512 });
    expect(zone.collision.length).toBeGreaterThanOrEqual(3);
    expect(zone.occluders.length).toBe(zone.collision.length * 4); // all-floor zone: every blocker occludes
  });

  test("spawns don't intersect collision", () => {
    const zone = deriveArenaZone(ARENA_00);
    for (const spawn of zone.spawns) {
      for (const box of zone.collision) {
        expect(distanceToAabb(spawn, box)).toBeGreaterThan(PLAYER_RADIUS);
      }
    }
  });

  test("the centre pillar breaks line of sight between spawns", () => {
    const zone = deriveArenaZone(ARENA_00);
    // Cross-map through the pillar: blocked (no spawn-camping stare-downs,
    // and mid-fight it's the juke cover).
    expect(segmentClear(zone.spawns[0], zone.spawns[1], zone.occluders)).toBe(false);
    // Skirting above the pillar: clear.
    expect(segmentClear({ x: 128, y: 128 }, { x: 896, y: 128 }, zone.occluders)).toBe(true);
  });

  test("a sim boots on the real zone and seats two players", () => {
    const sim = createSim(ARENA_00, 1);
    expect(addPlayer(sim, "a")).not.toBeNull();
    expect(addPlayer(sim, "b")).not.toBeNull();
    expect(addPlayer(sim, "c")).toBeNull(); // room full
    expect(sim.state.players[0]!.mover.pos).toEqual({ x: 128, y: 512 });
    expect(sim.state.players[1]!.mover.pos).toEqual({ x: 896, y: 512 });
  });
});
