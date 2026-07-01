/**
 * 2.5D depth for collision elements — the shared geometry that fakes vertical
 * perspective in our top-down view (see docs/design/world-representation.md).
 *
 * A flat slab is ambiguous: is it raised, sunken, or just a floor decal? The fix is
 * an **extruded side face** ("fascia"): a vertical surface drawn attached to the flat
 * top, whose length reads as height (walls, raised) or depth (voids, sunken).
 *
 * The depth is **camera-relative** (the parallax). With a real over-the-shoulder
 * top-down camera, the side you see of a vertical surface depends on where it sits
 * on screen: a pillar dead-centre is viewed straight down (no visible side); one near
 * the edge leans away and shows a tall side. We fake that by pivoting every element
 * around the camera focus `C` (the world point under the screen centre) — walls drop
 * their side face *toward* `C` (the near face the camera sees), voids shade the inner
 * rim *away* from `C` (the far wall you look across at). Both lengthen with distance
 * from `C`, so they "shorten/lengthen with position" — what sells the depth.
 *
 * Pure geometry + tunables, so BOTH renderers (the game's Skia recorder and
 * Realmsmith's Canvas2D viewport) draw identical depth — the same guarantee
 * `ZONE_PALETTE` gives colours and `loadZone` gives layout. The renderers only feed
 * in `C` (from their camera) and fill the shapes these return.
 */
import type { Vec2 } from "../math/vec2";
import type { Aabb } from "../physics/crowd";

/** Depth tunables, in world px (independent of tile size). */
export const ZONE_DEPTH = {
  /** South-face length EVERY wall shows regardless of position — the camera's fixed
   *  downward tilt, so collisions read as angled-from-above, never painted flat. */
  wallBase: 9,
  /** Extra side-face lean per world-px from the camera focus — the parallax on top of
   *  the tilt, toward the focus. Small, so faces don't visibly swim over the floor. */
  wallLean: 0.014,
  /** How far a pit's inner wall descends into the fog (world px) — its apparent height. */
  voidDepth: 32,
  /** Pit-wall **tilt** weight: how strongly a south-facing inner wall shows from the
   *  camera angle ALONE — i.e. the near wall you'd see standing just north of a pit.
   *  This is the void counterpart of `wallBase`: a baseline that doesn't need parallax. */
  voidTilt: 0.7,
  /** Pit-wall **parallax** weight: extra for the far wall you look across at, which
   *  shifts with the camera (the depth cue on top of the tilt). */
  voidLean: 0.5,
  /** Peak opacity of an inner pit wall (clamped); per-edge by tilt + parallax above. */
  voidWallAlpha: 0.95,
  /** Fraction of the wall (from the rim down) that stays FULLY solid before it starts
   *  fading into the fog — so the wall reads as a surface first, gradient second. 0 =
   *  fade from the rim (all feather); ~0.5 = solid top half, then ramp. */
  voidWallSolid: 0.45,
  /** Thickness of the lit ground lip at the pit rim (world px). */
  lip: 2.5,
  /** Opacity of the lit ground lip — drawn on every pit edge to outline the hole. */
  lipAlpha: 0.6,
} as const;

/**
 * The side-face ("skirt") quads for extruding `box` by the vector `(dx, dy)` — the
 * faces of the box-edges that point *along* the vector (so they'd be visible as the
 * solid is pushed that way). Each quad is a flat `[x0,y0, x1,y1, x2,y2, x3,y3]` (the
 * edge, then the edge translated by the vector), wound as a simple polygon. An
 * axis-aligned vector yields one quad; a diagonal (the usual parallax case) yields two.
 */
