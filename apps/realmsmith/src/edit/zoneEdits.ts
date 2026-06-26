import {
  COLLISION_CELL,
  type Aabb,
  type BreakableDef,
  type CollisionMaterial,
  type ZoneFile,
  type ZoneObject,
  type ZoneObjectKind,
} from "@heroic/core";
import { breakableDefaults, defaultObjectProps, type BreakableKind } from "./defaults";

/**
 * In-place editors for the authored ZoneFile. Each mutates the working copy and
 * returns whether it actually changed something (so the caller only marks dirty /
 * re-derives on real edits). Framework-free — App calls these from pointer events.
 */

const inBounds = (z: ZoneFile, col: number, row: number): boolean =>
  col >= 0 && col < z.size.cols && row >= 0 && row < z.size.rows;

const uniqueId = (existing: Iterable<string>, base: string): string => {
  const set = new Set(existing);
  let n = 1;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
};

// --- Floor layer --------------------------------------------------------------
export const setFloor = (z: ZoneFile, col: number, row: number, v: number): boolean => {
  if (!inBounds(z, col, row)) return false;
  const r = z.layers.floor[row];
  if (!r) return false;
  let changed = false;
  if (r[col] !== v) {
    r[col] = v;
    changed = true;
  }
  // Floor and collision are mutually exclusive in a cell (a cell is walkable ground
  // OR a solid, never both): painting ground onto a wall/void cell fills it, so drop
  // any collision there. The inverse of setCollisionCell. (Free rects aren't
  // cell-aligned, so those are removed via right-click, not by painting floor.)
  if (v !== 0 && z.collision.cells) {
    const cr = z.collision.cells[row];
    if (cr && cr[col] !== COLLISION_CELL.none) {
      cr[col] = COLLISION_CELL.none;
      changed = true;
    }
  }
  return changed;
};

// --- Collision: painted cells + free rects ------------------------------------
const ensureCells = (z: ZoneFile): number[][] => {
  if (!z.collision.cells || z.collision.cells.length !== z.size.rows) {
    z.collision.cells = Array.from({ length: z.size.rows }, () =>
      new Array<number>(z.size.cols).fill(0),
    );
    // The editor paints collision at tile resolution, so cells align with floor.
    z.collision.cellSize = z.tileSize;
  }
  return z.collision.cells;
};

export const setCollisionCell = (z: ZoneFile, col: number, row: number, v: number): boolean => {
  if (!inBounds(z, col, row)) return false;
  const r = ensureCells(z)[row];
  if (!r) return false;
  let changed = false;
  if (r[col] !== v) {
    r[col] = v;
    changed = true;
  }
  // A solid (wall or void) and walkable floor can't share a cell: painting collision
  // clears the floor beneath, so there's never hidden ground under a pit or a pillar
  // — the floorless cell renders as the void/pillar it now is. Erasing collision
  // (v=0) leaves the cell floorless (a void via fenceVoid); repaint floor to reopen
  // it. See docs/design/world-representation.md.
  if (v !== COLLISION_CELL.none) {
    const fr = z.layers.floor[row];
    if (fr && fr[col] !== 0) {
      fr[col] = 0;
      changed = true;
    }
  }
  return changed;
};

/** Clear floor in every cell whose centre lies inside `box` — so a collision rect
 *  obeys the same floor-or-solid rule as a painted cell (no hidden floor under it). */
const clearFloorUnderBox = (z: ZoneFile, box: Aabb): void => {
  const t = z.tileSize;
  const left = box.x - box.w / 2;
  const right = box.x + box.w / 2;
  const top = box.y - box.h / 2;
  const bottom = box.y + box.h / 2;
  const c0 = Math.max(0, Math.floor(left / t));
  const c1 = Math.min(z.size.cols - 1, Math.ceil(right / t) - 1);
  const r0 = Math.max(0, Math.floor(top / t));
  const r1 = Math.min(z.size.rows - 1, Math.ceil(bottom / t) - 1);
  for (let row = r0; row <= r1; row++) {
    const fr = z.layers.floor[row];
    if (!fr) continue;
    const cy = (row + 0.5) * t;
    if (cy < top || cy > bottom) continue;
    for (let col = c0; col <= c1; col++) {
      if ((col + 0.5) * t >= left && (col + 0.5) * t <= right) fr[col] = 0;
    }
  }
};

/** Append a free collision rect of `material` (the `"wall"` tag is left implicit
 *  so wall rects stay bare `Aabb`s on disk — matching legacy files). */
export const addCollisionRect = (z: ZoneFile, box: Aabb, material: CollisionMaterial): void => {
  z.collision.rects.push(material === "void" ? { ...box, material } : { ...box });
  // Same floor-or-solid rule as painted cells: a rect never sits over hidden floor.
  clearFloorUnderBox(z, box);
};

