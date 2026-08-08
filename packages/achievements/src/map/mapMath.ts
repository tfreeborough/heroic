/**
 * The Deed Map's pure geometry (achievements.md § map): world bounds, the
 * pan clamp, the screen→world inverse, and node hit-testing — everything the
 * gesture worklets and tap handler need, kept out of the component so it
 * unit-tests without a renderer.
 *
 * Coordinate model: node `pos` values are authored board coordinates; the
 * canvas is sized to their padded bounds and nodes draw at `pos − min`. The
 * canvas view sits at its container's top-left and is transformed
 * translate(tx,ty) THEN scale(s) — React Native scales about the view's
 * CENTRE, so with C = canvas centre:
 *   P_screen = T + C + (P_canvas − C)·s
 */

export const NODE_RADIUS = 26;
export const ROOT_RADIUS = 34;
/** Padding around the outermost nodes so nothing draws at the canvas edge. */
export const WORLD_PAD = 90;
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 2.5;

export interface WorldBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export const worldBounds = (positions: readonly { x: number; y: number }[], pad: number = WORLD_PAD): WorldBounds => {
  if (positions.length === 0) return { minX: -pad, minY: -pad, width: pad * 2, height: pad * 2 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
};

/**
 * Clamp one axis of the translation so the canvas edge never pulls inside
 * the viewport edge — unless the scaled canvas is SMALLER than the viewport,
 * in which case it centres. `world` = canvas size, `view` = viewport size.
 */
export const clampOffset = (t: number, scale: number, world: number, view: number): number => {
  "worklet";
  const base = (world / 2) * (1 - scale); // centre-origin scale offset
  const scaled = world * scale;
  const min = view - base - scaled; // right/bottom edge flush with viewport
  const max = -base; // left/top edge flush
  if (min > max) return (view - scaled) / 2 - base; // smaller than viewport → centred
  return Math.min(max, Math.max(min, t)) + 0; // `+ 0` normalises −0
};

/** The legal translation range for one axis at a scale — the fling decay's
 * clamp (same maths as clampOffset; a canvas smaller than the viewport
 * collapses the range to its centred point). */
export const offsetBounds = (scale: number, world: number, view: number): [number, number] => {
  "worklet";
  const base = (world / 2) * (1 - scale);
  const scaled = world * scale;
  const min = view - base - scaled;
  const max = -base;
  if (min > max) {
    const centred = (view - scaled) / 2 - base;
    return [centred, centred];
  }
  return [min + 0, max + 0];
};

/** Invert the view transform: container point → canvas point. */
export const screenToCanvas = (
  px: number,
  py: number,
  tx: number,
  ty: number,
  scale: number,
  world: WorldBounds,
): { x: number; y: number } => {
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { x: cx + (px - tx - cx) / scale, y: cy + (py - ty - cy) / scale };
};

/** The translation that puts a given CANVAS point at a given container
 * point, at the given scale — initial centring, and the pinch focal rule. */
export const offsetFor = (
  canvasX: number,
  canvasY: number,
  atX: number,
  atY: number,
  scale: number,
  world: WorldBounds,
): { tx: number; ty: number } => {
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { tx: atX - cx - (canvasX - cx) * scale, ty: atY - cy - (canvasY - cy) * scale };
};

export interface HitNode {
  id: string;
  /** Canvas coordinates (pos − bounds min). */
  x: number;
  y: number;
  radius: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Distance from a point to a line SEGMENT. */
export const segmentDistance = (a: Point, b: Point, p: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * Route an edge parent→child as an axis-aligned polyline (achievements.md §
 * map, Tom 2026-08-04: no diagonals — subway lines, not spiderwebs).
 * Aligned pairs get a straight segment; others an L-elbow, choosing the
 * bend (horizontal-first vs vertical-first) that passes through the fewest
 * OTHER nodes' discs — a segment under a node it doesn't connect reads as
 * a false link.
 */
export const routeEdge = (
  parent: Point & { id?: string },
  child: Point & { id?: string },
  obstacles: readonly HitNode[],
): Point[] => {
  if (parent.x === child.x || parent.y === child.y) return [parent, child];
  const hFirst: Point[] = [parent, { x: child.x, y: parent.y }, child];
  const vFirst: Point[] = [parent, { x: parent.x, y: child.y }, child];
  const crossings = (pts: Point[]): number => {
    let n = 0;
    for (const node of obstacles) {
      if (node.id === parent.id || node.id === child.id) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        if (segmentDistance(pts[i]!, pts[i + 1]!, node) < node.radius + 4) {
          n += 1;
          break;
        }
      }
    }
    return n;
  };
  return crossings(hFirst) <= crossings(vFirst) ? hFirst : vFirst;
};

/** The nearest node whose disc contains the point (a small slop margin
 * makes small nodes finger-friendly at low zoom), or null. */
export const hitTest = (nodes: readonly HitNode[], x: number, y: number, slop = 10): string | null => {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= n.radius + slop && d < bestDist) {
      bestDist = d;
      best = n.id;
    }
  }
  return best;
};
