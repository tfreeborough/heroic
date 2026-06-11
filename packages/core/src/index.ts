// @heroic/core — engine-agnostic game logic shared by every Heroic game.
// IMPORTANT: this package must stay pure TypeScript. No react-native, no Skia,
// no DOM. Everything here is unit-testable with `bun test` and reusable across
// both "Heroic" and "Heroic: Enter the Gauntlet".

export * from "./math/vec2";
export * from "./movement/stick";
export * from "./movement/locomotion";
export * from "./pathfinding/grid";
export * from "./pathfinding/astar";
export * from "./combat/combat";
export * from "./combat/attack";
export * from "./combat/targeting";
export * from "./combat/hitbox";
export * from "./combat/projectile";
export * from "./combat/flight";
export * from "./ecs/world";
export * from "./sim/loop";
export * from "./rng";
