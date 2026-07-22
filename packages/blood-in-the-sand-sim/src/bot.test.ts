import { describe, expect, test } from "bun:test";
import { speedFactorOf } from "./abilities";
import { ARCHETYPES, botThink, createBotMemory, decideCasts, deriveArchetype, DIFFICULTIES, focusTarget, nearestEnemy, SnapshotHistory } from "./bot";
import type { AbilityId } from "./config";
import { createBotNav, dashClear, navDirection, openDirection } from "./nav";
import type { AbilitySlotSnapshot, DeployableSnapshot, PlayerSnapshot, ProjectileSnapshot, SnapshotMsg } from "./protocol";
import { addPlayer, createSim } from "./sim";
import { ARENA_00 } from "./zone";

// A synthetic 640×640 arena with a U-shaped pocket (open to the LEFT) between
// the bot and its target — the exact geometry a purely local "steer toward"
// brain gets baited into and never leaves. Centre-based Aabbs, like the zone's.
//
//        top arm  ━━━━━━━
//   bot →   (pocket mouth)   back wall ┃   × target
//        bottom arm ━━━━━
const POCKET_ZONE = {
  size: { x: 640, y: 640 },
  collision: [
    { x: 320, y: 240, w: 200, h: 20 }, // top arm
    { x: 320, y: 400, w: 200, h: 20 }, // bottom arm
    { x: 410, y: 320, w: 20, h: 180 }, // back wall, connecting the arms
  ],
};

/** Greedy walker: follow navDirection in fixed steps; true if it gets within
 * `reach` of the goal without ever standing inside a blocker. */
const walksTo = (from: { x: number; y: number }, goal: { x: number; y: number }, targetId = 9): boolean => {
  const nav = createBotNav(POCKET_ZONE);
  const pos = { ...from };
  for (let i = 0; i < 400; i++) {
    const dir = navDirection(nav, targetId, pos, goal);
    pos.x += dir.x * 8;
    pos.y += dir.y * 8;
    for (const b of POCKET_ZONE.collision) {
      if (Math.abs(pos.x - b.x) < b.w / 2 && Math.abs(pos.y - b.y) < b.h / 2) return false;
    }
    if (Math.hypot(goal.x - pos.x, goal.y - pos.y) < 24) return true;
  }
  return false;
};

describe("nav", () => {
  test("routes around a concave pocket instead of into it", () => {
    // Bot at the pocket mouth, target behind the back wall: straight-line
    // steering wedges on the back wall forever; the flow field goes around.
    expect(walksTo({ x: 240, y: 320 }, { x: 520, y: 320 })).toBe(true);
  });

  test("escapes from inside the pocket", () => {
    // Baited all the way in: the way out is back through the mouth, i.e.
    // initially AWAY from the target — the move local steering can't make.
    expect(walksTo({ x: 380, y: 320 }, { x: 520, y: 320 })).toBe(true);
  });

  test("steers straight when nothing blocks", () => {
    const nav = createBotNav(POCKET_ZONE);
    const dir = navDirection(nav, 9, { x: 100, y: 100 }, { x: 200, y: 100 });
    expect(dir).toEqual({ x: 1, y: 0 });
    // The clear path never floods a field — the fast path stays raycast-only.
    expect(nav.fields.size).toBe(0);
  });

  test("the arena edge blocks probes: retreat slides along the boundary", () => {
    // The edge exists only as grid bounds (physics clamps, no collision box)
    // — a kiter pushed against it must not keep grinding outward. From near
    // the east edge, desired straight out: openDirection must rotate to a
    // direction whose probe endpoint stays inside the arena.
    const nav = createBotNav(POCKET_ZONE);
    const from = { x: 620, y: 100 };
    const out = { x: 1, y: 0 };
    const resolved = openDirection(nav, from, out);
    expect(resolved).not.toEqual(out);
    expect(from.x + resolved.x * 48).toBeLessThan(640); // endpoint in bounds
    // And a dash aimed out of the arena is refused outright.
    expect(dashClear(nav, from, out, 75)).toBe(false);
    expect(dashClear(nav, from, { x: -1, y: 0 }, 75)).toBe(true);
  });

  test("openDirection slides along a wall instead of grinding into it", () => {
    const nav = createBotNav(POCKET_ZONE);
    // Just left of the back wall, pushing right into it: the resolved
    // direction must turn away and its own probe must not be the blocked one.
    const from = { x: 380, y: 320 };
    const resolved = openDirection(nav, from, { x: 1, y: 0 });
    expect(resolved.x).toBeLessThan(1);
    expect(Math.hypot(resolved.x, resolved.y)).toBeCloseTo(1, 5);
  });
});

