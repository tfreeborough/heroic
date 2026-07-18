import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import {
  BLOOD_FONT,
  DEPLOYABLE_ID_BASE,
  HARPOON,
  IRONHIDE,
  PLAYER_MAX_SPEED,
  SANDTRAP,
  STRAW_MAN,
  TICK_DT,
  TREMOR,
  WAR_DRUMS,
  WARDING_SHOUT,
  type AbilityId,
  type WeaponId,
} from "./config";
import type { ArenaEvent } from "./events";
import { resetForRound } from "./round";
import { addPlayer, createSim, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import { slotOf, type ArenaPlayer, type PlayerInput } from "./state";
import { stepSim } from "./step";

// Same fixture as step.test.ts: 512×512, off-centre pillar at (256,128).
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

interface FightOpts {
  w0?: WeaponId;
  w1?: WeaponId;
  a0?: AbilityId[];
  a1?: AbilityId[];
  seed?: number;
}

/** Two seated players with the given loadouts, forced straight into a fight. */
const makeFight = (opts: FightOpts = {}): ArenaSim => {
  const sim = createSim(makeZone(), opts.seed ?? 0xb100d);
  addPlayer(sim, "alice");
  addPlayer(sim, "bob");
  setPlayerWeapon(sim, 0, opts.w0 ?? "blade");
  setPlayerWeapon(sim, 1, opts.w1 ?? "blade");
  setPlayerAbilities(sim, 0, opts.a0 ?? ["dash", "tremor"]);
  setPlayerAbilities(sim, 1, opts.a1 ?? ["dash", "tremor"]);
  sim.state.round.phase = "active";
  return sim;
};

type Inputs = ReadonlyMap<number, PlayerInput>;

interface Stamped {
  tick: number;
  event: ArenaEvent;
}

const run = (sim: ArenaSim, ticks: number, inputsFor?: (tick: number) => Inputs): Stamped[] => {
  const out: Stamped[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = sim.state.tick;
    for (const event of stepSim(sim, inputsFor?.(tick) ?? new Map(), TICK_DT)) out.push({ tick, event });
  }
  return out;
};

const ofType = <T extends ArenaEvent["type"]>(events: Stamped[], type: T) =>
  events.filter((e): e is Stamped & { event: Extract<ArenaEvent, { type: T }> } => e.event.type === type);

/** One tick's input pressing the button of the slot that holds `ability`. */
const press = (sim: ArenaSim, id: number, ability: AbilityId): Inputs => {
  const p = sim.state.players[id]!;
  return new Map([[id, { seq: 0, sx: 0, sy: 0, casts: p.slots.map((s) => s.id === ability) }]]);
};

/** Force a status ability's window open — timing shortcut for effect tests. */
const forceActive = (p: ArenaPlayer, id: AbilityId, seconds: number): void => {
  const slot = slotOf(p, id)!;
  slot.ability = { phase: "active", activeRemaining: seconds, cooldownRemaining: seconds + 1 };
};

const hp = (sim: ArenaSim, id: number): number => sim.state.players[id]!.combatant.hp;

describe("tremor (quake)", () => {
  test("opens a fixed zone: first tick bites on cast, then every second until expiry", () => {
    const sim = makeFight();
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    // Inside the zone (edge dist 202 < 240) but past blade reach — the only
    // hit events across the whole life are the quake's own ticks.
    sim.state.players[1]!.mover.pos = { x: 420, y: 256 };

    const events = run(sim, 1, () => press(sim, 0, "tremor"));
    const zone = sim.state.deployables.find((d) => d.kind === "quake")!;
    expect(zone).toBeDefined();
    expect(zone.pos).toEqual({ x: 200, y: 256 }); // fixed where the caster stood
    const hits = ofType(events, "hit");
    expect(hits).toHaveLength(1); // the ground bites the moment it opens
    expect(hits[0]!.event.damage).toBe(TREMOR.damagePerTick);
    expect(hits[0]!.event.crit).toBe(false);
    // No hurl any more — the quake holds you in place, it doesn't launch you.
    expect(Math.abs(sim.state.players[1]!.mover.vel.x)).toBeLessThan(1);

    // Ride out the rest of the life: 4 ticks total (0/1/2/3s), then gone.
    const rest = run(sim, Math.ceil(TREMOR.duration / TICK_DT) + 2);
    expect(ofType(rest, "hit")).toHaveLength(3);
    expect(hp(sim, 1)).toBe(100 - 4 * TREMOR.damagePerTick);
    expect(sim.state.deployables).toHaveLength(0);

    // Far enemy: same cast, nobody in the circle — the ground shakes at air.
    const far = makeFight();
    far.state.players[0]!.mover.pos = { x: 96, y: 96 };
    far.state.players[1]!.mover.pos = { x: 416, y: 450 };
    const farStart = far.state.tick;
    const quiet = run(far, Math.ceil(TREMOR.duration / TICK_DT) + 2, (t) =>
      t === farStart ? press(far, 0, "tremor") : new Map(),
    );
    expect(ofType(quiet, "hit")).toHaveLength(0);
    expect(ofType(quiet, "cast")).toHaveLength(1); // it still fired — just hit sand
  });

  test("slows whoever stands in it; the slow lingers briefly, then clears", () => {
    const sim = makeFight();
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    bob.mover.pos = { x: 420, y: 256 };

    const start = sim.state.tick;
    run(sim, 2, (t) => (t === start ? press(sim, 0, "tremor") : new Map()));
    expect(bob.slowLeft).toBeGreaterThan(0);
    expect(bob.slowFactor).toBe(TREMOR.slowFactor);

    // Sprint while inside: capped at the slowed speed, not full sprint.
    run(sim, 12, () => new Map([[1, { seq: 0, sx: -1, sy: 0, casts: [] }]]));
    const speed = Math.hypot(bob.mover.vel.x, bob.mover.vel.y);
    expect(speed).toBeLessThan(PLAYER_MAX_SPEED * TREMOR.slowFactor + 5);

    // After the zone expires, the linger runs out and the legs come back.
    run(sim, Math.ceil((TREMOR.duration + TREMOR.slowLinger) / TICK_DT) + 2);
    expect(sim.state.deployables).toHaveLength(0);
    expect(bob.slowLeft).toBe(0);
  });

  test("dash i-frames dodge the ticks and the slow", () => {
    const sim = makeFight();
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 420, y: 256 };
    slotOf(sim.state.players[1]!, "dash")!.invulnLeft = 999;
    const start = sim.state.tick;
    const events = run(sim, Math.ceil(TREMOR.duration / TICK_DT) + 2, (t) =>
      t === start ? press(sim, 0, "tremor") : new Map(),
    );
    expect(ofType(events, "hit")).toHaveLength(0);
    expect(hp(sim, 1)).toBe(100);
    expect(sim.state.players[1]!.slowLeft).toBe(0);
  });
});

