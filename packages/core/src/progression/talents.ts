// Talent offers and ownership (docs/design/characters-and-talents.md): every
// level from 2 owes one minor pick — 1 of OFFER_COUNT tiers drawn from the
// eligible pool (the next unowned tier of every chain), weighted by the
// class's stat lean × the chain's rarity, nudged by luck, with a pity rule
// forcing a Rare+ card after PITY_WINDOW all-common offers. Offers are seeded
// per character + pick level, so they're deterministic: reopening the pick
// screen, restarting the app, or replaying a save always shows the same
// cards. Randomness only decides WHICH chains show up — tier values are fixed
// by the catalogue.

import { createRng } from "../rng";
import type { StatId } from "../stats/stats";
import type { ModifierSource } from "../stats/modifiers";
import {
  TALENT_CHAINS,
  TALENT_TIER_BY_ID,
  type TalentChain,
  type TalentTier,
} from "./chains";

/** Cards per pick (placeholder count, per the docs). */
export const OFFER_COUNT = 3;

/** Rarity → offer-weight multiplier (talent-catalogue.md; placeholder). */
export const RARITY_OFFER_WEIGHT = { common: 1, rare: 0.35, epic: 0.12 } as const;

/**
 * How hard the luck channel pushes Rare+ offers: rare/epic weights scale by
 * (1 + luck × LUCK_RARE_SCALE). Luck's rating curve caps at 0.1, so a
 * luck-capped character sees Rare+ cards at +50% weight (placeholder).
 */
export const LUCK_RARE_SCALE = 5;

/** All-common offers in a row before one slot is forced Rare+ (placeholder). */
export const PITY_WINDOW = 3;

/** FNV-1a over a string — core has no string hash and offer seeds need one. */
const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Deterministic seed for one character's pick at one level. */
export const offerSeed = (characterId: string, pickLevel: number): number =>
  (fnv1a(characterId) ^ Math.imul(pickLevel, 0x9e3779b9)) >>> 0;

/**
 * The eligible pool: each chain's first unowned tier (tier I for unstarted
 * chains, nothing for finished ones). Tier-gating and never-reoffering owned
 * tiers both fall out of the construction.
 */
export const eligibleTiers = (
  owned: readonly string[],
  chains: readonly TalentChain[] = TALENT_CHAINS,
): TalentTier[] => {
  const ownedSet = new Set(owned);
  const pool: TalentTier[] = [];
  for (const chain of chains) {
    const next = chain.tiers.find((tier) => !ownedSet.has(tier.id));
    if (next) pool.push(next);
  }
  return pool;
};

/**
 * A chain may be offered only when the app has registered every handler its
 * tiers reference — the catalogue is authored ahead of the sim, and a card
 * must never promise behaviour the game can't deliver. `undefined` skips the
 * gate (tests, tools). Modifier-only chains always pass.
 */
const chainOfferable = (chain: TalentChain, implemented?: ReadonlySet<string>): boolean => {
  if (!implemented) return true;
  for (const tier of chain.tiers) {
    for (const effect of tier.effects ?? []) {
      if (!implemented.has(effect.handler)) return false;
    }
  }
  return true;
};

export interface OfferDraw {
  seed: number;
  /** Owned tier ids (any order — only membership matters here). */
  owned: readonly string[];
  /** Class offer weights over chain stats (characters-and-talents.md). */
  weights: Partial<Record<StatId, number>>;
  /** Luck channel value (EffectiveStats.luck, 0..~0.1); nudges Rare+ weight. */
  luck?: number;
  /** App-registered effect handlers; chains needing others are not offered. */
  implementedHandlers?: ReadonlySet<string>;
  /** Pity: force the first slot to draw from Rare+ chains when any exist. */
  forceRarePlus?: boolean;
  count?: number;
  chains?: readonly TalentChain[];
}

interface PoolEntry {
  tier: TalentTier;
  weight: number;
}

/** One weighted draw without replacement; mutates `pool`. */
const drawOne = (pool: PoolEntry[], rng: { next(): number }): TalentTier => {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  let idx = 0;
  while (idx < pool.length - 1 && (roll -= pool[idx]!.weight) >= 0) idx++;
  const [entry] = pool.splice(idx, 1);
  return entry!.tier;
};

/**
 * Draw one offer set: a weighted sample without replacement over the eligible
 * pool, deterministic in `seed`. A chain's weight is its stat's class weight
 * (baseline 1 for effect chains, gems, and hybrids) × its rarity multiplier;
 * luck scales the Rare+ side. Under pity the first slot draws from the Rare+
 * subset so the set is guaranteed one. Returns the whole pool when fewer than
 * `count` chains remain eligible.
 */
