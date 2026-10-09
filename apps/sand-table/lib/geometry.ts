/** Bounds and hit testing for the board. Pure. */
import { type Element, type Point, hasPoints, isBox } from "./scene";

export type Rect = { x: number; y: number; w: number; h: number };

/** A rect with positive width and height, whichever corner was dragged from. */
export const normalize = (r: Rect): Rect => ({
  x: Math.min(r.x, r.x + r.w),
  y: Math.min(r.y, r.y + r.h),
  w: Math.abs(r.w),
  h: Math.abs(r.h),
});

export const bounds = (el: Element): Rect => {
  if (isBox(el)) return normalize({ x: el.x, y: el.y, w: el.w, h: el.h });
  if (hasPoints(el)) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of el.points) {
      x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
    }
    if (!isFinite(x0)) return { x: el.x, y: el.y, w: 0, h: 0 };
    return { x: el.x + x0, y: el.y + y0, w: x1 - x0, h: y1 - y0 };
  }
  const e = el as Element;
  return { x: e.x, y: e.y, w: 0, h: 0 };
};

export const union = (rects: Rect[]): Rect | undefined => {
  if (!rects.length) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export const inRect = (p: Point, r: Rect, pad = 0): boolean => p[0] >= r.x - pad && p[0] <= r.x + r.w + pad && p[1] >= r.y - pad && p[1] <= r.y + r.h + pad;

export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const rectContains = (outer: Rect, inner: Rect): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const distToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

const distToPolyline = (p: Point, pts: Point[], closed = false): number => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1]!, pts[i]!));
  if (closed && pts.length > 2) best = Math.min(best, distToSegment(p, pts[pts.length - 1]!, pts[0]!));
  return best;
};

/** Does a world point land on the element? `tol` is in world units (scale it by 1/zoom). */
export const hits = (el: Element, p: Point, tol: number): boolean => {
  const b = bounds(el);
  if (!inRect(p, b, tol)) return false;
  switch (el.type) {
    case "text":
    case "image":
    case "glyph":
    case "frame":
      return el.type !== "frame" || !inRect(p, b, -tol); // a frame is hit on its edge only
    case "rect":
    case "ellipse":
    case "diamond": {
      const filled = el.fillStyle !== "none" && el.fill !== "transparent";
      if (filled) return el.type !== "ellipse" || insideEllipse(p, b) || nearEllipse(p, b, tol);
      if (el.type === "ellipse") return nearEllipse(p, b, tol);
      if (el.type === "diamond") {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return distToPolyline(p, [[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]], true) <= tol;
      }
      return distToPolyline(p, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]], true) <= tol;
    }
    case "line":
    case "arrow":
    case "pen":
      return distToPolyline(p, el.points.map(([x, y]) => [x + el.x, y + el.y] as Point)) <= tol;
  }
};

const insideEllipse = (p: Point, b: Rect): boolean => {
  const rx = b.w / 2, ry = b.h / 2;
  if (!rx || !ry) return false;
  const nx = (p[0] - (b.x + rx)) / rx, ny = (p[1] - (b.y + ry)) / ry;
  return nx * nx + ny * ny <= 1;
};
const nearEllipse = (p: Point, b: Rect, tol: number): boolean => {
  const rx = b.w / 2, ry = b.h / 2;
  if (rx < tol || ry < tol) return inRect(p, b, tol);
  const cx = b.x + rx, cy = b.y + ry;
  const a = Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx);
  return Math.hypot(p[0] - (cx + rx * Math.cos(a)), p[1] - (cy + ry * Math.sin(a))) <= tol;
};

/** Points of an element shifted by (dx, dy). */
export const moved = <T extends Element>(el: T, dx: number, dy: number): T => ({ ...el, x: el.x + dx, y: el.y + dy });

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
export const handlePoint = (r: Rect, h: Handle): Point => {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  switch (h) {
    case "nw": return [r.x, r.y];
    case "n": return [cx, r.y];
    case "ne": return [r.x + r.w, r.y];
    case "e": return [r.x + r.w, cy];
    case "se": return [r.x + r.w, r.y + r.h];
    case "s": return [cx, r.y + r.h];
    case "sw": return [r.x, r.y + r.h];
    case "w": return [r.x, cy];
  }
};

/** The rect after dragging handle `h` of `start` by (dx, dy); `lockAspect` keeps the corner drags proportional. */
export const resizeRect = (start: Rect, h: Handle, dx: number, dy: number, lockAspect: boolean): Rect => {
  let { x, y, w, h: hh } = start;
  if (h.includes("e")) w += dx;
  if (h.includes("w")) { x += dx; w -= dx; }
  if (h.includes("s")) hh += dy;
  if (h.includes("n")) { y += dy; hh -= dy; }
  if (lockAspect && start.w && start.h && h.length === 2) {
    const ratio = start.w / start.h;
    const nw = Math.abs(w), nh = Math.abs(hh);
    if (nw / ratio > nh) hh = Math.sign(hh || 1) * nw / ratio; else w = Math.sign(w || 1) * nh * ratio;
    if (h.includes("w")) x = start.x + start.w - w;
    if (h.includes("n")) y = start.y + start.h - hh;
  }
  return { x, y, w, h: hh };
};

/** Scale an element so its bounds go from `from` to `to` (used by group resize). */
export const fitInto = (el: Element, from: Rect, to: Rect): Element => {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const mapX = (x: number) => to.x + (x - from.x) * sx;
  const mapY = (y: number) => to.y + (y - from.y) * sy;
  if (hasPoints(el)) {
    const nx = mapX(el.x), ny = mapY(el.y);
    return { ...el, x: nx, y: ny, points: el.points.map(([px, py]) => [px * sx, py * sy] as Point) };
  }
  if (isBox(el)) {
    const b = normalize({ x: el.x, y: el.y, w: el.w, h: el.h });
    const r = { x: mapX(b.x), y: mapY(b.y), w: b.w * sx, h: b.h * sy };
    if (el.type === "text") {
      // Text scales by its font, keeping its own measured box.
      const k = Math.min(Math.abs(sx), Math.abs(sy)) || 1;
      return { ...el, x: r.x, y: r.y, fontSize: Math.max(8, el.fontSize * k), w: el.w * k, h: el.h * k };
    }
    return { ...el, ...r } as Element;
  }
  return el;
};
