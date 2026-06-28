// Shared palette for the menu/settings UI (the in-game world has its own palette
// in game/constants COLORS). Kept here so the front-end screens stay consistent
// and the game's tuning constants don't leak into chrome.

export const UI = {
  /**
   * Pixel display font (Press Start 2P), loaded in App via expo-font. Used for
   * headings, buttons, and HUD chrome — anything short. Long descriptive copy
   * stays in the system font (pixel fonts are hard to read at body sizes). Only
   * ASCII glyphs render in this font, so labels using it avoid fancy punctuation.
   */
  font: "PressStart2P_400Regular",
  bg: "#0e1116",
  panel: "rgba(255, 255, 255, 0.05)",
  panelBorder: "rgba(255, 255, 255, 0.12)",
  text: "#eef1f6",
  textDim: "rgba(238, 241, 246, 0.55)",
  accent: "#f2c14e", // the player gold, reused for primary actions
  accentText: "#1d2433",
  track: "rgba(255, 255, 255, 0.10)",
  trackFill: "#f2c14e",
  knob: "#ffffff",
} as const;
