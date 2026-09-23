/**
 * The words. Names and item one-liners come from the game via roster.json
 * (the one-liner is the War Table codex quote); the intro/outro text is the
 * only hand-written part.
 */

export const DEV = {
  game: "BLOOD IN THE SAND",
  preview: {
    weapon: "WEAPON PREVIEW",
    ability: "ABILITY PREVIEW",
    real: "REAL IN-APP GAMEPLAY",
    rec: "REC",
  },
  outro: {
    headline: "Rise to glory in the arena.",
    features: ["1v1 and 2v2 ranked modes", "Custom games with friends", "100+ achievements", "Completely free to play"],
    free: "FREE TO PLAY",
    where: "OUT NOW ON iOS + ANDROID",
    support: "Support indie game developers",
  },
  handles: ["discord.gg/8FHgBmaSnT", "r/FreeTheBoroughGames"],
  /** The match clip's cold open: what's under the title. */
  matchClip: {
    real: "Real gameplay · recorded in-match",
  },
  /** The match clip's end card — an indie game, and why that matters. Android
   * isn't mentioned until Play approves the listing. */
  signoff: {
    eyebrow: "Support indie games",
    lines: ["An independent game, free to play on iOS.", "Every install, rating and share keeps indie games alive."],
    ask: "Come and fight me.",
    signature: "Free the Borough Games · an independent studio",
  },
} as const;

/** Only for an item the codex has no quote for yet. */
export const DEFAULT_TAGLINE = "Pick it in the lobby. Prove it in the sand.";
