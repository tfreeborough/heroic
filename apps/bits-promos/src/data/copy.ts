/**
 * The words. Names come from the sim via roster.json; the one-liners and
 * the intro/outro text are the only hand-written part.
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
} as const;

export const TAGLINES: Record<string, string> = {
  // Weapons
  blade: "Stay close. Let the bleed do the talking.",
  bow: "One arrow. Make it count.",
  staff: "You can't outrun it. You can only dash through it.",
  hammer: "Every hit slows them down. Then the next one lands.",
  trident: "A steady drain they can't shake off.",
  fang: "Poison stacks. Panic follows.",
  scorpion: "A burst of bolts. Don't stand still.",
  bombard: "Shells land where you were. Keep moving.",
  lifeline: "Their health is your teammate's health.",
  // Abilities
  sandtrap: "Make the ground the weapon.",
  tremor: "Shake them off their feet.",
  harpoon: "Get over here.",
  dash: "The i-frames every duel is built around.",
  "mirror-guard": "Their best shot — returned to sender.",
  ironhide: "Tank the hit you chose not to dodge.",
  "straw-man": "Let them kill the decoy.",
  "warding-shout": "Nothing gets to target you. Briefly.",
  "war-drums": "Speed for you and yours.",
  "blood-font": "One pour. Choose the moment.",
  sandstorm: "Vanish inside the storm.",
  sinkhole: "One throw a round. It warps the whole fight.",
  "tar-pit": "The ground you leave behind wins fights.",
  "titans-draught": "Drink. Grow. Crush.",
};
export const DEFAULT_TAGLINE = "Pick it in the lobby. Prove it in the sand.";
