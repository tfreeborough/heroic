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
 * FINISHERS (bits-cosmetics.md § Finishers v1) are the third gated family:
 * `finisher:<id>`, the same deed/signet split, but cosmetic — the sim never
 * reads one. There is no free finisher: every id is gated, the default is
 * "none", and the server GRANTS a worn finisher only after an ownership read
 * (default-deny, in ranked AND skirmish — being seen is the product).
 *
 * ITEM_NAMES retires the kebab-case humaniser for reward lines: codex and
 * ceremony read display names from here; unknown ids (a newer server's
 * content) fall back to Title-Casing the id's tail.
 */
import type { AbilityId, WeaponId } from "./config";

/** Achievement-granted secrets (bits-secret-items.md). */
export const DEED_WEAPONS: ReadonlySet<WeaponId> = new Set<WeaponId>(["trident"]);
export const DEED_ABILITIES: ReadonlySet<AbilityId> = new Set<AbilityId>(["call-the-tide"]);

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

/** Kill finishers (bits-cosmetics.md). "none" is the bare default and is
 * never an entitlement; every other id is gated by exactly one kind. */
export const FINISHER_NONE = "none";
export const FINISHER_IDS = [
  FINISHER_NONE,
  "butterflies",
  "smite",
  "constellation",
  "medusa",
  "snuffed",
] as const;
export type FinisherId = (typeof FINISHER_IDS)[number];
export type OwnableFinisherId = Exclude<FinisherId, typeof FINISHER_NONE>;

export const SIGNET_FINISHERS: ReadonlySet<OwnableFinisherId> = new Set<OwnableFinisherId>([
  "butterflies",
  "smite",
  "constellation",
  "medusa",
]);
/** Earned, never sold — Snuffed rides the Gravedigger deed. */
export const DEED_FINISHERS: ReadonlySet<OwnableFinisherId> = new Set<OwnableFinisherId>(["snuffed"]);

export const finisherEntitlement = (finisher: OwnableFinisherId): string => `finisher:${finisher}`;

/** A wire claim → a finisher this build knows and that CAN be owned, or
 * null ("none", junk, a newer client's id). The server's grant check and
 * the client's renderer both start here. */
export const ownableFinisher = (claim: unknown): OwnableFinisherId | null =>
  typeof claim === "string" && claim !== FINISHER_NONE && (FINISHER_IDS as readonly string[]).includes(claim)
    ? (claim as OwnableFinisherId)
    : null;

/** The one ownership test (server grant, practice, the wardrobe): the claim
 * if `owned` holds its entitlement, else "none". Default-deny by shape. */
export const grantedFinisher = (claim: unknown, owned: Iterable<string>): FinisherId => {
  const id = ownableFinisher(claim);
  if (id === null) return FINISHER_NONE;
  const need = finisherEntitlement(id);
  for (const itemId of owned) if (itemId === need) return id;
  return FINISHER_NONE;
};

/** Every entitlement id the store may sell — the API's unlock endpoint
 * refuses anything not in this list (deed items are never purchasable). */
export const SIGNET_ITEM_IDS: readonly string[] = [
  ...[...SIGNET_WEAPONS].map(weaponEntitlement),
  ...[...SIGNET_ABILITIES].map(abilityEntitlement),
  ...[...SIGNET_FINISHERS].map(finisherEntitlement),
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
  "ability:call-the-tide": "Call the Tide",
  "finisher:butterflies": "Butterflies",
  "finisher:smite": "Smite",
  "finisher:constellation": "Among the Stars",
  "finisher:medusa": "Medusa",
  "finisher:snuffed": "Snuffed",
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
