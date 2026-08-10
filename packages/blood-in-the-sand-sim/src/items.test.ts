/**
 * Gated items (bits-secret-items.md, bits-store.md): the roster split, the
 * two gate kinds, and the content wiring each kind demands — a deed item
 * must be earnable (The Sand snake pays the trident), a writ item must
 * never be.
 */
import { describe, expect, test } from "bun:test";
import { FREE_WEAPON_IDS, WEAPON_IDS, WEAPONS } from "./config";
import {
  DEED_WEAPONS,
  GATED_WEAPONS,
  ITEM_NAMES,
  WRIT_ITEM_IDS,
  WRIT_WEAPONS,
  itemDisplayName,
  weaponEntitlement,
} from "./items";
import { ACHIEVEMENT_DEFS } from "./achievements/defs";

describe("gated items", () => {
  test("the roster split is exact: free + gated = all, with no overlap", () => {
    for (const w of WEAPON_IDS) {
      expect(FREE_WEAPON_IDS.includes(w) !== GATED_WEAPONS.has(w)).toBe(true);
    }
    // Every gated id is a real weapon (a typo here would gate nothing).
    for (const w of GATED_WEAPONS) expect(WEAPON_IDS).toContain(w);
  });

  test("a gated weapon has exactly one gate kind — deed XOR writ", () => {
    for (const w of GATED_WEAPONS) {
      expect(DEED_WEAPONS.has(w) !== WRIT_WEAPONS.has(w)).toBe(true);
    }
  });

  test("bots and random-fill can never draft gated steel — the free pool has none", () => {
    expect(FREE_WEAPON_IDS.some((w) => GATED_WEAPONS.has(w))).toBe(false);
  });

  test("every deed weapon is paid out by exactly one deed", () => {
    for (const w of DEED_WEAPONS) {
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === weaponEntitlement(w)),
      );
      expect(payers.length).toBe(1); // orphaned = unearnable; doubled = confusing
    }
  });

  test("no writ weapon is ever paid out by a deed — Writs cannot buy secrets, deeds cannot leak the shelf", () => {
    for (const w of WRIT_WEAPONS) {
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === weaponEntitlement(w)),
      );
      expect(payers.length).toBe(0);
    }
  });

  test("the store shelf lists every writ item and nothing else", () => {
    for (const w of WRIT_WEAPONS) expect(WRIT_ITEM_IDS).toContain(weaponEntitlement(w));
    for (const w of DEED_WEAPONS) expect(WRIT_ITEM_IDS).not.toContain(weaponEntitlement(w));
    expect(WRIT_ITEM_IDS.length).toBe(new Set(WRIT_ITEM_IDS).size);
  });

  test("every gated weapon has a display name; deed weapons also a codex chain", () => {
    for (const w of GATED_WEAPONS) {
      expect(ITEM_NAMES[weaponEntitlement(w)]).toBe(WEAPONS[w].name);
    }
    // The per-weapon rounds codex is the DEED breadcrumb trail — writ items
    // are advertised by the Armory instead, not hinted by achievements.
    for (const w of DEED_WEAPONS) {
      expect(ACHIEVEMENT_DEFS.some((d) => d.id.startsWith(`rounds-${w}-`))).toBe(true);
    }
  });

  test("itemDisplayName falls back to Title Case for unknown ids", () => {
    expect(itemDisplayName("weapon:trident")).toBe("Trident");
    expect(itemDisplayName("weapon:chu-ko-nu")).toBe("Chu Ko Nu");
    expect(itemDisplayName("shadow-blade")).toBe("Shadow Blade");
  });
});
