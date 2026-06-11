import Matter from "matter-js";

export interface PhysicsWorld {
  engine: Matter.Engine;
  world: Matter.World;
}

export interface PhysicsOptions {
  /** Default 0/0 — top-down action games usually want no gravity. */
  gravityX?: number;
  gravityY?: number;
}

/** Creates an isolated Matter.js world. One per game scene. */
export const createPhysicsWorld = (options: PhysicsOptions = {}): PhysicsWorld => {
  const engine = Matter.Engine.create();
  engine.gravity.x = options.gravityX ?? 0;
  engine.gravity.y = options.gravityY ?? 0;
  return { engine, world: engine.world };
};

/** Advance physics by one fixed step. `dt` is in seconds (Matter wants ms). */
export const stepPhysics = (physics: PhysicsWorld, dt: number): void => {
  Matter.Engine.update(physics.engine, dt * 1000);
};

export const addBody = (physics: PhysicsWorld, body: Matter.Body): void => {
  Matter.Composite.add(physics.world, body);
};

export const removeBody = (physics: PhysicsWorld, body: Matter.Body): void => {
  Matter.Composite.remove(physics.world, body);
};

// Re-export Matter so games don't take a second direct dependency on it.
export { Matter };
