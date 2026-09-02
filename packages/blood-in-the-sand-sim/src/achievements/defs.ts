/**
 * The Season I ranked board — Wave-1 content (achievements.md § content
 * sketch): every chain derivable from events the sim already emits. Titles
 * are PLACEHOLDERS in the right voice — Tom owns the titles pass, and each
 * tier is a plain object so title/description/reward edit in place next to
 * their threshold (Tom, 2026-08-03). Rewards are deliberately unset pending
 * the economy pass (glory-economy.md owns amounts); the per-tier `reward`
 * slot is live whenever content wants it.
 *
 * Per-weapon and per-ability chains are HAND-AUTHORED (Tom, 2026-08-04 —
 * split out from table derivation so each gets its own identity ramp, not a
 * templated "X Adept N"). The safety net for new sim content is the
 * coverage test in achievements.test.ts: a new weapon/ability FAILS the
 * suite until someone writes its chain here (and its forge icon row still
 * derives — deedIcons.ts maps these chains onto the loadout icons).
 *
 * `rewards: [{ kind: "title" }]` tiers (Tom, 2026-08-04): the deed's NAME is
 * also a wearable player title — unlocking grants the `title:<id>`
 * entitlement; the wearing UX is a future design pass.
 *
 * Board positions are rough authored placeholders — the Deed Map milestone
 * (M3) brings the chain-layout helper + Realmsmith board tab that will own
 * them. Nothing persisted cares about `pos`.
 */
import {
  milestoneChain,
  WIN_STREAK,
  LOSS_STREAK,
  type AchievementDef,
  type BoardDef,
  type ChainTier,
} from "@heroic/achievements";
import { COUNTERS, UNDYING_STREAK } from "./counters";
import { summaryTeamOf, wonMatch, type MatchSummary } from "./summary";
import { ACHIEVEMENT_DEFS_2V2, CHAPTER_2V2, RANKED_2V2_BOARD, RANKED_2V2_BOARD_DEF } from "./defs2v2";

export type BitsAchievementDef = AchievementDef<MatchSummary>;

export const RANKED_BOARD = "ranked";

/** Two boards (achievements.md § boards): the Season I ranked board accepts
 * every ranked match (its counters are bracket-blind — a 2v2 win is a
 * ranked win), the 2v2 board (defs2v2.ts) only 2v2 matches. */
export const ACHIEVEMENT_BOARDS: Record<string, BoardDef<MatchSummary>> = {
  [RANKED_BOARD]: { id: RANKED_BOARD, accepts: (s) => s.ranked },
  [RANKED_2V2_BOARD]: RANKED_2V2_BOARD_DEF,
};

/** The board's root: everyone's first node, parent of every chain. */
const FIRST_MATCH: BitsAchievementDef = {
  id: "sworn-to-the-sand",
  board: RANKED_BOARD,
  title: "Christened with blood",
  rewards: [{ kind: "title" }],
  description: "Fight in your first ranked match.",
  icon: "deed-first-match",
  parent: null,
  pos: { x: 0, y: 0 },
  trigger: { kind: "milestone", counter: COUNTERS.rankedMatches, threshold: 1 },
};

// ── Board geometry (reworked 2026-08-04, Tom's first board pass) ───────────
// Trunk and clusters (v4, same day — Tom: thematic grouping, more air):
// the wins spine runs NORTH along x=0 (not-a-scratch straight west of its
// first tier); kills run EAST with the damage row branching off 25 kills;
// the win-streak row branches east off the spine; and the south trunk
// (x=0) carries CLUSTERS — weapons, then glory, then healing as separate
// EAST blocks; loss-streaks and the three ability CATEGORY clusters
// (offensive / defensive / support) as WEST blocks — 115px rows inside a
// cluster, ~215px of air between clusters. Every chain runs along one
// axis; branch edges are auto-routed L-elbows (mapMath.routeEdge). Spacing
// is enforced by the overlap test in achievements.test.ts.

