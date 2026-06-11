import Matter from "matter-js";

/**
 * Matter normalises Body.setVelocity/getVelocity to its base tick of
 * 16.666ms (60Hz), independent of the delta passed to Engine.update.
 * Dividing px/s by 60 therefore yields real pixels-per-second motion.
 */
const MATTER_BASE_TICKS_PER_SECOND = 60;

/** Drive a body at a velocity expressed in px/s (hides Matter's tick units). */
export const setVelocityPerSecond = (body: Matter.Body, vx: number, vy: number): void => {
  Matter.Body.setVelocity(body, {
    x: vx / MATTER_BASE_TICKS_PER_SECOND,
    y: vy / MATTER_BASE_TICKS_PER_SECOND,
  });
};

/**
 * Read a body's velocity in px/s. Post-collision, so accelerating from this
 * (rather than from a commanded velocity) keeps the controls honest about
 * what physics actually allowed.
 */
export const getVelocityPerSecond = (body: Matter.Body): { x: number; y: number } => {
  const v = Matter.Body.getVelocity(body);
  return {
    x: v.x * MATTER_BASE_TICKS_PER_SECOND,
    y: v.y * MATTER_BASE_TICKS_PER_SECOND,
  };
};

/**
 * A player/enemy mover: a circle that collides but never spins or bounces.
 * - inertia: Infinity — collisions can't rotate it; facing is gameplay state,
 *   not physics state (see player-movement-and-targeting.md).
 * - zero friction/restitution — velocity is set directly each step, so any
 *   physics damping would just fight the controls; walls slide, not bounce.
 */
export const createMoverBody = (x: number, y: number, radius: number): Matter.Body =>
  Matter.Bodies.circle(x, y, radius, {
    inertia: Infinity,
    friction: 0,
    frictionStatic: 0,
    frictionAir: 0,
    restitution: 0,
  });

/** An impassable static rectangle (walls, blockers). Centred on (x, y). */
export const createBlockerBody = (x: number, y: number, width: number, height: number): Matter.Body =>
  Matter.Bodies.rectangle(x, y, width, height, { isStatic: true });
