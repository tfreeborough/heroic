import { describe, expect, test } from "bun:test";
import { CLASSES } from "../stats/classes";
import {
  TALENT_CHAINS,
  TALENT_TIER_BY_ID,
  talentEffectTotal,
  talentEffectsFor,
} from "./chains";
import {
  OFFER_COUNT,
  PITY_WINDOW,
  eligibleTiers,
  generateOffers,
  nextOffers,
  nextPickLevel,
  offerSeed,
  pendingPicks,
  talentModifierSources,
} from "./talents";

const weights = CLASSES.warrior.offerWeights;

describe("catalogue sanity", () => {
  test("the full catalogue is authored: commons, hybrids, rares, gems", () => {
    const byRarity = { common: 0, rare: 0, epic: 0 };
    for (const chain of TALENT_CHAINS) byRarity[chain.rarity]++;
    expect(byRarity.common).toBeGreaterThanOrEqual(22); // 14 ladders + 8 hybrids
    expect(byRarity.rare).toBeGreaterThanOrEqual(19);
    expect(byRarity.epic).toBeGreaterThanOrEqual(8);
  });

  test("every tier id unique and indexed", () => {
    const ids = TALENT_CHAINS.flatMap((c) => c.tiers.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(TALENT_TIER_BY_ID).length).toBe(ids.length);
  });

  test("tiers are contiguous from 1 and follow the `chain-tier` id scheme", () => {
    for (const chain of TALENT_CHAINS) {
      chain.tiers.forEach((tier, i) => {
        expect(tier.tier).toBe(i + 1);
        expect(tier.id).toBe(`${chain.id}-${i + 1}`);
        expect(tier.chainId).toBe(chain.id);
        expect(tier.rarity).toBe(chain.rarity);
      });
    }
  });

  test("every stat-keyed chain's modifiers touch that stat", () => {
    for (const chain of TALENT_CHAINS) {
      if (!chain.stat) continue;
      for (const tier of chain.tiers) {
        expect(tier.modifiers.length).toBeGreaterThan(0);
        for (const mod of tier.modifiers) expect(mod.stat).toBe(chain.stat);
      }
    }
  });

  test("effect chains carry effects instead of modifiers", () => {
    const swiftRoll = TALENT_CHAINS.find((c) => c.id === "swift-roll")!;
    expect(swiftRoll.stat).toBeUndefined();
    expect(swiftRoll.rarity).toBe("rare");
    for (const tier of swiftRoll.tiers) {
      expect(tier.modifiers.length).toBe(0);
      expect(tier.effects!.length).toBeGreaterThan(0);
    }
  });

  test("gems are single-tier epics and never capstones", () => {
    for (const chain of TALENT_CHAINS.filter((c) => c.rarity === "epic")) {
      expect(chain.tiers.length).toBe(1);
      expect(chain.tiers[0]!.capstone).toBe(false);
    }
  });

  test("multi-tier chains mark exactly their final tier as the capstone", () => {
    for (const chain of TALENT_CHAINS.filter((c) => c.tiers.length > 1)) {
      chain.tiers.forEach((tier, i) => {
        expect(tier.capstone).toBe(i === chain.tiers.length - 1);
      });
    }
  });

  test("hybrid tiers bump both stats with equal values", () => {
    const brawn = TALENT_CHAINS.find((c) => c.id === "brawn")!;
    expect(brawn.stat).toBeUndefined(); // baseline weight, no class lean
    for (const tier of brawn.tiers) {
      expect(tier.modifiers.length).toBe(2);
      expect(tier.modifiers[0]!.value).toBe(tier.modifiers[1]!.value);
    }
  });
});

describe("offerSeed", () => {
  test("stable for the same character and level, distinct otherwise", () => {
    expect(offerSeed("char-a", 5)).toBe(offerSeed("char-a", 5));
    expect(offerSeed("char-a", 5)).not.toBe(offerSeed("char-a", 6));
    expect(offerSeed("char-a", 5)).not.toBe(offerSeed("char-b", 5));
  });
});

