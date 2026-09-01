/**
 * The Sun-Forged Relic brand tokens — palette anchors straight from
 * docs/design/bits-art-style.md. If that doc moves, move this with it.
 *
 * Two faces: Cinzel is the GAME's (its title, the item names — what the
 * app itself is set in); Inter carries everything else — captions, the
 * numbers, the sign-off — because on a phone at arm's length readable beats
 * characterful.
 */
import type * as React from "react";
import { loadFont } from "@remotion/fonts";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { staticFile } from "remotion";

export const palette = {
  sand: "#dcb96f", // honey sand-gold
  steel: "#9aa0a6", // battle-grey steel
  bone: "#f2e9d4", // hottest highlight
  crimson: "#a32c22", // dried-blood red
  umber: "#4a3520", // warm dark shadow — never pure black
  night: "#241708", // backdrop floor (umber pushed down, still warm)
  ink: "rgba(20,10,4,0.84)", // caption ground
} as const;

export const CINZEL = "Cinzel";

loadFont({
  family: CINZEL,
  url: staticFile("assets/fonts/Cinzel-Bold.ttf"),
  weight: "700",
});

const inter = loadInter("normal", { weights: ["500", "700", "800"], subsets: ["latin"] });
/** Google-hosted, fetched at render; the fallback stack keeps an offline
 * render from failing (it just loses the face). */
export const SANS = `${inter.fontFamily}, -apple-system, "Helvetica Neue", Arial, sans-serif`;

/** 2×2 Bayer checkerboard, scaled chunky — the art style's dither signature. */
export const ditherOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='2' height='2'%3E%3Crect width='1' height='1' fill='white'/%3E%3Crect x='1' y='1' width='1' height='1' fill='white'/%3E%3C/svg%3E\")",
  backgroundSize: "8px 8px",
  imageRendering: "pixelated",
  opacity: 0.05,
  pointerEvents: "none",
};

export const FPS = 30;
export const VERTICAL = { width: 1080, height: 1920 } as const;