const wins = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "ranked-wins",
  counter: COUNTERS.rankedWins,
  icon: "deed-wins",
  parent: FIRST_MATCH.id,
  origin: { x: 0, y: -130 },
  step: { x: 0, y: -115 },
  tiers: [
    // The Sand snake also pays the game's FIRST gated weapon — the teaching
    // beat (bits-secret-items.md): five wins in, players learn deeds pay
    // steel. Rewards stack: one card, title + trident.
    { threshold: 5, title: "The Sand snake", description: "Win 5 ranked matches.", rewards: [{ kind: "title" }, { kind: "entitlement", itemId: "weapon:trident" }] },
    { threshold: 25, title: "The Pit Viper", description: "Win 25 ranked matches." },
    { threshold: 50, title: "The King Cobra", description: "Win 50 ranked matches.", rewards: [{ kind: "title" }] },
    { threshold: 100, title: "The Great Constrictor", description: "Win 100 ranked matches." },
    { threshold: 250, title: "The Basilisk", description: "Win 250 ranked matches." },
    { threshold: 500, title: "The Elder Wrym", description: "Win 500 ranked matches." },
    { threshold: 1000, title: "The World Serpent", description: "Win 1000 ranked matches.", rewards: [{ kind: "title" }] },
  ],
});

const kills = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "killing-blows",
  counter: COUNTERS.killingBlows,
  icon: "deed-kills",
  parent: FIRST_MATCH.id,
  origin: { x: 140, y: 0 },
  step: { x: 115, y: 0 },
  tiers: [
    // 1 → 5 (Tom, 2026-08-25 — first-win audit): a first-blood tier popped
    // in every first match next to Christened; five kills is a second win.
    { threshold: 5, title: "Lights Out", description: "Strike 5 killing blows." },
    { threshold: 25, title: "Gravedigger", description: "Strike 25 killing blows." },
    { threshold: 100, title: "Judge, Jury and Executioner", description: "Strike 100 killing blows." },
    { threshold: 500, title: "Sudden Death", description: "Strike 500 killing blows." },
    { threshold: 1250, title: "The Fourth Horseman", description: "Strike 1250 killing blows.", rewards: [{ kind: "title" }] },
    { threshold: 9001, title: "It's Over 9000", description: "Strike 9001 killing blows." },
  ],
});

/** Per-weapon round chains — four EAST ribs off the south trunk. */
const weaponChain = (weapon: string, row: number, tiers: readonly ChainTier[]) =>
  milestoneChain<MatchSummary>({
    board: RANKED_BOARD,
    idBase: `rounds-${weapon}`,
    counter: `rounds_won:${weapon}`,
    icon: `deed-rounds-${weapon}`,
    parent: FIRST_MATCH.id,
    origin: { x: 140, y: 185 + row * 115 },
    step: { x: 115, y: 0 },
    tiers,
  });

