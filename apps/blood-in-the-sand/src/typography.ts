/**
 * The display face — ONE home (it used to be a per-file
 * `Platform.select({ ios: "Copperplate" })`, which meant Android read the
 * whole ceremony voice in generic serif). IM Fell English SC (Tom,
 * 2026-08-08 — the specimen round): worn 17th-century print, the chronicle
 * made literal. Small-caps cut, so mixed-case strings set as elegant caps.
 * Bundled TTF (OFL, licence file beside it); App.tsx loads it with
 * `useFonts(DISPLAY_FONT_SOURCE)` so the load's completion re-renders the
 * tree — until then RN silently falls back to the system font for a frame
 * or two, which beats gating the whole app on a font.
 */
export const DISPLAY_FONT = "IMFellEnglishSC";

export const DISPLAY_FONT_SOURCE = {
  [DISPLAY_FONT]: require("../assets/fonts/IMFellEnglishSC-Regular.ttf") as number,
};
