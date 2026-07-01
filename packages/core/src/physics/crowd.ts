/**
 * Crowd physics — the kinematic mover + collision substrate for enemies.
 *
 * Enemies do NOT live in the matter.js world (its sort-and-sweep broadphase is
 * O(n²) when a crowd piles up — see docs/design/enemy-physics-and-crowds.md).
 * Instead each enemy is a plain `Mover` (position + velocity), and this module
 * integrates and collides them in pure, deterministic, unit-testable code:
 *
 *   integrate → push the crowd apart → resolve vs static boxes → resolve vs the
 *   player → clamp to the arena.
 *
 * Collision is positional and single-pass (this is a game crowd, not a rigid-body
 * solver): small residual overlaps settle over a few frames and read fine, while
 * the cost stays ~O(n) thanks to the spatial grid bounding how many neighbours
 * any one mover can touch. matter.js keeps only the player + static walls.
 */
import type { Vec2 } from "../math/vec2";
import { forEachNeighbor, rebuildGrid, type SpatialGrid } from "../spatial/grid";

/** A kinematic agent: a circle driven by a commanded velocity (px/s). */
export interface Mover {
  pos: Vec2;
  /** Velocity in px/s. Integrated directly (no matter.js tick scaling). */
  vel: Vec2;
  radius: number;
}

/** An axis-aligned box given by its centre and full width/height (matches level rects). */
export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const createMover = (x: number, y: number, radius: number): Mover => ({
  pos: { x, y },
  vel: { x: 0, y: 0 },
  radius,
});

/**
 * Push a circle out of an axis-aligned box if they overlap (mutates `pos`).
 * Resolves along the axis of least penetration when the centre is inside the box,
 * otherwise straight out from the nearest edge/corner. Returns whether it moved.
 */
export const resolveCircleAabb = (pos: Vec2, radius: number, box: Aabb): boolean => {
  const hw = box.w / 2;
  const hh = box.h / 2;
  const dx = pos.x - box.x;
  const dy = pos.y - box.y;

  // Separated on either axis (using the box expanded by the radius)? Then no hit.
  const overlapX = hw + radius - Math.abs(dx);
  const overlapY = hh + radius - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return false;

  // Centre inside the box proper → push out along the shallowest axis.
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) {
    if (overlapX < overlapY) pos.x += dx >= 0 ? overlapX : -overlapX;
    else pos.y += dy >= 0 ? overlapY : -overlapY;
    return true;
  }

  // Centre outside: push out from the nearest point on the box (handles corners,
  // where being inside the expanded box on both axes still isn't a real overlap).
  const cx = dx < -hw ? -hw : dx > hw ? hw : dx;
  const cy = dy < -hh ? -hh : dy > hh ? hh : dy;
  const nx = dx - cx;
  const ny = dy - cy;
  const d2 = nx * nx + ny * ny;
  if (d2 >= radius * radius || d2 === 0) return false;
  const d = Math.sqrt(d2);
  const push = radius - d;
  pos.x += (nx / d) * push;
  pos.y += (ny / d) * push;
  return true;
};

/**
 * The point on (or inside) an axis-aligned box closest to `p` — `p` clamped to
 * the box's extent on each axis. Returns `p` itself when it's inside the box.
 * Pure (allocates a fresh point); the shared primitive for circle/point-vs-box
 * distance tests (hit detection, AoE) outside the crowd solver.
 */
export const closestPointOnAabb = (p: Vec2, box: Aabb): Vec2 => {
  const hw = box.w / 2;
  const hh = box.h / 2;
  return {
    x: Math.max(box.x - hw, Math.min(p.x, box.x + hw)),
    y: Math.max(box.y - hh, Math.min(p.y, box.y + hh)),
  };
};

/** Distance from a point to an axis-aligned box (0 when the point is inside). */
export const distanceToAabb = (p: Vec2, box: Aabb): number => {
  const hw = box.w / 2;
  const hh = box.h / 2;
  const dx = Math.max(Math.abs(p.x - box.x) - hw, 0);
  const dy = Math.max(Math.abs(p.y - box.y) - hh, 0);
  return Math.hypot(dx, dy);
};

/**
 * Push `pos` out of another circle if they overlap (mutates `pos`; the other
 * circle is unmoved — used to ring enemies around the player without shoving the
 * player). Returns whether it moved.
 */
export const resolveCircleVsCircle = (
  pos: Vec2,
  radius: number,
  otherPos: Vec2,
  otherRadius: number,
): boolean => {
  const dx = pos.x - otherPos.x;
  const dy = pos.y - otherPos.y;
  const min = radius + otherRadius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  if (d2 === 0) {
    pos.x += min; // exact overlap: shove along +x so they don't lock together
    return true;
  }
  const d = Math.sqrt(d2);
  const push = min - d;
  pos.x += (dx / d) * push;
  pos.y += (dy / d) * push;
  return true;
};

/**
 * Keep a circle's centre inside the world rect `[radius, width-radius] ×
 * [radius, height-radius]`. Pass only `width` for a square world — `height`
 * defaults to it.
 */