const weaponRounds = [
  ...weaponChain("blade", 0, [
    { threshold: 15, title: "Quick on the Draw", description: "Win 15 rounds wielding the Blade." },
    { threshold: 150, title: "A Cut Above", description: "Win 150 rounds wielding the Blade." },
    { threshold: 600, title: "The Crimson Blur", description: "Win 600 rounds wielding the Blade.", rewards: [{ kind: "title" }] },
  ]),
  ...weaponChain("bow", 1, [
    { threshold: 15, title: "Fletcher's Friend", description: "Win 15 rounds wielding the Bow." },
    { threshold: 150, title: "Deadeye", description: "Win 150 rounds wielding the Bow." },
    { threshold: 600, title: "Death from Afar", description: "Win 600 rounds wielding the Bow.", rewards: [{ kind: "title" }] },
  ]),
  ...weaponChain("staff", 2, [
    { threshold: 15, title: "Spark-Thrower", description: "Win 15 rounds wielding the Staff." },
    { threshold: 150, title: "The Long Reach", description: "Win 150 rounds wielding the Staff." },
    { threshold: 600, title: "Stormcaller", description: "Win 600 rounds wielding the Staff.", rewards: [{ kind: "title" }] },
  ]),
  ...weaponChain("hammer", 3, [
    { threshold: 15, title: "Heavy-Handed", description: "Win 15 rounds wielding the Hammer." },
    { threshold: 150, title: "Bonebreaker", description: "Win 150 rounds wielding the Hammer." },
    { threshold: 600, title: "The Landslide", description: "Win 600 rounds wielding the Hammer.", rewards: [{ kind: "title" }] },
  ]),
  // The gated weapon's own ladder — visible like any chain, but you can't
  // climb it until the Sand snake hands you the spear. PLACEHOLDER titles.
  ...weaponChain("trident", 4, [
    { threshold: 15, title: "The Fisherman", description: "Win 15 rounds wielding the Trident." },
    { threshold: 150, title: "Spearside", description: "Win 150 rounds wielding the Trident." },
    { threshold: 600, title: "The Retiarius", description: "Win 600 rounds wielding the Trident.", rewards: [{ kind: "title" }] },
  ]),
  // The SIGNET weapons' ladders (bits-store-arms.md) — same rule as the
  // trident's: the chain is visible to all, climbable once the Armory sells
  // you the arm. PLACEHOLDER titles (Tom's naming pass).
  ...weaponChain("fang", 5, [
    { threshold: 15, title: "Just a Scratch", description: "Win 15 rounds wielding the Fang." },
    { threshold: 150, title: "Venomous", description: "Win 150 rounds wielding the Fang." },
    { threshold: 600, title: "The Adder's Kiss", description: "Win 600 rounds wielding the Fang.", rewards: [{ kind: "title" }] },
  ]),
  ...weaponChain("scorpion", 6, [
    { threshold: 15, title: "Three of a Kind", description: "Win 15 rounds wielding the Scorpion." },
    { threshold: 150, title: "Bolt-Counter", description: "Win 150 rounds wielding the Scorpion." },
    { threshold: 600, title: "The Rain of Barbs", description: "Win 600 rounds wielding the Scorpion.", rewards: [{ kind: "title" }] },
  ]),
  ...weaponChain("bombard", 7, [
    { threshold: 15, title: "Fire in the Hole", description: "Win 15 rounds wielding the Bombard." },
    { threshold: 150, title: "The Long Arm", description: "Win 150 rounds wielding the Bombard." },
    { threshold: 600, title: "Rain of Ruin", description: "Win 600 rounds wielding the Bombard.", rewards: [{ kind: "title" }] },
  ]),
  ...weaponChain("lifeline", 8, [
    { threshold: 15, title: "Field Medicine", description: "Win 15 rounds wielding the Lifeline." },
    { threshold: 150, title: "The Thin Gold Thread", description: "Win 150 rounds wielding the Lifeline." },
    { threshold: 600, title: "Death's Paperwork", description: "Win 600 rounds wielding the Lifeline.", rewards: [{ kind: "title" }] },
  ]),
];

/** Per-ability cast chains — WEST ribs, clustered BY CATEGORY (offensive /
 * defensive / support — thematic grouping, Tom 2026-08-04) with a wide gap
 * between clusters. Rows 0-4 offensive, 5-9 defensive, 10-13 support
 * (the SIGNET spells joined 2026-08-10/11: sinkhole + titans-draught
 * offensive, tar-pit support) match the authored order below. */
/** Cast tiers TRIPLED with the weapon tiers (Tom, 2026-08-25): charges
 * refill every round, so the old 10-cast tier 1 was a second match. */
const abilityRowY = (row: number): number =>
  185 + row * 115 + (row >= 5 ? 100 : 0) + (row >= 10 ? 100 : 0);

