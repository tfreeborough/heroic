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
 *  - `signet` (store items): bought with a Signet in the Armory. Visible and
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

/** Signet-purchasable store items (bits-store.md) — stocked by the pre-launch
 * content drops (bits-store-arms.md); a roster id lives in exactly one gate
 * kind, never both. */
export const SIGNET_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>([
  "fang",
  "scorpion",
  "bombard",
  "lifeline",
]);
export const SIGNET_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([
  "sinkhole",
  "tar-pit",
  "titans-draught",
]);

/** All gated ids regardless of kind — what pick validation and the
 * free-roster partition care about. */
export const GATED_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>([
  ...DEED_WEAPONS,
  ...SIGNET_WEAPONS,
]);
export const GATED_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([
  ...DEED_ABILITIES,
  ...SIGNET_ABILITIES,
]);

export const weaponEntitlement = (weapon: WeaponId): string => `weapon:${weapon}`;
export const abilityEntitlement = (ability: AbilityId): string => `ability:${ability}`;

/** Every entitlement id the store may sell — the API's unlock endpoint
 * refuses anything not in this list (deed items are never purchasable). */
export const SIGNET_ITEM_IDS: readonly string[] = [
  ...[...SIGNET_WEAPONS].map(weaponEntitlement),
  ...[...SIGNET_ABILITIES].map(abilityEntitlement),
];

/**
 * The IAP Signet packs (bits-store.md § S3, ratified 2026-08-15): product ids
 * as configured in App Store Connect / Play Console (identical on both
 * stores) → Signets credited. The API credits FROM THIS TABLE ONLY — a signet
 * count never travels from the client — and the client derives its SKU list
 * from the keys. Prices live in the store consoles (localized), never here:
 * 1 @ $1.89 · 3 @ $4.49 · 6 @ $7.99.
 */
export const SIGNET_PACKS: Readonly<Record<string, number>> = {
  signet_pack_1: 1,
  signet_pack_3: 3,
  signet_pack_6: 6,
};

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