export const clampCircleToBounds = (
  pos: Vec2,
  radius: number,
  width: number,
  height = width,
): void => {
  const maxX = width - radius;
  const maxY = height - radius;
  if (pos.x < radius) pos.x = radius;
  else if (pos.x > maxX) pos.x = maxX;
  if (pos.y < radius) pos.y = radius;
  else if (pos.y > maxY) pos.y = maxY;
};

/**
 * Hard-ish crowd spacing: for every overlapping pair (found via the grid), move
 * both apart by `strength` × half their overlap. `strength` 1 fully separates an
 * isolated pair in one pass; lower is softer/smoother through chains. Each pair
 * is handled once. The grid must already be rebuilt from `movers`' positions.
 */
export const pushApartCrowd = (
  movers: readonly Mover[],
  grid: SpatialGrid,
  strength: number,
): void => {
  let selfIndex = 0;
  const resolve = (j: number): void => {
    if (j <= selfIndex) return; // skip self and already-handled pairs
    const a = movers[selfIndex]!;
    const b = movers[j]!;
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const min = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) return;
    const d = Math.sqrt(d2);
    const push = (min - d) * 0.5 * strength;
    const ux = dx / d;
    const uy = dy / d;
    a.pos.x -= ux * push;
    a.pos.y -= uy * push;
    b.pos.x += ux * push;
    b.pos.y += uy * push;
  };
  for (let i = 0; i < movers.length; i++) {
    selfIndex = i;
    forEachNeighbor(grid, movers[i]!.pos.x, movers[i]!.pos.y, resolve);
  }
};

export interface CrowdParams {
  /** Reused each step to find overlapping neighbours for push-apart. */
  grid: SpatialGrid;
  /** Static impassable boxes (interior pillars). The arena edge is the bounds clamp. */
  walls: readonly Aabb[];
  /** The player to ring enemies around (enemies move out of it; it doesn't move). */
  player: { pos: Vec2; radius: number } | null;
  /** World width; movers are clamped inside it. */
  worldSize: number;
  /** World height; defaults to `worldSize` (square) when omitted. */
  worldHeight?: number;
  /** Crowd push-apart strength (0..1). See pushApartCrowd. */
  pushStrength: number;
}

/**
 * Advance the whole crowd one fixed step: integrate velocities, then resolve
 * collisions in order (crowd spacing → static walls → player → arena bounds).
 * Velocities are set by the caller's AI/locomotion before this; positions are
 * read by the caller afterwards.
 */
// Reused across stepCrowd calls (ground then flying, sequentially) to hold the walls
// near the crowd — so the broad-phase below allocates nothing per step.
const wallScratch: Aabb[] = [];

export const stepCrowd = (movers: readonly Mover[], dt: number, p: CrowdParams): void => {
  const n = movers.length;

  for (let i = 0; i < n; i++) {
    const m = movers[i]!;
    m.pos.x += m.vel.x * dt;
    m.pos.y += m.vel.y * dt;
  }

  rebuildGrid(p.grid, n, (i) => movers[i]!.pos);
  pushApartCrowd(movers, p.grid, p.pushStrength);

  // Wall collision, broad-phased. Testing every mover against every level wall is
  // O(movers × walls) — fine for a few walls, but a zone can carry ~100 collision
  // boxes (interior walls + the void border) and that dominated the crowd step. So
  // first cull the walls to the crowd's bounding box (expanded by the largest mover
  // radius); a wall outside it can't touch any mover. When the crowd is clustered —
  // chasing the player, the common case — the kept set is tiny. Skipping a far wall is
  // exact, not approximate, so behaviour is unchanged.
  if (n > 0 && p.walls.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const m = movers[i]!;
      if (m.pos.x < minX) minX = m.pos.x;
      if (m.pos.x > maxX) maxX = m.pos.x;
      if (m.pos.y < minY) minY = m.pos.y;
      if (m.pos.y > maxY) maxY = m.pos.y;
      if (m.radius > maxR) maxR = m.radius;
    }
    minX -= maxR;
    minY -= maxR;
    maxX += maxR;
    maxY += maxR;
    const near = wallScratch;
    near.length = 0;
    for (let w = 0; w < p.walls.length; w++) {
      const box = p.walls[w]!;
      if (
        box.x - box.w / 2 <= maxX &&
        box.x + box.w / 2 >= minX &&
        box.y - box.h / 2 <= maxY &&
        box.y + box.h / 2 >= minY
      ) {
        near.push(box);
      }
    }
    for (let i = 0; i < n; i++) {
      const m = movers[i]!;
      for (let w = 0; w < near.length; w++) resolveCircleAabb(m.pos, m.radius, near[w]!);
    }
  }

  if (p.player) {
    for (let i = 0; i < n; i++) {
      const m = movers[i]!;
      resolveCircleVsCircle(m.pos, m.radius, p.player.pos, p.player.radius);
    }
  }

  for (let i = 0; i < n; i++) {
    clampCircleToBounds(movers[i]!.pos, movers[i]!.radius, p.worldSize, p.worldHeight ?? p.worldSize);
  }
};