const abilityChain = (ability: string, row: number, tiers: readonly ChainTier[]) =>
  milestoneChain<MatchSummary>({
    board: RANKED_BOARD,
    idBase: `casts-${ability}`,
    counter: `cast:${ability}`,
    icon: `deed-casts-${ability}`,
    parent: FIRST_MATCH.id,
    origin: { x: -140, y: abilityRowY(row) },
    step: { x: -115, y: 0 },
    tiers,
  });

const abilityCasts = [
  ...abilityChain("sandtrap", 0, [
    { threshold: 30, title: "Trapper's Apprentice", description: "Cast Sandtrap 30 times." },
    { threshold: 150, title: "Tread Carefully", description: "Cast Sandtrap 150 times." },
    { threshold: 750, title: "The Ground Lies", description: "Cast Sandtrap 750 times." },
  ]),
  ...abilityChain("tremor", 1, [
    { threshold: 30, title: "Rumbler", description: "Cast Tremor 30 times." },
    { threshold: 150, title: "Faultline", description: "Cast Tremor 150 times." },
    { threshold: 750, title: "The Earthshaker", description: "Cast Tremor 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("harpoon", 2, [
    { threshold: 30, title: "Hooked", description: "Cast Harpoon 30 times." },
    { threshold: 150, title: "Reel Them In", description: "Cast Harpoon 150 times." },
    { threshold: 750, title: "The Butcher's Gaff", description: "Cast Harpoon 750 times." },
  ]),
  // The first SIGNET spell's ladder (bits-store-arms.md) — climbable once the
  // Armory sells you the throw. PLACEHOLDER titles (Tom's naming pass).
  ...abilityChain("sinkhole", 3, [
    { threshold: 30, title: "Undertow", description: "Cast Sinkhole 30 times." },
    { threshold: 150, title: "The Ground Hungers", description: "Cast Sinkhole 150 times." },
    { threshold: 750, title: "The Swallowing Sands", description: "Cast Sinkhole 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("titans-draught", 4, [
    { threshold: 30, title: "A Head Taller", description: "Drink Titan's Draught 30 times." },
    { threshold: 150, title: "Giant's Thirst", description: "Drink Titan's Draught 150 times." },
    { threshold: 750, title: "The Colossus of the Pit", description: "Drink Titan's Draught 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("dash", 5, [
    { threshold: 75, title: "Quickstep", description: "Cast Dash 75 times." },
    { threshold: 300, title: "Dust Devil", description: "Cast Dash 300 times." },
    { threshold: 1500, title: "Gone in a Blink", description: "Cast Dash 1500 times." },
  ]),
  ...abilityChain("mirror-guard", 6, [
    { threshold: 45, title: "Polished Bronze", description: "Cast Mirror Guard 45 times." },
    { threshold: 300, title: "Turnabout", description: "Cast Mirror Guard 300 times." },
    { threshold: 900, title: "The Mirror's Edge", description: "Cast Mirror Guard 900 times." },
  ]),
  ...abilityChain("ironhide", 7, [
    { threshold: 30, title: "Thick-Skinned", description: "Cast Ironhide 30 times." },
    { threshold: 150, title: "Man of Iron", description: "Cast Ironhide 150 times." },
    { threshold: 750, title: "The Anvil", description: "Cast Ironhide 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("straw-man", 8, [
    { threshold: 30, title: "Decoy", description: "Cast Straw Man 30 times." },
    { threshold: 225, title: "Misdirection", description: "Cast Straw Man 225 times." },
    { threshold: 600, title: "The Puppeteer", description: "Cast Straw Man 600 times." },
  ]),
  ...abilityChain("warding-shout", 9, [
    { threshold: 60, title: "Stand Back", description: "Cast Warding Shout 60 times." },
    { threshold: 300, title: "Hold the Line", description: "Cast Warding Shout 300 times." },
    { threshold: 750, title: "The Herald's Roar", description: "Cast Warding Shout 750 times." },
  ]),
  // The second SIGNET spell's ladder (bits-store-arms.md) — PLACEHOLDER titles.
  ...abilityChain("tar-pit", 10, [
    { threshold: 30, title: "Slow Going", description: "Cast Tar Pit 30 times." },
    { threshold: 150, title: "Black Wake", description: "Cast Tar Pit 150 times." },
    { threshold: 750, title: "The Unfollowable", description: "Cast Tar Pit 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("war-drums", 11, [
    { threshold: 30, title: "Drummer Boy", description: "Cast War Drums 30 times." },
    { threshold: 150, title: "March to War", description: "Cast War Drums 150 times." },
    { threshold: 750, title: "The Rhythm of Ruin", description: "Cast War Drums 750 times." },
  ]),
  ...abilityChain("blood-font", 12, [
    { threshold: 30, title: "First Aid", description: "Cast Blood Font 30 times." },
    { threshold: 150, title: "Haemophiliac", description: "Cast Blood Font 150 times." },
    { threshold: 750, title: "The Red Spring", description: "Cast Blood Font 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("sandstorm", 13, [
    { threshold: 30, title: "Dust Kicker", description: "Cast Sandstorm 30 times." },
    { threshold: 150, title: "Eye of the Storm", description: "Cast Sandstorm 150 times." },
    { threshold: 750, title: "The Desert's Wrath", description: "Cast Sandstorm 750 times." },
  ]),
  // Store drop 2's SIGNET spells (rows appended below the wave-1 clusters —
  // a board regroup by category is owed with Tom's naming pass). PLACEHOLDER
  // titles, as ever.
  ...abilityChain("true-ice", 14, [
    { threshold: 30, title: "Cold Snap", description: "Cast Shard of True Ice 30 times." },
    { threshold: 150, title: "Deep Winter", description: "Cast Shard of True Ice 150 times." },
    { threshold: 750, title: "The Heart of Winter", description: "Cast Shard of True Ice 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("magic-mirror", 15, [
    { threshold: 30, title: "Trading Places", description: "Cast Magic Mirror 30 times." },
    { threshold: 150, title: "On Reflection", description: "Cast Magic Mirror 150 times." },
    { threshold: 750, title: "The Other Side of the Glass", description: "Cast Magic Mirror 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("elven-cloak", 16, [
    { threshold: 30, title: "Out of Sight", description: "Cast Elven Cloak 30 times." },
    { threshold: 150, title: "Half-Remembered", description: "Cast Elven Cloak 150 times." },
    { threshold: 750, title: "The Unseen Blade", description: "Cast Elven Cloak 750 times.", rewards: [{ kind: "title" }] },
  ]),
];

const winStreaks = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "win-streak",
  counter: `${WIN_STREAK}_best`,
  icon: "deed-win-streak",
  // A streak begins once you've won a few — branches off the wins spine.
  parent: wins[0]!.id,
  origin: { x: 140, y: -280 },
  step: { x: 115, y: 0 },
  tiers: [
    { threshold: 3, title: "Hot Sand", description: "Win 3 ranked matches in a row." },
    { threshold: 5, title: "Heat Haze", description: "Win 5 ranked matches in a row." },
    { threshold: 10, title: "Scorched Earth", description: "Win 10 ranked matches in a row." },
    { threshold: 25, title: "Seas of Molten Glass", description: "Win 25 ranked matches in a row." },
  ],
});

/** Never pays Glory or items — paying out for losing in ranked is a throw
 * incentive (achievements.md § content sketch). Joke TITLES are fair game
 * (the wearable punchline); the coverage test enforces the line. */
const lossStreaks = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "loss-streak",
  counter: `${LOSS_STREAK}_best`,
  icon: "deed-loss-streak",
  parent: FIRST_MATCH.id,
  origin: { x: -140, y: 45 },
  step: { x: -115, y: 0 },
  tiers: [
    { threshold: 3, title: "Swallowed by the Dunes", description: "Lose 3 ranked matches in a row. It happens." },
    { threshold: 5, title: "Bleached Bones", description: "Lose 5 ranked matches in a row. It happens." },
    { threshold: 10, title: "Fossil Record", description: "Lose 10 ranked matches in a row. It happens.", rewards: [{ kind: "title" }]  },
  ],
});

const glory = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "glory-earned",
  counter: COUNTERS.gloryEarned,
  icon: "deed-glory",
  parent: FIRST_MATCH.id,
  // Shifted down per new weapon row above (latest: 1320 at the lifeline,
  // 2026-08-10) — keeps the ~215px inter-cluster air. M3's layout helper
  // owns these numbers eventually.
  origin: { x: 140, y: 1320 },
  step: { x: 115, y: 0 },
  tiers: [
    { threshold: 100, title: "I can go the distance", description: "Earn 100 lifetime Glory from ranked matches" },
    { threshold: 500, title: "Zero to Hero", description: "Earn 500 lifetime Glory from ranked matches" },
    { threshold: 2500, title: "Hall of Fame", description: "Earn 2500 lifetime Glory from ranked matches" },
    { threshold: 5000, title: "Living Legend", description: "Earn 5000 lifetime Glory from ranked matches", rewards: [{ kind: "title" }]  },
    { threshold: 8500, title: "Demigod", description: "Earn 8500 lifetime Glory from ranked matches", rewards: [{ kind: "title" }]  },
    { threshold: 15000, title: "The Thirteenth Labour", description: "Earn 15000 lifetime Glory from ranked matches" },
    { threshold: 25000, title: "A Star Is Born", description: "Earn 25000 lifetime Glory from ranked matches" },
  ],
});

const damage = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "damage-dealt",
  counter: COUNTERS.damageDealt,
  icon: "deed-damage",
  // Mass damage is the killer's road — branches off 25 killing blows.
  parent: kills[1]!.id,
  origin: { x: 370, y: -140 },
  step: { x: 115, y: 0 },
  tiers: [
    { threshold: 500, title: "Bloodletter", description: "Deal 500 damage to your foes." },
    { threshold: 2500, title: "Crimson Rain", description: "Deal 2500 damage to your foes." },
    { threshold: 10000, title: "Bloodbath", description: "Deal 10000 damage to your foes." },
    { threshold: 25000, title: "Red Tide", description: "Deal 25000 damage to your foes." },
    { threshold: 100000, title: "Hemoclysm", description: "Deal 100000 damage to your foes." },
  ],
});

