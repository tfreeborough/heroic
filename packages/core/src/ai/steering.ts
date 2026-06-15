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
  // Hot path: runs for every enemy against every other enemy each step, so it
  // accumulates into scalars instead of allocating a Vec2 per neighbour, and
  // compares squared distances to skip the sqrt for the (usually many)
  // neighbours outside `radius`. `pos` itself may appear in `neighbors` (callers
  // pass one shared position list); the dist-0 self entry is skipped like any
  // exact overlap.
  const radiusSq = radius * radius;
  let px = 0;
  let py = 0;
  for (const n of neighbors) {
    const ax = pos.x - n.x;
    const ay = pos.y - n.y;
    const distSq = ax * ax + ay * ay;
    if (distSq >= radiusSq || distSq === 0) continue;
    const dist = Math.sqrt(distSq);
    const weight = (1 - dist / radius) / dist;
    px += ax * weight;
    py += ay * weight;
  }
  if (px === 0 && py === 0) return { x: 0, y: 0 };
  return clampSpeed({ x: px * maxSpeed, y: py * maxSpeed }, maxSpeed);
};

/** Cap a blended desired velocity so stacked behaviours can't exceed `maxSpeed`. */
export const clampSpeed = (v: Vec2, maxSpeed: number): Vec2 => {
  const len = length(v);
  return len > maxSpeed ? scale(v, maxSpeed / len) : v;
};