/** Index of the free collision rect containing (wx,wy), or -1. */
export const rectIndexAt = (z: ZoneFile, wx: number, wy: number): number =>
  z.collision.rects.findIndex(
    (r) => Math.abs(wx - r.x) <= r.w / 2 && Math.abs(wy - r.y) <= r.h / 2,
  );

export const deleteRect = (z: ZoneFile, idx: number): boolean => {
  if (idx < 0) return false;
  z.collision.rects.splice(idx, 1);
  return true;
};

// --- Breakables ---------------------------------------------------------------
/** Topmost breakable whose box contains (wx,wy), or null. */
export const breakableIdAt = (z: ZoneFile, wx: number, wy: number): string | null => {
  for (let i = z.breakables.length - 1; i >= 0; i--) {
    const b = z.breakables[i]!;
    if (Math.abs(wx - b.box.x) <= b.box.w / 2 && Math.abs(wy - b.box.y) <= b.box.h / 2) return b.id;
  }
  return null;
};

/** `x`,`y` are the final (already-snapped) box centre — App owns snap policy. */
export const placeBreakable = (z: ZoneFile, kind: BreakableKind, x: number, y: number): string => {
  const def = breakableDefaults(kind, x, y, z.tileSize);
  def.id = uniqueId(
    z.breakables.map((b) => b.id),
    kind,
  );
  z.breakables.push(def);
  return def.id;
};

export const moveBreakable = (z: ZoneFile, id: string, x: number, y: number): boolean => {
  const b = z.breakables.find((b) => b.id === id);
  if (!b || (b.box.x === x && b.box.y === y)) return false;
  b.box.x = x;
  b.box.y = y;
  return true;
};

export const deleteBreakable = (z: ZoneFile, id: string): boolean => {
  const i = z.breakables.findIndex((b) => b.id === id);
  if (i < 0) return false;
  z.breakables.splice(i, 1);
  return true;
};

/** Clone a breakable, offset by (dx,dy), with a fresh id. Returns the new id. */
export const duplicateBreakable = (z: ZoneFile, id: string, dx: number, dy: number): string | null => {
  const src = z.breakables.find((b) => b.id === id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src)) as BreakableDef;
  copy.id = uniqueId(
    z.breakables.map((b) => b.id),
    src.kind,
  );
  copy.box.x += dx;
  copy.box.y += dy;
  z.breakables.push(copy);
  return copy.id;
};

// --- Objects ------------------------------------------------------------------
/** Topmost object within `radius` of (wx,wy), or null. */
export const objectIdAt = (z: ZoneFile, wx: number, wy: number, radius: number): string | null => {
  for (let i = z.objects.length - 1; i >= 0; i--) {
    const o = z.objects[i]!;
    if (Math.hypot(wx - o.x, wy - o.y) <= radius) return o.id;
  }
  return null;
};

export const placeObject = (
  z: ZoneFile,
  kind: ZoneObjectKind,
  x: number,
  y: number,
  // Initial props for the new object — used to stamp the toolbar's chosen creature
  // onto a `creature` placement. Omitted ⇒ the kind's defaults (defaultObjectProps).
  props?: Record<string, string | number | boolean>,
): string => {
  // playerSpawn is unique: relocate the existing one rather than adding a second.
  if (kind === "playerSpawn") {
    const existing = z.objects.find((o) => o.kind === "playerSpawn");
    if (existing) {
      existing.x = x;
      existing.y = y;
      return existing.id;
    }
  }
  const id = uniqueId(
    z.objects.map((o) => o.id),
    kind,
  );
  z.objects.push({ id, kind, x, y, props: props ?? defaultObjectProps(kind) });
  return id;
};

export const moveObject = (z: ZoneFile, id: string, x: number, y: number): boolean => {
  const o = z.objects.find((o) => o.id === id);
  if (!o || (o.x === x && o.y === y)) return false;
  o.x = x;
  o.y = y;
  return true;
};

export const deleteObject = (z: ZoneFile, id: string): boolean => {
  const i = z.objects.findIndex((o) => o.id === id);
  if (i < 0) return false;
  z.objects.splice(i, 1);
  return true;
};

/** Clone an object, offset by (dx,dy), with a fresh id. Returns the new id. */
export const duplicateObject = (z: ZoneFile, id: string, dx: number, dy: number): string | null => {
  const src = z.objects.find((o) => o.id === id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src)) as ZoneObject;
  copy.id = uniqueId(
    z.objects.map((o) => o.id),
    src.kind,
  );
  copy.x += dx;
  copy.y += dy;
  z.objects.push(copy);
  return copy.id;
};
