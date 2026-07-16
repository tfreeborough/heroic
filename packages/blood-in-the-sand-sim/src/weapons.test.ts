import { describe, expect, test } from "bun:test";
import type { ZoneFile } from "@heroic/core";
import { TICK_DT, WEAPONS, type WeaponId } from "./config";
import type { ArenaEvent } from "./events";
import { resetForRound, startMatch } from "./round";
import { addPlayer, createSim, setPlayerAbilities, setPlayerWeapon, type ArenaSim } from "./sim";
import { slotOf, type ArenaProjectile, type PlayerInput } from "./state";
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

/** Two seated players with the given picks, forced straight into a fight. */
const makeFight = (w0: WeaponId, w1: WeaponId, seed = 0xb100d): ArenaSim => {
  const sim = createSim(makeZone(), seed);
  addPlayer(sim, "alice");
  addPlayer(sim, "bob");
  setPlayerWeapon(sim, 0, w0);
  setPlayerWeapon(sim, 1, w1);
  // Dash in slot 0 so the i-frame forcings below have a slot to poke.
  setPlayerAbilities(sim, 0, ["dash", "tremor"]);
  setPlayerAbilities(sim, 1, ["dash", "tremor"]);
  sim.state.round.phase = "active";
  return sim;
};

type InputsFor = (tick: number, sim: ArenaSim) => ReadonlyMap<number, PlayerInput>;

interface Stamped {
  tick: number;
  event: ArenaEvent;
}

const run = (sim: ArenaSim, ticks: number, inputsFor?: InputsFor): Stamped[] => {
  const out: Stamped[] = [];
  for (let i = 0; i < ticks; i++) {
    const tick = sim.state.tick;
    const events = stepSim(sim, inputsFor?.(tick, sim) ?? new Map(), TICK_DT);
    for (const event of events) out.push({ tick, event });
  }
  return out;
};

const ofType = <T extends ArenaEvent["type"]>(events: Stamped[], type: T) =>
  events.filter((e): e is Stamped & { event: Extract<ArenaEvent, { type: T }> } => e.event.type === type);

const hitsBy = (events: Stamped[], attackerId: number) =>
  ofType(events, "hit").filter((h) => h.event.attackerId === attackerId && !h.event.bleed);

/** A hand-rolled shot for the mechanics tests below. */
const shot = (over: Partial<ArenaProjectile>): ArenaProjectile => ({
  pos: { x: 0, y: 0 },
  dir: { x: 1, y: 0 },
  speed: 520,
  radius: 6,
  traveled: 0,
  maxRange: 400,
  pierceLeft: 0,
  hitIds: [],
  turnRate: 0,
  turnLeft: 0,
  id: 999,
  ownerId: 0,
  kind: "bow",
  targetId: null,
  ...over,
});

describe("weapon picking", () => {
  test("the pick overlays the weapon's stats and refills hp", () => {
    const sim = createSim(makeZone(), 1);
    addPlayer(sim, "alice");
    const p = sim.state.players[0]!;
    p.combatant.hp = 40; // pre-pick damage is irrelevant — lobby only
    expect(setPlayerWeapon(sim, 0, "bow")).toBe(true);
    expect(p.weapon).toBe("bow");
    expect(p.combatant.stats.attack).toBe(20);
    expect(p.combatant.hp).toBe(p.combatant.stats.maxHp);
    // Repick freely in the lobby.
    expect(setPlayerWeapon(sim, 0, "hammer")).toBe(true);
    expect(p.combatant.stats.attack).toBe(WEAPONS.hammer.stats.attack!);
  });

  test("weapon stats survive round resets (maxHp reread each round)", () => {
    const sim = createSim(makeZone(), 1);
    addPlayer(sim, "alice");
    addPlayer(sim, "bob");
    setPlayerWeapon(sim, 0, "bow");
    setPlayerWeapon(sim, 1, "blade");
    expect(startMatch(sim, [])).toBe(true);
    expect(sim.state.players[0]!.combatant.stats.attack).toBe(20);
    expect(sim.state.players[0]!.combatant.hp).toBe(100);
  });
});