/** Minimal living snapshot — only the fields the brain reads. */
const snap = (over: Partial<PlayerSnapshot>): PlayerSnapshot => ({
  id: 0,
  team: 1,
  name: "t",
  weapon: "blade",
  x: 0,
  y: 0,
  hp: 100,
  maxHp: 100,
  alive: true,
  facing: 0,
  atk: "ready",
  atkLeft: 0,
  lockedFacing: 0,
  dashing: false,
  slowLeft: 0,
  bleedLeft: 0,
  tauntLeft: 0,
  abilities: [],
  reeling: null,
  lastSeq: 0,
  ...over,
});

const slot = (id: AbilityId, over: Partial<AbilitySlotSnapshot> = {}): AbilitySlotSnapshot => ({
  id,
  cd: 0,
  active: 0,
  charges: 2,
  ...over,
});

const deployable = (over: Partial<DeployableSnapshot>): DeployableSnapshot => ({
  id: 100,
  kind: "sandtrap",
  team: 2,
  x: 0,
  y: 0,
  armLeft: 0,
  lifeLeft: 10,
  hp: 0,
  ...over,
});

/** The brain's world view — players plus whatever ground/air the test needs. */
const w = (
  players: PlayerSnapshot[],
  deployables: DeployableSnapshot[] = [],
  projectiles: ProjectileSnapshot[] = [],
) => ({ players, deployables, projectiles });

const arrow = (over: Partial<ProjectileSnapshot>): ProjectileSnapshot => ({
  id: 500,
  x: 0,
  y: 0,
  angle: 0,
  kind: "bow",
  ...over,
});

describe("botThink", () => {
  const nav = createBotNav(POCKET_ZONE);

  test("casts are slot-indexed: dash lands on its slot, wherever it sits", () => {
    const me = snap({
      x: 100,
      y: 100,
      abilities: [slot("mirror-guard"), slot("dash", { charges: 4 })],
    });
    const enemy = snap({ id: 9, team: 2, x: 600, y: 100 });
    // Archetype pinned via the override — a brawler gap-closes with dash.
    const d = botThink(createBotMemory(), me, w([me, enemy]), nav, { archetype: "brawler" });
    expect(d.casts).toEqual([false, true]); // far + clear hop → dash, slot 1
    expect(d.sx).toBeGreaterThan(0);
  });

  test("no dash without charges; idle without a living enemy", () => {
    const me = snap({ abilities: [slot("dash", { charges: 0 })] });
    const enemy = snap({ id: 9, team: 2, x: 600, y: 0 });
    expect(botThink(createBotMemory(), me, w([me, enemy]), nav).casts).toEqual([false]);
    const dead = snap({ id: 9, team: 2, alive: false });
    expect(botThink(createBotMemory(), me, w([me, dead]), nav)).toEqual({ sx: 0, sy: 0, casts: [] });
  });

  test("one proactive press per pacing beat", () => {
    // Harpoon range vs a distant enemy: the first think presses it, the next
    // think may not press another proactive ability until the hold runs out.
    // Godlike tier: castChance 1 makes the press deterministic.
    const memory = createBotMemory();
    const godlike = { difficulty: "godlike" as const };
    const me = snap({ x: 100, y: 100, abilities: [slot("harpoon"), slot("tremor")] });
    const enemy = snap({ id: 9, team: 2, x: 500, y: 100, weapon: "bow" });
    const first = botThink(memory, me, w([me, enemy]), nav, godlike);
    expect(first.casts).toEqual([true, false]);
    // Enemy now point-blank — tremor's rule is satisfied but the beat holds.
    const close = snap({ id: 9, team: 2, x: 150, y: 100 });
    const second = botThink(memory, me, w([me, close]), nav, godlike);
    expect(second.casts).toEqual([false, false]);
  });

  test("nearestEnemy skips teammates and the dead", () => {
    const me = snap({ x: 0, y: 0 });
    const mate = snap({ id: 1, team: 1, x: 10, y: 0 });
    const corpse = snap({ id: 2, team: 2, x: 20, y: 0, alive: false });
    const far = snap({ id: 3, team: 2, x: 300, y: 0 });
    expect(nearestEnemy(me, [me, mate, corpse, far])?.id).toBe(3);
  });
});

