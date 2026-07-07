// The minor-Talent catalogue (docs/design/talent-catalogue.md): every chain
// carries a rarity — Common stat ladders (incl. two-stat hybrids), Rare
// effect chains (picks that visibly change behaviour), Epic single-tier
// "gems" — which weights offers and dresses cards, never values: tier values
// stay fixed and hand-authored. Deep tiers of the six core attributes switch
// flat → percent (the capstone), the counterweight to the flat-fade curve.
//
// Tier values are INCREMENTAL — owning Mighty I and II sums both through the
// modifier buckets, so a tier never restates the chain's total. Effect tiers
// follow the same rule: talentEffectTotal sums `value` across owned tiers,
// so later tiers author the *delta* (Adrenaline's +8/+10/+12% ladder is
// authored 0.08 / 0.02 / 0.02).
//
// Effects are data + named app handlers (modifiers-and-effects.md): core
// carries {hook, handler, value}; the sim registers the handler code and
// fires the hooks. The whole catalogue is authored up front — chains whose
// handlers the app hasn't registered yet are simply never offered
// (talents.ts), so no card can promise something the sim can't do.

import type { StatId } from "../stats/stats";
import type { StatModifier } from "../stats/modifiers";

export type TalentRarity = "common" | "rare" | "epic";

/** Sim moments an effect attaches to; "passive" effects are config reads. */
export type EffectHook = "passive" | "onKill" | "onCrit" | "onHitDealt" | "onHitTaken" | "onDash";

/**
 * One talent effect: data pointing at a named, app-registered handler (the
 * data-vs-code split from the skills system — core carries the numbers, the
 * app owns the behaviour).
 */
export interface TalentEffect {
  hook: EffectHook;
  /** App-registered routine name, e.g. "heal", "statBuff", "dashCooldown". */
  handler: string;
  /** Primary magnitude — incremental per tier; talentEffectTotal sums it. */
  value: number;
  /** Target stat, for stat-buff handlers. */
  stat?: StatId;
  /**
   * Shared handler tuning (durations, thresholds, internal cooldowns) —
   * identical on every tier of a chain and never summed.
   */
  params?: Readonly<Record<string, number>>;
}

export interface TalentTier {
  /** `${chainId}-${tier}` — the unit a character owns and persists. */
  id: string;
  chainId: string;
  /** 1-based position in the chain. */
  tier: number;
  /** Display name, e.g. "Mighty II" (gems drop the numeral). */
  label: string;
  /** One-line pitch for the pick card, e.g. "+12 Strength". */
  description: string;
  /** Chain rarity, denormalised for card dressing. */
  rarity: TalentRarity;
  /** Final tier of a multi-tier chain — dresses gold on the pick card. */
  capstone: boolean;
  /** Stat bumps applied as one permanent modifier source. Empty for pure effect tiers. */
  modifiers: readonly StatModifier[];
  /** App-interpreted effects (see TalentEffect). */
  effects?: readonly TalentEffect[];
}