describe("bow", () => {
  test("duels at range: shots spawn, fly, and land without melee contact", () => {
    const sim = makeFight("bow", "bow");
    // 250px apart on a clear line — far beyond any melee reach.
    sim.state.players[0]!.mover.pos = { x: 96, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 346, y: 256 };

    let sawShot = false;
    const events: Stamped[] = [];
    for (let i = 0; i < 120; i++) {
      const tick = sim.state.tick;
      for (const event of stepSim(sim, new Map(), TICK_DT)) events.push({ tick, event });
      if (sim.state.projectiles.length > 0) sawShot = true;
    }
    expect(sawShot).toBe(true);
    expect(hitsBy(events, 0).length).toBeGreaterThan(0);
    expect(hitsBy(events, 1).length).toBeGreaterThan(0);
    // Windup (0.5s) + flight (~0.4s) gates the first hit — nothing is instant.
    expect(ofType(events, "hit")[0]!.tick).toBeGreaterThan(20);
  });

  test("dash i-frames let the defender pass through an arrow untouched", () => {
    const sim = makeFight("bow", "blade");
    sim.state.players[0]!.mover.pos = { x: 96, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 346, y: 256 };
    slotOf(sim.state.players[1]!, "dash")!.invulnLeft = 999; // i-frames cover every flight
    const events = run(sim, 90);
    expect(hitsBy(events, 0)).toHaveLength(0);
    expect(sim.state.players[1]!.combatant.hp).toBe(100);
  });

  test("walls stop shots", () => {
    const sim = makeFight("blade", "blade"); // blades: nobody in engagement range
    // Aimed square at the pillar (edge at x=224) from 24px away → dead in ~1 tick.
    sim.state.projectiles.push(shot({ pos: { x: 200, y: 128 } }));
    const events = run(sim, 5);
    expect(sim.state.projectiles).toHaveLength(0);
    expect(ofType(events, "hit")).toHaveLength(0);
  });

  test("a shot with nothing to hit expires at max range, not before", () => {
    const sim = makeFight("blade", "blade");
    // Down the open south lane: nothing between (40,450) and the east wall.
    sim.state.projectiles.push(shot({ pos: { x: 40, y: 450 }, maxRange: 300 }));
    run(sim, 10); // 520px/s → ~17px/tick → alive through tick 17
    expect(sim.state.projectiles).toHaveLength(1);
    run(sim, 15);
    expect(sim.state.projectiles).toHaveLength(0);
  });
});

describe("staff", () => {
  test("the orb steers toward its target mid-flight", () => {
    const sim = makeFight("blade", "blade");
    sim.state.players[1]!.mover.pos = { x: 300, y: 400 }; // south-east of the shot line
    sim.state.projectiles.push(
      shot({ pos: { x: 96, y: 256 }, kind: "staff", speed: 300, radius: 10, targetId: 1 }),
    );
    run(sim, 6);
    const orb = sim.state.projectiles.find((p) => p.id === 999);
    expect(orb).toBeDefined();
    expect(orb!.dir.y).toBeGreaterThan(0.1); // bent toward the target below the line
  });

  test("the orb runs down a perpendicular strafer", () => {
    const sim = makeFight("staff", "blade", 7);
    sim.state.players[0]!.mover.pos = { x: 96, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 330, y: 256 };
    // Bob strafes straight south at full speed, forever.
    const events = run(sim, 300, () => new Map([[1, { seq: 0, sx: 0, sy: 1, casts: [] }]]));
    expect(hitsBy(events, 0).length).toBeGreaterThan(0);
  });
});

describe("hammer", () => {
  /** One-sided duel: the attacker's permanent i-frames mute the defender. */
  const measure = (weapon: WeaponId) => {
    const sim = makeFight(weapon, "blade", 3);
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 260, y: 256 };
    slotOf(sim.state.players[0]!, "dash")!.invulnLeft = 999;

    const damages: number[] = [];
    let velAtFirstHit = 0;
    for (let i = 0; i < 400 && damages.length < 4; i++) {
      const events = stepSim(sim, new Map(), TICK_DT);
      for (const e of events) {
        if (e.type === "hit" && e.attackerId === 0 && !e.bleed) {
          damages.push(e.damage);
          if (damages.length === 1) {
            const v = sim.state.players[1]!.mover.vel;
            velAtFirstHit = Math.hypot(v.x, v.y);
          }
          // Undo any knockback drift so every swing is measured from the
          // same spot (and heal chip damage out of the comparison's way).
          sim.state.players[1]!.mover.pos = { x: 260, y: 256 };
          sim.state.players[1]!.mover.vel = { x: 0, y: 0 };
        }
      }
    }
    return { perHit: damages[0] ?? 0, hits: damages.length, velAtFirstHit };
  };

  test("hits far harder than the blade and slows instead of launching", () => {
    const hammer = measure("hammer");
    const blade = measure("blade");
    expect(hammer.hits).toBe(4);
    expect(blade.hits).toBe(4);
    expect(hammer.perHit).toBeGreaterThan(blade.perHit);
    // No knockback at all — the blade's residual 100 px/s shove out-launches it.
    expect(hammer.velAtFirstHit).toBeLessThan(blade.velAtFirstHit);
  });

  test("a hit applies the movement slow; it caps run speed, then expires", () => {
    const sim = makeFight("hammer", "blade", 3);
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 280, y: 256 };
    slotOf(sim.state.players[0]!, "dash")!.invulnLeft = 999;

    // Swing until the first hammer hit lands.
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) {
      hit = stepSim(sim, new Map(), TICK_DT).some(
        (e) => e.type === "hit" && e.attackerId === 0,
      );
    }
    expect(hit).toBe(true);
    const bob = sim.state.players[1]!;
    expect(bob.slowLeft).toBeCloseTo(WEAPONS.hammer.slow!.duration, 1);

    // Park the fighters apart so nothing else lands, then run bob flat out.
    sim.state.players[0]!.mover.pos = { x: 64, y: 64 };
    bob.mover.pos = { x: 416, y: 420 };
    bob.mover.vel = { x: 0, y: 0 };
    const sprint = new Map([[1, { seq: 0, sx: 1, sy: 0, casts: [] }]]);
    run(sim, 15, () => sprint); // 0.5s — plenty to reach the (slowed) cap
    const slowedSpeed = Math.hypot(bob.mover.vel.x, bob.mover.vel.y);
    expect(slowedSpeed).toBeLessThan(280 * WEAPONS.hammer.slow!.factor + 5);

    run(sim, 60, () => sprint); // 2s more — the 1.5s slow has expired
    expect(bob.slowLeft).toBe(0);
    expect(Math.hypot(bob.mover.vel.x, bob.mover.vel.y)).toBeGreaterThan(270);
  });
});

