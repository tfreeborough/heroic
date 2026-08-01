/**
 * Forged tier badges (the Forge's badge-bits type, 256px transparent
 * cut-outs), keyed by kebab-case tier name — null until forged; consumers
 * simply show no crest. Division numerals composite in text beside the
 * badge, never inside the art (bits-ranked.md § divisions). Shared by the
 * ranked standing panel AND the match-end rank-change callout, hence its own
 * module — the Forge's save step pastes new lines here.
 */
export const RANK_BADGES: Record<string, number | null> = {
  initiate: require("../../assets/ranks/initiate.png"),
  "pit-fighter": require("../../assets/ranks/pit-fighter.png"),
  gladiator: require("../../assets/ranks/gladiator.png"),
  champion: require("../../assets/ranks/champion.png"),
  warlord: require("../../assets/ranks/warlord.png"),
  immortal: require("../../assets/ranks/immortal.png"),
};

/** "Pit Fighter" → the forged crest, or null while unforged/unknown. */
export const badgeFor = (tier: string): number | null =>
  RANK_BADGES[tier.toLowerCase().replace(/\s+/g, "-")] ?? null;
