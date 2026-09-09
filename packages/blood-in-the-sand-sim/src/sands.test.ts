import { afterEach, describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { CALL_THE_TIDE, CLOSING_SANDS, configureSafeCircle, PLAYER_RADIUS, SANDS_ATTACKER_ID, TICK_DT } from "./config";
import type { ArenaEvent } from "./events";
import { startMatch } from "./round";
import { sandsProgress, sandsRadius } from "./sands";
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

// ── Deed signals + Call the Tide (bits-sands-deeds.md, 2026-09-09) ─────────
import { markShoved } from "./abilities/damage";
import type { PlayerInput } from "./state";

const IDLE_CAST: PlayerInput = { seq: 0, sx: 0, sy: 0, casts: [false, false] };
const pressing = (seat: number, slot: number): Map<number, PlayerInput> =>
  new Map([[seat, { ...IDLE_CAST, casts: slot === 0 ? [true, false] : [false, true] }]]);

/** Step `seconds` with `inputs` every tick, collecting events. */
const runWith = (sim: ArenaSim, seconds: number, inputs: Map<number, PlayerInput>): ArenaEvent[] => {
  const events: ArenaEvent[] = [];
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) events.push(...stepSim(sim, inputs, TICK_DT));
  return events;
};

describe("the Blood Tide's deed signals", () => {
  test("the horn names who already stands inside the final ring", () => {
    fastSands();
    const sim = makeMatch();
    run(sim, 5.4); // countdown done, fuse not yet burnt
    // Park alice on every candidate centre at once? Can't — so park BOTH
    // bodies dead-centre of the arena and read the roll honestly.
    for (const p of [sim.state.players[0]!, sim.state.players[1]!]) {
      p.mover.pos.x = 256;
      p.mover.pos.y = 256;
    }
    const start = run(sim, 0.3).find((e) => e.type === "sandsStart") as Extract<ArenaEvent, { type: "sandsStart" }>;
    expect(start).toBeDefined();
    expect(start.callerId).toBeUndefined(); // the fuse, not a caller
    const sands = sim.state.round.sands!;
    const inside = Math.hypot(256 - sands.cx, 256 - sands.cy) + PLAYER_RADIUS <= CLOSING_SANDS.finalRadius;
    expect(start.inside).toEqual(inside ? [0, 1] : []);
  });

  test("real hits while the tide is live carry who stood in the blood and the close progress", () => {
    fastSands();
    const sim = makeMatch();
    run(sim, 5.6);
    const sands = sim.state.round.sands!;
    // Both in the blood at the corner, adjacent — the blades auto-swing —
    // and the stamp must read both as out.
    sim.state.players[0]!.mover.pos.x = 40;
    sim.state.players[0]!.mover.pos.y = 40;
    sim.state.players[1]!.mover.pos.x = 70;
    sim.state.players[1]!.mover.pos.y = 40;
    const events = run(sim, 1.2); // blades auto-swing at a body in reach
    const blows = events.filter(
      (e): e is Extract<ArenaEvent, { type: "hit" }> => e.type === "hit" && e.attackerId === 0 && e.targetId === 1,
    );
    expect(blows.length).toBeGreaterThan(0);
    for (const b of blows) {
      expect(b.tide).toBeDefined();
      expect(b.tide!.attackerOut).toBe(true);
      expect(b.tide!.victimOut).toBe(true);
      expect(b.tide!.p).toBeGreaterThanOrEqual(0);
      expect(b.tide!.p).toBeLessThanOrEqual(1);
    }
    // The tide's own ticks are never stamped.
    const ticks = events.filter((e) => e.type === "hit" && e.attackerId === SANDS_ATTACKER_ID);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((e) => e.type === "hit" && e.tide === undefined)).toBe(true);
    void sands;
  });

  test("a body put over the shoreline inside the shove window emits sandsShove; a walk-out doesn't", () => {
    fastSands();
    const sim = makeMatch();
    run(sim, 5.6);
    const sands = sim.state.round.sands!;
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos.x = sands.cx;
    alice.mover.pos.y = sands.cy;
    bob.mover.pos.x = sands.cx;
    bob.mover.pos.y = sands.cy;
    run(sim, 0.2); // both registered INSIDE
    // Bob crosses the line under his own steam: no shove on record.
    bob.mover.pos.x = 30;
    bob.mover.pos.y = 30;
    let events = run(sim, 0.2);
    expect(events.some((e) => e.type === "sandsShove")).toBe(false);
    bob.mover.pos.x = sands.cx;
    bob.mover.pos.y = sands.cy;
    run(sim, 0.2); // back inside
    // Now alice shoves him (the impulse's stamp) and he lands in the blood.
    markShoved(bob, alice.id);
    bob.mover.pos.x = 30;
    bob.mover.pos.y = 30;
    events = run(sim, 0.2);
    const shoves = events.filter((e) => e.type === "sandsShove");
    expect(shoves).toEqual([{ type: "sandsShove", byId: 0, victimId: 1 }]);
    // The stamp is consumed — no second shove for staying out.
    expect(run(sim, 0.2).some((e) => e.type === "sandsShove")).toBe(false);
  });

  test("a shove's credit expires after the window", () => {
    fastSands();
    configureSafeCircle({ finalRadius: 150 }); // room to keep two blades apart
    const sim = makeMatch();
    run(sim, 5.6);
    const sands = sim.state.round.sands!;
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    // Apart, inside: overlapping bodies auto-swing and every weapon hit
    // re-stamps the shove (correct — a hammer blow IS a shove).
    alice.mover.pos.x = sands.cx - 100;
    alice.mover.pos.y = sands.cy;
    bob.mover.pos.x = sands.cx + 100;
    bob.mover.pos.y = sands.cy;
    run(sim, 0.2);
    markShoved(bob, alice.id);
    run(sim, 1.5); // > SANDS_SHOVE_WINDOW, still inside
    expect(bob.shovedBy).toBeNull();
    bob.mover.pos.x = 30;
    bob.mover.pos.y = 30;
    expect(run(sim, 0.2).some((e) => e.type === "sandsShove")).toBe(false);
  });
});