describe("bleed", () => {
  test("a dot ticks its fixed damage on the interval, flagged for the client", () => {
    const sim = makeFight("blade", "blade");
    // Parked out of engagement range so nothing else swings.
    sim.state.players[0]!.mover.pos = { x: 96, y: 96 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 450 };
    sim.state.players[1]!.dots.push({ ticksLeft: 3, tLeft: 1, interval: 1, damage: 3, sourceId: 0 });

    const events = run(sim, 120); // 4 simulated seconds
    const bleeds = ofType(events, "hit").filter((h) => h.event.bleed);
    expect(bleeds).toHaveLength(3);
    for (const b of bleeds) {
      expect(b.event.damage).toBe(3);
      expect(b.event.crit).toBe(false);
      expect(b.event.attackerId).toBe(0);
      expect(b.event.targetId).toBe(1);
    }
    // ~1s apart at 30Hz.
    expect(bleeds[1]!.tick - bleeds[0]!.tick).toBe(30);
    expect(bleeds[2]!.tick - bleeds[1]!.tick).toBe(30);
    expect(sim.state.players[1]!.combatant.hp).toBe(91);
    expect(sim.state.players[1]!.dots).toHaveLength(0);
  });

  test("a bleed tick can kill — and scores the round like any other death", () => {
    const sim = makeFight("blade", "blade");
    sim.state.players[0]!.mover.pos = { x: 96, y: 96 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 450 };
    sim.state.players[1]!.combatant.hp = 2;
    sim.state.players[1]!.dots.push({ ticksLeft: 3, tLeft: 0.1, interval: 1, damage: 3, sourceId: 0 });

    const events = run(sim, 30);
    const bleeds = ofType(events, "hit").filter((h) => h.event.bleed);
    expect(bleeds).toHaveLength(1); // death clears the remaining ticks
    expect(bleeds[0]!.event.lethal).toBe(true);
    expect(ofType(events, "death")).toHaveLength(1);
    expect(ofType(events, "roundEnd")[0]!.event.winnerTeam).toBe(1);
  });

  test("blade hits actually proc bleeds in a real duel", () => {
    const sim = makeFight("blade", "blade", 0xfeed);
    sim.state.players[0]!.mover.pos = { x: 200, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 260, y: 256 };
    slotOf(sim.state.players[0]!, "dash")!.invulnLeft = 999; // one-sided, so bob just soaks
    const events = run(sim, 600);
    expect(ofType(events, "hit").filter((h) => h.event.bleed).length).toBeGreaterThan(0);
  });

  test("round reset clears dots, slows, and projectiles", () => {
    const sim = makeFight("blade", "blade");
    sim.state.players[1]!.dots.push({ ticksLeft: 3, tLeft: 1, interval: 1, damage: 3, sourceId: 0 });
    sim.state.players[1]!.slowLeft = 1.5;
    sim.state.projectiles.push(shot({ pos: { x: 40, y: 450 } }));
    resetForRound(sim, []);
    expect(sim.state.players[1]!.dots).toHaveLength(0);
    expect(sim.state.players[1]!.slowLeft).toBe(0);
    expect(sim.state.projectiles).toHaveLength(0);
  });
});

describe("per-weapon engagement", () => {
  test("a bow acquires at a range the blade ignores", () => {
    const sim = makeFight("bow", "blade");
    sim.state.players[0]!.mover.pos = { x: 96, y: 256 };
    sim.state.players[1]!.mover.pos = { x: 416, y: 256 }; // 320 apart
    run(sim, 3);
    expect(sim.state.players[0]!.targetId).toBe(1); // bow: 380 engagement
    expect(sim.state.players[1]!.targetId).toBeNull(); // blade: 270 engagement
  });
});