describe("eligibleTiers — tier-gating", () => {
  test("a fresh character sees exactly every chain's tier I", () => {
    const pool = eligibleTiers([]);
    expect(pool.length).toBe(TALENT_CHAINS.length);
    for (const tier of pool) expect(tier.tier).toBe(1);
  });

  test("owning a tier unlocks exactly the next one in that chain", () => {
    const pool = eligibleTiers(["mighty-1"]);
    const mighty = pool.filter((t) => t.chainId === "mighty");
    expect(mighty).toEqual([TALENT_TIER_BY_ID["mighty-2"]!]);
  });

  test("a finished chain drops out of the pool", () => {
    const swiftRoll = ["swift-roll-1", "swift-roll-2", "swift-roll-3"];
    const pool = eligibleTiers(swiftRoll);
    expect(pool.some((t) => t.chainId === "swift-roll")).toBe(false);
    expect(pool.length).toBe(TALENT_CHAINS.length - 1);
  });
});

describe("generateOffers", () => {
  test("deterministic: same seed → identical offers", () => {
    const draw = { seed: offerSeed("char-a", 3), owned: ["mighty-1"], weights };
    expect(generateOffers(draw).map((t) => t.id)).toEqual(generateOffers(draw).map((t) => t.id));
  });

  test("returns OFFER_COUNT distinct chains, never an owned tier", () => {
    const owned = ["mighty-1", "fleet-1", "fleet-2"];
    for (let seed = 0; seed < 100; seed++) {
      const offers = generateOffers({ seed, owned, weights });
      expect(offers.length).toBe(OFFER_COUNT);
      expect(new Set(offers.map((t) => t.chainId)).size).toBe(OFFER_COUNT);
      for (const tier of offers) expect(owned).not.toContain(tier.id);
    }
  });

  test("returns the whole pool when fewer chains than OFFER_COUNT remain", () => {
    const twoChains = TALENT_CHAINS.slice(0, 2);
    const offers = generateOffers({ seed: 1, owned: [], weights, chains: twoChains });
    expect(offers.length).toBe(2);
  });

  test("class weighting leans offers toward the class's stats", () => {
    // Warrior weights strength 3 / luck unlisted (1) — over many seeds the
    // Mighty chain must show up comfortably more often than Fortune. A
    // generous margin keeps this stable against RNG-stream tweaks.
    let mighty = 0;
    let fortune = 0;
    for (let seed = 0; seed < 500; seed++) {
      for (const tier of generateOffers({ seed, owned: [], weights })) {
        if (tier.chainId === "mighty") mighty++;
        if (tier.chainId === "fortune") fortune++;
      }
    }
    expect(mighty).toBeGreaterThan(fortune * 1.5);
    expect(fortune).toBeGreaterThan(0); // leaned, never excluded
  });

  test("rarity weights make common chains far more frequent than epics", () => {
    let common = 0;
    let epic = 0;
    for (let seed = 0; seed < 500; seed++) {
      for (const tier of generateOffers({ seed, owned: [], weights })) {
        if (tier.rarity === "common") common++;
        if (tier.rarity === "epic") epic++;
      }
    }
    expect(common).toBeGreaterThan(epic * 5);
    expect(epic).toBeGreaterThan(0); // rare, never impossible
  });

  test("luck raises the Rare+ share of offers", () => {
    const rarePlusCount = (luck: number): number => {
      let count = 0;
      for (let seed = 0; seed < 500; seed++) {
        for (const tier of generateOffers({ seed, owned: [], weights, luck })) {
          if (tier.rarity !== "common") count++;
        }
      }
      return count;
    };
    expect(rarePlusCount(0.1)).toBeGreaterThan(rarePlusCount(0) * 1.15);
  });

  test("handler gating: chains needing unregistered handlers are never offered", () => {
    const implemented = new Set(["dashCooldown"]);
    for (let seed = 0; seed < 300; seed++) {
      for (const tier of generateOffers({ seed, owned: [], weights, implementedHandlers: implemented })) {
        for (const effect of tier.effects ?? []) {
          expect(effect.handler).toBe("dashCooldown");
        }
      }
    }
  });

  test("modifier-only chains pass the handler gate", () => {
    // Glass Soul has no effects — offerable even with an empty registry.
    const none: ReadonlySet<string> = new Set();
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      for (const tier of generateOffers({ seed, owned: [], weights, implementedHandlers: none })) {
        seen.add(tier.chainId);
      }
    }
    expect(seen.has("glass-soul") || seen.has("stone-soul")).toBe(true);
    expect(seen.has("swift-roll")).toBe(false);
  });

  test("forceRarePlus guarantees a Rare+ card when any is eligible", () => {
    for (let seed = 0; seed < 200; seed++) {
      const offers = generateOffers({ seed, owned: [], weights, forceRarePlus: true });
      expect(offers.some((t) => t.rarity !== "common")).toBe(true);
    }
  });
});