const healing = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "healing-done",
  counter: COUNTERS.healingDone,
  icon: "deed-healing",
  parent: FIRST_MATCH.id,
  origin: { x: 140, y: 1535 },
  step: { x: 115, y: 0 },
  tiers: [
    { threshold: 500, title: "Medic", description: "Restore 500 health.", rewards: [{ kind: "title" }]  },
    { threshold: 2500, title: "Field Surgeon", description: "Restore 2500 health.", rewards: [{ kind: "title" }]  },
    { threshold: 10000, title: "Lifeline", description: "Restore 10000 health." },
    { threshold: 25000, title: "Guardian Angel", description: "Restore 25000 health.", rewards: [{ kind: "title" }]  },
    { threshold: 100000, title: "Panacea", description: "Restore 100000 health." },
  ],
});

/** The feats — one-off nodes branching off their related chains. Wave-2
 * set authored 2026-08-08 (achievements.md § Wave-2 feats; titles are
 * placeholders until Tom's naming pass; 7/300/10 thresholds are Tom-tuned
 * tuning knobs). Several deliberately CASCADE (Not a Scratch ⊃ Flawless ⊃
 * Still Standing can pop off one perfect match — a great ceremony). */
const FEATS: BitsAchievementDef[] = [
  {
    id: "not-a-scratch",
    board: RANKED_BOARD,
    title: "Not a Scratch",
    description: "Win a ranked match without taking a single point of damage.",
    icon: "deed-untouched",
    parent: wins[0]!.id,
    pos: { x: -150, y: -130 },
    trigger: {
      kind: "feat",
      test: (s, p) => wonMatch(s, p) && (s.stats[p]?.damageTaken ?? 0) === 0,
    },
  },
  {
    id: "lifeblood",
    board: RANKED_BOARD,
    title: "Lifeblood",
    // Wave 2: healing credits its CASTER — this reads healing DEALT now
    // (identical in 1v1 self-heals; correct once team heals exist).
    description: "Restore 200 health in a single ranked match.",
    icon: "deed-lifeblood",
    parent: healing[0]!.id,
    pos: { x: 45, y: 1650 },
    trigger: {
      kind: "feat",
      test: (s, p) => (s.stats[p]?.healingDealt ?? 0) >= 200,
    },
  },
  {
    id: "by-a-thread",
    board: RANKED_BOARD,
    title: "By a Thread",
    description: "Take a ranked match to the final round and win it with a sliver of health.",
    icon: "deed-thread",
    parent: wins[0]!.id,
    pos: { x: -265, y: -130 },
    trigger: {
      kind: "feat",
      // A decider = both sides took a round; the Wave-2 HP sample is the
      // FINAL round's close (null = dead when it ended).
      test: (s, p) => {
        const frac = s.stats[p]?.lastRoundHpFrac;
        return wonMatch(s, p) && s.roundWins[0] > 0 && s.roundWins[1] > 0 && frac !== null && frac !== undefined && frac < 0.1;
      },
    },
  },
  {
    id: "return-to-sender",
    board: RANKED_BOARD,
    title: "Return to Sender",
    description: "Turn seven shots back with Mirror Guard in a single ranked match.",
    icon: "deed-reflect",
    parent: "casts-mirror-guard-45",
    pos: { x: -25, y: 745 },
    trigger: {
      kind: "feat",
      test: (s, p) => (s.stats[p]?.reflects ?? 0) >= 7,
    },
  },
  {
    id: "still-standing",
    board: RANKED_BOARD,
    title: "Still Standing",
    // Reworked 2026-08-25 (first-win audit): as a "win without dying" feat
    // it was IDENTICAL to Flawless in a 1v1 (a dropped round is a death)
    // and popped as its twin on every sweep. Now an undying STREAK — three
    // ranked wins in a row without dying — read off the adapter-folded
    // `undying_streak_best` (counters.ts). Same id, icon and board slot.
    description: "Win three ranked matches in a row without dying once.",
    icon: "deed-standing",
    parent: wins[0]!.id,
    pos: { x: -150, y: -245 },
    trigger: { kind: "milestone", counter: `${UNDYING_STREAK}_best`, threshold: 3 },
  },
  {
    id: "flawless",
    board: RANKED_BOARD,
    title: "Flawless",
    description: "Win a ranked match without dropping a single round.",
    icon: "deed-flawless",
    parent: wins[0]!.id,
    pos: { x: -265, y: -245 },
    trigger: {
      kind: "feat",
      // The OTHER side's round tally is zero (wins index = team - 1).
      test: (s, p) => {
        const team = summaryTeamOf(s, p);
        return team !== null && wonMatch(s, p) && s.roundWins[team === 1 ? 1 : 0] === 0;
      },
    },
  },
  {
    id: "the-old-ways",
    board: RANKED_BOARD,
    title: "The Old Ways",
    description: "Win a ranked match without casting a single ability.",
    icon: "deed-old-ways",
    parent: FIRST_MATCH.id,
    pos: { x: -265, y: -15 },
    trigger: {
      kind: "feat",
      test: (s, p) => wonMatch(s, p) && Object.values(s.stats[p]?.casts ?? {}).every((n) => !n),
    },
  },
  {
    id: "carnage",
    board: RANKED_BOARD,
    title: "Carnage",
    // 300 → 750 (Tom, 2026-08-25 — first-ranked-win ceremony audit): a
    // match is first-to-3 on 100hp bodies and hit damage isn't clamped to
    // remaining HP, so EVERY 1v1 win deals ~320–340 — 300 popped on the
    // first win alongside the two "firsts". 750 is past any heal-less 1v1
    // (five rounds max ≈ 530): it's the 2v2 CARRY deed — three-quarters of
    // the enemy side's HP over a five-round match — or grinding a healer
    // down in 1v1.
    description: "Deal 750 damage in a single ranked match.",
    icon: "deed-carnage",
    parent: damage[0]!.id,
    pos: { x: 255, y: -140 },
    trigger: {
      kind: "feat",
      test: (s, p) => (s.stats[p]?.damageDealt ?? 0) >= 750,
    },
  },
  {
    id: "killer-instinct",
    board: RANKED_BOARD,
    title: "Killer Instinct",
    description: "Land ten critical hits in a single ranked match.",
    icon: "deed-crits",
    parent: kills[0]!.id,
    pos: { x: 140, y: -115 },
    trigger: {
      kind: "feat",
      test: (s, p) => (s.stats[p]?.crits ?? 0) >= 10,
    },
  },
  {
    id: "never-doubted",
    board: RANKED_BOARD,
    title: "Never Doubted",
    description: "Lose the opening round, then win the ranked match.",
    icon: "deed-comeback",
    parent: wins[0]!.id,
    pos: { x: -150, y: -15 },
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const team = summaryTeamOf(s, p);
        return team !== null && wonMatch(s, p) && s.roundWinners[0] !== undefined && s.roundWinners[0] !== 0 && s.roundWinners[0] !== team;
      },
    },
  },
];

