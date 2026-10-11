/**
 * Autosave ships vertical only: it lives on TikTok / Reels / Shorts. Plain
 * data: the Desk's server reads it through desk.config.ts.
 */
export const FPS = 30;
export const VERTICAL = { width: 1080, height: 1920 } as const;
export const FORMATS = {
  vertical: { width: 1080, height: 1920, label: "9:16 · TikTok / Reels / Shorts" },
};