describe("archetypes", () => {
  const nav = createBotNav(POCKET_ZONE);

  test("derivation: the loadout IS the archetype", () => {
    expect(deriveArchetype("blade", ["warding-shout", "ironhide"])).toBe("brawler");
    expect(deriveArchetype("hammer", ["ironhide", "warding-shout"])).toBe("juggernaut");
    expect(deriveArchetype("blade", ["dash", "ironhide"])).toBe("duellist");
    expect(deriveArchetype("blade", ["sandtrap", "dash"])).toBe("trapper");
    expect(deriveArchetype("bow", ["dash", "mirror-guard"])).toBe("skirmisher");
    expect(deriveArchetype("bow", ["mirror-guard", "ironhide"])).toBe("sniper");
    expect(deriveArchetype("blade", ["war-drums", "dash"])).toBe("bodyguard"); // melee + support
    expect(deriveArchetype("staff", ["war-drums", "blood-font"])).toBe("bodyguard"); // all-support
    expect(deriveArchetype("blade", ["dash", "harpoon"])).toBe("opportunist");
    expect(deriveArchetype("hammer", ["tremor", "ironhide"])).toBe("trapper"); // traps outrank armour
  });

  test("a skirmisher kites: too close means moving AWAY, and the escape hop", () => {
    const me = snap({
      x: 300,
      y: 300,
      weapon: "bow",
      abilities: [slot("dash", { charges: 4 }), slot("mirror-guard")],
    });
    const enemy = snap({ id: 9, team: 2, x: 350, y: 300, weapon: "blade" });
    const d = botThink(createBotMemory(), me, w([me, enemy]), nav);
    expect(d.sx).toBeLessThan(0); // enemy at +x, well inside the band → retreat
    expect(d.casts[0]).toBe(true); // deep inside near-band → hop out
  });

  test("a bodyguard hunts the diver on its hurt ward, not its own nearest", () => {
    const me = snap({ x: 100, y: 300, weapon: "blade", abilities: [slot("war-drums"), slot("dash")] });
    const ward = snap({ id: 1, team: 1, x: 500, y: 300, hp: 30 });
    const nearMe = snap({ id: 8, team: 2, x: 140, y: 300 });
    const onWard = snap({ id: 9, team: 2, x: 540, y: 300 });
    const players = [me, ward, nearMe, onWard];
    expect(focusTarget(ARCHETYPES.bodyguard, me, players)?.id).toBe(9);
    // Movement agrees: toward the ward's side of the sand (+x), not enemy 8.
    const d = botThink(createBotMemory(), me, w(players), nav);
    expect(d.sx).toBeGreaterThan(0);
  });

  test("an opportunist focuses the weakest and dives once they're low", () => {
    const me = snap({ x: 100, y: 100, weapon: "blade", abilities: [slot("harpoon"), slot("dash")] });
    const weak = snap({ id: 9, team: 2, x: 600, y: 100, hp: 30 });
    const near = snap({ id: 8, team: 2, x: 150, y: 100 });
    expect(focusTarget(ARCHETYPES.opportunist, me, [me, weak, near])?.id).toBe(9);
    const d = botThink(createBotMemory(), me, w([me, weak, near]), nav);
    expect(d.sx).toBeGreaterThan(0); // diving the weak mark, past the near body
  });

  test("last stand: a lone survivor stops fleeing; with a teammate it retreats", () => {
    // A hurt sniper beyond its band: with a living teammate it disengages
    // (away from the enemy at +x); as its team's last body it presses the
    // fight instead — fleeing can only prolong a round it can't win.
    const hurt = snap({
      x: 200,
      y: 100,
      hp: 30, // 0.3 < sniper's disengageBelow 0.5
      weapon: "bow",
      abilities: [slot("mirror-guard"), slot("ironhide")],
    });
    const enemy = snap({ id: 9, team: 2, x: 600, y: 100, weapon: "bow" });
    const mate = snap({ id: 1, team: 1, x: 300, y: 550 });
    const withMate = botThink(createBotMemory(), hurt, w([hurt, mate, enemy]), nav, { difficulty: "godlike" });
    expect(withMate.sx).toBeLessThan(0); // retreating
    const alone = botThink(createBotMemory(), hurt, w([hurt, enemy]), nav, { difficulty: "godlike" });
    expect(alone.sx).toBeGreaterThan(0); // last stand: back into the fight
    const deadMate = snap({ id: 1, team: 1, x: 300, y: 550, alive: false });
    const mateDown = botThink(createBotMemory(), hurt, w([hurt, deadMate, enemy]), nav, { difficulty: "godlike" });
    expect(mateDown.sx).toBeGreaterThan(0); // a corpse is not a teammate
  });

  test("the flee budget: a few seconds of retreat, then it fights wounded", () => {
    // A hurt sniper WITH a teammate (so last-stand doesn't apply) retreats —
    // but only for the budget. Walking the bot (static snapshots trip the
    // unstick slide), it must flee at first and be heading back INTO the
    // fight well before 6 seconds have passed. Healing is the only re-arm.
    const memory = createBotMemory();
    const pos = { x: 400, y: 100 };
    const enemy = snap({ id: 9, team: 2, x: 620, y: 100 });
    const mate = snap({ id: 1, team: 1, x: 100, y: 550 });
    let firstSx = 0;
    let lateSx = 0;
    for (let tick = 0; tick < 180; tick++) {
      const me = snap({ x: pos.x, y: pos.y, hp: 30, weapon: "bow", abilities: [slot("mirror-guard"), slot("ironhide")] });
      const d = botThink(memory, me, w([me, mate, enemy]), nav, { difficulty: "godlike" });
      pos.x = Math.max(30, pos.x + d.sx * 9);
      pos.y = Math.max(30, Math.min(610, pos.y + d.sy * 9));
      if (tick === 0) firstSx = d.sx;
      if (tick === 170) lateSx = d.sx;
    }
    expect(firstSx).toBeLessThan(0); // fleeing the enemy at +x
    expect(memory.fleeSpent).toBe(true); // the allowance burned
    expect(lateSx).toBeGreaterThan(-0.1); // no longer running away
    // Healing re-arms: back above threshold, the trackers reset.
    const healed = snap({ x: pos.x, y: pos.y, hp: 90, weapon: "bow", abilities: [] });
    botThink(memory, healed, w([healed, mate, enemy]), nav, { difficulty: "godlike" });
    expect(memory.fleeSpent).toBe(false);
  });

  test("hostile ground repels: a bot standing in an enemy quake steps out", () => {
    const me = snap({ x: 300, y: 300, weapon: "blade", abilities: [] });
    const enemy = snap({ id: 9, team: 2, x: 600, y: 300 });
    const quake = deployable({ kind: "quake", team: 2, x: 340, y: 300 });
    const d = botThink(createBotMemory(), me, w([me, enemy], [quake]), nav);
    expect(d.sx).toBeLessThan(0.1); // the engage pull is beaten back by the zone push
  });
});

