import { afterEach, describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { CLOSING_SANDS, configureSafeCircle, PLAYER_RADIUS, SANDS_ATTACKER_ID, TICK_DT } from "./config";
import type { ArenaEvent } from "./events";
import { startMatch } from "./round";
import { sandsRadius } from "./sands";
import { addPlayer, createSim, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import { toSnapshot } from "./snapshot";
import { stepSim } from "./step";

// Same little arena as step.test.ts: 512×512, one 64×64 pillar at (256,128).
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
  collision: { rects: [{ x: 256, y: 128, w: 64, h: 64 }] },
  breakables: [],
  objects: [
    { id: "spawn-t1", kind: "playerSpawn", x: 96, y: 256, props: { team: 1 } },
    { id: "spawn-t2", kind: "playerSpawn", x: 416, y: 256, props: { team: 2 } },
  ],
});

const makeMatch = (seed = 0xb100d, training = false): ArenaSim => {
  const sim = createSim(makeZone(), seed, 1, training);
  addPlayer(sim, "alice", training ? 1 : undefined);
  addPlayer(sim, "bob", training ? 2 : undefined);
  setPlayerWeapon(sim, 0, "blade");
  setPlayerWeapon(sim, 1, "blade");
  setPlayerAbilities(sim, 0, ["dash", "tremor"]);
  setPlayerAbilities(sim, 1, ["dash", "tremor"]);
  expect(startMatch(sim, [])).toBe(true);
  return sim;
};

/** Step `seconds` of idle inputs, collecting every event. */
const run = (sim: ArenaSim, seconds: number): ArenaEvent[] => {
  const events: ArenaEvent[] = [];
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    events.push(...stepSim(sim, new Map(), TICK_DT));
  }
  return events;
};

/** Fast sands for tests: rolls after 0.5s active, fully closed 1s later. */
const fastSands = (): void =>
  configureSafeCircle({
    delaySeconds: 0.5,
    closeSeconds: 1,
    finalRadius: 60,
    tickInterval: 0.1,
    damageMin: 5,
    damageMax: 50,
  });

const DEFAULTS = { ...CLOSING_SANDS };
afterEach(() => configureSafeCircle(DEFAULTS));

describe("the Closing Sands", () => {
  test("rolls after the delay, announces once, and rides snapshots", () => {
    fastSands();
    const sim = makeMatch();
    const events = run(sim, 7); // 5s entrance countdown + past the 0.5s fuse
    const starts = events.filter((e) => e.type === "sandsStart");
    expect(starts).toHaveLength(1);
    const sands = sim.state.round.sands!;
    expect(sands).not.toBeNull();
    // The final circle sits fully on walkable sand: inside the arena margin…
    const margin = CLOSING_SANDS.finalRadius + PLAYER_RADIUS;
    expect(sands.cx).toBeGreaterThanOrEqual(margin);
    expect(sands.cx).toBeLessThanOrEqual(512 - margin);
    expect(sands.cy).toBeGreaterThanOrEqual(margin);
    expect(sands.cy).toBeLessThanOrEqual(512 - margin);
    // …and the snapshot projects centre + radius + progress.
    const snap = toSnapshot(sim.state, []);
    expect(snap.round.sands).not.toBeNull();
    expect(snap.round.sands!.cx).toBe(sands.cx);
    expect(snap.round.sands!.r).toBeGreaterThan(0);
  });

  test("shrinks to the final radius and holds", () => {
    fastSands();
    const sim = makeMatch();
    run(sim, 5.6); // countdown + fuse + a first slice of the close
    const early = sandsRadius(sim.state.round);
    // Keep both fighters alive at the centre so the round can't end under us.
    const sands = sim.state.round.sands!;
    for (const p of [sim.state.players[0]!, sim.state.players[1]!]) {
      p.mover.pos.x = sands.cx;
      p.mover.pos.y = sands.cy;
    }
    run(sim, 2);
    const late = sandsRadius(sim.state.round);
    expect(late).toBeLessThan(early);
    expect(late).toBe(CLOSING_SANDS.finalRadius);
    expect(sim.state.round.phase).toBe("active"); // nobody bled — both inside
  });

  test("bleeds anyone outside with unattributed ambient ticks, and can end the round", () => {
    fastSands();
    const sim = makeMatch();
    run(sim, 5.6);
    const sands = sim.state.round.sands!;
    // Alice holds the centre; bob is parked at the arena corner, deep in it.
    sim.state.players[0]!.mover.pos.x = sands.cx;
    sim.state.players[0]!.mover.pos.y = sands.cy;
    sim.state.players[1]!.mover.pos.x = 30;
    sim.state.players[1]!.mover.pos.y = 30;
    const events = run(sim, 4.5); // long enough to bleed bob out AND close the round plate
    const ticks = events.filter(
      (e): e is Extract<ArenaEvent, { type: "hit" }> =>
        e.type === "hit" && e.attackerId === SANDS_ATTACKER_ID,
    );
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((e) => e.targetId === 1 && e.bleed === true && !e.crit)).toBe(true);
    // The tide killed bob: death emitted, alice's team took the round.
    expect(events.some((e) => e.type === "death" && e.playerId === 1)).toBe(true);
    expect(sim.state.round.wins[0]).toBe(1);
    // …and the fresh round starts clean: fuse re-armed, circle drained.
    expect(sim.state.round.sands).toBeNull();
    expect(sim.state.round.elapsed).toBe(0);
  });

  test("damage ramps with close progress", () => {
    fastSands();
    const sim = makeMatch();
    run(sim, 5.55); // just past the roll — progress ~0
    const sands = sim.state.round.sands!;
    const sandsTicks = (events: ArenaEvent[]) =>
      events.filter(
        (e): e is Extract<ArenaEvent, { type: "hit" }> =>
          e.type === "hit" && e.attackerId === SANDS_ATTACKER_ID,
      );
    // Bob eats one early tick outside, then shelters at the centre.
    sim.state.players[0]!.mover.pos.x = sands.cx;
    sim.state.players[0]!.mover.pos.y = sands.cy;
    sim.state.players[1]!.mover.pos.x = 30;
    sim.state.players[1]!.mover.pos.y = 30;
    const early = sandsTicks(run(sim, 0.2));
    expect(early.length).toBeGreaterThan(0);
    expect(early[0]!.damage).toBeLessThan(CLOSING_SANDS.damageMax);
    sim.state.players[1]!.mover.pos.x = sands.cx;
    sim.state.players[1]!.mover.pos.y = sands.cy;
    run(sim, 1.2); // fully closed (closeSeconds = 1), both safe inside
    // Back outside at full close: the tick lands at the ramp's top.
    sim.state.players[1]!.combatant.hp = 100;
    sim.state.players[1]!.mover.pos.x = 30;
    sim.state.players[1]!.mover.pos.y = 30;
    const late = sandsTicks(run(sim, 0.2));
    expect(late.length).toBeGreaterThan(0);
    expect(late[0]!.damage).toBe(CLOSING_SANDS.damageMax);
    expect(late[0]!.damage).toBeGreaterThan(early[0]!.damage);
  });

  test("never rolls when disabled, and never in training", () => {
    fastSands();
    configureSafeCircle({ enabled: false });
    const off = makeMatch();
    expect(run(off, 8).some((e) => e.type === "sandsStart")).toBe(false);
    expect(off.state.round.sands).toBeNull();

    configureSafeCircle({ enabled: true });
    const range = makeMatch(0xb100d, true);
    expect(run(range, 8).some((e) => e.type === "sandsStart")).toBe(false);
    expect(range.state.round.sands).toBeNull();
  });
});
