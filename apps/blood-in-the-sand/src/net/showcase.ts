/**
 * Showcase matches — the promo video factory's hands-free footage source
 * (apps/bits-promos, docs/marketing.md). A deep link
 *
 *   bloodinthesand://showcase?weapon=trident&abilities=sinkhole,dash&feature=sinkhole&tier=skilled
 *
 * drops the app straight into an offline practice 1v1 where seat 0 (the
 * "human") is driven by the shared bot brain and the featured ability is
 * fired at the first sensible moment, so a screen recording of the
 * simulator shows the item actually being used. The capture script in
 * bits-promos opens the link with `xcrun simctl openurl` and records.
 *
 * Only honoured when the bundle was started with EXPO_PUBLIC_SHOWCASE=1 —
 * shipped builds never react to the link.
 */
import {
  ABILITY_IDS,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_IDS,
  LOADOUT_ABILITY_COUNT,
  WEAPON_IDS,
  type AbilityId,
  type DifficultyId,
  type WeaponId,
} from "@heroic/blood-in-the-sand-sim";

export const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";

export interface ShowcaseRequest {
  weapon: WeaponId;
  abilities: AbilityId[];
  /** The ability the autopilot fires eagerly (must be in `abilities`). */
  feature: AbilityId | null;
  /** OUR execution tier — defaults to the top of the ladder so the star of
   * the clip looks like the best player in the room. */
  tier: DifficultyId;
  /** The opponent: a low tier and a quiet kit by default, so nothing on
   * their side upstages the item being shown (Tom, 2026-08-29). */
  enemy: { weapon: WeaponId; abilities: AbilityId[]; tier: DifficultyId };
}

const TOP_TIER = DIFFICULTY_IDS[DIFFICULTY_IDS.length - 1] ?? DEFAULT_DIFFICULTY;
const BOTTOM_TIER = DIFFICULTY_IDS[0] ?? DEFAULT_DIFFICULTY;
/** A sparring partner's kit: melee (keeps the fight in frame) + the least
 * spectacular hand — a dodge and a self-buff, no zones, pulls or decoys. */
const QUIET_ENEMY: { weapon: WeaponId; abilities: AbilityId[] } = {
  weapon: "blade",
  abilities: ["dash", "ironhide"],
};

const isWeapon = (s: string): s is WeaponId => (WEAPON_IDS as readonly string[]).includes(s);
const isAbility = (s: string): s is AbilityId => (ABILITY_IDS as readonly string[]).includes(s);
const isTier = (s: string): s is DifficultyId => (DIFFICULTY_IDS as readonly string[]).includes(s);

/** Fill a hand up to LOADOUT_ABILITY_COUNT with sensible, distinct picks. */
const FILLERS: AbilityId[] = ["dash", "harpoon", "ironhide"];

/** A distinct hand from a comma list, topped up with fillers. */
const parseHand = (raw: string | null, lead: AbilityId | null, fillers: AbilityId[]): AbilityId[] => {
  const hand: AbilityId[] = [];
  const add = (a: AbilityId) => {
    if (hand.length < LOADOUT_ABILITY_COUNT && !hand.includes(a)) hand.push(a);
  };
  if (lead) add(lead);
  for (const s of (raw ?? "").split(",")) if (isAbility(s)) add(s);
  for (const f of fillers) add(f);
  return hand;
};

/** Parse a showcase URL; null for anything that isn't one (or is malformed). */
export const parseShowcaseUrl = (url: string): ShowcaseRequest | null => {
  const m = /^bloodinthesand:\/\/showcase\/?(?:\?(.*))?$/.exec(url);
  if (!m) return null;
  const q = new URLSearchParams(m[1] ?? "");
  const weaponRaw = q.get("weapon") ?? "blade";
  if (!isWeapon(weaponRaw)) return null;
  const featureRaw = q.get("feature");
  const feature = featureRaw && isAbility(featureRaw) ? featureRaw : null;
  const tierRaw = q.get("tier") ?? "";
  const enemyWeaponRaw = q.get("enemyWeapon") ?? "";
  const enemyTierRaw = q.get("enemyTier") ?? "";
  return {
    weapon: weaponRaw,
    abilities: parseHand(q.get("abilities"), feature, FILLERS),
    feature,
    tier: isTier(tierRaw) ? tierRaw : TOP_TIER,
    enemy: {
      weapon: isWeapon(enemyWeaponRaw) ? enemyWeaponRaw : QUIET_ENEMY.weapon,
      abilities: parseHand(q.get("enemyAbilities"), null, QUIET_ENEMY.abilities),
      tier: isTier(enemyTierRaw) ? enemyTierRaw : BOTTOM_TIER,
    },
  };
};
