/**
 * Every easter egg in one list, and the slot ledger that keeps PLAYTIME
 * honest (docs/design/save-point-channel.md, "Playtime + the egg registry").
 *
 * At most one egg per save, and only some saves get one. A pinned slot
 * always gets its egg; otherwise one seeded roll at EGG_RATE decides
 * whether there's an egg at all, then a weighted pick among the live eggs
 * that aren't on cooldown. Make can override (none, or force one).
 *
 * To add an idea so it isn't forgotten: add an entry with status "idea"
 * and a note. It never fires, and the Saves tab lists it.
 */
import { mulberry } from "@heroic/ascii-build";

export type EggEffect = "playtime-backwards" | "playtime-freeze" | "playtime-dashes" | "playtime-unknown" | "achievement";

export type Egg = {
  id: string;
  label: string;
  /** What it is, for the Saves tab (and for an idea, what it would be). */
  note: string;
  status: "live" | "idea";
  effect?: EggEffect;
  /** Always fires on these slots (and only these, unless it also has a weight). */
  slots?: number[];
  /** Relative odds in the roll (a pinned-only egg has none). */
  weight?: number;
  /** Can't fire again within this many slots of the last time. */
  cooldown?: number;
};

/** About one save in seven gets an egg from the roll. */
export const EGG_RATE = 1 / 7;

export const EGGS: Egg[] = [
  { id: "backwards", label: "Clock runs backwards", note: "Partway through the build PLAYTIME runs backwards for about a second, then snaps forward and carries on.", status: "live", effect: "playtime-backwards", weight: 3, cooldown: 8 },
  { id: "dashes", label: "--:--:-- until saved", note: "PLAYTIME reads --:--:-- while it saves, then snaps to the right time.", status: "live", effect: "playtime-dashes", weight: 3, cooldown: 8 },
  { id: "freeze", label: "Frozen at 99:59:59", note: "PLAYTIME shows the old games' cap, 99:59:59, and doesn't tick. Back to normal next save.", status: "live", effect: "playtime-freeze", weight: 1, cooldown: 25 },
  { id: "achievement", label: "Achievement unlocked", note: "A box drops in after the save: \"Achievement unlocked. Watched one to the end\".", status: "live", effect: "achievement", weight: 2, cooldown: 6 },
  { id: "unlucky", label: "?? hours on slot 13", note: "Slot 13's PLAYTIME hours read ??.", status: "live", effect: "playtime-unknown", slots: [13] },
];

// ── the ledger: public/slots.json, written by the Desk when a Save renders ──

export type SlotEntry = {
  slot: number;
  /** The video's actual length. */
  seconds: number;
  /** PLAYTIME at its first frame. */
  playtimeFrom: number;
  /** The egg it got ("" for none). */
  egg: string;
  batch: string;
  renderedAt: string;
};
export type Ledger = { slots: SlotEntry[] };
export const EMPTY_LEDGER: Ledger = { slots: [] };

/** The ledger with this entry in it (a re-render replaces its slot). */
export const record = (l: Ledger, e: SlotEntry): Ledger => ({ slots: [...l.slots.filter((x) => x.slot !== e.slot), e].sort((a, b) => a.slot - b.slot) });

/** PLAYTIME at the start of `slot`: every earlier save's real length, added up. */
export const playtimeFor = (l: Ledger, slot: number) => l.slots.filter((e) => e.slot < slot).reduce((n, e) => n + e.seconds, 0);

/** Earlier slots with no render: their length can't be counted yet. */
export const missingBefore = (l: Ledger, slot: number) => {
  const have = new Set(l.slots.map((e) => e.slot));
  return Array.from({ length: Math.max(0, slot - 1) }, (_, i) => i + 1).filter((s) => !have.has(s));
};

export const nextSlot = (l: Ledger) => (l.slots.length ? Math.max(...l.slots.map((e) => e.slot)) + 1 : 1);

export const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

/** The save's egg: `choice` is "auto", "none" or an egg id. Only earlier slots count for cooldowns. */
export const resolveEgg = (choice: string, slot: number, seed: number, l: Ledger): { egg?: Egg; why: string } => {
  const live = EGGS.filter((e) => e.status === "live");
  if (choice === "none") return { why: "Eggs turned off for this one." };
  if (choice !== "auto") {
    const forced = live.find((e) => e.id === choice);
    return forced ? { egg: forced, why: "Forced in Make." } : { why: `No live egg called ${choice}.` };
  }
  const pinned = live.find((e) => e.slots?.includes(slot));
  if (pinned) return { egg: pinned, why: `Pinned to slot ${slot}.` };
  const r = mulberry(seed * 97 + slot * 13 + 7);
  if (r() >= EGG_RATE) return { why: `No egg this time (about 1 in ${Math.round(1 / EGG_RATE)} saves get one).` };
  const cooling = (e: Egg) => l.slots.some((x) => x.egg === e.id && x.slot < slot && slot - x.slot <= (e.cooldown ?? 0));
  const pool = live.filter((e) => (e.weight ?? 0) > 0 && !cooling(e));
  if (!pool.length) return { why: "The roll hit, but every egg is on cooldown." };
  let pick = r() * pool.reduce((n, e) => n + e.weight!, 0);
  const egg = pool.find((e) => (pick -= e.weight!) < 0) ?? pool[pool.length - 1]!;
  return { egg, why: `The 1-in-${Math.round(1 / EGG_RATE)} roll hit.` };
};