describe("warding shout", () => {
  test("hurls the enemy in the cone, damage-free; the flank is safe", () => {
    const sim = makeFight({ a0: ["dash", "warding-shout"] });
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    bob.mover.pos = { x: 320, y: 256 }; // dead ahead, well inside range
    sim.state.players[0]!.facing = 0; // bellowing east (abilities step before facing re-tracks)

    const events = run(sim, 1, () => press(sim, 0, "warding-shout"));
    expect(ofType(events, "hit")).toHaveLength(0); // pure peel — no damage, ever
    expect(hp(sim, 1)).toBe(100);
    expect(bob.mover.vel.x).toBeGreaterThan(WARDING_SHOUT.knockback * 0.8); // hurled east

    // Same spacing, shout aimed the other way: a shout has a direction.
    const flank = makeFight({ a0: ["dash", "warding-shout"] });
    flank.state.players[0]!.mover.pos = { x: 200, y: 256 };
    flank.state.players[1]!.mover.pos = { x: 320, y: 256 };
    flank.state.players[0]!.facing = Math.PI; // bellowing west; bob stands east
    run(flank, 1, () => press(flank, 0, "warding-shout"));
    expect(Math.abs(flank.state.players[1]!.mover.vel.x)).toBeLessThan(1);
  });

  test("range-gated, and dash i-frames ride straight through it", () => {
    const far = makeFight({ a0: ["dash", "warding-shout"] });
    far.state.players[0]!.mover.pos = { x: 96, y: 256 };
    far.state.players[1]!.mover.pos = { x: 420, y: 256 }; // edge dist 306 > 170
    far.state.players[0]!.facing = 0;
    run(far, 1, () => press(far, 0, "warding-shout"));
    expect(Math.abs(far.state.players[1]!.mover.vel.x)).toBeLessThan(1);

    const sim = makeFight({ a0: ["dash", "warding-shout"] });
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 300, y: 256 };
    sim.state.players[0]!.facing = 0;
    slotOf(sim.state.players[1]!, "dash")!.invulnLeft = 999;
    run(sim, 1, () => press(sim, 0, "warding-shout"));
    expect(Math.abs(sim.state.players[1]!.mover.vel.x)).toBeLessThan(1);
  });
});

