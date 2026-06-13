import { add, length, normalize, scale, sub, type Vec2 } from "../math/vec2";

/**
 * The shared steering palette (see docs/design/enemy-behaviour.md, layer 2).
 * Each behaviour is a pure function returning a *desired velocity* in px/s —
 * "which way I want to move, and how fast". Behaviours compose by vector
 * addition (then `clampSpeed`), and the result is fed through the same
 * acceleration-limited locomotion the player uses, so enemies inherit the
 * weight/skid feel for free.
 */

/** Full speed straight at the target. The chaser special. */
export const seek = (pos: Vec2, target: Vec2, maxSpeed: number): Vec2 =>
  scale(normalize(sub(target, pos)), maxSpeed);

/** Full speed straight away from the target — the inverse of seek (the kiter's retreat). */
export const flee = (pos: Vec2, target: Vec2, maxSpeed: number): Vec2 =>
  scale(normalize(sub(pos, target)), maxSpeed);

/**
 * Seek, but ease off inside `slowRadius` so the mover settles at the target
 * instead of orbiting an overshoot.
 */
export const arrive = (pos: Vec2, target: Vec2, maxSpeed: number, slowRadius: number): Vec2 => {
  const offset = sub(target, pos);
  const dist = length(offset);
  if (dist === 0) return { x: 0, y: 0 };
  const speed = dist < slowRadius ? maxSpeed * (dist / slowRadius) : maxSpeed;
  return scale(offset, speed / dist);
};

/**
 * Circle the target at `ringDistance`: a tangential component (the circling)
 * plus a radial correction proportional to how far off the ring the mover is,
 * so drifting in or out self-corrects instead of spiralling.
 *
 * `direction` picks which way round: +1 = clockwise on screen (y down),
 * -1 = counter-clockwise. Per-enemy consistent direction reads as a personality.
 */
export const orbit = (
  pos: Vec2,
  target: Vec2,
  maxSpeed: number,
  ringDistance: number,
  direction: 1 | -1,
): Vec2 => {
  const toTarget = sub(target, pos);
  const dist = length(toTarget);
  // Dead-centre has no tangent; just hold and let separation/physics nudge us off.
  if (dist === 0) return { x: 0, y: 0 };
  const radial = scale(toTarget, 1 / dist);
  const tangent = { x: -radial.y * direction, y: radial.x * direction };
  // Ring error as a fraction of the ring, clamped to ±1: small drift = gentle
  // correction, badly off the ring = correction dominates the circling.
  const error = Math.max(-1, Math.min(1, (dist - ringDistance) / ringDistance));
  return scale(normalize(add(tangent, scale(radial, error))), maxSpeed);
};

/**
 * Back away when closer than `minDistance`; zero otherwise. Strength ramps
 * with intrusion depth, so blending with orbit yields a soft "kept distance"
 * rather than a hard bounce at the threshold.
 */
export const keepDistance = (pos: Vec2, target: Vec2, maxSpeed: number, minDistance: number): Vec2 => {
  const away = sub(pos, target);
  const dist = length(away);
  if (dist >= minDistance) return { x: 0, y: 0 };
  if (dist === 0) return { x: maxSpeed, y: 0 }; // degenerate overlap: any way out
  return scale(away, (maxSpeed * (1 - dist / minDistance)) / dist);
};

/**
 * Steer away from nearby allies so crowds spread and flow instead of stacking
 * into one point (on by default for every enemy). Each neighbour inside
 * `radius` pushes inverse-linearly with closeness; the summed push is capped
 * at `maxSpeed`.
 */
export const separation = (
  pos: Vec2,
  neighbors: readonly Vec2[],
  maxSpeed: number,
  radius: number,
): Vec2 => {
  let push = { x: 0, y: 0 };
  for (const n of neighbors) {
    const away = sub(pos, n);
    const dist = length(away);
    if (dist >= radius || dist === 0) continue;
    push = add(push, scale(away, (1 - dist / radius) / dist));
  }
  if (push.x === 0 && push.y === 0) return push;
  return clampSpeed(scale(push, maxSpeed), maxSpeed);
};

/** Cap a blended desired velocity so stacked behaviours can't exceed `maxSpeed`. */
export const clampSpeed = (v: Vec2, maxSpeed: number): Vec2 => {
  const len = length(v);
  return len > maxSpeed ? scale(v, maxSpeed / len) : v;
};