describe("difficulty", () => {
  const nav = createBotNav(POCKET_ZONE);
  const dodgeSetup = () => {
    // Open ground, well clear of the pocket walls — the dash lane must be
    // clear at every wobble angle so casts[0] purely reflects the roll.
    const me = snap({ x: 150, y: 100, weapon: "blade", abilities: [slot("dash", { charges: 4 })] });
    const swinger = snap({ id: 9, team: 2, x: 230, y: 100, weapon: "hammer", atk: "windup" });
    return { me, players: [me, swinger] };
  };

  test("godlike answers every telegraph; novice eats nearly all of them", () => {
    const { me, players } = dodgeSetup();
    const dodges = (difficulty: "godlike" | "novice"): number => {
      let n = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const d = botThink(createBotMemory(seed), me, w(players), nav, { difficulty });
        if (d.casts[0]) n += 1;
      }
      return n;
    };
    expect(dodges("godlike")).toBe(100); // dodgeChance 1
    expect(dodges("novice")).toBeLessThan(20); // dodgeChance 0.05
  });

  test("the dodge roll is per swing, not per tick — a failed roll stays failed", () => {
    // Find a seed whose novice roll fails, then re-think the SAME windup:
    // the bot must not luck into a dodge on a later tick of the same swing.
    const { me, players } = dodgeSetup();
    for (let seed = 1; seed <= 20; seed++) {
      const memory = createBotMemory(seed);
      const first = botThink(memory, me, w(players), nav, { difficulty: "novice" });
      if (first.casts[0]) continue; // this seed dodged; not the case under test
      for (let tick = 0; tick < 5; tick++) {
        expect(botThink(memory, me, w(players), nav, { difficulty: "novice" }).casts[0]).toBe(false);
      }
      return;
    }
    throw new Error("no failing novice seed in 1..20 — dodgeChance drifted?");
  });

  test("cast discipline: novice presses its paced plays far less often", () => {
    const me = snap({ x: 100, y: 100, weapon: "blade", abilities: [slot("harpoon")] });
    const enemy = snap({ id: 9, team: 2, x: 500, y: 100 });
    const presses = (difficulty: "godlike" | "novice"): number => {
      let n = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const d = botThink(createBotMemory(seed), me, w([me, enemy]), nav, { difficulty });
        if (d.casts[0]) n += 1;
      }
      return n;
    };
    expect(presses("godlike")).toBe(100);
    const novice = presses("novice"); // castChance 0.3
    expect(novice).toBeGreaterThan(5);
    expect(novice).toBeLessThan(60);
  });

  test("impatience: a band-holding bot presses in once nothing bleeds", () => {
    // Rounds have no clock — a skirmisher holding its band against a static
    // stand-off must eventually charge. Static snapshots (no hp changes) at
    // band distance: early ticks strafe (no toward component to speak of),
    // and after the stall threshold the intent turns INTO the enemy.
    const memory = createBotMemory();
    const me = snap({ x: 150, y: 100, weapon: "bow", abilities: [slot("dash", { charges: 4 }), slot("mirror-guard")] });
    const enemy = snap({ id: 9, team: 2, x: 400, y: 100, weapon: "bow" }); // dist 250, inside [209, 304]
    const early = botThink(memory, me, w([me, enemy]), nav, { difficulty: "godlike" });
    expect(Math.abs(early.sx)).toBeLessThan(0.6); // holding: strafe dominates
    let pressed = false;
    for (let tick = 0; tick < 260; tick++) {
      const d = botThink(memory, me, w([me, enemy]), nav, { difficulty: "godlike" });
      if (d.sx > 0.6) pressed = true; // charging the enemy at +x (weave adds lateral)
    }
    expect(pressed).toBe(true);
  });

  test("SnapshotHistory serves the world N ticks back, clamped to the oldest", () => {
    const history = new SnapshotHistory();
    const stamped = (n: number): SnapshotMsg =>
      ({ t: "snapshot", tick: n, round: { phase: "fight" }, players: [], projectiles: [], deployables: [], events: [] }) as unknown as SnapshotMsg;
    for (let n = 1; n <= 30; n++) history.push(stamped(n));
    expect((history.stale(0) as unknown as { tick: number }).tick).toBe(30);
    expect((history.stale(8) as unknown as { tick: number }).tick).toBe(22);
    expect((history.stale(100) as unknown as { tick: number }).tick).toBe(7); // 24-deep ring
  });

  test("dither: a novice freezes mid-fight now and then; godlike never", () => {
    const me = snap({ x: 150, y: 100, weapon: "blade", abilities: [] });
    const enemy = snap({ id: 9, team: 2, x: 500, y: 100 });
    const frozenTicks = (difficulty: "novice" | "godlike"): number => {
      const memory = createBotMemory(7);
      let frozen = 0;
      for (let tick = 0; tick < 300; tick++) {
        const d = botThink(memory, me, w([me, enemy]), nav, { difficulty });
        if (d.sx === 0 && d.sy === 0) frozen += 1;
      }
      return frozen;
    };
    expect(frozenTicks("novice")).toBeGreaterThan(0);
    expect(frozenTicks("godlike")).toBe(0);
  });

  test("weave: a high tier serpentines toward a shooter instead of walking the line", () => {
    // Enemy bow at +x, far beyond any band: the approach must carry a real
    // lateral component that CHANGES SIGN (the irregular cut), never against
    // a melee target at the same spot.
    const run = (weapon: "bow" | "blade"): { maxLat: number; flips: boolean } => {
      // The bot actually WALKS (static snapshots trip the unstick fallback,
      // whose perpendicular slide would read as fake weave).
      const memory = createBotMemory(3);
      const pos = { x: 150, y: 100 }; // open lane, clear of the pocket walls
      const enemy = snap({ id: 9, team: 2, x: 600, y: 100, weapon });
      let maxLat = 0;
      let sawPos = false;
      let sawNeg = false;
      for (let tick = 0; tick < 30; tick++) {
        const me = snap({ x: pos.x, y: pos.y, weapon: "blade", abilities: [] });
        const d = botThink(memory, me, w([me, enemy]), nav, { difficulty: "masterful" });
        pos.x += d.sx * 9;
        pos.y += d.sy * 9;
        maxLat = Math.max(maxLat, Math.abs(d.sy));
        if (d.sy > 0.2) sawPos = true;
        if (d.sy < -0.2) sawNeg = true;
      }
      return { maxLat, flips: sawPos && sawNeg };
    };
    const vsBow = run("bow");
    expect(vsBow.maxLat).toBeGreaterThan(0.4);
    expect(vsBow.flips).toBe(true);
    expect(run("blade").maxLat).toBeLessThan(0.25); // straight charge stays straight
  });

  test("smartDodge: the dash waits for the arrow and hops perpendicular", () => {
    const me = snap({ x: 150, y: 100, weapon: "blade", abilities: [slot("dash", { charges: 4 })] });
    const early = snap({ id: 9, team: 2, x: 350, y: 100, weapon: "bow", atk: "windup", atkLeft: 0.4 });
    const held = botThink(createBotMemory(), me, w([me, early]), nav, { difficulty: "godlike" });
    expect(held.casts[0]).toBe(false); // shot not close to loosing — hold the dash
    const late = snap({ id: 9, team: 2, x: 350, y: 100, weapon: "bow", atk: "windup", atkLeft: 0.1 });
    const dodge = botThink(createBotMemory(), me, w([me, late]), nav, { difficulty: "godlike" });
    expect(dodge.casts[0]).toBe(true); // now — dodge by displacement
    expect(Math.abs(dodge.sy)).toBeGreaterThan(0.8); // perpendicular to the shot line
  });

  test("in-flight evasion: a smart tier steps off the arrow's line, dashes when it's imminent", () => {
    // Arrow flying -x, dead-on at the bot: far out (eta ~0.31s) the feet
    // move perpendicular but the dash is held; close in (eta ~0.12s) it
    // spends the hop. A tier without smartDodge is blind to the air.
    const me = snap({ x: 300, y: 100, weapon: "blade", abilities: [slot("dash", { charges: 4 })] });
    const enemy = snap({ id: 9, team: 2, x: 600, y: 100 });
    const farShot = arrow({ x: 500, y: 100, angle: Math.PI });
    const evade = botThink(createBotMemory(), me, w([me, enemy], [], [farShot]), nav, { difficulty: "godlike" });
    expect(Math.abs(evade.sy)).toBeGreaterThan(0.8); // off the line
    expect(evade.casts[0]).toBe(false); // hop held
    const nearShot = arrow({ x: 380, y: 100, angle: Math.PI });
    const dodge = botThink(createBotMemory(), me, w([me, enemy], [], [nearShot]), nav, { difficulty: "godlike" });
    expect(Math.abs(dodge.sy)).toBeGreaterThan(0.8);
    expect(dodge.casts[0]).toBe(true); // imminent — spend it
    const blind = botThink(createBotMemory(), me, w([me, enemy], [], [nearShot]), nav, { difficulty: "skilled" });
    expect(Math.abs(blind.sy)).toBeLessThan(0.4); // no in-flight model down here
  });

  test("dash-down punish: a duellist surges when the target's escape is spent", () => {
    // In-band a duellist normally holds and strafes; the target's dash on
    // cooldown flips it into the punish charge (public cooldown clocks).
    const me = snap({ x: 300, y: 100, weapon: "blade", abilities: [slot("dash", { charges: 4 }), slot("ironhide")] });
    const escapeUp = snap({ id: 9, team: 2, x: 400, y: 100, abilities: [slot("dash")] });
    const hold = botThink(createBotMemory(), me, w([me, escapeUp]), nav, { difficulty: "godlike" });
    expect(hold.sx).toBeLessThan(0.6); // holding the band, strafing
    const escapeDown = snap({ id: 9, team: 2, x: 400, y: 100, abilities: [slot("dash", { cd: 2.5 })] });
    const surge = botThink(createBotMemory(), me, w([me, escapeDown]), nav, { difficulty: "godlike" });
    expect(surge.sx).toBeGreaterThan(0.7); // the punish window
  });

  test("focus fire: top tiers hunt the weakest, not the nearest", () => {
    const me = snap({ x: 300, y: 100, weapon: "blade", abilities: [] });
    const strongNear = snap({ id: 8, team: 2, x: 120, y: 100 }); // -x, closer
    const weakFar = snap({ id: 9, team: 2, x: 600, y: 100, hp: 20 }); // +x
    const players = [me, strongNear, weakFar];
    const godlike = botThink(createBotMemory(), me, w(players), nav, { difficulty: "godlike" });
    expect(godlike.sx).toBeGreaterThan(0); // toward the kill at +x
    const skilled = botThink(createBotMemory(), me, w(players), nav, { difficulty: "skilled" });
    expect(skilled.sx).toBeLessThan(0); // dogpiles the nearest at -x
  });

  test("dash economy: the last hop is never spent gap-closing a shooter", () => {
    const enemy = snap({ id: 9, team: 2, x: 640, y: 100, weapon: "bow" });
    const lastCharge = snap({ x: 150, y: 100, weapon: "blade", abilities: [slot("dash", { charges: 1 })] });
    const held = botThink(createBotMemory(), lastCharge, w([lastCharge, enemy]), nav, { archetype: "brawler", difficulty: "godlike" });
    expect(held.casts[0]).toBe(false); // reserve it for the dodge
    const flush = snap({ x: 150, y: 100, weapon: "blade", abilities: [slot("dash", { charges: 4 })] });
    const spend = botThink(createBotMemory(), flush, w([flush, enemy]), nav, { archetype: "brawler", difficulty: "godlike" });
    expect(spend.casts[0]).toBe(true); // plenty left — close the gap
  });

  test("the top tiers run hot: moveFactor multiplies into the speed stack", () => {
    const sim = createSim(ARENA_00, 42);
    const p = addPlayer(sim, "hotshot")!;
    expect(speedFactorOf(p, [p])).toBe(1);
    p.moveFactor = DIFFICULTIES.godlike.speedFactor;
    expect(speedFactorOf(p, [p])).toBeCloseTo(1.1, 5);
  });
});

