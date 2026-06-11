export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const lengthSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const length = (a: Vec2): number => Math.sqrt(lengthSq(a));

export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const distanceSq = (a: Vec2, b: Vec2): number => lengthSq(sub(a, b));

export const normalize = (a: Vec2): Vec2 => {
  const len = length(a);
  return len === 0 ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
};

/**
 * Step `current` toward `target` by at most `maxDelta`, without overshooting.
 * The workhorse of acceleration-limited movement: call once per fixed step
 * with `maxDelta = rate * dt`.
 */
export const moveToward = (current: Vec2, target: Vec2, maxDelta: number): Vec2 => {
  const delta = sub(target, current);
  const dist = length(delta);
  if (dist <= maxDelta) return target;
  return add(current, scale(delta, maxDelta / dist));
};

/** Linear interpolation; `t` is clamped to [0, 1]. Used for render interpolation. */
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
};

/** Angle (radians) of the direction from `from` to `to`. 0 = +x, clockwise (screen y down). */
export const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

/** Rotate a vector by `angle` radians (positive = clockwise with screen y down). */
export const rotate = (v: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/**
 * Signed smallest difference between two angles, normalised to [-π, π].
 * Needed wherever angles are compared (arc hit checks, turn-toward logic) —
 * raw subtraction breaks at the ±π wrap.
 */
export const angleDiff = (a: number, b: number): number => {
  const TWO_PI = Math.PI * 2;
  let d = (a - b) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
};