export const generateOffers = (draw: OfferDraw): TalentTier[] => {
  const count = draw.count ?? OFFER_COUNT;
  const chains = draw.chains ?? TALENT_CHAINS;
  const luckBoost = 1 + (draw.luck ?? 0) * LUCK_RARE_SCALE;

  const ownedSet = new Set(draw.owned);
  const pool: PoolEntry[] = [];
  for (const chain of chains) {
    if (!chainOfferable(chain, draw.implementedHandlers)) continue;
    const next = chain.tiers.find((tier) => !ownedSet.has(tier.id));
    if (!next) continue;
    const statWeight = (chain.stat && draw.weights[chain.stat]) || 1;
    const rarityWeight =
      RARITY_OFFER_WEIGHT[chain.rarity] * (chain.rarity === "common" ? 1 : luckBoost);
    pool.push({ tier: next, weight: statWeight * rarityWeight });
  }

  const rng = createRng(draw.seed);
  const offers: TalentTier[] = [];

  if (draw.forceRarePlus) {
    const rarePlus = pool.filter((entry) => entry.tier.rarity !== "common");
    if (rarePlus.length > 0) {
      const forced = drawOne(rarePlus, rng);
      offers.push(forced);
      pool.splice(pool.findIndex((entry) => entry.tier === forced), 1);
    }
  }

  while (offers.length < count && pool.length > 0) offers.push(drawOne(pool, rng));
  return offers;
};

export interface OfferParams {
  characterId: string;
  /** Owned tier ids IN PICK ORDER (the persisted record) — pity replays it. */
  talents: readonly string[];
  weights: Partial<Record<StatId, number>>;
  luck?: number;
  implementedHandlers?: ReadonlySet<string>;
  count?: number;
  chains?: readonly TalentChain[];
}

/**
 * The offers for a character's next pick, pity included. Pity needs to know
 * whether recent offers showed a Rare+ card, and past offers are a pure
 * function of the pick history (offers at pick i used seed(char, i+2) and the
 * first i talents) — so the whole thing replays from the record with NO new
 * persisted state. Backing out, restarting, or reloading always re-derives
 * the same cards.
 *
 * Honest wrinkle: the replay evaluates history with the CURRENT luck and
 * handler registry, so after a luck change or an app update the recomputed
 * past may differ from what was literally shown. The result is still
 * deterministic in the inputs — pity drifts by at most a pick, and the
 * current offer never flickers for a given record.
 */
export const nextOffers = (params: OfferParams): TalentTier[] => {
  let dry = 0;
  for (let pick = 0; ; pick++) {
    const offers = generateOffers({
      seed: offerSeed(params.characterId, pick + 2),
      owned: params.talents.slice(0, pick),
      weights: params.weights,
      luck: params.luck,
      implementedHandlers: params.implementedHandlers,
      forceRarePlus: dry >= PITY_WINDOW,
      count: params.count,
      chains: params.chains,
    });
    if (pick === params.talents.length) return offers;
    dry = offers.some((tier) => tier.rarity !== "common") ? 0 : dry + 1;
  }
};

/**
 * Owned tiers → permanent modifier sources for computeEffectiveStats. One
 * source per tier (values are incremental, so they sum through the buckets).
 * Pure effect tiers contribute nothing here — the app reads those through
 * talentEffectTotal. Unknown ids (a renamed chain under an old save) are
 * skipped rather than crashing the character.
 */
export const talentModifierSources = (owned: readonly string[]): ModifierSource[] => {
  const sources: ModifierSource[] = [];
  for (const id of owned) {
    const tier = TALENT_TIER_BY_ID[id];
    if (tier && tier.modifiers.length > 0) {
      sources.push({ id, lifecycle: "permanent", modifiers: tier.modifiers });
    }
  }
  return sources;
};

/**
 * Picks owed is DERIVED, never stored: every level from 2 owes exactly one
 * pick, so the count is a function of the persisted record. Multi-level
 * kills, app restarts mid-pick, and backing out of the pick screen all
 * self-heal for free.
 */
export const pendingPicks = (level: number, talentsTaken: number): number =>
  Math.max(0, level - 1 - talentsTaken);

/** The level a character's next pick belongs to (seeds that pick's offers). */
export const nextPickLevel = (talentsTaken: number): number => talentsTaken + 2;
