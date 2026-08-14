/**
 * Gated items + the item-name registry (bits-secret-items.md, bits-store.md).
 *
 * A GATED item exists in the sim like any other roster entry but is only
 * pickable once its `weapon:<id>` / `ability:<id>` entitlement is owned.
 * Two gate kinds decide how the entitlement is EARNED and how the item is
 * SHOWN before it's yours:
 *
 *  - `deed` (secret items): granted by an achievement. Hidden everywhere
 *    until owned — a secret doesn't exist until it's yours.
 *  - `writ` (store items): bought with a Writ in the Armory. Visible and
 *    locked in the Armory, absent from the wizard until owned (Tom,
 *    2026-08-09), fully usable in practice (try-before-buy).
 *
 * Both kinds resolve to the same entitlement rows; the server's ranked pick
 * validation reads the GATED_* unions and needs no kind at all. Drafting
 * (bots + forceStart random-fill) uses the FREE roster only — Tom,
 * 2026-08-09: bots never touch gated items of either kind, permanently.
 *
 * ITEM_NAMES retires the kebab-case humaniser for reward lines: codex and
 * ceremony read display names from here; unknown ids (a newer server's
 * content) fall back to Title-Casing the id's tail.
 */
import type { AbilityId, WeaponId } from "./config";

/** Achievement-granted secrets (bits-secret-items.md). */
export const DEED_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>(["trident"]);
export const DEED_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([]);

/** Writ-purchasable store items (bits-store.md) — stocked by the pre-launch
 * content drops (bits-store-arms.md); a roster id lives in exactly one gate
 * kind, never both. */
export const WRIT_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "fang",
  "scorpion",
  "bombard",
  "lifeline",
]);
export const WRIT_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([
  "sinkhole",
  "tar-pit",
  "titans-draught",
]);

/** All gated ids regardless of kind — what pick validation and the
 * free-roster partition care about. */
export const GATED_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>([
  ...DEED_WEAPONS,
  ...WRIT_WEAPONS,
]);
export const GATED_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([
  ...DEED_ABILITIES,
  ...WRIT_ABILITIES,
]);

export const weaponEntitlement = (weapon: WeaponId): string => `weapon:${weapon}`;
export const abilityEntitlement = (ability: AbilityId): string => `ability:${ability}`;

/** Every entitlement id the store may sell — the API's unlock endpoint
 * refuses anything not in this list (deed items are never purchasable). */
export const WRIT_ITEM_IDS: readonly string[] = [
  ...[...WRIT_WEAPONS].map(weaponEntitlement),
  ...[...WRIT_ABILITIES].map(abilityEntitlement),
];

/** Entitlement itemId → display name. Titles are NOT here (a title's
 * display string is its deed's own name — resolved from ACHIEVEMENT_DEFS). */
export const ITEM_NAMES: Record<string, string> = {
  "weapon:trident": "Trident",
  "weapon:fang": "Fang",
  "weapon:scorpion": "Scorpion",
  "weapon:bombard": "Bombard",
  "weapon:lifeline": "Lifeline",
  "ability:sinkhole": "Sinkhole",
  "ability:tar-pit": "Tar Pit",
  "ability:titans-draught": "Titan's Draught",
};

/** Display name for an entitlement itemId, with the legacy kebab fallback
 * for ids this bundle doesn't know yet. */
export const itemDisplayName = (itemId: string): string =>
  ITEM_NAMES[itemId] ??
  itemId
    .split(":")
    .pop()!
    .split("-")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
