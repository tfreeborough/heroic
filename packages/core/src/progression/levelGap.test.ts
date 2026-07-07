import { describe, expect, test } from "bun:test";
import { createRng } from "../rng";
import {
  GAP_TUNING,
  NEUTRAL_GAP_MODS,
  conTier,
  creatureAttackGapMods,
  gapMultiplier as xpGapMultiplier,
  parseLevelRange,
  playerAttackGapMods,
  rollCreatureLevel,
} from "../index";
import { XP_TUNING } from "./xp";

const { grace, player, creature } = GAP_TUNING;

describe("playerAttackGapMods — swinging up and down", () => {
  test("neutral inside the grace band, both edges", () => {
    expect(playerAttackGapMods(10, 10)).toEqual(NEUTRAL_GAP_MODS);
    expect(playerAttackGapMods(10, 10 + grace)).toEqual(NEUTRAL_GAP_MODS);
    expect(playerAttackGapMods(10, 10 - grace)).toEqual(NEUTRAL_GAP_MODS);
  });

  test("attacking up: damage tapers per level and floors, miss ramps and caps", () => {
    const one = playerAttackGapMods(10, 10 + grace + 1);
    expect(one.damageMult).toBeCloseTo(1 - player.upDamagePerLevel);
    expect(one.missChance).toBeCloseTo(player.upMissPerLevel);
    expect(one.critBonus).toBe(0);
    const wall = playerAttackGapMods(1, 40);
    expect(wall.damageMult).toBe(player.upDamageFloor);
    expect(wall.missChance).toBe(player.upMissCap);
  });

  test("attacking down: crit ramps toward its cap, damage bonus capped", () => {
    const one = playerAttackGapMods(10 + grace + 1, 10);
    expect(one.critBonus).toBeCloseTo(player.downCritPerLevel);
    expect(one.damageMult).toBeCloseTo(1 + player.downDamagePerLevel);
    expect(one.missChance).toBe(0);
    const grey = playerAttackGapMods(40, 1);
    expect(grey.critCap).toBe(player.downCritCap);
    expect(Math.min(grey.critBonus, grey.critCap)).toBe(player.downCritCap); // lowbies pop
    expect(grey.damageMult).toBe(1 + player.downDamageCap);
  });
});

describe("creatureAttackGapMods — the incoming side", () => {
  test("a higher-level creature hits harder and crits more, capped", () => {
    const one = creatureAttackGapMods(10 + grace + 1, 10);
    expect(one.damageMult).toBeCloseTo(1 + creature.downDamagePerLevel);
    expect(one.critBonus).toBeCloseTo(creature.downCritPerLevel);
    expect(one.critCap).toBe(creature.downCritCap);
  });

  test("a far lower creature barely scratches, and creatures never miss", () => {
    const scratch = creatureAttackGapMods(1, 40);
    expect(scratch.damageMult).toBe(creature.upDamageFloor);
    expect(scratch.missChance).toBe(0);
  });
});

describe("conTier — derived from the same thresholds", () => {
  test("the ladder around a level-10 player", () => {
    const con = (creatureLevel: number) => conTier(creatureLevel, 10);
    expect(con(10 + grace + GAP_TUNING.orangeSpan + 1)).toBe("red"); // 15
    expect(con(10 + grace + 1)).toBe("orange"); // 13
    expect(con(10 + grace)).toBe("gold"); // 12
    expect(con(10 - grace)).toBe("gold"); // 8
    expect(con(10 - grace - 1)).toBe("green"); // 7
    expect(con(10 - grace - GAP_TUNING.greenSpan)).toBe("green"); // 5
    expect(con(10 - grace - GAP_TUNING.greenSpan - 1)).toBe("grey"); // 4
  });

  test("grey starts exactly where XP sits at its trivial floor", () => {
    const greyGap = grace + GAP_TUNING.greenSpan + 1; // player is this far above
    expect(conTier(10, 10 + greyGap)).toBe("grey");
    expect(xpGapMultiplier(10 + greyGap, 10)).toBe(XP_TUNING.trivialFloor);
  });
});

describe("rollCreatureLevel — zone range ∩ creature bounds", () => {
  const zone = { min: 1, max: 10 };

  test("rolls only inside the intersection, hitting every level in it", () => {
    const rng = createRng(7);
    const wizard = { min: 5, max: 12 };
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(rollCreatureLevel(zone, wizard, rng));
    expect([...seen].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]); // 1-10 ∩ 5-12
  });

  test("a higher zone lifts the floor: realm-01 (9-15) wizards are 9-12", () => {
    const rng = createRng(3);
    const wizard = { min: 5, max: 12 };
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(rollCreatureLevel({ min: 9, max: 15 }, wizard, rng));
    expect([...seen].sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
  });

  test("an authored override replaces the zone window (still clamped by the species)", () => {
    const rng = createRng(5);
    const zombie = { min: 1, max: 4 };
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      seen.add(rollCreatureLevel(zone, zombie, rng, { min: 3, max: 8 }));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4]); // override 3-8 ∩ zombie 1-4
  });

  test("an empty intersection clamps to the creature's nearest edge", () => {
    const rng = createRng(9);
    // A 1-3 bat in a 9-15 zone: species identity wins — it spawns at its own max.
    expect(rollCreatureLevel({ min: 9, max: 15 }, { min: 1, max: 3 }, rng)).toBe(3);
    // A 5-12 wizard forced under its floor spawns at its own min.
    expect(rollCreatureLevel(zone, { min: 5, max: 12 }, rng, { min: 1, max: 2 })).toBe(5);
  });

  test("deterministic per seed", () => {
    const a = createRng(11);
    const b = createRng(11);
    const wolf = { min: 2, max: 6 };
    for (let i = 0; i < 20; i++) {
      expect(rollCreatureLevel(zone, wolf, a)).toBe(rollCreatureLevel(zone, wolf, b));
    }
  });
});

describe("parseLevelRange — authored props", () => {
  test("absent props mean no override", () => {
    expect(parseLevelRange({})).toBeUndefined();
    expect(parseLevelRange({ creature: "zombie", maxHp: 120 })).toBeUndefined();
  });

  test("reads numbers and numeric strings (Realmsmith props are untyped)", () => {
    expect(parseLevelRange({ levelMin: 3, levelMax: 8 })).toEqual({ min: 3, max: 8 });
    expect(parseLevelRange({ levelMin: "3", levelMax: "8" })).toEqual({ min: 3, max: 8 });
  });

  test("one side alone pins both ends; a reversed pair is swapped", () => {
    expect(parseLevelRange({ levelMin: 7 })).toEqual({ min: 7, max: 7 });
    expect(parseLevelRange({ levelMax: 4 })).toEqual({ min: 4, max: 4 });
    expect(parseLevelRange({ levelMin: 9, levelMax: 2 })).toEqual({ min: 2, max: 9 });
  });
});
