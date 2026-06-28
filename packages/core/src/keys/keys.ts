/**
 * Keys & locked doors — the light puzzle layer borrowed from Gauntlet (1985):
 * color-matched keys open color-matched doors, and keys are **consumed** on use
 * so the player has to choose which door to spend one on. See
 * docs/design/doors-and-keys.md.
 *
 * This is the **pure** half: the fixed color palette, the per-run key inventory
 * (a count per color) with add/spend/has helpers, and the proximity tests that
 * decide "is the player touching this key / this door".
 *
 * There is deliberately no door state machine here. A door *is* a `Breakable`
 * carrying a `lock` (see zone/format.ts) — opening it reuses the existing
 * breakable-destroy path (drop collision, rebuild nav, remove occluder). So the
 * game's step loop only needs the two rules below: which color matches, and
 * whether the player is close enough.
 */
import { distance, type Vec2 } from "../math/vec2";
import { distanceToAabb, type Aabb } from "../physics/crowd";

/**
 * The fixed key/door colors. A door and its key match by sharing one id. Chosen
 * to spread around the hue wheel so any two read as clearly different at a glance
 * (the HUD only ever shows the colors you're *holding*, so the full set never
 * crowds it). Extend by adding an entry here — everything else derives from it.
 */
export type KeyColor = "red" | "gold" | "green" | "cyan" | "blue" | "purple";

/** What a locked door (a `Breakable` with this set) needs to open. */
export interface DoorLock {
  color: KeyColor;
}

/** One palette entry: the id used for matching, plus how it reads (label + hex). */
export interface KeyColorDef {
  id: KeyColor;
  label: string;
  /** Canonical render color — one source of truth for the game HUD and Realmsmith. */
  hex: string;
}

/** The palette, in HUD/display order — warm → cool, well-separated hues. */
export const KEY_COLORS: readonly KeyColorDef[] = [
  { id: "red", label: "Red", hex: "#e2402f" },
  { id: "gold", label: "Gold", hex: "#e2b033" },
  { id: "green", label: "Green", hex: "#3fbf55" },
  { id: "cyan", label: "Cyan", hex: "#2fc2d6" },
  { id: "blue", label: "Blue", hex: "#3b6fe2" },
  { id: "purple", label: "Purple", hex: "#a64fe2" },
];

const KEY_COLOR_BY_ID = Object.fromEntries(KEY_COLORS.map((c) => [c.id, c])) as Record<
  KeyColor,
  KeyColorDef
>;

/** Ordered list of valid color ids — for authoring pickers and validation. */
export const KEY_COLOR_IDS: readonly KeyColor[] = KEY_COLORS.map((c) => c.id);

/** Is `s` one of the palette colors? Narrows an authored string to `KeyColor`. */
export const isKeyColor = (s: unknown): s is KeyColor =>
  typeof s === "string" && s in KEY_COLOR_BY_ID;

/** The palette entry (label + hex) for a color. */
export const keyColorDef = (color: KeyColor): KeyColorDef => KEY_COLOR_BY_ID[color];

// ───────────────────────────────── Inventory ─────────────────────────────────

/**
 * The player's held keys — a count per color. Per-run state (resets each run,
 * like a destroyed spawner); the game holds one of these. The helpers are
 * immutable (return a fresh inventory) so the whole thing stays trivially
 * testable and free of aliasing bugs.
 */
export type KeyInventory = Partial<Record<KeyColor, number>>;

export const emptyInventory = (): KeyInventory => ({});

/** How many `color` keys are held (0 if none). */
export const keyCount = (inv: KeyInventory, color: KeyColor): number => inv[color] ?? 0;

/** Does the player hold at least one `color` key? */
export const hasKey = (inv: KeyInventory, color: KeyColor): boolean => keyCount(inv, color) > 0;

/** Pick up `n` (default 1) keys of `color`. */
export const addKey = (inv: KeyInventory, color: KeyColor, n = 1): KeyInventory => ({
  ...inv,
  [color]: keyCount(inv, color) + n,
});

/**
 * Spend one `color` key. Returns the inventory unchanged if none is held, so a
 * caller can gate the unlock on `hasKey` and still call this without a branch.
 */
export const spendKey = (inv: KeyInventory, color: KeyColor): KeyInventory =>
  hasKey(inv, color) ? { ...inv, [color]: keyCount(inv, color) - 1 } : inv;

// ──────────────────────────────── Reach tests ────────────────────────────────

/**
 * How far (px) the player's body may be from a door's footprint and still unlock
 * it — reach *past* touching, so a door opens as you walk up to it rather than
 * only when pressed into it. Added to the player's radius in `playerAtDoor`.
 */
export const DOOR_UNLOCK_MARGIN = 40;

/** How close (px) the player's centre must come to a key to pick it up. */
export const KEY_PICKUP_RADIUS = 28;

/**
 * Is the player (a circle) touching `door`'s footprint closely enough to unlock?
 * Pure geometry; the game pairs this with `hasKey(inv, lock.color)` to decide.
 */
export const playerAtDoor = (
  door: Aabb,
  playerPos: Vec2,
  playerRadius: number,
  margin = DOOR_UNLOCK_MARGIN,
): boolean => distanceToAabb(playerPos, door) <= playerRadius + margin;

/** Is the player close enough to a key (a point pickup) to collect it? */
export const playerAtKey = (
  keyPos: Vec2,
  playerPos: Vec2,
  playerRadius: number,
  pickup = KEY_PICKUP_RADIUS,
): boolean => distance(playerPos, keyPos) <= playerRadius + pickup;
