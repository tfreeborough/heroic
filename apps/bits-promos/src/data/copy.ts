/**
 * The marketing voice, keyed by roster id. Names/numbers come from the sim
 * via roster.json; these one-liners are the only hand-written part.
 */
export const TAGLINES: Record<string, string> = {
  // Weapons
  blade: "Stay close. Let the bleed do the talking.",
  bow: "One arrow. Make it count.",
  staff: "You can't outrun it. You can only dash through it.",
  hammer: "Every hit slows them down. Then the next one lands.",
  trident: "A steady drain they can't shake off.",
  fang: "Poison stacks. Panic follows.",
  scorpion: "Reach out and ruin someone's day.",
  bombard: "Why aim when the ground can explode?",
  lifeline: "Their health is your health.",
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

export const CTA = {
  title: "BLOOD IN THE SAND",
  sub: "1v1 arena duels · first to 3 · one life per round",
  action: "OUT NOW ON iOS",
} as const;
