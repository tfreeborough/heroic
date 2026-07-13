import { describe, expect, test } from "bun:test";
import { distanceToAabb, loadZone, segmentClear } from "@heroic/core";
import { PLAYER_RADIUS } from "./config";
import { addPlayer, createSim, deriveArenaZone } from "./sim";
import { ARENA_00 } from "./zone";

// The arena is authored in Realmsmith and changes as it's polished, so these
// tests derive their expectations from the file (spawn objects, loadZone's
// collision channels) instead of hardcoding the layout of the day. What they
// pin down is deriveArenaZone's WIRING: spawns resolve, footprints collide,
// and only walls + occluding props block sight.

const authoredSpawn = (team: number) => {
  const o = ARENA_00.objects.find((o) => o.kind === "playerSpawn" && Number(o.props.team) === team)!;
  return { x: o.x, y: o.y };
};

describe("arena-00", () => {
  test("derives a playable zone with both team spawns", () => {
    const zone = deriveArenaZone(ARENA_00);
    const full = loadZone(ARENA_00);
    expect(zone.id).toBe("arena-00");
    expect(zone.size).toEqual({
      x: ARENA_00.size.cols * ARENA_00.tileSize,
      y: ARENA_00.size.rows * ARENA_00.tileSize,
    });
    expect(zone.spawns[0]).toEqual(authoredSpawn(1));
    expect(zone.spawns[1]).toEqual(authoredSpawn(2));
    // Movement collision is loadZone's union (walls ∪ voids ∪ hidden ∪ prop
    // footprints); sight comes from walls + occluding footprints only, 4 edges each.
    expect(zone.collision).toEqual(full.collision);
    expect(zone.occluders.length).toBe((full.walls.length + full.propOccluders.length) * 4);
  });

  test("spawns don't intersect collision", () => {
    const zone = deriveArenaZone(ARENA_00);
    for (const spawn of zone.spawns) {
      for (const box of zone.collision) {
        expect(distanceToAabb(spawn, box)).toBeGreaterThan(PLAYER_RADIUS);
      }
    }
  });

  test("occluding props break line of sight; open ground is clear", () => {
    const zone = deriveArenaZone(ARENA_00);
    const full = loadZone(ARENA_00);
    // Straight through the middle of every occluding footprint: blocked.
    for (const box of full.propOccluders) {
      const a = { x: box.x - box.w, y: box.y };
      const b = { x: box.x + box.w, y: box.y };
      expect(segmentClear(a, b, zone.occluders)).toBe(false);
    }
    // A hair's-width segment at a spawn (proven off-collision above): clear.
    const s = zone.spawns[0];
    expect(segmentClear(s, { x: s.x + 1, y: s.y }, zone.occluders)).toBe(true);
  });

  test("a sim boots on the real zone and seats two players at the authored spawns", () => {
    const sim = createSim(ARENA_00, 1);
    expect(addPlayer(sim, "a")).not.toBeNull();
    expect(addPlayer(sim, "b")).not.toBeNull();
    expect(addPlayer(sim, "c")).toBeNull(); // room full
    expect(sim.state.players[0]!.mover.pos).toEqual(authoredSpawn(1));
    expect(sim.state.players[1]!.mover.pos).toEqual(authoredSpawn(2));
  });
});
