/**
 * Bot brains v4 — the un-trickable pass (docs/design/bot-brains-v4.md).
 * Unit tests for the knowledge tables + strike predictor, and the exploit
 * gauntlet's hard gates: the tricks that used to beat Godlike must stay dead.
 */
import { describe, expect, test } from "bun:test";
import { runMatch, SETUPS } from "./botGauntlet";
import { botThink, createBotMemory, decideCasts, focusTarget, ARCHETYPES } from "./bot";
import { HAZARDS, THREAT_KINDS, hazardOf, incomingShell, meleeSpacing, strikeBand } from "./botThreats";
import { WEAPON_IDS, type AbilityId } from "./config";
import { createBotNav } from "./nav";
import type { AbilitySlotSnapshot, DeployableSnapshot, PlayerSnapshot, ShellSnapshot } from "./protocol";

const OPEN = createBotNav({ size: { x: 2000, y: 2000 }, collision: [] });

const snap = (over: Partial<PlayerSnapshot>): PlayerSnapshot => ({
  id: 0,
  team: 1,
  name: "t",
  weapon: "blade",
  x: 1000,
  y: 1000,
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
  poisonLeft: 0,
  poisonStacks: 0,
  beamTargetId: null,
  beamLink: 0,
  tauntLeft: 0,
  abilities: [],
  reeling: null,
  lastSeq: 0,
  ...over,
});
const slot = (id: AbilityId, over: Partial<AbilitySlotSnapshot> = {}): AbilitySlotSnapshot => ({ id, cd: 0, active: 0, charges: 4, ...over });
const mine = (over: Partial<DeployableSnapshot>): DeployableSnapshot => ({ id: 100, kind: "sandtrap", team: 2, x: 0, y: 0, armLeft: 0, lifeLeft: 10, hp: 0, ...over });
const shell = (over: Partial<ShellSnapshot>): ShellSnapshot => ({ id: 700, fx: 0, fy: 0, tx: 1000, ty: 1000, landIn: 0.7, total: 0.9, blast: 120, ...over } as ShellSnapshot);
const DASH_IRON = [slot("dash"), slot("ironhide")];

describe("knowledge tables", () => {
  test("every weapon and every deployable has an entry the brain can read", () => {
    for (const id of WEAPON_IDS) expect(THREAT_KINDS[id]).toBeDefined();
    expect(Object.keys(HAZARDS).sort()).toEqual(["blood-font", "quake", "sandstorm", "sandtrap", "sinkhole", "straw-man", "tar"]);
  });

  test("an ARMING mine is already a hazard; spare-no-one ground binds its own team", () => {
    const me = snap({});
    expect(hazardOf(mine({ armLeft: 1.5 }), me)).not.toBeNull();
    expect(hazardOf(mine({ team: 1 }), me)).toBeNull(); // my own mine is safe
    expect(hazardOf(mine({ kind: "sinkhole", team: 1 }), me)).not.toBeNull();
    expect(hazardOf(mine({ kind: "tar", team: 1 }), me)).not.toBeNull();
    expect(hazardOf(mine({ kind: "blood-font" }), me)).toBeNull();
  });

  test("strike bands follow step.ts's rim rule, dead zone and titan scale included", () => {
    const me = snap({});
    expect(strikeBand(snap({ weapon: "hammer" }), me)).toEqual({ near: 0, far: 143 });
    expect(strikeBand(snap({ weapon: "trident" }), me)).toEqual({ near: 97, far: 198 });
    expect(strikeBand(snap({ weapon: "bow" }), me)).toBeNull();
    const titan = snap({ weapon: "hammer", abilities: [slot("titans-draught", { active: 3 })] });
    expect(strikeBand(titan, me)!.far).toBe(125 * 1.6 + 18);
  });

  test("spacing: out-reach → hold my edge; dead zone → hug; thin edge or shooter → contact", () => {
    const hammer = snap({ weapon: "hammer" });
    const vsBlade = meleeSpacing(hammer, snap({ weapon: "blade" }))!;
    expect(vsBlade.near).toBeGreaterThan(108); // outside the blade's reach
    expect(vsBlade.far).toBeLessThan(143); // inside my own
    expect(meleeSpacing(snap({ weapon: "blade" }), snap({ weapon: "fang" }))).toBeNull(); // 30px: just slog
    expect(meleeSpacing(snap({ weapon: "blade" }), snap({ weapon: "hammer" }))).toBeNull();
    expect(meleeSpacing(hammer, snap({ weapon: "bow" }))).toBeNull();
    const hugTrident = meleeSpacing(snap({ weapon: "blade" }), snap({ weapon: "trident" }))!;
    expect(hugTrident.near).toBe(0);
    expect(hugTrident.far).toBeLessThan(97);
    expect(meleeSpacing(hammer, snap({ weapon: "bombard" }))!.far).toBeLessThan(102);
  });

  test("a shell's ring is only a threat from inside it", () => {
    expect(incomingShell(snap({}), [shell({})])!.exitDist).toBeGreaterThan(120);
    expect(incomingShell(snap({ x: 1200 }), [shell({})])).toBeNull();
  });
});

