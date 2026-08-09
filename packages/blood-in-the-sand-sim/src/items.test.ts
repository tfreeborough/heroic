/**
 * Gated items (bits-secret-items.md): the roster split, the entitlement
 * registry, and the one content wiring that makes the teaching beat work —
 * The Sand snake pays the trident.
 */
import { describe, expect, test } from "bun:test";
import { FREE_WEAPON_IDS, WEAPON_IDS, WEAPONS } from "./config";
import { GATED_WEAPONS, ITEM_NAMES, itemDisplayName, weaponEntitlement } from "./items";
import { ACHIEVEMENT_DEFS } from "./achievements/defs";

describe("gated items", () => {
  test("the roster split is exact: free + gated = all, with no overlap", () => {
    for (const w of WEAPON_IDS) {
      expect(FREE_WEAPON_IDS.includes(w) !== GATED_WEAPONS.has(w)).toBe(true);
    }
    // Every gated id is a real weapon (a typo here would gate nothing).
    for (const w of GATED_WEAPONS) expect(WEAPON_IDS).toContain(w);
  });

  test("bots and random-fill can never draft gated steel — the free pool has none", () => {
    expect(FREE_WEAPON_IDS.some((w) => GATED_WEAPONS.has(w))).toBe(false);
  });

  test("every gated weapon is paid out by exactly one deed", () => {
    for (const w of GATED_WEAPONS) {
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === weaponEntitlement(w)),
      );
      expect(payers.length).toBe(1); // orphaned = unearnable; doubled = confusing
    }
  });

  test("every gated weapon has a display name and a codex chain", () => {
    for (const w of GATED_WEAPONS) {
      expect(ITEM_NAMES[weaponEntitlement(w)]).toBe(WEAPONS[w].name);
      expect(ACHIEVEMENT_DEFS.some((d) => d.id.startsWith(`rounds-${w}-`))).toBe(true);
    }
  });

  test("itemDisplayName falls back to Title Case for unknown ids", () => {
    expect(itemDisplayName("weapon:trident")).toBe("Trident");
    expect(itemDisplayName("weapon:chu-ko-nu")).toBe("Chu Ko Nu");
    expect(itemDisplayName("shadow-blade")).toBe("Shadow Blade");
  });
});
