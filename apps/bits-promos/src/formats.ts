/**
 * Frame rate and the shapes a promo ships in. Plain data on purpose: the
 * Desk's server (apps/desk) imports this via desk.config.ts, and brand.ts
 * (fonts, browser-only) re-exports it for the templates.
 */
export const FPS = 30;
export const VERTICAL = { width: 1080, height: 1920 } as const;

/** The three shapes a promo ships in. Vertical is the native one (TikTok,
 * Reels and Shorts all take 9:16); the others re-lay the same template. */
export type Format = "vertical" | "square" | "landscape";
export const FORMATS: Record<Format, { width: number; height: number; label: string }> = {
  vertical: { width: 1080, height: 1920, label: "9:16 · TikTok / Reels / Shorts" },
  square: { width: 1080, height: 1080, label: "1:1 · feed" },
  landscape: { width: 1920, height: 1080, label: "16:9 · YouTube / X" },
};
export const formatSize = (format?: Format) => {
  const f = FORMATS[format ?? "vertical"];
  return { width: f.width, height: f.height };
};
