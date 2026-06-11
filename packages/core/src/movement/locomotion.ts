import { type Vec2, length, moveToward } from "../math/vec2";

/**
 * Acceleration-limited velocity shaping: the stick produces a *desired*
 * velocity, and the actual velocity chases it at a capped rate. That cap is
 * what gives movement weight — slamming the stick ramps speed over a few
 * frames instead of teleporting to full speed, and releasing it leaves a
 * short skid instead of stopping on a dime.
 *
 * Two rates, both in px/s²:
 * - `accel` applies when speeding up (or turning at the same speed) — the
 *   ramp-up feel. A flat-out reversal pays the ramp twice, which reads as
 *   momentum.
 * - `decel` applies when the desired speed is *lower* than the current speed
 *   (easing the stick back, or releasing it entirely) — keep this much higher
 *   than `accel` so stopping feels responsive, just not instant.
 *
 * Call once per fixed step; returns the new velocity.
 */
export const approachVelocity = (
  current: Vec2,
  desired: Vec2,
  dt: number,
  accel: number,
  decel: number,
): Vec2 => {
  const rate = length(desired) < length(current) ? decel : accel;
  return moveToward(current, desired, rate * dt);
};