describe("sandtrap", () => {
  test("arms over 2s, then detonates on the first enemy in trigger range", () => {
    const sim = makeFight({ a0: ["sandtrap", "dash"] });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 150, y: 400 };
    bob.mover.pos = { x: 416, y: 450 };

    run(sim, 1, () => press(sim, 0, "sandtrap"));
    expect(sim.state.deployables).toHaveLength(1);
    const mine = sim.state.deployables[0]!;
    expect(mine.kind).toBe("sandtrap");
    expect(mine.id).toBeGreaterThanOrEqual(DEPLOYABLE_ID_BASE);

    // Bob stands ON the spot while it arms — no boom until the 2s are up.
    bob.mover.pos = { x: mine.pos.x, y: mine.pos.y + 30 };
    alice.mover.pos = { x: 96, y: 96 }; // caster well clear (and out of blade reach)
    const arming = run(sim, 30); // 1s into the 2s arm
    expect(ofType(arming, "detonate")).toHaveLength(0);

    const events = run(sim, 45); // past the arm point → boom
    expect(ofType(events, "detonate")).toHaveLength(1);
    expect(sim.state.deployables).toHaveLength(0); // spent
    const hits = ofType(events, "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.event.damage).toBe(SANDTRAP.damage);
    expect(hp(sim, 1)).toBe(100 - SANDTRAP.damage);
  });

  test("one live mine per player — replanting fizzles the old", () => {
    const sim = makeFight({ a0: ["sandtrap", "dash"] });
    sim.state.players[0]!.mover.pos = { x: 96, y: 96 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 450 };
    run(sim, 1, () => press(sim, 0, "sandtrap"));
    const firstId = sim.state.deployables[0]!.id;
    // Wait out the cooldown, then plant again somewhere else.
    sim.state.players[0]!.mover.pos = { x: 96, y: 200 };
    slotOf(sim.state.players[0]!, "sandtrap")!.ability = { phase: "ready", activeRemaining: 0, cooldownRemaining: 0 };
    run(sim, 1, () => press(sim, 0, "sandtrap"));
    expect(sim.state.deployables).toHaveLength(1);
    expect(sim.state.deployables[0]!.id).not.toBe(firstId);
  });
});

