import type { Aabb, TilesetDef, Zone } from "@heroic/core";

/**
 * Placement validity against the *derived* world: solids can't overlap, and a
 * solid can't bury an object marker (spawn/exit/…). Operates on the runtime Zone
 * so `collision` already folds in painted cells, free rects, and the void-fence —
 * one uniform test. Edge-adjacency is allowed (strict `<`), so a barrel snug
 * against a wall is fine; only real overlap fails.
 */

const boxesOverlap = (a: Aabb, b: Aabb): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

const pointInBox = (x: number, y: number, b: Aabb): boolean =>
  Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2;

const cellBox = (zone: Zone, col: number, row: number): Aabb => {
  const t = zone.tileSize;
  return { x: col * t + t / 2, y: row * t + t / 2, w: t, h: t };
};

/** A breakable box may not overlap collision/another breakable, nor bury an object. */
export const breakableFits = (zone: Zone, box: Aabb, ignoreId?: string): boolean => {
  for (const c of zone.collision) if (boxesOverlap(box, c)) return false;
  for (const b of zone.breakables) if (b.id !== ignoreId && boxesOverlap(box, b.box)) return false;
  for (const o of zone.objects) if (pointInBox(o.x, o.y, box)) return false;
  return true;
};

/** An object point may not sit inside collision or a breakable. */
export const objectPlaceable = (zone: Zone, x: number, y: number): boolean => {
  for (const c of zone.collision) if (pointInBox(x, y, c)) return false;
  for (const b of zone.breakables) if (pointInBox(x, y, b.box)) return false;
  return true;
};

/**
 * Whether a prop of `propName` can stand with its feet at (x,y). Props carry
 * their own footprint (which the loader folds into `zone.collision`), so the
 * generic point test can't serve: a placed prop would collide with itself the
 * moment you tried to move it. Instead, test the *candidate footprint* against
 * authored solids and every OTHER prop's footprint (`ignoreId` skips its own).
 * Footprint-less props (grass) just need their feet off solids.
 */
export const propPlaceable = (
  zone: Zone,
  tileset: TilesetDef | undefined,
  propName: string,
  x: number,
  y: number,
  ignoreId?: string,
): boolean => {
  const def = tileset?.props[propName];
  if (!def) return false; // unknown prop → nothing sensible to place
  const fp = def.footprint;
  const box: Aabb = fp
    ? { x, y: y - (fp.h * zone.tileSize) / 2, w: fp.w * zone.tileSize, h: fp.h * zone.tileSize }
    : { x, y, w: 1, h: 1 };
  // Authored solids only — zone.collision would include prop footprints.
  for (const c of zone.walls) if (boxesOverlap(box, c)) return false;
  for (const c of zone.voids) if (boxesOverlap(box, c)) return false;
  for (const c of zone.hidden) if (boxesOverlap(box, c)) return false;
  for (const b of zone.breakables) if (boxesOverlap(box, b.box)) return false;
  for (const p of zone.props) {
    if (p.id === ignoreId || !p.foot) continue;
    if (boxesOverlap(box, p.foot)) return false;
  }
  return true;
};

/** A collision cell may not cover a breakable's footprint or an object. */
export const cellFreeForCollision = (zone: Zone, col: number, row: number): boolean => {
  const cell = cellBox(zone, col, row);
  for (const b of zone.breakables) if (boxesOverlap(cell, b.box)) return false;
  for (const o of zone.objects) if (pointInBox(o.x, o.y, cell)) return false;
  return true;
};

/** A free collision rect may overlap other collision freely, but not a breakable or object. */
export const rectFitsCollision = (zone: Zone, box: Aabb): boolean => {
  for (const b of zone.breakables) if (boxesOverlap(box, b.box)) return false;
  for (const o of zone.objects) if (pointInBox(o.x, o.y, box)) return false;
  return true;
};

/** Is there a breakable footprint under (x,y)? (Hover: left-click would grab it.) */
export const breakableAt = (zone: Zone, x: number, y: number): boolean =>
  zone.breakables.some((b) => pointInBox(x, y, b.box));

/** Is there an object within `radius` of (x,y)? (Hover: left-click would grab it.) */
export const objectAt = (zone: Zone, x: number, y: number, radius: number): boolean =>
  zone.objects.some((o) => Math.hypot(x - o.x, y - o.y) <= radius) || propIdAt(zone, x, y) !== null;

/**
 * Topmost prop whose SPRITE rect contains (x,y), or null. Props are grabbed by
 * their whole drawn body (feet-anchored: x±w/2, y−h..y), not just a radius at
 * their feet — a footprint-less tuft is as draggable as a tree. Later in the
 * array = drawn later = topmost, matching the other hit tests.
 */
export const propIdAt = (zone: Zone, x: number, y: number): string | null => {
  for (let i = zone.props.length - 1; i >= 0; i--) {
    const p = zone.props[i]!;
    if (Math.abs(x - p.x) <= p.w / 2 && y <= p.y && y >= p.y - p.h) return p.id;
  }
  return null;
};
