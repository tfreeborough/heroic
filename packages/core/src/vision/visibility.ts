/**
 * 2D line-of-sight: what a point observer can see in a world of solid walls.
 *
 * The technique is the standard "visibility polygon" (a.k.a. 2D shadow-casting):
 * from the observer, cast a ray at every wall *corner* — plus one a hair to
 * either side, so a ray can slip past a corner and land on whatever lies behind
 * it. Keep each ray's nearest wall hit, sort those hits by angle, and join them
 * into a polygon. That polygon is exactly the lit area; everything outside it is
 * a blind spot. The caller supplies a bounding box among the segments so every
 * ray is guaranteed to hit *something* and terminate.
 *
 * Pure geometry, no renderer: the app draws the polygon (punch it out of a dark
 * overlay for blind spots / fog of war) and the AI can ask `segmentClear` to
 * decide whether an enemy can actually see the player.
 */
import type { Vec2 } from "../math/vec2";

/** A directed wall edge from (ax, ay) to (bx, by). Occludes from either side. */
export interface VisionSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * The four edges of an axis-aligned rectangle given by its *centre* and size —
 * matching how walls/pillars are stored elsewhere (centre + width/height).
 */
export const rectEdges = (cx: number, cy: number, w: number, h: number): VisionSegment[] => {
  const l = cx - w / 2;
  const r = cx + w / 2;
  const t = cy - h / 2;
  const b = cy + h / 2;
  return [
    { ax: l, ay: t, bx: r, by: t },
    { ax: r, ay: t, bx: r, by: b },
    { ax: r, ay: b, bx: l, by: b },
    { ax: l, ay: b, bx: l, by: t },
  ];
};

// One ray straight at each corner can graze it ambiguously; a pair offset by
// this much (radians) reliably lands just inside the edge and just past it.
const CORNER_NUDGE = 1e-4;

/**
 * The visibility polygon seen from `origin`, occluded by `segments`. Vertices
 * come out sorted by angle (counter-clockwise), forming a simple star-shaped
 * polygon with `origin` inside it. Include a bounding box in `segments` so
 * outward rays terminate — otherwise corners with open sky are dropped.
 */
export const computeVisibility = (origin: Vec2, segments: VisionSegment[]): Vec2[] => {
  const ox = origin.x;
  const oy = origin.y;
  const n = segments.length;

  const angles: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = segments[i]!;
    const a1 = Math.atan2(s.ay - oy, s.ax - ox);
    const a2 = Math.atan2(s.by - oy, s.bx - ox);
    angles.push(a1 - CORNER_NUDGE, a1, a1 + CORNER_NUDGE, a2 - CORNER_NUDGE, a2, a2 + CORNER_NUDGE);
  }

  // Cast each ray and keep its nearest hit. The inner loop is the hot path (rays
  // × segments every frame), so it's inlined and allocation-free — no per-hit
  // object, just a running best `t`; the hit point is computed once at the end.
  const hits: { x: number; y: number; angle: number }[] = [];
  for (let k = 0; k < angles.length; k++) {
    const angle = angles[k]!;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let bestT = Infinity;
    for (let i = 0; i < n; i++) {
      const s = segments[i]!;
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const det = ex * dy - ey * dx;
      if (det < 1e-9 && det > -1e-9) continue; // ray parallel to the segment
      const wx = s.ax - ox;
      const wy = s.ay - oy;
      const t = (ex * wy - ey * wx) / det; // distance along the ray
      const u = (dx * wy - dy * wx) / det; // 0..1 along the segment
      if (t >= 0 && u >= 0 && u <= 1 && t < bestT) bestT = t;
    }
    if (bestT !== Infinity) hits.push({ x: ox + dx * bestT, y: oy + dy * bestT, angle });
  }

  // Sorted by angle, the hits already form the visibility polygon's vertices;
  // the extra `angle` field is harmless to the Vec2[] consumers.
  hits.sort((p, q) => p.angle - q.angle);
  return hits;
};

/**
 * Is the straight line from `origin` to `target` unobstructed by any segment?
 * The companion to `computeVisibility` for gameplay queries — e.g. "can this
 * enemy see the player", or "does this shot reach before hitting a wall". A
 * touch at the very endpoints doesn't count as a block.
 */
export const segmentClear = (origin: Vec2, target: Vec2, segments: VisionSegment[]): boolean => {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  for (const s of segments) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const det = ex * dy - ey * dx;
    if (Math.abs(det) < 1e-9) continue; // parallel: no single crossing
    const wx = s.ax - origin.x;
    const wy = s.ay - origin.y;
    const t = (ex * wy - ey * wx) / det; // 0..1 along origin→target
    const u = (dx * wy - dy * wx) / det; // 0..1 along the segment
    if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) return false;
  }
  return true;
};