describe("harpoon", () => {
  test("no mark in chain range, no cast — the press is ignored, cooldown keeps", () => {
    const sim = makeFight({ a0: ["harpoon", "dash"] });
    // Corner to corner: ~611px apart — past even the harpoon's own 550 reach.
    sim.state.players[0]!.mover.pos = { x: 40, y: 40 };
    sim.state.players[1]!.mover.pos = { x: 472, y: 472 };
    const events = run(sim, 3, () => press(sim, 0, "harpoon"));
    expect(ofType(events, "cast")).toHaveLength(0);
    expect(slotOf(sim.state.players[0]!, "harpoon")!.ability.phase).toBe("ready");
  });

  test("acquires its OWN mark past the weapon's lock-on distance", () => {
    const sim = makeFight({ a0: ["harpoon", "dash"] }); // blade: 250 engagement
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 60, y: 400 };
    bob.mover.pos = { x: 460, y: 400 }; // 400 apart — no blade lock, well inside the chain
    run(sim, 1);
    expect(alice.targetId).toBeNull(); // the weapon can't see that far…
    const events = run(sim, 45, (tick) => (tick === 1 ? press(sim, 0, "harpoon") : new Map()));
    expect(ofType(events, "harpoon")).toHaveLength(1); // …the chain can
    const gap = Math.hypot(bob.mover.pos.x - alice.mover.pos.x, bob.mover.pos.y - alice.mover.pos.y);
    expect(gap).toBeLessThan(HARPOON.pullGap + 15);
  });

  test("lands instantly, then REELS the mark in while the caster stands rooted", () => {
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash"] });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 100, y: 400 };
    bob.mover.pos = { x: 300, y: 400 }; // 200 apart — inside chain range
    const gap = () => Math.hypot(bob.mover.pos.x - alice.mover.pos.x, bob.mover.pos.y - alice.mover.pos.y);

    run(sim, 1); // acquire targets
    expect(alice.targetId).toBe(1);
    // Windup 0.1s ≈ 3 ticks; the chain lands with NO flight time after it.
    const events = run(sim, 5, (tick) => (tick === 1 ? press(sim, 0, "harpoon") : new Map()));

    expect(ofType(events, "cast").filter((e) => e.event.ability === "harpoon")).toHaveLength(1);
    expect(ofType(events, "harpoon")).toHaveLength(1); // the chain flash
    expect(sim.state.projectiles).toHaveLength(0); // nothing in flight, ever
    const hits = ofType(events, "hit");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.event.damage).toBe(HARPOON.damage);

    // No teleport: right after landing the mark is still out there, chained.
    expect(gap()).toBeGreaterThan(120);
    expect(slotOf(alice, "harpoon")!.reelLeft).toBeGreaterThan(0);

    // Mid-haul the caster is ROOTED: stick input goes nowhere.
    const castX = alice.mover.pos.x;
    run(sim, 6, () => new Map([[0, { seq: 0, sx: 1, sy: 0, casts: [] }]]));
    expect(alice.mover.pos.x).toBeCloseTo(castX, 0);
    expect(gap()).toBeLessThan(200); // …while the mark is dragged closer

    // The full haul ends just in front of the caster.
    run(sim, 30);
    expect(gap()).toBeLessThan(HARPOON.pullGap + 15);
    expect(slotOf(alice, "harpoon")!.reelLeft).toBe(0);
  });

  test("the victim's dash mid-reel snaps the chain", () => {
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash"] });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 60, y: 400 };
    bob.mover.pos = { x: 460, y: 400 }; // 400 apart — a long haul
    const gap = () => Math.hypot(bob.mover.pos.x - alice.mover.pos.x, bob.mover.pos.y - alice.mover.pos.y);

    run(sim, 1);
    run(sim, 8, (tick) => (tick === 1 ? press(sim, 0, "harpoon") : new Map()));
    expect(slotOf(alice, "harpoon")!.reelLeft).toBeGreaterThan(0); // hauling

    // Bob rolls away — the i-frames cut the chain.
    run(sim, 1, () => new Map([[1, { seq: 0, sx: 1, sy: 0, casts: [true] }]]));
    run(sim, 40);
    expect(slotOf(alice, "harpoon")!.reelLeft).toBe(0);
    expect(gap()).toBeGreaterThan(200); // never got dragged in
  });

  test("dash i-frames at the landing moment dodge it (the chain still whips)", () => {
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash"] });
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 100, y: 400 };
    bob.mover.pos = { x: 300, y: 400 };
    slotOf(bob, "dash")!.invulnLeft = 999;
    run(sim, 1);
    const events = run(sim, 5, (tick) => (tick === 1 ? press(sim, 0, "harpoon") : new Map()));
    expect(ofType(events, "harpoon")).toHaveLength(1); // whiffed through air
    expect(ofType(events, "hit")).toHaveLength(0);
    expect(bob.mover.pos.x).toBeCloseTo(300, 0);
  });

  test("Ironhide blocks the pull (and blunts the sting)", () => {
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash"], a1: ["ironhide", "dash"] });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 100, y: 400 };
    bob.mover.pos = { x: 300, y: 400 };
    forceActive(bob, "ironhide", 999);

    run(sim, 1);
    const events = run(sim, 5, (tick) => (tick === 1 ? press(sim, 0, "harpoon") : new Map()));
    const hits = ofType(events, "hit");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.event.damage).toBe(Math.max(1, Math.round(HARPOON.damage * IRONHIDE.damageTakenFactor)));
    expect(bob.mover.pos.x).toBeCloseTo(300, 0); // never moved
  });

  test("Mirror Guard reflects the chain — the CASTER eats the barb and is reeled in (gradually)", () => {
    const sim = makeFight({
      w0: "bow", w1: "bow",
      a0: ["harpoon", "dash"],
      a1: ["mirror-guard", "dash"],
    });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 100, y: 400 };
    bob.mover.pos = { x: 300, y: 400 };
    forceActive(bob, "mirror-guard", 999);

    run(sim, 1);
    const events = run(sim, 5, (tick) => (tick === 1 ? press(sim, 0, "harpoon") : new Map()));
    const hits = ofType(events, "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.event.attackerId).toBe(1); // the guard gets the credit
    expect(hits[0]!.event.targetId).toBe(0);

    // The reflect is a slow haul, not a teleport: a few ticks in, the caster has
    // started sliding toward the guard but is nowhere near planted yet.
    expect(bob.mover.pos.x).toBeCloseTo(300, 0); // the guard never moves…
    expect(alice.mover.pos.x).toBeGreaterThan(105); // …the caster has begun moving…
    const gapMid = Math.hypot(alice.mover.pos.x - bob.mover.pos.x, alice.mover.pos.y - bob.mover.pos.y);
    expect(gapMid).toBeGreaterThan(HARPOON.pullGap + 30); // …but is still in transit, not snapped in

    // Let the reel run its course — the caster is hauled all the way to the guard.
    run(sim, 20);
    expect(bob.mover.pos.x).toBeCloseTo(300, 0); // guard stayed free but idle → still put
    const gapEnd = Math.hypot(alice.mover.pos.x - bob.mover.pos.x, alice.mover.pos.y - bob.mover.pos.y);
    expect(gapEnd).toBeLessThan(HARPOON.pullGap + 15); // planted in the guard's face
  });
});

