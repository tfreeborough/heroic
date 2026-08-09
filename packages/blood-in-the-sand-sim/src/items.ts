/**
 * Gated items + the item-name registry (bits-secret-items.md).
 *
 * A GATED item exists in the sim like any other roster entry but is only
 * pickable once its `weapon:<id>` / `ability:<id>` entitlement has been
 * earned through a deed. One source of truth, three readers: the arming
 * wizard (hide unearned — never grey; a secret doesn't exist until it's
 * yours), the server's ranked pick validation, and the drafting sweep
 * (bots + forceStart random-fill use the FREE roster only — Tom,
 * 2026-08-09: bots never touch gated items, permanently).
 *
 * ITEM_NAMES retires the kebab-case humaniser for reward lines: codex and
 * ceremony read display names from here; unknown ids (a newer server's
 * content) fall back to Title-Casing the id's tail.
 */
import type { AbilityId, WeaponId } from "./config";

export const GATED_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>(["trident"]);
export const GATED_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>([]);

export const weaponEntitlement = (weapon: WeaponId): string => `weapon:${weapon}`;
export const abilityEntitlement = (ability: AbilityId): string => `ability:${ability}`;

/** Entitlement itemId → display name. Titles are NOT here (a title's
 * display string is its deed's own name — resolved from ACHIEVEMENT_DEFS). */
export const ITEM_NAMES: Record<string, string> = {
  "weapon:trident": "Trident",
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
