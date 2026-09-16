import {
  COLLISION_CELL,
  pointInPolygon,
  type Aabb,
  type Vec2,
  type BreakableDef,
  type CollisionMaterial,
  type ZoneFile,
  type ZoneObject,
  type ZoneObjectKind,
} from "@heroic/core";
import {
  breakableDefaults,
  defaultObjectProps,
  TRIGGER_REGION_TILES,
  type BreakableKind,
} from "./defaults";

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

/**
 * Painted collision lives on a QUARTER-tile grid (`collision.cellSize =
 * tileSize / COLLISION_DIV`) so hidden fences can hug a shape; drawn solids
 * (wall, void) stay tile-grain — they render, and a quarter of a pillar in a
 * floor tile would look wrong — so their edits fill the whole tile's sub-cells.
 * Legacy tile-grain grids are upsampled on first touch.
 */
export const COLLISION_DIV = 4;

/** The sub-cells of tile (col,row) run [col*div, col*div+div) × [row*div, …). */
const forTileSubCells = (z: ZoneFile, col: number, row: number, f: (sc: number, sr: number) => void): void => {
  const div = collisionDiv(z);
  for (let sr = row * div; sr < (row + 1) * div; sr++) for (let sc = col * div; sc < (col + 1) * div; sc++) f(sc, sr);
};

/** Sub-cells per tile side of the file's current collision grid (1 for legacy). */
export const collisionDiv = (z: ZoneFile): number =>
  z.collision.cells ? Math.max(1, Math.round(z.tileSize / (z.collision.cellSize ?? z.tileSize))) : COLLISION_DIV;

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
  // Floor and *visible* collision are mutually exclusive in a cell (a cell is
  // walkable ground OR a drawn solid, never both): painting ground onto a
  // wall/void cell fills it, so drop that collision. The inverse of
  // setCollisionCell. Hidden barriers are exempt — they sit ON floor by design
  // (invisible fence over normal-looking ground), so floor paints leave them.
  // (Free rects aren't cell-aligned, so those are removed via right-click.)
  if (v !== 0 && z.collision.cells) {
    const cells = z.collision.cells;
    forTileSubCells(z, col, row, (sc, sr) => {
      const cr = cells[sr];
      if (cr && (cr[sc] === COLLISION_CELL.wall || cr[sc] === COLLISION_CELL.void)) {
        cr[sc] = COLLISION_CELL.none;
        changed = true;
      }
    });
  }
  return changed;
};

// --- Decor layer ----------------------------------------------------------------
/** Paint the optional decor overlay (purely visual, sits above the floor — no
 *  floor/collision exclusivity rules). The layer is created on first paint. */
export const setDecor = (z: ZoneFile, col: number, row: number, v: number): boolean => {
  if (!inBounds(z, col, row)) return false;
  if (!z.layers.decor || z.layers.decor.length !== z.size.rows) {
    if (v === 0) return false; // erasing a layer that doesn't exist
    z.layers.decor = Array.from({ length: z.size.rows }, () =>
      new Array<number>(z.size.cols).fill(0),
    );
  }
  const r = z.layers.decor[row];
  if (!r || r[col] === v) return false;
  r[col] = v;
  return true;
};

// --- Collision: painted cells + free rects ------------------------------------
/** The quarter-tile grid, created — or a coarser legacy grid upsampled — on demand. */
const ensureCells = (z: ZoneFile): number[][] => {
  const rows = z.size.rows * COLLISION_DIV;
  const cols = z.size.cols * COLLISION_DIV;
  const old = z.collision.cells;
  const oldDiv = old ? collisionDiv(z) : 0;
  if (!old || old.length !== rows || oldDiv !== COLLISION_DIV) {
    const next = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    if (old && oldDiv > 0) {
      // Nearest-neighbour resample: a legacy tile cell becomes a div×div block.
      const k = COLLISION_DIV / oldDiv;
      for (let sr = 0; sr < rows; sr++) {
        const src = old[Math.floor(sr / k)];
        if (!src) continue;
        for (let sc = 0; sc < cols; sc++) next[sr]![sc] = src[Math.floor(sc / k)] ?? 0;
      }
    }
    z.collision.cells = next;
    z.collision.cellSize = z.tileSize / COLLISION_DIV;
  }
  return z.collision.cells!;
};

/**
 * Paint a whole TILE's collision: drawn solids (wall/void) and tile-grain
 * erase. Every sub-cell of the tile is set.
 */
