import { describe, expect, test } from "bun:test";
import type { Aabb } from "../physics/crowd";
import {
  addKey,
  DOOR_UNLOCK_MARGIN,
  emptyInventory,
  hasKey,
  isKeyColor,
  KEY_COLOR_IDS,
  KEY_PICKUP_RADIUS,
  keyColorDef,
  keyCount,
  playerAtDoor,
  playerAtKey,
  spendKey,
} from "./keys";

describe("palette", () => {
  test("ids round-trip through isKeyColor / keyColorDef", () => {
    for (const id of KEY_COLOR_IDS) {
      expect(isKeyColor(id)).toBe(true);
      expect(keyColorDef(id).id).toBe(id);
      expect(keyColorDef(id).hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("rejects non-palette strings and non-strings", () => {
    expect(isKeyColor("silver")).toBe(false);
    expect(isKeyColor("")).toBe(false);
    expect(isKeyColor(42)).toBe(false);
    expect(isKeyColor(undefined)).toBe(false);
  });
});

describe("inventory", () => {
  test("starts empty", () => {
    const inv = emptyInventory();
    expect(keyCount(inv, "red")).toBe(0);
    expect(hasKey(inv, "red")).toBe(false);
  });

  test("addKey accumulates per color without touching others", () => {
    let inv = addKey(emptyInventory(), "red");
    inv = addKey(inv, "red");
    inv = addKey(inv, "blue", 3);
    expect(keyCount(inv, "red")).toBe(2);
    expect(keyCount(inv, "blue")).toBe(3);
    expect(keyCount(inv, "gold")).toBe(0);
    expect(hasKey(inv, "red")).toBe(true);
  });

  test("spendKey consumes exactly one, and is a no-op when empty", () => {
    let inv = addKey(emptyInventory(), "gold", 2);
    inv = spendKey(inv, "gold");
    expect(keyCount(inv, "gold")).toBe(1);
    inv = spendKey(inv, "gold");
    expect(keyCount(inv, "gold")).toBe(0);
    // spending what you don't have changes nothing (caller may not have guarded)
    const before = inv;
    const after = spendKey(inv, "gold");
    expect(keyCount(after, "gold")).toBe(0);
    expect(after).toBe(before);
  });

  test("helpers are immutable — the source inventory is never mutated", () => {
    const inv = addKey(emptyInventory(), "red", 1);
    const grown = addKey(inv, "red");
    const spent = spendKey(inv, "red");
    expect(keyCount(inv, "red")).toBe(1); // unchanged
    expect(keyCount(grown, "red")).toBe(2);
    expect(keyCount(spent, "red")).toBe(0);
  });
});

describe("reach tests", () => {
  // A 40×40 door footprint centred at the origin (Aabb is centre + size).
  const door: Aabb = { x: 0, y: 0, w: 40, h: 40 };
  const radius = 14;

  test("playerAtDoor is true on contact and false out of reach", () => {
    // Touching the right edge (edge at x=20) from just outside, within radius+margin.
    const justTouching = 20 + radius + DOOR_UNLOCK_MARGIN - 1;
    expect(playerAtDoor(door, { x: justTouching, y: 0 }, radius)).toBe(true);
    // A hair beyond reach.
    const justClear = 20 + radius + DOOR_UNLOCK_MARGIN + 1;
    expect(playerAtDoor(door, { x: justClear, y: 0 }, radius)).toBe(false);
  });

  test("playerAtKey uses centre distance against radius + pickup", () => {
    const key = { x: 0, y: 0 };
    const within = radius + KEY_PICKUP_RADIUS - 1;
    expect(playerAtKey(key, { x: within, y: 0 }, radius)).toBe(true);
    const beyond = radius + KEY_PICKUP_RADIUS + 1;
    expect(playerAtKey(key, { x: beyond, y: 0 }, radius)).toBe(false);
  });
});
