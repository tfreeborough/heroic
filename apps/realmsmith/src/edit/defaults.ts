import { CREATURE_IDS, SPAWNER_DEFAULTS, type BreakableDef, type ZoneObjectKind } from "@heroic/core";

export const BREAKABLE_KINDS = ["barrel", "crate", "wood-wall"] as const;
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
    case "crate":
    default:
      return { id: "", kind: "crate", box: { x: cx, y: cy, w: tile, h: tile }, maxHp: 15, occludes: false };
  }
};

/** Object kinds the editor can place (the format also allows waystone/settlement). */
export const OBJECT_KINDS: ZoneObjectKind[] = ["playerSpawn", "exit", "spawner", "creature", "poi"];

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
  kind === "spawner" ? { ...SPAWNER_DEFAULTS } : kind === "creature" ? { creature: CREATURE_IDS[0]! } : {};
