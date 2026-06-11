// @heroic/engine — the React Native runtime layer that drives @heroic/core's
// pure simulation. This is the ONLY place that knows about frame timing and
// physics. Swapping the renderer (Skia → Pixi) or physics (Matter → Rapier)
// later means touching this package and nothing else.

export * from "@heroic/core";
export * from "./useGameLoop";
export * from "./physics/matterWorld";
export * from "./physics/bodies";