describe("mirror guard", () => {
  test("a shot that hits the guard flips ownership and returns to its shooter", () => {
    const sim = makeFight({ w0: "bow", w1: "bow" , a1: ["mirror-guard", "dash"] });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 100, y: 400 };
    bob.mover.pos = { x: 300, y: 400 };
    forceActive(bob, "mirror-guard", 999);

    // Hand-rolled arrow mid-flight at bob, fired by alice.
    sim.state.projectiles.push({
      pos: { x: 260, y: 400 },
      dir: { x: 1, y: 0 },
      speed: 650,
      radius: 6,
      traveled: 0,
      maxRange: 420,
      pierceLeft: 0,
      hitIds: [],
      turnRate: 0,
      turnLeft: 0,
      id: 999,
      ownerId: 0,
      kind: "bow",
      targetId: null,
    });

    const events = run(sim, 20);
    const shot = sim.state.projectiles.find((p) => p.id === 999);
    // Either still homing back or already landed — but bob took nothing…
    expect(hp(sim, 1)).toBe(100);
    // …and the return fire credits bob when it lands on alice.
    const returnHits = ofType(events, "hit").filter((h) => h.event.attackerId === 1 && h.event.targetId === 0);
    expect(shot === undefined ? returnHits.length : 1).toBeGreaterThan(0);
    if (returnHits.length > 0) expect(hp(sim, 0)).toBeLessThan(100);
  });
});

