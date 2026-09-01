/**
 * Showcase matches — the promo video factory's hands-free footage source
 * (apps/bits-promos, docs/marketing.md, docs/design/bits-showcase-scripts.md).
 * A deep link
 *
 *   bloodinthesand://showcase?feature=sinkhole      (an ability spotlight)
 *   bloodinthesand://showcase?weapon=trident        (a weapon spotlight)
 *
 * drops the app straight into an offline practice match where EVERY seat is
 * driven by the item's choreographed script (showcaseScripts.ts) — seat 0
 * is the star and the camera's subject — so a screen recording of the
 * simulator shows the item demonstrated once, clearly. The capture script
 * in bits-promos opens the link with `xcrun simctl openurl` and records.
 *
 * Only honoured when the bundle was started with EXPO_PUBLIC_SHOWCASE=1 —
 * shipped builds never react to the link.
 */
import { ABILITY_IDS, WEAPON_IDS, type AbilityId, type WeaponId } from "@heroic/blood-in-the-sand-sim";
import { abilityScript, weaponScript, type ShowcaseScript } from "./showcaseScripts";

export const SHOWCASE_ENABLED = process.env.EXPO_PUBLIC_SHOWCASE === "1";

export interface ShowcaseRequest {
  kind: "weapon" | "ability";
  id: WeaponId | AbilityId;
  script: ShowcaseScript;
}

const isWeapon = (s: string): s is WeaponId => (WEAPON_IDS as readonly string[]).includes(s);
const isAbility = (s: string): s is AbilityId => (ABILITY_IDS as readonly string[]).includes(s);

/** Parse a showcase URL; null for anything that isn't one (or is malformed).
 * `feature` (an ability) wins over `weapon` when both are given. */
export const parseShowcaseUrl = (url: string): ShowcaseRequest | null => {
  const m = /^bloodinthesand:\/\/showcase\/?(?:\?(.*))?$/.exec(url);
  if (!m) return null;
  const q = new URLSearchParams(m[1] ?? "");
  const feature = q.get("feature");
  if (feature) {
    return isAbility(feature) ? { kind: "ability", id: feature, script: abilityScript(feature) } : null;
  }
  const weapon = q.get("weapon") ?? "blade";
  return isWeapon(weapon) ? { kind: "weapon", id: weapon, script: weaponScript(weapon) } : null;
};
