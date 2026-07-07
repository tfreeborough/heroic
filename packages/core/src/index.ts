// @heroic/core — engine-agnostic game logic shared by every Heroic game.
// IMPORTANT: this package must stay pure TypeScript. No react-native, no Skia,
// no DOM. Everything here is unit-testable with `bun test` and reusable across
// both "Heroic" and "Heroic: Enter the Gauntlet".

export * from "./math/vec2";
export * from "./movement/stick";
export * from "./movement/locomotion";
export * from "./pathfinding/grid";
export * from "./pathfinding/astar";
export * from "./pathfinding/navgrid";
export * from "./pathfinding/flowField";
export * from "./ai/steering";
export * from "./ai/pursue";
export * from "./ai/perception";
export * from "./ai/runtime";
export * from "./ai/archetypes";
export * from "./creature/roster";
export * from "./spawner/spawner";
export * from "./trigger/trigger";
export * from "./keys/keys";
export * from "./spatial/grid";
export * from "./physics/crowd";
export * from "./vision/visibility";
export * from "./vision/fog";
export * from "./stats/stats";
export * from "./stats/modifiers";
export * from "./stats/classes";
export * from "./stats/derive";
export * from "./progression/xp";
export * from "./progression/chains";
export * from "./progression/talents";
export * from "./progression/levelGap";
export * from "./combat/combat";
export * from "./combat/attack";
export * from "./combat/targeting";
export * from "./combat/hitbox";
export * from "./combat/projectile";
export * from "./combat/flight";
export * from "./abilities/ability";
export * from "./ecs/world";
export * from "./sim/loop";
export * from "./zone/format";
export * from "./zone/mesh";
export * from "./zone/load";
export * from "./zone/view";
export * from "./zone/theme";
export * from "./zone/depth";
export * from "./audio/musicState";
export * from "./audio/sound";
export * from "./rng";