export const setCollisionCell = (z: ZoneFile, col: number, row: number, v: number): boolean => {
  if (!inBounds(z, col, row)) return false;
  const cells = ensureCells(z);
  let changed = false;
  forTileSubCells(z, col, row, (sc, sr) => {
    const r = cells[sr];
    if (r && r[sc] !== v) {
      r[sc] = v;
      changed = true;
    }
  });
  // A DRAWN solid (wall or void) and walkable floor can't share a cell: painting
  // one clears the floor beneath, so there's never hidden ground under a pit or a
  // pillar — the floorless cell renders as the void/pillar it now is. Erasing
  // collision (v=0) leaves the cell floorless (a void via fenceVoid); repaint
  // floor to reopen it. A `hidden` barrier is the exception: it renders as
  // nothing, so the floor under it must STAY painted and visible.
  // See docs/design/world-representation.md + tilesets.md.
  if (v === COLLISION_CELL.wall || v === COLLISION_CELL.void) {
    const fr = z.layers.floor[row];
    if (fr && fr[col] !== 0) {
      fr[col] = 0;
      changed = true;
    }
  }
  return changed;
};

/**
 * Paint one quarter-tile SUB-cell (`sc`,`sr` in sub-cell units) — the hidden
 * fence brush. Erasing a sub-cell that holds a drawn solid clears that whole
 * tile instead (drawn solids are tile-grain).
 */
export const setCollisionSubCell = (z: ZoneFile, sc: number, sr: number, v: number): boolean => {
  const div = COLLISION_DIV;
  const col = Math.floor(sc / div);
  const row = Math.floor(sr / div);
  if (!inBounds(z, col, row)) return false;
  const cells = ensureCells(z);
  const r = cells[sr];
  if (!r) return false;
  const cur = r[sc] ?? 0;
  if (v === COLLISION_CELL.none && (cur === COLLISION_CELL.wall || cur === COLLISION_CELL.void)) {
    return setCollisionCell(z, col, row, COLLISION_CELL.none);
  }
  if (cur === v) return false;
  r[sc] = v;
  return true;
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
  z.collision.rects.push(material === "wall" ? { ...box } : { ...box, material });
  // Same floor-or-drawn-solid rule as painted cells: a wall/void rect never sits
  // over unseen floor. Hidden barriers keep their floor — invisible by design.
  if (material !== "hidden") clearFloorUnderBox(z, box);
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

// --- Collision polygons (hidden fences; core zone/polygon.ts) -----------------
/** Append a closed hidden polygon. Returns its index. */
export const addPolygon = (z: ZoneFile, points: Vec2[]): number => {
  if (!z.collision.polys) z.collision.polys = [];
  z.collision.polys.push({ points: points.map((p) => ({ x: p.x, y: p.y })), material: "hidden" });
  return z.collision.polys.length - 1;
};

/** Index of the topmost polygon containing (wx,wy), or -1. */
export const polygonIndexAt = (z: ZoneFile, wx: number, wy: number): number => {
  const polys = z.collision.polys ?? [];
  for (let i = polys.length - 1; i >= 0; i--) {
    if (pointInPolygon({ x: wx, y: wy }, polys[i]!.points)) return i;
  }
  return -1;
};

/** The polygon vertex within `tol` px of (wx,wy), nearest first, or null. */
export const polygonVertexAt = (
  z: ZoneFile,
  wx: number,
  wy: number,
  tol: number,
): { poly: number; vertex: number } | null => {
  let best: { poly: number; vertex: number } | null = null;
  let bestD = tol;
  const polys = z.collision.polys ?? [];
  for (let pi = 0; pi < polys.length; pi++) {
    const pts = polys[pi]!.points;
    for (let vi = 0; vi < pts.length; vi++) {
      const d = Math.hypot(pts[vi]!.x - wx, pts[vi]!.y - wy);
      if (d <= bestD) {
        bestD = d;
        best = { poly: pi, vertex: vi };
      }
    }
  }
  return best;
};

export const movePolygonVertex = (z: ZoneFile, poly: number, vertex: number, x: number, y: number): boolean => {
  const p = z.collision.polys?.[poly]?.points[vertex];
  if (!p || (p.x === x && p.y === y)) return false;
  p.x = x;
  p.y = y;
  return true;
};

export const deletePolygon = (z: ZoneFile, idx: number): boolean => {
  if (!z.collision.polys || idx < 0 || idx >= z.collision.polys.length) return false;
  z.collision.polys.splice(idx, 1);
  if (z.collision.polys.length === 0) delete z.collision.polys;
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
/** Topmost object at (wx,wy), or null. Point markers hit within `radius`; region
 *  objects (a trigger, carrying `w`/`h`) hit anywhere inside their rect. */
export const objectIdAt = (z: ZoneFile, wx: number, wy: number, radius: number): string | null => {
  for (let i = z.objects.length - 1; i >= 0; i--) {
    const o = z.objects[i]!;
    if (o.w && o.h) {
      if (Math.abs(wx - o.x) <= o.w / 2 && Math.abs(wy - o.y) <= o.h / 2) return o.id;
    } else if (Math.hypot(wx - o.x, wy - o.y) <= radius) {
      return o.id;
    }
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
  const obj: ZoneObject = { id, kind, x, y, props: props ?? defaultObjectProps(kind) };
  // A trigger is a region: give it a default footprint (resized by its corners).
  if (kind === "trigger") {
    const s = TRIGGER_REGION_TILES * z.tileSize;
    obj.w = s;
    obj.h = s;
  }
  z.objects.push(obj);
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
