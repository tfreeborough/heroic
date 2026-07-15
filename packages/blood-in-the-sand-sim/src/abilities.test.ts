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
  setPlayerAbilities(sim, 0, opts.a0 ?? ["dash", "tremor", "sandstorm"]);
  setPlayerAbilities(sim, 1, opts.a1 ?? ["dash", "tremor", "sandstorm"]);
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

describe("tremor", () => {
  test("slams every enemy in radius for fixed damage + a shove; spares the far", () => {
    const sim = makeFight();
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 280, y: 256 }; // edge dist 62 < 110

    const events = run(sim, 1, () => press(sim, 0, "tremor"));
    const hits = ofType(events, "hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.event.damage).toBe(TREMOR.damage);
    expect(hits[0]!.event.crit).toBe(false);
    expect(hp(sim, 1)).toBe(100 - TREMOR.damage);
    expect(sim.state.players[1]!.mover.vel.x).toBeGreaterThan(TREMOR.knockback * 0.8); // hurled east

    // Far enemy: same cast, nobody in radius.
    const far = makeFight();
    far.state.players[0]!.mover.pos = { x: 96, y: 96 };
    far.state.players[1]!.mover.pos = { x: 416, y: 450 };
    const quiet = run(far, 1, () => press(far, 0, "tremor"));
    expect(ofType(quiet, "hit")).toHaveLength(0);
    expect(ofType(quiet, "cast")).toHaveLength(1); // it still fired — just hit air
  });

  test("dash i-frames dodge the slam entirely", () => {
    const sim = makeFight();
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 280, y: 256 };
    slotOf(sim.state.players[1]!, "dash")!.invulnLeft = 999;
    const events = run(sim, 1, () => press(sim, 0, "tremor"));
    expect(ofType(events, "hit")).toHaveLength(0);
    expect(hp(sim, 1)).toBe(100);
  });
});

describe("sandtrap", () => {
  test("arms over 2s, then detonates on the first enemy in trigger range", () => {
    const sim = makeFight({ a0: ["sandtrap", "dash", "tremor"] });
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
    const sim = makeFight({ a0: ["sandtrap", "dash", "tremor"] });
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
    const sim = makeFight({ a0: ["harpoon", "dash", "tremor"] });
    // Corner to corner: ~611px apart — past even the harpoon's own 550 reach.
    sim.state.players[0]!.mover.pos = { x: 40, y: 40 };
    sim.state.players[1]!.mover.pos = { x: 472, y: 472 };
    const events = run(sim, 3, () => press(sim, 0, "harpoon"));
    expect(ofType(events, "cast")).toHaveLength(0);
    expect(slotOf(sim.state.players[0]!, "harpoon")!.ability.phase).toBe("ready");
  });

  test("acquires its OWN mark past the weapon's lock-on distance", () => {
    const sim = makeFight({ a0: ["harpoon", "dash", "tremor"] }); // blade: 250 engagement
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
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash", "tremor"] });
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
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash", "tremor"] });
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
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash", "tremor"] });
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
    const sim = makeFight({ w0: "bow", w1: "bow", a0: ["harpoon", "dash", "tremor"], a1: ["ironhide", "dash", "tremor"] });
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

  test("Mirror Guard reflects the chain — the CASTER eats the barb and the drag", () => {
    const sim = makeFight({
      w0: "bow", w1: "bow",
      a0: ["harpoon", "dash", "tremor"],
      a1: ["mirror-guard", "dash", "tremor"],
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
    expect(bob.mover.pos.x).toBeCloseTo(300, 0); // the guard never moves…
    const gap = Math.hypot(alice.mover.pos.x - bob.mover.pos.x, alice.mover.pos.y - bob.mover.pos.y);
    expect(gap).toBeLessThan(HARPOON.pullGap + 15); // …the caster gets yanked in
  });
});

describe("mirror guard", () => {
  test("a shot that hits the guard flips ownership and returns to its shooter", () => {
    const sim = makeFight({ w0: "bow", w1: "bow" , a1: ["mirror-guard", "dash", "tremor"] });
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
      const sim = makeFight({ a1: iron ? ["ironhide", "dash", "tremor"] : undefined });
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
    const sim = makeFight({ w0: "hammer", a1: ["ironhide", "dash", "tremor"] });
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

  test("shrugs off tremor's knockback (but still takes reduced damage)", () => {
    const sim = makeFight({ a1: ["ironhide", "dash", "tremor"] });
    const bob = sim.state.players[1]!;
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    bob.mover.pos = { x: 280, y: 256 };
    forceActive(bob, "ironhide", 999);
    run(sim, 1, () => press(sim, 0, "tremor"));
    expect(hp(sim, 1)).toBe(100 - Math.max(1, Math.round(TREMOR.damage * IRONHIDE.damageTakenFactor)));
    expect(Math.abs(bob.mover.vel.x)).toBeLessThan(1); // never hurled
  });
});

describe("straw man", () => {
  test("the decoy joins the target pool, soaks hits, and breaks", () => {
    const sim = makeFight({ a1: ["straw-man", "dash", "tremor"] });
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
    const sim = makeFight({ a1: ["straw-man", "dash", "tremor"] });
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
    const sim = makeFight({ a0: ["war-drums", "dash", "tremor"] });
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
    const sim = makeFight({ a0: ["blood-font", "dash", "tremor"] });
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
    const sim = makeFight({ a0: ["blood-font", "dash", "tremor"] });
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
    const sim = makeFight({ w0: "bow", w1: "bow", a1: ["sandstorm", "dash", "tremor"] });
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
    const sim = makeFight({ w0: "bow", a1: ["sandstorm", "dash", "tremor"] });
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
    const sim = makeFight({ a0: ["sandtrap", "blood-font", "sandstorm"] });
    sim.state.players[0]!.mover.pos = { x: 96, y: 400 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 96 };
    run(sim, 1, () => press(sim, 0, "sandtrap"));
    run(sim, 30);
    expect(sim.state.deployables.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(sim.state))).toEqual(sim.state);
  });
});