export interface TalentChain {
  id: string;
  label: string;
  rarity: TalentRarity;
  /**
   * The single stat this chain grows — the key into a class's offerWeights.
   * Absent for effect chains, gems, and hybrids, which sit at baseline offer
   * weight (hybrids are deliberately generalist — no class lean).
   */
  stat?: StatId;
  tiers: readonly TalentTier[];
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

/**
 * Author one stat chain from its value ladder: `flats` are the incremental
 * flat bumps per tier; `percentCap` appends a final percent tier (the
 * flat → percent switch for deep tiers). `flatAsPercent` formats descriptions
 * for the 100-pts-per-1.0× stats (speed/reach/attackSpeed), where +4 points
 * reads as +4%.
 */
const statChain = (
  id: string,
  label: string,
  stat: StatId,
  statLabel: string,
  flats: readonly number[],
  opts: { percentCap?: number; flatAsPercent?: boolean } = {},
): TalentChain => {
  const count = flats.length + (opts.percentCap !== undefined ? 1 : 0);
  const tiers: TalentTier[] = flats.map((value, i) => ({
    id: `${id}-${i + 1}`,
    chainId: id,
    tier: i + 1,
    label: `${label} ${ROMAN[i]}`,
    description: opts.flatAsPercent ? `+${value}% ${statLabel}` : `+${value} ${statLabel}`,
    rarity: "common",
    capstone: i + 1 === count,
    modifiers: [{ stat, kind: "flat", value }],
  }));
  if (opts.percentCap !== undefined) {
    const tier = flats.length + 1;
    tiers.push({
      id: `${id}-${tier}`,
      chainId: id,
      tier,
      label: `${label} ${ROMAN[tier - 1]}`,
      description: `+${Math.round(opts.percentCap * 100)}% ${statLabel}`,
      rarity: "common",
      capstone: true,
      modifiers: [{ stat, kind: "percent", value: opts.percentCap }],
    });
  }
  return { id, label, rarity: "common", stat, tiers };
};

/**
 * Hybrid ladder (talent-catalogue.md): two stats per tier, each under-budget
 * but over-budget in total — pure ladders are focus, hybrids are efficiency.
 * No `stat` key: hybrids sit at baseline offer weight for every class.
 */
const HYBRID_FLATS = [6, 7, 9, 12] as const;
const HYBRID_CAP = 0.03;
const hybridChain = (
  id: string,
  label: string,
  statA: StatId,
  labelA: string,
  statB: StatId,
  labelB: string,
): TalentChain => {
  const tiers: TalentTier[] = HYBRID_FLATS.map((value, i) => ({
    id: `${id}-${i + 1}`,
    chainId: id,
    tier: i + 1,
    label: `${label} ${ROMAN[i]}`,
    description: `+${value} ${labelA} & ${labelB}`,
    rarity: "common" as const,
    capstone: false,
    modifiers: [
      { stat: statA, kind: "flat" as const, value },
      { stat: statB, kind: "flat" as const, value },
    ],
  }));
  const tier = HYBRID_FLATS.length + 1;
  tiers.push({
    id: `${id}-${tier}`,
    chainId: id,
    tier,
    label: `${label} ${ROMAN[tier - 1]}`,
    description: `+${Math.round(HYBRID_CAP * 100)}% ${labelA} & ${labelB}`,
    rarity: "common",
    capstone: true,
    modifiers: [
      { stat: statA, kind: "percent", value: HYBRID_CAP },
      { stat: statB, kind: "percent", value: HYBRID_CAP },
    ],
  });
  return { id, label, rarity: "common", tiers };
};

/** Rare effect chain: one handler, incremental values, shared params. */
const effectChain = (
  id: string,
  label: string,
  effect: { hook: EffectHook; handler: string; stat?: StatId; params?: Readonly<Record<string, number>> },
  tiers: readonly { value: number; desc: string }[],
): TalentChain => ({
  id,
  label,
  rarity: "rare",
  tiers: tiers.map(({ value, desc }, i) => ({
    id: `${id}-${i + 1}`,
    chainId: id,
    tier: i + 1,
    label: `${label} ${ROMAN[i]}`,
    description: desc,
    rarity: "rare" as const,
    capstone: i + 1 === tiers.length,
    modifiers: [],
    effects: [{ ...effect, value }],
  })),
});

/** Epic gem: a single-tier chain — one weird promise, purple glow. */
const gem = (
  id: string,
  label: string,
  description: string,
  body: { modifiers?: readonly StatModifier[]; effect?: TalentEffect },
): TalentChain => ({
  id,
  label,
  rarity: "epic",
  tiers: [
    {
      id: `${id}-1`,
      chainId: id,
      tier: 1,
      label,
      description,
      rarity: "epic",
      capstone: false,
      modifiers: body.modifiers ?? [],
      effects: body.effect ? [body.effect] : undefined,
    },
  ],
});

export const TALENT_CHAINS: readonly TalentChain[] = [
  // ── Common: the six core attributes — creeping flats + a percent capstone.
  statChain("mighty", "Mighty", "strength", "Strength", [10, 12, 15, 20], { percentCap: 0.05 }),
  statChain("stalwart", "Stalwart", "vitality", "Vitality", [10, 12, 15, 20], { percentCap: 0.05 }),
  statChain("nimble", "Nimble", "agility", "Agility", [10, 12, 15, 20], { percentCap: 0.05 }),
  statChain("keen-mind", "Keen Mind", "intellect", "Intellect", [10, 12, 15, 20], { percentCap: 0.05 }),
  statChain("sage", "Sage", "wisdom", "Wisdom", [10, 12, 15, 20], { percentCap: 0.05 }),
  statChain("mending", "Mending", "renewal", "Renewal", [10, 12, 15, 20], { percentCap: 0.05 }),
  // ── Common: avoidance/mitigation ratings — shorter flat ladders.
  statChain("ironhide", "Ironhide", "armor", "Armor", [8, 10, 13, 18]),
  statChain("elusive", "Elusive", "dodge", "Dodge", [8, 10, 13, 18]),
  statChain("riposte", "Riposte", "parry", "Parry", [8, 10, 13, 18]),
  statChain("bulwark", "Bulwark", "block", "Block", [8, 10, 13, 18]),
  statChain("fortune", "Fortune", "luck", "Luck", [8, 10, 13, 18]),
  // ── Common: multiplier pool stats — small integer points, 1 pt = 1%.
  statChain("fleet", "Fleet", "speed", "Move Speed", [3, 4, 5, 6], { flatAsPercent: true }),
  statChain("long-arm", "Long Arm", "reach", "Reach", [3, 4, 5, 6], { flatAsPercent: true }),
  statChain("quickhand", "Quickhand", "attackSpeed", "Attack Speed", [3, 4, 5, 6], {
    flatAsPercent: true,
  }),
  // ── Common: hybrid ladders — two stats, efficiency over focus.
  hybridChain("brawn", "Brawn", "strength", "Strength", "vitality", "Vitality"),
  hybridChain("warcasters-blood", "Warcaster's Blood", "strength", "Strength", "intellect", "Intellect"),
  hybridChain("spellsight", "Spellsight", "agility", "Agility", "intellect", "Intellect"),
  hybridChain("battle-meditation", "Battle Meditation", "intellect", "Intellect", "wisdom", "Wisdom"),
  hybridChain("lifeblood", "Lifeblood", "vitality", "Vitality", "renewal", "Renewal"),
  hybridChain("weapon-master", "Weapon Master", "strength", "Strength", "agility", "Agility"),
  hybridChain("crusaders-creed", "Crusader's Creed", "strength", "Strength", "wisdom", "Wisdom"),
  hybridChain("wildheart", "Wildheart", "agility", "Agility", "wisdom", "Wisdom"),

  // ── Rare: effect chains — small numbers, visible behaviour.
  effectChain("swift-roll", "Swift Roll", { hook: "passive", handler: "dashCooldown" }, [
    { value: 0.1, desc: "−0.1s roll cooldown" },
    { value: 0.1, desc: "−0.1s roll cooldown" },
    { value: 0.2, desc: "−0.2s roll cooldown" },
  ]),
  effectChain("sure-feet", "Sure Feet", { hook: "passive", handler: "dashIframes" }, [
    { value: 0.05, desc: "+0.05s of dodge i-frames on dash" },
    { value: 0.05, desc: "+0.05s more dodge i-frames" },
    { value: 0.1, desc: "+0.1s more dodge i-frames" },
  ]),
  effectChain("heavy-hands", "Heavy Hands", { hook: "passive", handler: "knockbackDealt" }, [
    { value: 0.15, desc: "Attacks knock back 15% harder" },
    { value: 0.1, desc: "Knockback +10% harder again" },
    { value: 0.15, desc: "Knockback +15% harder again" },
  ]),
  effectChain("bloodletter", "Bloodletter", { hook: "onKill", handler: "heal" }, [
    { value: 2, desc: "Kills restore 2 HP" },
    { value: 1, desc: "Kills restore +1 HP more" },
    { value: 2, desc: "Kills restore +2 HP more" },
  ]),
  effectChain(
    "adrenaline",
    "Adrenaline",
    { hook: "onKill", handler: "statBuff", stat: "speed", params: { duration: 2 } },
    [
      { value: 0.08, desc: "Kills grant +8% move speed for 2s" },
      { value: 0.02, desc: "Kill speed burst +2% more" },
      { value: 0.02, desc: "Kill speed burst +2% more" },
    ],
  ),
  effectChain(
    "battle-trance",
    "Battle Trance",
    { hook: "onCrit", handler: "statBuff", stat: "attackSpeed", params: { duration: 3 } },
    [
      { value: 0.1, desc: "Crits grant +10% attack speed for 3s" },
      { value: 0.05, desc: "Crit frenzy +5% more" },
      { value: 0.05, desc: "Crit frenzy +5% more" },
    ],
  ),
  effectChain(
    "second-wind",
    "Second Wind",
    {
      hook: "onHitTaken",
      handler: "regenBurst",
      params: { threshold: 0.3, duration: 3, cooldown: 30 },
    },
    [
      { value: 3, desc: "Dropping below 30% HP restores 3 HP over 3s (30s cooldown)" },
      { value: 1, desc: "Second Wind restores +1 HP more" },
      { value: 2, desc: "Second Wind restores +2 HP more" },
    ],
  ),
  effectChain("spiked-hide", "Spiked Hide", { hook: "onHitTaken", handler: "thorns" }, [
    { value: 1, desc: "Melee attackers take 1 damage" },
    { value: 1, desc: "Thorns deal +1 damage more" },
    { value: 1, desc: "Thorns deal +1 damage more" },
  ]),
  effectChain("red-harvest", "Red Harvest", { hook: "onHitDealt", handler: "lifesteal" }, [
    { value: 0.033, desc: "Heal 1 HP per 30 damage dealt" },
    { value: 0.007, desc: "Heal 1 HP per 25 damage dealt" },
    { value: 0.01, desc: "Heal 1 HP per 20 damage dealt" },
  ]),
  effectChain(
    "executioner",
    "Executioner",
    { hook: "passive", handler: "damageVsLowHp", params: { threshold: 0.25 } },
    [
      { value: 0.1, desc: "+10% damage to enemies below 25% health" },
      { value: 0.08, desc: "Execution damage +8% more" },
      { value: 0.07, desc: "Execution damage +7% more" },
    ],
  ),
  effectChain("momentum", "Momentum", { hook: "passive", handler: "damageWhileMoving" }, [
    { value: 0.04, desc: "+4% damage while moving" },
    { value: 0.02, desc: "Moving damage +2% more" },
    { value: 0.03, desc: "Moving damage +3% more" },
  ]),
  effectChain("ambusher", "Ambusher", { hook: "passive", handler: "damageVsFullHp" }, [
    { value: 0.15, desc: "+15% damage to enemies at full health" },
    { value: 0.1, desc: "Opener damage +10% more" },
    { value: 0.15, desc: "Opener damage +15% more" },
  ]),
  effectChain(
    "rampage",
    "Rampage",
    { hook: "onKill", handler: "damageBuff", params: { duration: 3, stacks: 3 } },
    [
      { value: 0.04, desc: "Kills grant +4% damage for 3s, stacks 3×" },
      { value: 0.02, desc: "Rampage stacks +2% more" },
      { value: 0.02, desc: "Rampage stacks +2% more" },
    ],
  ),
  effectChain(
    "vengeance",
    "Vengeance",
    { hook: "onHitTaken", handler: "damageBuff", params: { duration: 3 } },
    [
      { value: 0.08, desc: "Taking a hit grants +8% damage for 3s" },
      { value: 0.04, desc: "Vengeance +4% more" },
      { value: 0.06, desc: "Vengeance +6% more" },
    ],
  ),
  effectChain("bloodrush", "Bloodrush", { hook: "onCrit", handler: "heal" }, [
    { value: 1, desc: "Crits restore 1 HP" },
    { value: 1, desc: "Crits restore +1 HP more" },
    { value: 1, desc: "Crits restore +1 HP more" },
  ]),
  effectChain("staggering-blows", "Staggering Blows", { hook: "passive", handler: "staggerChance" }, [
    { value: 0.05, desc: "Hits have a 5% chance to stagger" },
    { value: 0.03, desc: "Stagger chance +3% more" },
    { value: 0.04, desc: "Stagger chance +4% more" },
  ]),
  effectChain("opportunist", "Opportunist", { hook: "passive", handler: "damageVsStaggered" }, [
    { value: 0.1, desc: "+10% damage to staggered or knocked-back enemies" },
    { value: 0.06, desc: "Opportunist damage +6% more" },
    { value: 0.09, desc: "Opportunist damage +9% more" },
  ]),
  effectChain(
    "runners-high",
    "Runner's High",
    { hook: "onDash", handler: "statBuff", stat: "speed", params: { duration: 1.5 } },
    [
      { value: 0.08, desc: "Dashing grants +8% move speed for 1.5s" },
      { value: 0.02, desc: "Dash speed burst +2% more" },
      { value: 0.04, desc: "Dash speed burst +4% more" },
    ],
  ),
  effectChain("steadfast", "Steadfast", { hook: "passive", handler: "knockbackTaken" }, [
    { value: 0.2, desc: "Knockback you take is reduced 20%" },
    { value: 0.15, desc: "Knockback taken −15% more" },
    { value: 0.15, desc: "Knockback taken −15% more" },
  ]),

  // ── Epic: gems — single-tier, rule-bending, very rare.
  gem("ghost-step", "Ghost Step", "Dash passes through enemies", {
    effect: { hook: "passive", handler: "dashGhost", value: 1 },
  }),
  gem("impact-wave", "Impact Wave", "Every 4th attack releases a knockback shockwave", {
    effect: { hook: "passive", handler: "impactWave", value: 1, params: { every: 4 } },
  }),
  gem("piercing-volley", "Piercing Volley", "Projectiles pierce one extra enemy", {
    effect: { hook: "passive", handler: "projectilePierce", value: 1 },
  }),
  gem("glass-soul", "Glass Soul", "+25% damage · −10% max health", {
    modifiers: [
      { stat: "strength", kind: "more", value: 0.25 },
      { stat: "agility", kind: "more", value: 0.25 },
      { stat: "intellect", kind: "more", value: 0.25 },
      { stat: "vitality", kind: "more", value: -0.1 },
    ],
  }),
  gem("stone-soul", "Stone Soul", "+25% armor and max health · −10% move speed", {
    modifiers: [
      { stat: "armor", kind: "more", value: 0.25 },
      { stat: "vitality", kind: "more", value: 0.25 },
      { stat: "speed", kind: "more", value: -0.1 },
    ],
  }),
  gem("reapers-step", "Reaper's Step", "Kills reset your dash cooldown", {
    effect: { hook: "onKill", handler: "dashReset", value: 1 },
  }),
  gem("split-shot", "Split Shot", "Projectiles fork into two at 60% damage", {
    effect: { hook: "passive", handler: "projectileFork", value: 0.6 },
  }),
  gem("retaliation-wave", "Retaliation Wave", "Taking a hit has a 20% chance to emit a knockback shockwave", {
    effect: { hook: "onHitTaken", handler: "shockwave", value: 0.2 },
  }),
];

/** Every tier in the catalogue by its owned/persisted id. */
export const TALENT_TIER_BY_ID: Record<string, TalentTier> = Object.fromEntries(
  TALENT_CHAINS.flatMap((chain) => chain.tiers.map((tier) => [tier.id, tier])),
);

/** Sum of a handler's `value` across a character's owned tiers (tiers are incremental). */
export const talentEffectTotal = (owned: readonly string[], handler: string): number => {
  let total = 0;
  for (const id of owned) {
    for (const effect of TALENT_TIER_BY_ID[id]?.effects ?? []) {
      if (effect.handler === handler) total += effect.value;
    }
  }
  return total;
};

/**
 * A character's owned effects on one hook, for the sim's dispatch (Step 2 of
 * the talent build). Tiers stay separate — callers aggregate per handler with
 * talentEffectTotal, and read shared params off any entry.
 */
export const talentEffectsFor = (owned: readonly string[], hook: EffectHook): TalentEffect[] => {
  const out: TalentEffect[] = [];
  for (const id of owned) {
    for (const effect of TALENT_TIER_BY_ID[id]?.effects ?? []) {
      if (effect.hook === hook) out.push(effect);
    }
  }
  return out;
};