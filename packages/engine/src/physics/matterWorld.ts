import Matter from "matter-js";

export interface PhysicsWorld {
  engine: Matter.Engine;
  world: Matter.World;
}

export interface PhysicsOptions {
  /** Default 0/0 — top-down action games usually want no gravity. */
  gravityX?: number;
  gravityY?: number;
  /**
   * Constraint-solver iteration counts (position/velocity/constraint). The
   * solver runs these *per contact pair*, and the pair count spikes when a
   * crowd piles up — so these are the main knob on collision cost in dense
   * fights. Matter's defaults (6/4/2) target stacked rigid bodies under
   * gravity; our movers are velocity-driven, frictionless, restitution-free
   * circles with no joints, which need far fewer. Defaults below are tuned for
   * that. Raise positionIterations if bodies visibly sink into each other in a
   * crush; the others can usually stay low.
   */
  positionIterations?: number;
  velocityIterations?: number;
  constraintIterations?: number;
}

/** Creates an isolated Matter.js world. One per game scene. */
export const createPhysicsWorld = (options: PhysicsOptions = {}): PhysicsWorld => {
  const engine = Matter.Engine.create();
  engine.gravity.x = options.gravityX ?? 0;
  engine.gravity.y = options.gravityY ?? 0;
  engine.positionIterations = options.positionIterations ?? 4;
  engine.velocityIterations = options.velocityIterations ?? 2;
  engine.constraintIterations = options.constraintIterations ?? 1;
  return { engine, world: engine.world };
};

/**
 * Advance physics by one fixed step. `dt` is in seconds (Matter wants ms).
 * Matter integrates best at ≤16.667ms; when the game loop drops to a coarser sim
 * rate (e.g. 30Hz → 33ms steps), we sub-step so each Engine.update stays in that
 * range — same total motion, no large-delta instability or warnings.
 */
const MATTER_MAX_DELTA_MS = 1000 / 60;
export const stepPhysics = (physics: PhysicsWorld, dt: number): void => {
  const ms = dt * 1000;
  if (ms <= MATTER_MAX_DELTA_MS + 1e-6) {
    Matter.Engine.update(physics.engine, ms);
    return;
  }
  const subSteps = Math.ceil(ms / MATTER_MAX_DELTA_MS);
  const subMs = ms / subSteps;
  for (let i = 0; i < subSteps; i++) Matter.Engine.update(physics.engine, subMs);
};

export const addBody = (physics: PhysicsWorld, body: Matter.Body): void => {
  Matter.Composite.add(physics.world, body);
};

export const removeBody = (physics: PhysicsWorld, body: Matter.Body): void => {
  Matter.Composite.remove(physics.world, body);
};

// Re-export Matter so games don't take a second direct dependency on it.
export { Matter };
