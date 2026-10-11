import { expect, test } from "bun:test";
import { EGG_RATE, EMPTY_LEDGER, type Ledger, nextSlot, playtimeFor, record, resolveEgg } from "./eggs";

const entry = (slot: number, seconds: number, egg = "") => ({ slot, seconds, playtimeFrom: 0, egg, batch: "", renderedAt: "" });

test("playtime adds up every earlier save's real length", () => {
  let l: Ledger = EMPTY_LEDGER;
  l = record(l, entry(1, 16));
  l = record(l, entry(2, 20));
  l = record(l, entry(3, 16));
  expect(playtimeFor(l, 1)).toBe(0);
  expect(playtimeFor(l, 3)).toBe(36);
  expect(playtimeFor(l, 4)).toBe(52);
  expect(nextSlot(l)).toBe(4);
  // A re-render replaces its slot.
  expect(playtimeFor(record(l, entry(2, 30)), 4)).toBe(62);
});

test("about 1 in 7 saves get an egg, never more than one", () => {
  let hits = 0;
  for (let seed = 1; seed <= 7000; seed++) if (resolveEgg("auto", 20, seed, EMPTY_LEDGER).egg) hits++;
  expect(Math.abs(hits / 7000 - EGG_RATE)).toBeLessThan(0.015);
});

test("pinned slots always get their egg; none and force override", () => {
  expect(resolveEgg("auto", 13, 5, EMPTY_LEDGER).egg?.id).toBe("unlucky");
  expect(resolveEgg("none", 13, 5, EMPTY_LEDGER).egg).toBeUndefined();
  expect(resolveEgg("freeze", 4, 5, EMPTY_LEDGER).egg?.id).toBe("freeze");
});

test("an egg on cooldown can't fire again", () => {
  const l = record(EMPTY_LEDGER, entry(19, 16, "freeze"));
  for (let seed = 1; seed <= 3000; seed++) expect(resolveEgg("auto", 20, seed, l).egg?.id).not.toBe("freeze");
});