describe("cast rules", () => {
  const at = (x: number, over: Partial<PlayerSnapshot> = {}): PlayerSnapshot =>
    snap({ id: 9, team: 2, x, y: 0, ...over });

  test("mirror-guard answers a ranged windup aimed at me — even mid-hold", () => {
    const me = snap({ abilities: [slot("mirror-guard")] });
    const bowman = at(200, { weapon: "bow", atk: "windup" });
    expect(decideCasts(me, bowman, [me, bowman], [], false)).toBe("mirror-guard");
    // Not against a melee windup, not when the shot can't threaten yet.
    const brawler = at(200, { weapon: "blade", atk: "windup" });
    expect(decideCasts(me, brawler, [me, brawler], [], true)).toBe(null);
    expect(decideCasts(me, at(500, { weapon: "bow", atk: "windup" }), [me], [], true)).toBe(null);
  });

  test("ironhide tanks a telegraph only when no dash is up", () => {
    const withDash = snap({ abilities: [slot("ironhide"), slot("dash")] });
    const noDash = snap({ abilities: [slot("ironhide"), slot("dash", { cd: 2 })] });
    const swinger = at(100, { weapon: "hammer", atk: "windup" });
    expect(decideCasts(withDash, swinger, [withDash, swinger], [], true)).toBe(null);
    expect(decideCasts(noDash, swinger, [noDash, swinger], [], true)).toBe("ironhide");
  });

  test("warding-shout peels when hurt with an enemy in the cone", () => {
    const hurt = snap({ hp: 40, abilities: [slot("warding-shout")] });
    const healthy = snap({ hp: 100, abilities: [slot("warding-shout")] });
    expect(decideCasts(hurt, at(100), [hurt], [], true)).toBe("warding-shout");
    expect(decideCasts(healthy, at(100), [healthy], [], true)).toBe(null);
  });

  test("blood-font pours only when low, at range, on clean ground", () => {
    const low = snap({ hp: 30, abilities: [slot("blood-font", { charges: 1 })] });
    expect(decideCasts(low, at(400), [low], [], true)).toBe("blood-font");
    expect(decideCasts(low, at(100), [low], [], true)).toBe(null); // mid-melee: no pour
    const quaked = [deployable({ kind: "quake", team: 2, x: 30, y: 0 })];
    expect(decideCasts(low, at(400), [low], quaked, true)).toBe(null); // fouled ground
  });

  test("harpoon drags a kiter holding the range my weapon can't start at", () => {
    const me = snap({ weapon: "blade", abilities: [slot("harpoon")] });
    expect(decideCasts(me, at(400), [me], [], true)).toBe("harpoon");
    expect(decideCasts(me, at(80), [me], [], true)).toBe(null); // already in reach
  });

  test("sandtrap seeds the gap once — no churn while a mine is down", () => {
    const me = snap({ abilities: [slot("sandtrap")] });
    expect(decideCasts(me, at(250), [me], [], true)).toBe("sandtrap");
    const mined = [deployable({ kind: "sandtrap", team: 1, x: 50, y: 0 })];
    expect(decideCasts(me, at(250), [me], mined, true)).toBe(null);
  });

  test("war drums beat for a nearby pack", () => {
    const me = snap({ abilities: [slot("war-drums")] });
    const mate = snap({ id: 1, team: 1, x: 100, y: 0 });
    expect(decideCasts(me, at(200), [me, mate], [], true)).toBe("war-drums");
    expect(decideCasts(me, at(200), [me], [], true)).toBe(null); // alone, enemy close
  });
});