describe("Call the Tide", () => {
  const armed = (): ArenaSim => {
    const sim = createSim(makeZone(), 0xb100d, 1, false);
    addPlayer(sim, "alice");
    addPlayer(sim, "bob");
    setPlayerWeapon(sim, 0, "blade");
    setPlayerWeapon(sim, 1, "blade");
    setPlayerAbilities(sim, 0, ["call-the-tide", "dash"]);
    setPlayerAbilities(sim, 1, ["dash", "tremor"]);
    expect(startMatch(sim, [])).toBe(true);
    return sim;
  };

  test("too early in the round the press is nothing — no cast, charge kept — and the lock SHOWS as a cooldown", () => {
    configureSafeCircle({ delaySeconds: 60 }); // the fuse is far away
    const sim = armed();
    run(sim, 5.2); // countdown over, fight ~0.2s old
    const slot = sim.state.players[0]!.slots[0]!;
    expect(slot.ability.phase).toBe("cooldown");
    expect(slot.ability.cooldownRemaining).toBeGreaterThan(CALL_THE_TIDE.minFightSeconds - 0.5);
    expect(slot.ability.cooldownRemaining).toBeLessThanOrEqual(CALL_THE_TIDE.minFightSeconds);
    const events = runWith(sim, 0.5, pressing(0, 0));
    expect(events.some((e) => e.type === "cast")).toBe(false);
    expect(events.some((e) => e.type === "sandsStart")).toBe(false);
    expect(sim.state.round.sands).toBeNull();
    expect(sim.state.players[0]!.slots[0]!.chargesLeft).toBe(1);
  });

  test("after the minimum fight time the horn sounds NOW and the close runs from zero", () => {
    configureSafeCircle({ delaySeconds: 60, closeSeconds: 1, finalRadius: 60 });
    const sim = armed();
    // Keep both alive and central so nothing ends the round under us.
    run(sim, 5 + CALL_THE_TIDE.minFightSeconds + 0.1);
    for (const p of [sim.state.players[0]!, sim.state.players[1]!]) {
      p.mover.pos.x = 256;
      p.mover.pos.y = 256;
    }
    const events = runWith(sim, 0.2, pressing(0, 0));
    expect(events.filter((e) => e.type === "cast" && e.ability === "call-the-tide")).toHaveLength(1);
    const starts = events.filter((e): e is Extract<ArenaEvent, { type: "sandsStart" }> => e.type === "sandsStart");
    expect(starts).toHaveLength(1);
    expect(starts[0]!.callerId).toBe(0); // the banner names the caller
    expect(sim.state.round.sands).not.toBeNull();
    expect(sandsProgress(sim.state.round)).toBeLessThan(0.3); // fresh roll, not the fuse's clock
    expect(sim.state.players[0]!.slots[0]!.chargesLeft).toBe(0);
    // A second press while the tide is in: nothing.
    const again = runWith(sim, 0.2, pressing(0, 0));
    expect(again.some((e) => e.type === "cast")).toBe(false);
  });

  test("the fuse's own roll spends the unused charge — the button reads spent, not pressable", () => {
    configureSafeCircle({ delaySeconds: 0.5, closeSeconds: 1, finalRadius: 60 });
    const sim = armed();
    run(sim, 5.2);
    expect(sim.state.players[0]!.slots[0]!.chargesLeft).toBe(1);
    run(sim, 0.5); // past the fuse
    expect(sim.state.round.sands).not.toBeNull();
    expect(sim.state.players[0]!.slots[0]!.chargesLeft).toBe(0);
  });

  test("never in the range", () => {
    configureSafeCircle({ delaySeconds: 60 });
    const sim = createSim(makeZone(), 1, 1, true);
    addPlayer(sim, "alice", 1);
    addPlayer(sim, "bob", 2);
    setPlayerWeapon(sim, 0, "blade");
    setPlayerWeapon(sim, 1, "blade");
    setPlayerAbilities(sim, 0, ["call-the-tide", "dash"]);
    setPlayerAbilities(sim, 1, ["dash", "tremor"]);
    expect(startMatch(sim, [])).toBe(true);
    run(sim, 5 + CALL_THE_TIDE.minFightSeconds + 0.1);
    const events = runWith(sim, 0.5, pressing(0, 0));
    expect(events.some((e) => e.type === "sandsStart")).toBe(false);
    expect(sim.state.round.sands).toBeNull();
  });
});
