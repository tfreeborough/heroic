/**
 * Gated items (bits-secret-items.md, bits-store.md): the roster split, the
 * two gate kinds, and the content wiring each kind demands — a deed item
 * must be earnable (The Sand snake pays the trident), a signet item must
 * never be.
 */
import { describe, expect, test } from "bun:test";
import {
  ABILITIES,
  ABILITY_IDS,
  FREE_ABILITY_IDS,
  FREE_WEAPON_IDS,
  WEAPON_IDS,
  WEAPONS,
} from "./config";
import {
  DEED_ABILITIES,
  DEED_FINISHERS,
  DEED_WEAPONS,
  FINISHER_IDS,
  GATED_ABILITIES,
  GATED_WEAPONS,
  ITEM_NAMES,
  SIGNET_ABILITIES,
  SIGNET_FINISHERS,
  SIGNET_ITEM_IDS,
  SIGNET_WEAPONS,
  abilityEntitlement,
  finisherEntitlement,
  grantedFinisher,
  itemDisplayName,
  ownableFinisher,
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
    // The ability twin — FREE_ABILITY_IDS is a literal exclusion list in
    // config (it can't import items.ts), so THIS is what keeps the two
    // files honest: an ability gated here must be excluded there.
    for (const a of ABILITY_IDS) {
      expect(FREE_ABILITY_IDS.includes(a) !== GATED_ABILITIES.has(a)).toBe(true);
    }
    for (const a of GATED_ABILITIES) expect(ABILITY_IDS).toContain(a);
  });

  test("a gated weapon has exactly one gate kind — deed XOR signet", () => {
    for (const w of GATED_WEAPONS) {
      expect(DEED_WEAPONS.has(w) !== SIGNET_WEAPONS.has(w)).toBe(true);
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

  test("every deed ability is paid out by exactly one deed", () => {
    for (const a of DEED_ABILITIES) {
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === abilityEntitlement(a)),
      );
      expect(payers.length).toBe(1);
    }
  });

  test("no signet weapon is ever paid out by a deed — Signets cannot buy secrets, deeds cannot leak the shelf", () => {
    for (const w of SIGNET_WEAPONS) {
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === weaponEntitlement(w)),
      );
      expect(payers.length).toBe(0);
    }
  });

  test("the store shelf lists every signet item and nothing else", () => {
    for (const w of SIGNET_WEAPONS) expect(SIGNET_ITEM_IDS).toContain(weaponEntitlement(w));
    for (const a of SIGNET_ABILITIES) expect(SIGNET_ITEM_IDS).toContain(abilityEntitlement(a));
    for (const w of DEED_WEAPONS) expect(SIGNET_ITEM_IDS).not.toContain(weaponEntitlement(w));
    expect(SIGNET_ITEM_IDS.length).toBe(new Set(SIGNET_ITEM_IDS).size);
  });

  test("every gated ability has a display name", () => {
    for (const a of GATED_ABILITIES) {
      expect(ITEM_NAMES[abilityEntitlement(a)]).toBe(ABILITIES[a].name);
    }
  });

  test("every gated weapon has a display name; deed weapons also a codex chain", () => {
    for (const w of GATED_WEAPONS) {
      expect(ITEM_NAMES[weaponEntitlement(w)]).toBe(WEAPONS[w].name);
    }
    // The per-weapon rounds codex is the DEED breadcrumb trail — signet items
    // are advertised by the Armory instead, not hinted by achievements.
    for (const w of DEED_WEAPONS) {
      expect(ACHIEVEMENT_DEFS.some((d) => d.id.startsWith(`rounds-${w}-`))).toBe(true);
    }
  });

  // ── kill finishers (bits-cosmetics.md § Finishers v1) ────────────────────
  test("every finisher but \"none\" has exactly one gate kind — there is no free finisher", () => {
    for (const f of FINISHER_IDS) {
      if (f === "none") continue;
      expect(DEED_FINISHERS.has(f) !== SIGNET_FINISHERS.has(f)).toBe(true);
      expect(ITEM_NAMES[finisherEntitlement(f)]).toBeDefined();
    }
    for (const f of [...DEED_FINISHERS, ...SIGNET_FINISHERS]) expect(FINISHER_IDS).toContain(f);
  });

  test("the shelf sells every signet finisher and no deed finisher; no deed pays a signet finisher", () => {
    for (const f of SIGNET_FINISHERS) {
      expect(SIGNET_ITEM_IDS).toContain(finisherEntitlement(f));
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === finisherEntitlement(f)),
      );
      expect(payers.length).toBe(0);
    }
    for (const f of DEED_FINISHERS) expect(SIGNET_ITEM_IDS).not.toContain(finisherEntitlement(f));
  });

  test("every deed finisher is paid out by exactly one deed", () => {
    for (const f of DEED_FINISHERS) {
      const payers = ACHIEVEMENT_DEFS.filter((d) =>
        (d.rewards ?? []).some((r) => r.kind === "entitlement" && r.itemId === finisherEntitlement(f)),
      );
      expect(payers.length).toBe(1);
    }
  });

  test("a finisher is granted only against its own entitlement — default-deny", () => {
    expect(grantedFinisher("medusa", ["finisher:medusa"])).toBe("medusa");
    expect(grantedFinisher("medusa", ["finisher:butterflies", "weapon:fang"])).toBe("none");
    expect(grantedFinisher("medusa", [])).toBe("none");
    expect(grantedFinisher("none", ["finisher:none"])).toBe("none");
    expect(grantedFinisher("free-lunch", ["finisher:free-lunch"])).toBe("none"); // unknown ids never dress a seat
    expect(grantedFinisher(undefined, ["finisher:medusa"])).toBe("none");
    expect(ownableFinisher("snuffed")).toBe("snuffed");
    expect(ownableFinisher(42)).toBeNull();
  });

  test("itemDisplayName falls back to Title Case for unknown ids", () => {
    expect(itemDisplayName("weapon:trident")).toBe("Trident");
    expect(itemDisplayName("weapon:chu-ko-nu")).toBe("Chu Ko Nu");
    expect(itemDisplayName("shadow-blade")).toBe("Shadow Blade");
  });
});
