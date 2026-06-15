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

/** Add to a body's velocity, expressed in px/s — impulses like knockback. */
export const addVelocityPerSecond = (body: Matter.Body, dvx: number, dvy: number): void => {
  const v = Matter.Body.getVelocity(body);
  Matter.Body.setVelocity(body, {
    x: v.x + dvx / MATTER_BASE_TICKS_PER_SECOND,
    y: v.y + dvy / MATTER_BASE_TICKS_PER_SECOND,
  });
};

/** Teleport a body and zero its motion — respawns, scene resets. */
export const resetBody = (body: Matter.Body, x: number, y: number): void => {
  Matter.Body.setPosition(body, { x, y });
  Matter.Body.setVelocity(body, { x: 0, y: 0 });
};

export interface MoverOptions {
  /**
   * Matter's per-tick velocity damping (0 = none). Leave at 0 for bodies
   * driven by a commanded velocity each step (the player); set it for bodies
   * that only ever receive impulses (knockback dummies) so they glide to a
   * stop instead of sliding forever.
   */
  frictionAir?: number;
  /**
   * Matter collision group. Bodies that share the same *negative* group never
   * collide with each other, but still collide with everything else (the player,
   * walls). Give a whole swarm one negative group so they pass through one another
   * — spacing handled by steering separation, not physics — which removes the
   * crowd's O(n²) contact pairs (the dominant cost when many enemies pile up).
   * Default 0: normal collisions with everyone.
   */
  collisionGroup?: number;
}

/**
 * A player/enemy mover: a circle that collides but never spins or bounces.
 * - inertia: Infinity — collisions can't rotate it; facing is gameplay state,
 *   not physics state (see player-movement-and-targeting.md).
 * - zero friction/restitution — velocity is set directly each step, so any
 *   physics damping would just fight the controls; walls slide, not bounce.
 */
export const createMoverBody = (
  x: number,
  y: number,
  radius: number,
  options: MoverOptions = {},
): Matter.Body =>
  Matter.Bodies.circle(x, y, radius, {
    inertia: Infinity,
    friction: 0,
    frictionStatic: 0,
    frictionAir: options.frictionAir ?? 0,
    restitution: 0,
  });

/** An impassable static rectangle (walls, blockers). Centred on (x, y). */
export const createBlockerBody = (x: number, y: number, width: number, height: number): Matter.Body =>
  Matter.Bodies.rectangle(x, y, width, height, { isStatic: true });
