import { type Vec2, length } from "../math/vec2";

/**
 * Virtual-stick input, resolved from a raw touch offset.
 *
 * `dir` is a unit vector (zero when idle); `magnitude` is 0..1 where 0 is
 * standing still and 1 is full speed. Keeping direction and magnitude separate
 * lets gameplay scale speed without re-normalising.
 */
export interface StickSample {
  dir: Vec2;
  magnitude: number;
}

export const STICK_ZERO: StickSample = Object.freeze({
  dir: Object.freeze({ x: 0, y: 0 }),
  magnitude: 0,
});

/**
 * Fraction of the stick radius treated as "no input". Touch sensors and
 * resting thumbs jitter a few pixels; without a deadzone the player creeps.
 */
export const STICK_DEADZONE = 0.1;

/**
 * Resolve a touch offset (relative to the stick centre) into a stick sample.
 *
 * - Inside the deadzone → STICK_ZERO.
 * - Magnitude ramps linearly from 0 at the deadzone edge to 1 at `radius`,
 *   so full speed is reachable exactly at the rim and the deadzone doesn't
 *   eat the bottom of the speed range.
 * - Beyond `radius` the magnitude clamps at 1 (thumb can wander off the pad).
 */
export const resolveStick = (
  offset: Vec2,
  radius: number,
  deadzone: number = STICK_DEADZONE,
): StickSample => {
  if (radius <= 0) return STICK_ZERO;
  const len = length(offset);
  const deadzonePx = radius * deadzone;
  if (len <= deadzonePx) return STICK_ZERO;
  const clamped = Math.min(len, radius);
  return {
    dir: { x: offset.x / len, y: offset.y / len },
    magnitude: (clamped - deadzonePx) / (radius - deadzonePx),
  };
};

/**
 * Facing rule with no hostiles around (see player-movement-and-targeting.md):
 * face the movement direction while moving, hold the last facing when idle.
 * Angle is radians, 0 = +x, increasing clockwise (screen y points down).
 */
export const faceMovement = (currentFacing: number, stick: StickSample): number =>
  stick.magnitude > 0 ? Math.atan2(stick.dir.y, stick.dir.x) : currentFacing;
