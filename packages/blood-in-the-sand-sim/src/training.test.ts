/**
 * Training mode (the dev menu's target-dummy range): inert dummies that never
 * aim or swing, rounds that never end, and a dead dummy replaced on its spawn
 * slot after a beat — the firing range never empties.
 */
import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { killPlayer } from "./abilities";
import {
  COUNTDOWN_SECONDS,
  DUMMY_RESPAWN_SECONDS,
  LOBBY_COUNTDOWN_SECONDS,
  TICK_DT,
} from "./config";
import { armingComplete } from "./round";
import { addDummy, addPlayer, createSim, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import { seatedPlayers, type ArenaPlayer } from "./state";
import { stepSim } from "./step";

const makeZone = (): ZoneFile => ({
  format: 1,
  id: "test-range",
  name: "Test Range",
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

/** The dev-menu line-up: an armed human on team 1, three dummies on team 2 —
 * a FULL 4-seat room, so the arming gate passes without a force-start. */
const makeRange = (): ArenaSim => {
  const sim = createSim(makeZone(), 0xd0d0, 2, true);
  addPlayer(sim, "tom", 1);
  addDummy(sim, "dummy I");
  addDummy(sim, "dummy II");
  addDummy(sim, "dummy III");
  setPlayerWeapon(sim, 0, "blade");
  setPlayerAbilities(sim, 0, ["dash", "tremor"]);
  return sim;
};

const seconds = (s: number): number => Math.ceil(s / TICK_DT);

const run = (sim: ArenaSim, ticks: number) => {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepSim(sim, new Map(), TICK_DT));
  return events;
};

/** Arming countdown + fight countdown, with a couple of ticks of slack. */
const runToActive = (sim: ArenaSim): void => {
  run(sim, seconds(LOBBY_COUNTDOWN_SECONDS + COUNTDOWN_SECONDS) + 4);
  expect(sim.state.round.phase).toBe("active");
};

const dummies = (sim: ArenaSim): ArenaPlayer[] => seatedPlayers(sim.state).filter((p) => p.dummy);

describe("the target-dummy range", () => {
  test("dummies arm on placement — the human arming is the last gate", () => {
    const sim = makeRange();
    expect(armingComplete(sim)).toBe(true);
    runToActive(sim);
  });

  test("a dummy in blade reach never aims or swings back", () => {
    const sim = makeRange();
    runToActive(sim);
    const tom = sim.state.players[0]!;
    const mark = dummies(sim)[0]!;
    tom.mover.pos.x = mark.mover.pos.x + 10;
    tom.mover.pos.y = mark.mover.pos.y;

    const events = run(sim, seconds(5));
    const hits = events.filter((e) => e.type === "hit");
    expect(hits.length).toBeGreaterThan(0); // tom's auto-attack found the dummy
    expect(hits.every((e) => e.attackerId === 0)).toBe(true);
    expect(events.some((e) => e.type === "shoot")).toBe(false);
    for (const d of dummies(sim)) {
      expect(d.targetId).toBeNull();
      expect(d.attack.phase).toBe("ready");
    }
  });

  test("a killed dummy stands back up on its slot at full hp", () => {
    const sim = makeRange();
    runToActive(sim);
    const mark = dummies(sim)[0]!;
    const home = { x: mark.mover.pos.x, y: mark.mover.pos.y };
    mark.mover.pos.x += 50; // shoved off its station before dying
    killPlayer(mark, []);
    expect(mark.alive).toBe(false);

    run(sim, seconds(DUMMY_RESPAWN_SECONDS) + 2);
    expect(mark.alive).toBe(true);
    expect(mark.combatant.hp).toBe(mark.combatant.stats.maxHp);
    expect(mark.mover.pos.x).toBeCloseTo(home.x);
    expect(mark.mover.pos.y).toBeCloseTo(home.y);
  });

  test("wiping the whole line never ends the round — it refills instead", () => {
    const sim = makeRange();
    runToActive(sim);
    for (const d of dummies(sim)) killPlayer(d, []);

    run(sim, 1);
    expect(sim.state.round.phase).toBe("active");
    expect(sim.state.round.wins).toEqual([0, 0]);

    run(sim, seconds(DUMMY_RESPAWN_SECONDS) + 2);
    expect(dummies(sim).every((d) => d.alive)).toBe(true);
  });
});