describe("strike predictor", () => {
  const dashed = (d: { casts: boolean[] }) => d.casts[0] === true;

  test("godlike holds the dash until the blow is about to land; sloppy tiers mistime the same read", () => {
    const me = snap({ weapon: "blade", abilities: DASH_IRON });
    const swing = (atkLeft: number) => snap({ id: 9, team: 2, weapon: "hammer", x: 1090, atk: "windup", atkLeft });
    const godlike = (atkLeft: number) => {
      const foe = swing(atkLeft);
      return botThink(createBotMemory(3), me, { players: [me, foe], deployables: [], projectiles: [] }, OPEN, { difficulty: "godlike" });
    };
    expect(dashed(godlike(0.6))).toBe(false); // 0.2s of i-frames would be long gone
    expect(dashed(godlike(0.12))).toBe(true); // now they straddle the strike
    // Same predictor, worse hands: a sloppy tier's timing error sometimes
    // fires the hop this early — the old panic dash, now a graded mistake.
    let early = false;
    for (let seed = 1; seed < 300 && !early; seed++) {
      const foe = swing(0.6);
      early = dashed(botThink(createBotMemory(seed), me, { players: [me, foe], deployables: [], projectiles: [] }, OPEN, { difficulty: "experienced" }));
    }
    expect(early).toBe(true);
  });

  test("a whiff costs nothing: outside the band, no dash, no ironhide", () => {
    const me = snap({ weapon: "hammer", abilities: DASH_IRON });
    const foe = snap({ id: 9, team: 2, weapon: "blade", x: 1140, atk: "windup", atkLeft: 0.1 }); // 140 > 108
    const out = botThink(createBotMemory(3), me, { players: [me, foe], deployables: [], projectiles: [] }, OPEN, { difficulty: "godlike" });
    expect(out.casts).toEqual([false, false]);
  });

  test("reactive buttons commit late — a feinted windup baits nothing out of a sharp hand", () => {
    const me = snap({ weapon: "bow", abilities: [slot("mirror-guard"), slot("ironhide")] });
    const bowman = (atkLeft: number) => snap({ id: 9, team: 2, weapon: "bow", x: 1200, atk: "windup", atkLeft });
    expect(decideCasts(me, bowman(0.45), [me, bowman(0.45)], [], true, true, 0.29)).toBeNull();
    expect(decideCasts(me, bowman(0.2), [me, bowman(0.2)], [], true, true, 0.29)).toBe("mirror-guard");
    expect(decideCasts(me, bowman(0.45), [me, bowman(0.45)], [], true, true)).toBe("mirror-guard"); // dumb tiers: on sight
  });

  test("the bombard is not a melee weapon: its windup is ignored, its landing ring is left", () => {
    const me = snap({ weapon: "bow", abilities: [slot("dash"), slot("mirror-guard")] });
    const gunner = snap({ id: 9, team: 2, weapon: "bombard", x: 1300, atk: "windup", atkLeft: 0.5 });
    const calm = botThink(createBotMemory(3), me, { players: [me, gunner], deployables: [], projectiles: [] }, OPEN, { difficulty: "godlike" });
    expect(calm.casts).toEqual([false, false]);
    // A ring centred just left of me: the feet go right, hard.
    const out = botThink(createBotMemory(3), me, { players: [me, gunner], deployables: [], projectiles: [], shells: [shell({ tx: 960, ty: 1000 })] }, OPEN, { difficulty: "godlike" });
    expect(out.sx).toBeGreaterThan(0.9);
  });

  test("hazards are a constraint: the pull through a mine never carries the feet across its lip", () => {
    // Camper geometry: the mark stands directly behind their mine.
    const foe = snap({ id: 9, team: 2, weapon: "bow", x: 1400, y: 1000 });
    const trap = mine({ x: 1230, y: 1000 });
    const mem = createBotMemory(11);
    let me = snap({ weapon: "blade", x: 900, y: 1000, abilities: DASH_IRON });
    let closest = Infinity;
    for (let i = 0; i < 150; i++) {
      const d = botThink(mem, me, { players: [me, foe], deployables: [trap], projectiles: [] }, OPEN, { difficulty: "godlike" });
      me = { ...me, x: me.x + d.sx * 308 / 30, y: me.y + d.sy * 308 / 30 };
      closest = Math.min(closest, Math.hypot(me.x - trap.x, me.y - trap.y));
    }
    expect(closest).toBeGreaterThan(138); // trigger radius + body
  });
});

