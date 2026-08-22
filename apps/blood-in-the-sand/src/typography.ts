/**
 * The display face — ONE home (it used to be a per-file
 * `Platform.select({ ios: "Copperplate" })`, which meant Android read the
 * whole ceremony voice in generic serif). Cinzel Bold (Tom, 2026-08-14 —
 * replaced IM Fell English SC, whose ink distress read as papyrus): a
 * descendant of the Trajan's Column inscriptional capitals, the Roman
 * arena voice cut in stone. Lowercase glyphs set as capitals, so the
 * mixed-case strings that relied on IM Fell's small caps still render as
 * caps unchanged. Static 700 instance (the variable TTF renders at its
 * default weight in RN). Bundled TTF (OFL, licence file beside it).
 *
 * Two ways it reaches the screen, both under the SAME name — the TTF's
 * PostScript name is literally "Cinzel-Bold", which is what iOS resolves
 * an embedded font by and what Android names an assets/fonts/ file:
 *   1. app.json's expo-font config plugin embeds it in the native build
 *      (iOS UIAppFonts / Android assets/fonts), so it's registered at
 *      launch and `useFonts` reports it loaded synchronously.
 *   2. Builds from before the plugin load it at runtime via the same
 *      `useFonts(DISPLAY_FONT_SOURCE)` — and App.tsx holds the routed
 *      tree back until that lands. It used to render straight away and
 *      let the load re-render the tree, but a Text that mounts before the
 *      face is registered is measured in the system fallback and then
 *      drawn in Cinzel (wider) — the title's "IN THE SAND" lost its "SAND"
 *      off the end of the measured box, and text that never re-measured
 *      stayed in the fallback face (Tom, 2026-08-22).
 */
export const DISPLAY_FONT = "Cinzel-Bold";

export const DISPLAY_FONT_SOURCE = {
  [DISPLAY_FONT]: require("../assets/fonts/Cinzel-Bold.ttf") as number,
};