export const extrudeRect = (box: Aabb, dx: number, dy: number): number[][] => {
  const x0 = box.x - box.w / 2;
  const x1 = box.x + box.w / 2;
  const y0 = box.y - box.h / 2;
  const y1 = box.y + box.h / 2;
  const quads: number[][] = [];
  if (dy > 0) quads.push([x0, y1, x1, y1, x1 + dx, y1 + dy, x0 + dx, y1 + dy]);
  if (dy < 0) quads.push([x1, y0, x0, y0, x0 + dx, y0 + dy, x1 + dx, y0 + dy]);
  if (dx > 0) quads.push([x1, y0, x1, y1, x1 + dx, y1 + dy, x1 + dx, y0 + dy]);
  if (dx < 0) quads.push([x0, y1, x0, y0, x0 + dx, y0 + dy, x0 + dx, y1 + dy]);
  return quads;
};

/**
 * A wall's side-face vector: feed it to `extrudeRect(wall, v.x, v.y)`. Two parts:
 *   - a **fixed south tilt** (`wallBase`) every wall shows — the camera's angle, so
 *     even a wall dead-centre reads as raised, not painted on the floor; plus
 *   - a small **parallax lean** toward the camera focus `(cx, cy)`, growing with
 *     distance (`wallLean`), so off-centre walls also show a side face that shifts as
 *     you move.
 * The two sum, so an off-axis wall shows both its south face and a side face (a fuller
 * 3D read), while the south tilt keeps every wall grounded.
 */
export const wallLeanVector = (box: Aabb, cx: number, cy: number, leanScale = 1): Vec2 => {
  const tx = cx - box.x;
  const ty = cy - box.y;
  const dist = Math.hypot(tx, ty);
  const lean = dist * ZONE_DEPTH.wallLean * leanScale;
  const lx = dist < 1e-3 ? 0 : (tx / dist) * lean;
  const ly = dist < 1e-3 ? 0 : (ty / dist) * lean;
  return { x: lx, y: ly + ZONE_DEPTH.wallBase };
};

/**
 * One pit edge rendered as a piece of cliff: a lit ground lip at the rim, then a wall
 * surface descending into the fog. Renderers paint the `lip*` rect in the lip colour,
 * then fill `(x,y,w,h)` with a gradient — wall colour (at `voidWallAlpha · intensity`)
 * at the rim `(x0,y0)` → transparent at the foot `(x1,y1)`, where it dissolves into
 * the mist.
 */
export interface RimBand {
  x: number;
  y: number;
  w: number;
  h: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Lit ground lip at the rim (thin strip just inside the edge). */
  lipX: number;
  lipY: number;
  lipW: number;
  lipH: number;
  /** 0..1 — how much this edge faces away from the camera (drives the wall's opacity).
   *  The lip is drawn regardless (it outlines the hole); the wall scales with this. */
  intensity: number;
}

type Span = [number, number];
const EDGE_EPS = 0.5;

/** `[lo,hi]` with every `blocker` interval removed — the gaps left over. Used to keep
 *  a void edge's rim only where it actually borders non-void: an abutting void rect
 *  covers part of the edge, and that covered part must NOT be rimmed (it's an interior
 *  seam between two meshed tiles, not a real pit edge). */