describe("nextOffers — pity replay", () => {
  test("deterministic in the record: same inputs → same cards", () => {
    const params = { characterId: "char-a", talents: ["mighty-1", "fleet-1"], weights };
    expect(nextOffers(params).map((t) => t.id)).toEqual(nextOffers(params).map((t) => t.id));
  });

  test("never more than PITY_WINDOW all-common offer sets in a row", () => {
    // Simulate long careers across several characters, always taking the first
    // card; count consecutive offer sets with no Rare+ card.
    for (const characterId of ["pity-a", "pity-b", "pity-c"]) {
      const talents: string[] = [];
      let dry = 0;
      for (let pick = 0; pick < 30; pick++) {
        const offers = nextOffers({ characterId, talents, weights });
        if (offers.length === 0) break;
        dry = offers.some((t) => t.rarity !== "common") ? 0 : dry + 1;
        expect(dry).toBeLessThanOrEqual(PITY_WINDOW);
        talents.push(offers[0]!.id);
      }
    }
  });
});

describe("talentModifierSources", () => {
  test("one permanent source per owned stat tier, incremental values", () => {
    const sources = talentModifierSources(["mighty-1", "mighty-2"]);
    expect(sources.length).toBe(2);
    expect(sources.map((s) => s.lifecycle)).toEqual(["permanent", "permanent"]);
    const total = sources.flatMap((s) => s.modifiers).reduce((sum, m) => sum + m.value, 0);
    expect(total).toBe(10 + 12);
  });

  test("pure effect tiers and unknown ids contribute nothing", () => {
    expect(talentModifierSources(["swift-roll-1", "gone-from-catalogue-9"])).toEqual([]);
  });
});

describe("talent effects", () => {
  test("talentEffectTotal sums a handler across owned tiers", () => {
    expect(talentEffectTotal(["swift-roll-1", "swift-roll-2"], "dashCooldown")).toBeCloseTo(0.2);
    expect(talentEffectTotal(["sure-feet-1", "sure-feet-2", "sure-feet-3"], "dashIframes")).toBeCloseTo(0.2);
    expect(talentEffectTotal(["mighty-1"], "dashCooldown")).toBe(0);
  });

  test("talentEffectsFor returns a hook's owned effects with shared params", () => {
    const onKill = talentEffectsFor(["bloodletter-1", "adrenaline-1", "swift-roll-1"], "onKill");
    expect(onKill.map((e) => e.handler).sort()).toEqual(["heal", "statBuff"]);
    const adrenaline = onKill.find((e) => e.handler === "statBuff")!;
    expect(adrenaline.stat).toBe("speed");
    expect(adrenaline.params?.duration).toBe(2);
  });
});

describe("pendingPicks / nextPickLevel", () => {
  test("every level from 2 owes exactly one pick", () => {
    expect(pendingPicks(1, 0)).toBe(0);
    expect(pendingPicks(2, 0)).toBe(1);
    expect(pendingPicks(5, 2)).toBe(2); // two picks behind
    expect(pendingPicks(5, 4)).toBe(0); // caught up
  });

  test("the next pick's level follows the picks already taken", () => {
    expect(nextPickLevel(0)).toBe(2);
    expect(nextPickLevel(3)).toBe(5);
  });
});