export const ACHIEVEMENT_DEFS: readonly BitsAchievementDef[] = [
  FIRST_MATCH,
  ...wins,
  ...kills,
  ...weaponRounds,
  ...abilityCasts,
  ...winStreaks,
  ...lossStreaks,
  ...glory,
  ...damage,
  ...healing,
  ...FEATS,
  ...ACHIEVEMENT_DEFS_2V2,
];

/**
 * The Chronicle's chapters (achievements.md § the codex, Tom 2026-08-04 —
 * the scrolling illuminated codex replaced the 2D map): thematic reading
 * order, defined HERE so content and presentation stay in lockstep. Titles
 * are Tom's to rename like any other content string.
 */
export interface AchievementChapter {
  title: string;
  ids: readonly string[];
}

const idsOf = (defs: readonly BitsAchievementDef[]): string[] => defs.map((d) => d.id);

export const ACHIEVEMENT_CHAPTERS: readonly AchievementChapter[] = [
  {
    title: "The Pit",
    ids: [
      FIRST_MATCH.id,
      ...idsOf(wins),
      ...idsOf(winStreaks),
      "not-a-scratch",
      "by-a-thread",
      "still-standing",
      "flawless",
      "never-doubted",
      ...idsOf(lossStreaks),
    ],
  },
  CHAPTER_2V2,
  { title: "The Kill", ids: [...idsOf(kills), "killer-instinct", ...idsOf(damage), "carnage"] },
  { title: "The Arsenal", ids: [...idsOf(weaponRounds), "the-old-ways"] },
  // Slice bounds = 3 tiers × chains per category cluster (offensive grew
  // to 4 chains with the sinkhole, support to 4 with the tar pit —
  // 2026-08-10).
  { title: "Offensive Arts", ids: idsOf(abilityCasts.slice(0, 15)) },
  { title: "Defensive Arts", ids: [...idsOf(abilityCasts.slice(15, 30)), "return-to-sender"] },
  { title: "Support Arts", ids: idsOf(abilityCasts.slice(30)) },
  { title: "Glory", ids: idsOf(glory) },
  { title: "Blood & Mercy", ids: [...idsOf(healing), "lifeblood"] },
];