const subtractSpans = (lo: number, hi: number, blockers: readonly Span[]): Span[] => {
  const clipped = blockers
    .map((b): Span => [Math.max(lo, b[0]), Math.min(hi, b[1])])
    .filter((b) => b[1] - b[0] > EDGE_EPS)
    .sort((p, q) => p[0] - q[0]);
  const out: Span[] = [];
  let cursor = lo;
  for (const [a, b] of clipped) {
    if (a - cursor > EDGE_EPS) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (hi - cursor > EDGE_EPS) out.push([cursor, hi]);
  return out;
};

/**
 * Cliff bands for one void rect — the lit lip + descending wall along each pit edge,
 * but **only over the genuinely-exposed parts** of that edge. Greedy-meshed void rects
 * frequently share an edge only partially (a wide rect above the playable island sits
 * over two narrow rects either side of the gap), so each edge is split into the spans
 * NOT covered by an abutting void rect — that's what stops rim lines appearing *inside*
 * the void between meshed tiles. Every exposed span gets a lip (outlining the hole);
 * the wall's `intensity` is two parts (the same split as walls):
 *   - **tilt** (`voidTilt`) — a south-facing inner wall (the void's north edge) always
 *     shows a bit, from the camera angle alone. The wall you'd see standing just north
 *     of a pit; doesn't depend on camera position. Plus
 *   - **parallax** (`voidLean`) — extra for the edge facing away from the focus (the
 *     far wall you look across at), which shifts smoothly as you move.
 * `voids` is the full meshed set, for the abutment test.
 */
export const voidRimBands = (
  rect: Aabb,
  voids: readonly Aabb[],
  cx: number,
  cy: number,
  leanScale = 1,
): RimBand[] => {
  const d = ZONE_DEPTH.voidDepth;
  const lip = ZONE_DEPTH.lip;
  const left = rect.x - rect.w / 2;
  const right = rect.x + rect.w / 2;
  const top = rect.y - rect.h / 2;
  const bottom = rect.y + rect.h / 2;
  const bands: RimBand[] = [];

  const emit = (nx: number, ny: number, mx: number, my: number, band: Omit<RimBand, "intensity">): void => {
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    const tilt = Math.max(0, -ny);
    const parallax = Math.max(0, (nx * dx + ny * dy) / len);
    const intensity = Math.min(1, ZONE_DEPTH.voidTilt * tilt + ZONE_DEPTH.voidLean * parallax * leanScale);
    bands.push({ ...band, intensity });
  };

  // Spans of one edge (the range [lo,hi] along its axis) that border non-void: subtract
  // every void rect abutting on the outside. `abuts(r)` = r touches this edge's line;
  // `range(r)` = r's extent along the edge.
  const exposed = (lo: number, hi: number, abuts: (r: Aabb) => boolean, range: (r: Aabb) => Span): Span[] => {
    const blockers: Span[] = [];
    for (const r of voids) if (r !== rect && abuts(r)) blockers.push(range(r));
    return subtractSpans(lo, hi, blockers);
  };
  const xRange = (r: Aabb): Span => [r.x - r.w / 2, r.x + r.w / 2];
  const yRange = (r: Aabb): Span => [r.y - r.h / 2, r.y + r.h / 2];

  // Top edge (north-facing rim): void rects whose bottom sits on this edge block it.
  for (const [a, b] of exposed(left, right, (r) => Math.abs(r.y + r.h / 2 - top) < EDGE_EPS, xRange)) {
    const mx = (a + b) / 2;
    emit(0, -1, mx, top, { x: a, y: top, w: b - a, h: d, x0: mx, y0: top, x1: mx, y1: top + d, lipX: a, lipY: top, lipW: b - a, lipH: lip });
  }
  // Bottom edge (south-facing rim).
  for (const [a, b] of exposed(left, right, (r) => Math.abs(r.y - r.h / 2 - bottom) < EDGE_EPS, xRange)) {
    const mx = (a + b) / 2;
    emit(0, 1, mx, bottom, { x: a, y: bottom - d, w: b - a, h: d, x0: mx, y0: bottom, x1: mx, y1: bottom - d, lipX: a, lipY: bottom - lip, lipW: b - a, lipH: lip });
  }
  // Left edge (west-facing rim).
  for (const [a, b] of exposed(top, bottom, (r) => Math.abs(r.x + r.w / 2 - left) < EDGE_EPS, yRange)) {
    const my = (a + b) / 2;
    emit(-1, 0, left, my, { x: left, y: a, w: d, h: b - a, x0: left, y0: my, x1: left + d, y1: my, lipX: left, lipY: a, lipW: lip, lipH: b - a });
  }
  // Right edge (east-facing rim).
  for (const [a, b] of exposed(top, bottom, (r) => Math.abs(r.x - r.w / 2 - right) < EDGE_EPS, yRange)) {
    const my = (a + b) / 2;
    emit(1, 0, right, my, { x: right - d, y: a, w: d, h: b - a, x0: right, y0: my, x1: right - d, y1: my, lipX: right - lip, lipY: a, lipW: lip, lipH: b - a });
  }
  return bands;
};
