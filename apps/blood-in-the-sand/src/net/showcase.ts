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
  tier: DifficultyId;
}

const isWeapon = (s: string): s is WeaponId => (WEAPON_IDS as readonly string[]).includes(s);
const isAbility = (s: string): s is AbilityId => (ABILITY_IDS as readonly string[]).includes(s);
const isTier = (s: string): s is DifficultyId => (DIFFICULTY_IDS as readonly string[]).includes(s);

/** Fill a hand up to LOADOUT_ABILITY_COUNT with sensible, distinct picks. */
const FILLERS: AbilityId[] = ["dash", "harpoon", "ironhide"];

/** Parse a showcase URL; null for anything that isn't one (or is malformed). */
export const parseShowcaseUrl = (url: string): ShowcaseRequest | null => {
  const m = /^bloodinthesand:\/\/showcase\/?(?:\?(.*))?$/.exec(url);
  if (!m) return null;
  const q = new URLSearchParams(m[1] ?? "");
  const weaponRaw = q.get("weapon") ?? "blade";
  if (!isWeapon(weaponRaw)) return null;
  const abilities: AbilityId[] = [];
  for (const raw of (q.get("abilities") ?? "").split(",")) {
    if (isAbility(raw) && !abilities.includes(raw)) abilities.push(raw);
  }
  const featureRaw = q.get("feature");
  const feature = featureRaw && isAbility(featureRaw) ? featureRaw : null;
  if (feature && !abilities.includes(feature)) abilities.unshift(feature);
  for (const f of FILLERS) {
    if (abilities.length >= LOADOUT_ABILITY_COUNT) break;
    if (!abilities.includes(f)) abilities.push(f);
  }
  const tierRaw = q.get("tier") ?? "";
  return {
    weapon: weaponRaw,
    abilities: abilities.slice(0, LOADOUT_ABILITY_COUNT),
    feature,
    tier: isTier(tierRaw) ? tierRaw : DEFAULT_DIFFICULTY,
  };
};
