/**
 * Shared zone-visual palette — the single source of truth for how the static
 * world is *coloured*, read by BOTH the game's Skia renderer and the Realmsmith
 * editor's Canvas2D viewport (see docs/design/realmsmith.md).
 *
 * Living here, in pure core, is what guarantees the editor draws the map
 * identically to the game: there is no second copy of these values to drift out
 * of sync. Pure data (hex strings) + one tiny rule — no renderer, no Skia/DOM.
 *
 * Geometry identity is already guaranteed by `loadZone`/`greedyMesh` (both sides
 * run the same code on the same file); this pins the *colours* the same way.
 */
export const ZONE_PALETTE = {
  /** Backdrop showing through void cells (outside the painted zone shape). */
  void: "#0e1116",
  /**
   * Drifting-mist wisp colour for a void pit's swirling cloud. In-game the pit is an
   * animated mist shader (see renderCombat); Realmsmith can't run that, so it paints
   * a *static* stand-in — soft puffs of this colour over the void base. Mirrors the
   * game's fog `mistColor` so the two read alike.
   */
  voidMist: "#27324f",
  /** Floor checker: the base fill, and the darker tone on odd-parity cells. */
  tileLight: "#222a3c",
  tileDark: "#1a2030",
  /** Boundary walls (drawn from the zone bounds; not stored in the file). */
  wall: "#4a5470",
  /** Interior static collision (pillars / greedy-meshed walls) — the lit top "cap". */
  pillar: "#5b6685",
  /** A wall's extruded side face (its "height"), darker than the cap so it reads as
   *  a vertical surface in shadow — see the 2.5D depth treatment in `zone/depth`. */
  pillarShadow: "#353d52",
  /** Thin highlight on a wall's north (top) edge — the lit lip of a raised block. */
  pillarHi: "#707d9e",
  /** The inner wall of a void pit — a vertical surface descending from the rim and
   *  dissolving into the fog, so the floor reads as a raised platform/bridge. Lighter
   *  than the void floor so it reads as a lit surface, not a shadow. */
  voidWall: "#2c3446",
  /** The lit ground lip where solid floor meets the drop — the top edge of `voidWall`. */
  voidLip: "#6c7a98",
  /** Breakables by kind (unknown kinds fall back to crate)… */
  breakableWood: "#7a5230",
  breakableBarrel: "#a9702f",
  breakableCrate: "#8f6a3c",
  /** …plus the bright accent for a destructible wall's frame/cracks. */
  breakableEdge: "#e0b878",
  /** Monster-nest (spawner) structure — a deep nest-red, distinct from breakables —
   *  plus a brighter edge accent. Shared so the editor and game draw a nest alike. */
  spawnerNest: "#c4445e",
  spawnerNestEdge: "#e0556b",
} as const;

export type ZonePalette = typeof ZONE_PALETTE;

/**
 * The placeholder floor's checkerboard rule: the darker tone is drawn on cells
 * where world `(col + row)` is odd. Shared so the game's baker and the editor's
 * viewport use the *same* parity. (When a real tileset lands, `tileSourceRect`
 * becomes the shared source of truth and this placeholder rule retires.)
 */
export const isCheckerDark = (gx: number, gy: number): boolean => (gx + gy) % 2 === 1;
