// The archetype catalogue (see docs/design/enemy-behaviour.md). Each module is
// a self-contained behaviour pattern implementing the uniform Archetype
// interface; a creature picks one and tunes it with config data.
export * from "./chaser";
export * from "./circler";
export * from "./ambusher";
export * from "./kiter";
export * from "./charger";
