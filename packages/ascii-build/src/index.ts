/**
 * ASCII builds: a picture assembles itself out of glyphs over time.
 * Born in apps/bits-promos/lab/beat-builds (2026-10-09); used by the Save
 * Point channel (docs/design/save-point-channel.md) and, later, the BITS
 * Desk's sketch cards.
 *
 *   const ink = inkFromImage(img, "light");
 *   const build = planBuild({ ink, look: LOCKED_LOOK, box, frame, start, end, seed, arrival, order, exit });
 *   drawBuild(ctx, build, t, { palette: PALETTES.matrix, cache });
 */
export * from "./look";
export * from "./ink";
export * from "./plan";
export * from "./draw";
