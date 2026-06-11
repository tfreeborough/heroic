/**
 * A tiny, allocation-light ECS. Deliberately minimal — enough to organise
 * real-time entities (players, enemies, projectiles) without prescribing a
 * rendering or physics layer. Components are plain objects keyed by a string.
 */
export type Entity = number;

export type ComponentMap = Record<string, unknown>;

export interface World {
  /** Spawn an entity with an initial set of components. Returns its id. */
  spawn(components?: ComponentMap): Entity;
  /** Remove an entity and all its components. */
  despawn(entity: Entity): void;
  alive(entity: Entity): boolean;
  /** Get a component by name (typed by the caller). */
  get<T>(entity: Entity, component: string): T | undefined;
  /** Add or replace a component on an entity. */
  set<T>(entity: Entity, component: string, value: T): void;
  remove(entity: Entity, component: string): void;
  /** All living entities that have *every* named component. */
  query(...components: string[]): Entity[];
}

export const createWorld = (): World => {
  const entities = new Set<Entity>();
  const stores = new Map<string, Map<Entity, unknown>>();
  let nextId = 1;

  const storeFor = (component: string): Map<Entity, unknown> => {
    let store = stores.get(component);
    if (!store) {
      store = new Map();
      stores.set(component, store);
    }
    return store;
  };

  return {
    spawn(components = {}) {
      const entity = nextId++;
      entities.add(entity);
      for (const [name, value] of Object.entries(components)) {
        storeFor(name).set(entity, value);
      }
      return entity;
    },
    despawn(entity) {
      entities.delete(entity);
      for (const store of stores.values()) store.delete(entity);
    },
    alive(entity) {
      return entities.has(entity);
    },
    get(entity, component) {
      return stores.get(component)?.get(entity) as never;
    },
    set(entity, component, value) {
      if (!entities.has(entity)) return;
      storeFor(component).set(entity, value);
    },
    remove(entity, component) {
      stores.get(component)?.delete(entity);
    },
    query(...components) {
      if (components.length === 0) return [...entities];
      // Iterate the smallest store first for a cheap intersection.
      const relevant = components.map((c) => storeFor(c));
      relevant.sort((a, b) => a.size - b.size);
      const [smallest, ...rest] = relevant;
      const result: Entity[] = [];
      for (const entity of smallest!.keys()) {
        if (rest.every((store) => store.has(entity))) result.push(entity);
      }
      return result;
    },
  };
};

/** A system advances the world by one fixed simulation tick. */
export type System = (world: World, dt: number) => void;
