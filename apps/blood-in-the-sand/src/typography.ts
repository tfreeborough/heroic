/**
 * The display face — ONE home (it used to be a per-file
 * `Platform.select({ ios: "Copperplate" })`, which meant Android read the
 * whole ceremony voice in generic serif). Cinzel Bold (Tom, 2026-08-14 —
 * replaced IM Fell English SC, whose ink distress read as papyrus): a
 * descendant of the Trajan's Column inscriptional capitals, the Roman
 * arena voice cut in stone. Lowercase glyphs set as capitals, so the
 * mixed-case strings that relied on IM Fell's small caps still render as
 * caps unchanged. Static 700 instance (the variable TTF renders at its
 * default weight in RN). Bundled TTF (OFL, licence file beside it);
 * App.tsx loads it with `useFonts(DISPLAY_FONT_SOURCE)` so the load's
 * completion re-renders the tree — until then RN silently falls back to
 * the system font for a frame or two, which beats gating the whole app
 * on a font.
 */
export const DISPLAY_FONT = "Cinzel-Bold";

export const DISPLAY_FONT_SOURCE = {
  [DISPLAY_FONT]: require("../assets/fonts/Cinzel-Bold.ttf") as number,
};