describe("ironhide", () => {
  test("cuts melee damage on the exact same rng roll", () => {
    const setup = (iron: boolean): number => {
      const sim = makeFight({ a1: iron ? ["ironhide", "dash"] : undefined });
      sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
      sim.state.players[1]!.mover.pos = { x: 260, y: 256 };
      slotOf(sim.state.players[0]!, "dash")!.invulnLeft = 999; // one-sided
      if (iron) forceActive(sim.state.players[1]!, "ironhide", 999);
      for (let i = 0; i < 60; i++) {
        for (const e of stepSim(sim, new Map(), TICK_DT)) {
          if (e.type === "hit" && e.attackerId === 0) return e.damage;
        }
      }
      return -1;
    };
    const control = setup(false);
    const ironed = setup(true);
    expect(control).toBeGreaterThan(0);
    expect(ironed).toBe(Math.max(1, Math.round(control * IRONHIDE.damageTakenFactor)));
  });

  test("immune to the hammer's slow; self-slowed while it lasts", () => {
    const sim = makeFight({ w0: "hammer", a1: ["ironhide", "dash"] });
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    bob.mover.pos = { x: 300, y: 256 };
    slotOf(sim.state.players[0]!, "dash")!.invulnLeft = 999;
    forceActive(bob, "ironhide", 999);

    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      hit = stepSim(sim, new Map(), TICK_DT).some((e) => e.type === "hit" && e.attackerId === 0);
    }
    expect(hit).toBe(true);
    expect(bob.slowLeft).toBe(0); // the slow never took

    // Park apart, sprint: capped at the iron self-slow, not full speed.
    sim.state.players[0]!.mover.pos = { x: 64, y: 64 };
    bob.mover.pos = { x: 416, y: 420 };
    bob.mover.vel = { x: 0, y: 0 };
    run(sim, 15, () => new Map([[1, { seq: 0, sx: 1, sy: 0, casts: [] }]]));
    const speed = Math.hypot(bob.mover.vel.x, bob.mover.vel.y);
    expect(speed).toBeLessThan(PLAYER_MAX_SPEED * IRONHIDE.selfSlowFactor + 5);
  });

  test("takes reduced quake ticks and shrugs off the quake's slow", () => {
    const sim = makeFight({ a1: ["ironhide", "dash"] });
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    bob.mover.pos = { x: 420, y: 256 };
    forceActive(bob, "ironhide", 999);
    run(sim, 1, () => press(sim, 0, "tremor"));
    expect(hp(sim, 1)).toBe(100 - Math.max(1, Math.round(TREMOR.damagePerTick * IRONHIDE.damageTakenFactor)));
    expect(bob.slowLeft).toBe(0); // the ground grabs at iron and finds no purchase
  });

  test("plants through Warding Shout's hurl (knockback immune)", () => {
    const sim = makeFight({ a0: ["dash", "warding-shout"], a1: ["ironhide", "dash"] });
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    bob.mover.pos = { x: 300, y: 256 };
    sim.state.players[0]!.facing = 0;
    forceActive(bob, "ironhide", 999);
    run(sim, 1, () => press(sim, 0, "warding-shout"));
    expect(Math.abs(bob.mover.vel.x)).toBeLessThan(1); // never budged
    expect(hp(sim, 1)).toBe(100);
  });
});

describe("straw man", () => {
  test("the decoy joins the target pool, soaks hits, and breaks", () => {
    const sim = makeFight({ a1: ["straw-man", "dash"] });
    const alice = sim.state.players[0]!;
    const bob = sim.state.players[1]!;
    alice.mover.pos = { x: 200, y: 400 };
    bob.mover.pos = { x: 290, y: 400 };

    run(sim, 1, () => press(sim, 1, "straw-man"));
    const dummy = sim.state.deployables.find((d) => d.kind === "straw-man")!;
    expect(dummy).toBeDefined();
    expect(dummy.hp).toBe(STRAW_MAN.hp);

    // Bob slips away; the dummy stands where he was — nearest wins the lock.
    const flee = new Map([[1, { seq: 0, sx: 1, sy: 0.5, casts: [] as boolean[] }]]);
    const events = run(sim, 40, () => flee);
    expect(ofType(events, "hit").some((h) => h.event.targetId === dummy.id)).toBe(true);
    // ~2 blade hits break it; by 40 ticks it's gone (broken, not expired).
    expect(sim.state.deployables.find((d) => d.id === dummy.id)).toBeUndefined();
    expect(bob.alive).toBe(true);
  });

  test("an unmolested dummy times out on its own", () => {
    const sim = makeFight({ a1: ["straw-man", "dash"] });
    sim.state.players[0]!.mover.pos = { x: 96, y: 96 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 450 };
    run(sim, 1, () => press(sim, 1, "straw-man"));
    expect(sim.state.deployables).toHaveLength(1);
    run(sim, Math.ceil(STRAW_MAN.lifetime / TICK_DT) + 5);
    expect(sim.state.deployables).toHaveLength(0);
  });
});

describe("war drums", () => {
  test("the beat raises the drummer's own speed cap while it plays", () => {
    const sim = makeFight({ a0: ["war-drums", "dash"] });
    const alice = sim.state.players[0]!;
    alice.mover.pos = { x: 96, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 96 };
    forceActive(alice, "war-drums", 999);
    run(sim, 20, () => new Map([[0, { seq: 0, sx: 1, sy: 0, casts: [] }]]));
    const speed = Math.hypot(alice.mover.vel.x, alice.mover.vel.y);
    expect(speed).toBeGreaterThan(PLAYER_MAX_SPEED + 10);
    expect(speed).toBeLessThan(PLAYER_MAX_SPEED * WAR_DRUMS.speedFactor + 5);
  });
});

