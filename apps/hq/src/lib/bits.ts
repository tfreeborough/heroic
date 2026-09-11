/**
 * Blood in the Sand's HQ-side constants. The sim owns names and packs;
 * this file holds only what the game deliberately doesn't (US list prices,
 * bits-store.md § S3 — the consoles localise them, HQ estimates in USD).
 */
import { ABILITIES, WEAPONS, ACHIEVEMENT_DEFS, itemDisplayName } from "@heroic/blood-in-the-sand-sim";

export const SEASON = 1;
export const BRACKETS = ["1v1", "2v2"] as const;

export const SKU_USD: Record<string, number> = {
  signet_pack_1: 1.89,
  signet_pack_3: 4.49,
  signet_pack_6: 7.99,
};

/** `iap:<platform>:<sku>` → estimated USD at list price. */
export const iapUsd = (source: string): number => SKU_USD[source.split(":")[2] ?? ""] ?? 0;

export const weaponName = (id: string): string =>
  (WEAPONS as Record<string, { name: string } | undefined>)[id]?.name ?? id;
export const abilityName = (id: string): string =>
  (ABILITIES as Record<string, { name: string } | undefined>)[id]?.name ?? id;
export const itemName = (id: string): string => itemDisplayName(id);

export interface DeedInfo {
  id: string;
  board: string;
  title: string;
  description: string;
  secret: boolean;
}

export const deeds = (): DeedInfo[] =>
  (ACHIEVEMENT_DEFS as readonly { id: string; board: string; title: string; description: string; secret?: boolean }[]).map(
    (d) => ({ id: d.id, board: d.board, title: d.title, description: d.description, secret: d.secret === true }),
  );
