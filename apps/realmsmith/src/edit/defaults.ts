import {
  CREATURES,
  CREATURE_IDS,
  KEY_COLOR_IDS,
  SPAWNER_DEFAULTS,
  TRIGGER_DEFAULTS,
  creatureLabel,
  type BreakableDef,
  type CreatureId,
  type ZoneObjectKind,
} from "@heroic/core";

/**
 * Picker label carrying the species' level bounds (creature-levels.md), so
 * choosing what a spawner emits — or authoring a levelMin/levelMax window —
 * shows what levels the species can actually be.
 */
export const creaturePickerLabel = (id: CreatureId): string => {
  const { min, max } = CREATURES[id].levels;
  return `${creatureLabel(id)} · Lv ${min}–${max}`;
};

export const BREAKABLE_KINDS = ["barrel", "crate", "wood-wall", "door"] as const;
export type BreakableKind = (typeof BREAKABLE_KINDS)[number];

/**
 * A fresh breakable of `kind`, centred at (cx,cy) — id filled in by the caller.
 * Defaults mirror realm-00's authored values so placing matches what we hand-built:
 * barrels chain-explode, wood walls occlude, crates are inert.
 */
export const breakableDefaults = (
  kind: BreakableKind,
  cx: number,
  cy: number,
  tile: number,
): BreakableDef => {
  switch (kind) {
    case "barrel":
      return {
        id: "",
        kind,
        box: { x: cx, y: cy, w: 0.75 * tile, h: 0.75 * tile },
        maxHp: 12,
        occludes: false,
        onBreak: [{ type: "explode", radius: 120, damage: 25 }],
      };
    case "wood-wall":
      return {
        id: "",
        kind,
        // Thin + tall by default (resize per-instance in the inspector).
        box: { x: cx, y: cy, w: 0.5 * tile, h: 3 * tile },
        maxHp: 45,
        occludes: true,
      };
    case "door":
      return {
        id: "",
        kind,
        // One tile, filling a doorway. Blocks movement but does NOT occlude sight —
        // the player's lit radius passes through it (like a void/gate), so you can
        // see the room beyond. Opened only by a matching-color key; invulnerable to
        // weapons, so maxHp is nominal.
        box: { x: cx, y: cy, w: tile, h: tile },
        maxHp: 1,
        occludes: false,
        lock: { color: KEY_COLOR_IDS[0]! },
      };
    case "crate":
    default:
      return { id: "", kind: "crate", box: { x: cx, y: cy, w: tile, h: tile }, maxHp: 15, occludes: false };
  }
};

/** Object kinds the editor can place (the format also allows waystone/settlement). */
export const OBJECT_KINDS: ZoneObjectKind[] = [
  "playerSpawn",
  "exit",
  "spawner",
  "creature",
  "key",
  "trigger",
  "poi",
];

/** A freshly-placed trigger's region size, in tiles per side (resize per-instance). */
export const TRIGGER_REGION_TILES = 3;

/**
 * SPAWNER_DEFAULTS minus its structured `levels` range — props are flat
 * scalars, and level bounds ride as separate `levelMin`/`levelMax` props
 * (parseLevelRange), authored in the inspector rather than defaulted here.
 */
const scalarSpawnerDefaults = (): Record<string, string | number | boolean> => {
  const { levels: _levels, ...scalars } = SPAWNER_DEFAULTS;
  return { ...scalars };
};

/**
 * TRIGGER_DEFAULTS flattened into a scalar `props` bag — the action's `type`,
 * its `text`/`durationMs`, and the `repeat` flag (parseTriggerConfig reads them
 * back). v1 has only the `text` action, so its fields are inlined directly.
 */
const scalarTriggerDefaults = (): Record<string, string | number | boolean> => ({
  action: TRIGGER_DEFAULTS.action.type,
  text: TRIGGER_DEFAULTS.action.text,
  durationMs: TRIGGER_DEFAULTS.action.durationMs,
  repeat: TRIGGER_DEFAULTS.repeat,
});

/**
 * Starting `props` for a freshly placed object. Spawners carry the full
 * SPAWNER_DEFAULTS so a placed nest is immediately a working, watchable spawner
 * (zombie, on a cadence); a `creature` carries just its roster id (the toolbar's
 * chosen creature is threaded in at placement — this is the fallback). Both are
 * then tuned in the inspector. Other kinds start propertyless.
 */
export const defaultObjectProps = (
  kind: ZoneObjectKind,
): Record<string, string | number | boolean> =>
  kind === "spawner"
    ? scalarSpawnerDefaults()
    : kind === "creature"
      ? { creature: CREATURE_IDS[0]! }
      : kind === "key"
        ? { color: KEY_COLOR_IDS[0]! }
        : kind === "trigger"
          ? scalarTriggerDefaults()
          : {};