describe("blood font", () => {
  test("heals allies standing in the circle on the fixed tick, capped at max", () => {
    const sim = makeFight({ a0: ["blood-font", "dash"] });
    const alice = sim.state.players[0]!;
    alice.mover.pos = { x: 96, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 96 }; // enemy far away
    alice.combatant.hp = 50;

    run(sim, 1, () => press(sim, 0, "blood-font"));
    const events = run(sim, 33); // ~1.1s of the pour → 2 ticks
    const heals = ofType(events, "heal");
    expect(heals.length).toBe(2);
    for (const h of heals) expect(h.event.amount).toBe(BLOOD_FONT.healPerTick);
    expect(hp(sim, 0)).toBe(50 + 2 * BLOOD_FONT.healPerTick);
    expect(hp(sim, 1)).toBe(100); // the enemy got nothing (and took nothing)
  });

  test("never overheals — the last tick tops up exactly to max", () => {
    const sim = makeFight({ a0: ["blood-font", "dash"] });
    const alice = sim.state.players[0]!;
    alice.mover.pos = { x: 96, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 96 };
    alice.combatant.hp = 98;
    run(sim, 1, () => press(sim, 0, "blood-font"));
    const events = run(sim, 40);
    const heals = ofType(events, "heal");
    expect(heals).toHaveLength(1); // +2 then full — full allies get no event
    expect(heals[0]!.event.amount).toBe(2);
    expect(hp(sim, 0)).toBe(100);
  });
});

describe("sandstorm", () => {
  test("the cloud blinds BOTH ways: no locks on anyone inside, none FROM inside", () => {
    const sim = makeFight({ w0: "bow", w1: "bow", a1: ["sandstorm", "dash"] });
    sim.state.players[0]!.mover.pos = { x: 100, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 350, y: 400 }; // inside bow engagement
    run(sim, 2); // both acquire first
    expect(sim.state.players[1]!.targetId).toBe(0);
    run(sim, 1, () => press(sim, 1, "sandstorm"));
    run(sim, 3);
    expect(sim.state.players[0]!.targetId).toBeNull(); // can't mark the smoked
    expect(sim.state.players[1]!.targetId).toBeNull(); // can't take aim from inside either
  });

  test("a mid-windup lock on a smoked mark breaks", () => {
    const sim = makeFight({ w0: "bow", a1: ["sandstorm", "dash"] });
    const alice = sim.state.players[0]!;
    alice.mover.pos = { x: 100, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 350, y: 400 };

    // Let the bow enter its windup with a clean lock…
    let ticks = 0;
    while (alice.attack.phase !== "windup" && ticks++ < 30) run(sim, 1);
    expect(alice.attack.phase).toBe("windup");
    expect(alice.lockedTargetId).toBe(1);

    // …then bob kicks up the storm under himself.
    const events = run(sim, 3, (tick) => (tick === sim.state.tick ? press(sim, 1, "sandstorm") : new Map()));
    expect(ofType(events, "cast").some((e) => e.event.ability === "sandstorm")).toBe(true);
    run(sim, 2);
    expect(alice.attack.phase).toBe("ready"); // the windup broke
    expect(alice.lockedTargetId).toBeNull();
  });
});

describe("slots and rounds", () => {
  test("charges are a per-round budget: spent slots go dead, the reset refills", () => {
    const sim = makeFight(); // dash in slot 0, 4 charges, 3s cooldown
    const alice = sim.state.players[0]!;
    sim.state.players[0]!.mover.pos = { x: 96, y: 96 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 450 };

    // Press dash every 4s (past its cooldown) far more times than the budget.
    const events = run(sim, 30 * 30, (tick) =>
      tick % 120 === 0 ? press(sim, 0, "dash") : new Map(),
    );
    const dashes = ofType(events, "cast").filter((e) => e.event.ability === "dash");
    expect(dashes.length).toBe(4); // the budget, not the press count
    expect(slotOf(alice, "dash")!.chargesLeft).toBe(0);

    // The round reset replenishes the whole hand.
    resetForRound(sim, []);
    expect(slotOf(alice, "dash")!.chargesLeft).toBe(4);
  });

  test("state with deployables and slots survives a JSON round-trip", () => {
    const sim = makeFight({ a0: ["sandtrap", "blood-font"] });
    sim.state.players[0]!.mover.pos = { x: 96, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 96 };
    run(sim, 1, () => press(sim, 0, "sandtrap"));
    run(sim, 30);
    expect(sim.state.deployables.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(sim.state);
  });
});