describe("retreat reads the room", () => {
  // A bow kiter with a diver in its face: bandState −1 on the first think.
  const kite = (x: number) => {
    const me = snap({ weapon: "bow", x, y: 1000, abilities: [slot("mirror-guard"), slot("ironhide")] });
    const foe = snap({ id: 9, team: 2, weapon: "blade", x: x + 120, y: 1000 });
    return botThink(createBotMemory(3), me, { players: [me, foe], deployables: [], projectiles: [] }, OPEN, { difficulty: "godlike" });
  };

  test("open ground behind: straight away, exactly as before", () => {
    const d = kite(1000);
    expect(d.sx).toBeLessThan(-0.9);
  });

  test("a wall behind: it curls along the open side instead of backing into it", () => {
    const d = kite(90); // the arena edge is ~90px behind
    expect(Math.abs(d.sy)).toBeGreaterThan(0.6);
  });

  test("the Closing Sands' ring is the end of the room too", () => {
    const me = snap({ weapon: "bow", x: 1000, y: 1000, abilities: [slot("mirror-guard"), slot("ironhide")] });
    const foe = snap({ id: 9, team: 2, weapon: "blade", x: 1120, y: 1000 });
    const round = { phase: "active" as const, timer: 0, roundNumber: 1, wins: [0, 0], lastWinner: 0 as const, sands: { cx: 1200, cy: 1000, r: 300, p: 0.5 } };
    const d = botThink(createBotMemory(3), me, { players: [me, foe], deployables: [], projectiles: [], round }, OPEN, { difficulty: "godlike" });
    expect(Math.abs(d.sy)).toBeGreaterThan(0.5); // ring edge is 100px behind me at −x
  });
});

describe("team focus", () => {
  test("two bots converge on one body, and the body on our wounded outranks a nearer one", () => {
    const a = snap({ id: 0, x: 900, y: 1000 });
    const b = snap({ id: 1, x: 1100, y: 1000, hp: 35 });
    const e1 = snap({ id: 8, team: 2, x: 850, y: 900 }); // nearest to A
    const e2 = snap({ id: 9, team: 2, x: 1150, y: 1080 }); // on wounded B
    const all = [a, b, e1, e2];
    const pickA = focusTarget(ARCHETYPES.brawler, a, all, true)!;
    const pickB = focusTarget(ARCHETYPES.brawler, b, all, true)!;
    expect(pickA.id).toBe(9);
    expect(pickB.id).toBe(9);
    expect(focusTarget(ARCHETYPES.brawler, a, all, false)!.id).toBe(8); // solo: nearest
  });

  test("a live heal-link makes the healer the kill", () => {
    const me = snap({ id: 0 });
    const mate = snap({ id: 1, x: 1050 });
    const bruiser = snap({ id: 8, team: 2, x: 1120 });
    const healer = snap({ id: 9, team: 2, weapon: "lifeline", x: 1260, beamTargetId: 8 });
    expect(focusTarget(ARCHETYPES.brawler, me, [me, mate, bruiser, healer], true)!.id).toBe(9);
  });

  test("the pour and the peel answer a teammate's trouble, not just my own", () => {
    const foe = snap({ id: 9, team: 2, x: 1140 });
    const healer = snap({ id: 0, abilities: [slot("blood-font", { charges: 1 }), slot("warding-shout")] });
    const hurtMate = snap({ id: 1, x: 1040, hp: 30 });
    expect(decideCasts(healer, foe, [healer, hurtMate, foe], [], true)).toBe("warding-shout");
    const pourOnly = snap({ id: 0, abilities: [slot("blood-font", { charges: 1 })] });
    expect(decideCasts(pourOnly, foe, [pourOnly, hurtMate, foe], [], true)).toBe("blood-font");
    expect(decideCasts(pourOnly, foe, [pourOnly, snap({ id: 1, x: 1040 }), foe], [], true)).toBeNull();
  });
});

describe("exploit gauntlet gates — the tricks that used to beat Godlike stay dead", () => {
  const GATED = [
    "TOM hammer vs DIVER blade", // 0–8 before v4
    "TOM hammer vs VENOM hit-and-run fang", // 0–8
    "hammer vs CHASER fang", // 1–7
    "blade  vs KITER trident", // 1–7
    "bow    vs KITER bombard", // 0–8
    "blade  vs TRAP-CAMPER bow", // 2–4
  ];
  for (const label of GATED) {
    test(label, () => {
      const setup = SETUPS.find((s) => s.label === label)!;
      for (const seed of [1000, 1017]) expect(runMatch(setup, seed, "godlike").winner).toBe("bot");
    });
  }
});
