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
import { ACHIEVEMENT_DEFS_SKIRMISH, CHAPTERS_SKIRMISH, SKIRMISH_BOARD, SKIRMISH_BOARD_DEF } from "./defsSkirmish";

export type BitsAchievementDef = AchievementDef<MatchSummary>;

export const RANKED_BOARD = "ranked";

/** Two boards (achievements.md § boards): the Season I ranked board accepts
 * every ranked match (its counters are bracket-blind — a 2v2 win is a
 * ranked win), the 2v2 board (defs2v2.ts) only 2v2 matches. */
export const ACHIEVEMENT_BOARDS: Record<string, BoardDef<MatchSummary>> = {
  [RANKED_BOARD]: { id: RANKED_BOARD, accepts: (s) => s.ranked },
  [RANKED_2V2_BOARD]: RANKED_2V2_BOARD_DEF,
  // The sealed, zero-pay skirmish board (bits-skirmish-deeds.md, 2026-09-09).
  [SKIRMISH_BOARD]: SKIRMISH_BOARD_DEF,
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
 * between clusters. Rows 0-5 offensive, 6-10 defensive, 11-14 support
 * (the SIGNET spells joined 2026-08-10/11: sinkhole + titans-draught
 * offensive, tar-pit support; the DEED spell Call the Tide joined
 * 2026-09-09, offensive) match the authored order below. */
/** Cast tiers TRIPLED with the weapon tiers (Tom, 2026-08-25): charges
 * refill every round, so the old 10-cast tier 1 was a second match. */
const abilityRowY = (row: number): number =>
  185 + row * 115 + (row >= 6 ? 100 : 0) + (row >= 11 ? 100 : 0);

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
  // The DEED spell's ladder (bits-sands-deeds.md) — climbable only by a
  // Tidecaller. One cast a round, so the tiers sit low.
  ...abilityChain("call-the-tide", 5, [
    { threshold: 15, title: "Early Horn", description: "Call the Tide 15 times." },
    { threshold: 75, title: "Master of the Clock", description: "Call the Tide 75 times." },
    { threshold: 300, title: "The Moon's Own Pull", description: "Call the Tide 300 times." },
  ]),
  ...abilityChain("dash", 6, [
    { threshold: 75, title: "Quickstep", description: "Cast Dash 75 times." },
    { threshold: 300, title: "Dust Devil", description: "Cast Dash 300 times." },
    { threshold: 1500, title: "Gone in a Blink", description: "Cast Dash 1500 times." },
  ]),
  ...abilityChain("mirror-guard", 7, [
    { threshold: 45, title: "Polished Bronze", description: "Cast Mirror Guard 45 times." },
    { threshold: 300, title: "Turnabout", description: "Cast Mirror Guard 300 times." },
    { threshold: 900, title: "The Mirror's Edge", description: "Cast Mirror Guard 900 times." },
  ]),
  ...abilityChain("ironhide", 8, [
    { threshold: 30, title: "Thick-Skinned", description: "Cast Ironhide 30 times." },
    { threshold: 150, title: "Man of Iron", description: "Cast Ironhide 150 times." },
    { threshold: 750, title: "The Anvil", description: "Cast Ironhide 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("straw-man", 9, [
    { threshold: 30, title: "Decoy", description: "Cast Straw Man 30 times." },
    { threshold: 225, title: "Misdirection", description: "Cast Straw Man 225 times." },
    { threshold: 600, title: "The Puppeteer", description: "Cast Straw Man 600 times." },
  ]),
  ...abilityChain("warding-shout", 10, [
    { threshold: 60, title: "Stand Back", description: "Cast Warding Shout 60 times." },
    { threshold: 300, title: "Hold the Line", description: "Cast Warding Shout 300 times." },
    { threshold: 750, title: "The Herald's Roar", description: "Cast Warding Shout 750 times." },
  ]),
  // The second SIGNET spell's ladder (bits-store-arms.md) — PLACEHOLDER titles.
  ...abilityChain("tar-pit", 11, [
    { threshold: 30, title: "Slow Going", description: "Cast Tar Pit 30 times." },
    { threshold: 150, title: "Black Wake", description: "Cast Tar Pit 150 times." },
    { threshold: 750, title: "The Unfollowable", description: "Cast Tar Pit 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("war-drums", 12, [
    { threshold: 30, title: "Drummer Boy", description: "Cast War Drums 30 times." },
    { threshold: 150, title: "March to War", description: "Cast War Drums 150 times." },
    { threshold: 750, title: "The Rhythm of Ruin", description: "Cast War Drums 750 times." },
  ]),
  ...abilityChain("blood-font", 13, [
    { threshold: 30, title: "First Aid", description: "Cast Blood Font 30 times." },
    { threshold: 150, title: "Haemophiliac", description: "Cast Blood Font 150 times." },
    { threshold: 750, title: "The Red Spring", description: "Cast Blood Font 750 times.", rewards: [{ kind: "title" }] },
  ]),
  ...abilityChain("sandstorm", 14, [
    { threshold: 30, title: "Dust Kicker", description: "Cast Sandstorm 30 times." },
    { threshold: 150, title: "Eye of the Storm", description: "Cast Sandstorm 150 times." },
    { threshold: 750, title: "The Desert's Wrath", description: "Cast Sandstorm 750 times." },
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
      // A decider = more than one side took a round; the Wave-2 HP sample is
      // the FINAL round's close (null = dead when it ended).
      test: (s, p) => {
        const frac = s.stats[p]?.lastRoundHpFrac;
        const contested = s.roundWins.filter((w) => w > 0).length >= 2;
        return wonMatch(s, p) && contested && frac !== null && frac !== undefined && frac < 0.1;
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
      // No OTHER side took a round (wins index = team - 1; N-team-safe).
      test: (s, p) => {
        const team = summaryTeamOf(s, p);
        return (
          team !== null &&
          wonMatch(s, p) &&
          s.roundWins.every((w, i) => i === team - 1 || w === 0)
        );
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

// ── The Blood Tide (bits-sands-deeds.md, 2026-09-04/09) ──────────────────
// Player-facing name is the Blood Tide — never sands/circle/drown in any
// string here. A SOUTH cluster below everything (y ≥ 2300, the cast ribs
// end near 2000): the horn root
// off the trunk, the kills-after-the-horn chain running EAST with the
// capstone at its end, six skill feats + three jokes in WEST rows.
// Titles: exactly two (Tidecaller, Dry Feet) — Tom 2026-09-09,
// don't oversaturate titles. Every other unlock is its own reward.
const TIDE_Y = 2300;

const tideHorn: BitsAchievementDef = {
  id: "the-horn-sounds",
  board: RANKED_BOARD,
  title: "The Horn Sounds",
  description: "Fight in a ranked round where the Blood Tide rises.",
  icon: "deed-tide-horn",
  parent: FIRST_MATCH.id,
  pos: { x: 0, y: TIDE_Y },
  trigger: { kind: "milestone", counter: COUNTERS.sandsRounds, threshold: 1 },
};

const tideKills = milestoneChain<MatchSummary>({
  board: RANKED_BOARD,
  idBase: "tide-kills",
  counter: COUNTERS.sandsKills,
  icon: "deed-tide-kills",
  parent: tideHorn.id,
  origin: { x: 150, y: TIDE_Y },
  step: { x: 115, y: 0 },
  tiers: [
    { threshold: 10, title: "High Tide", description: "Land 10 killing blows after the Blood Tide has risen." },
    { threshold: 60, title: "Spring Tide", description: "Land 60 killing blows after the Blood Tide has risen." },
    { threshold: 250, title: "Red Deluge", description: "Land 250 killing blows after the Blood Tide has risen." },
  ],
});

/** The skill feats — every one a Tidecaller requisite. */
const tideFeat = (
  id: string,
  title: string,
  description: string,
  icon: string,
  pos: { x: number; y: number },
  test: (s: MatchSummary, p: number) => boolean,
): BitsAchievementDef => ({
  id,
  board: RANKED_BOARD,
  title,
  description,
  icon,
  parent: tideHorn.id,
  pos,
  trigger: { kind: "feat", test },
});

const tideFeats: BitsAchievementDef[] = [
  tideFeat(
    "baptism",
    "Baptism",
    "Win a round by striking down the last enemy while you stand in the Blood Tide.",
    "deed-baptism",
    { x: -150, y: TIDE_Y + 115 },
    (s, p) => (s.stats[p]?.baptisms ?? 0) > 0,
  ),
  tideFeat(
    "waist-deep",
    "Waist Deep",
    "Win a round after ten seconds in the Blood Tide.",
    "deed-waist-deep",
    { x: -265, y: TIDE_Y + 115 },
    (s, p) => (s.stats[p]?.waistDeepWins ?? 0) > 0,
  ),
  tideFeat(
    "let-the-tide-decide",
    "Let the Tide Decide",
    "Win a round where the last enemy is taken by the Blood Tide while you never touch it.",
    "deed-tide-decided",
    { x: -380, y: TIDE_Y + 115 },
    (s, p) => (s.stats[p]?.tideDecidedWins ?? 0) > 0,
  ),
  tideFeat(
    "quicksand",
    "Quicksand",
    "Win a ranked match with every round decided inside ten seconds.",
    "deed-quicksand",
    { x: -150, y: TIDE_Y + 230 },
    (s, p) => {
      const st = s.stats[p];
      return wonMatch(s, p) && st !== undefined && st.longestRoundSec !== null && st.longestRoundSec < 10;
    },
  ),
  tideFeat(
    "the-last-grain",
    "The Last Grain",
    "Win a round with a killing blow landed after the Blood Tide has fully closed.",
    "deed-last-grain",
    { x: -265, y: TIDE_Y + 230 },
    (s, p) => (s.stats[p]?.lastGrainWins ?? 0) > 0,
  ),
  tideFeat(
    "undertow",
    "Undertow",
    "Throw, drag or knock an enemy into the Blood Tide, and see them die there within four seconds.",
    "deed-undertow",
    { x: -380, y: TIDE_Y + 230 },
    (s, p) => (s.stats[p]?.undertows ?? 0) > 0,
  ),
];

/** The jokes: never Tidecaller requisites, never pay Glory or items. */
const tideJokes: BitsAchievementDef[] = [
  {
    ...tideFeat(
      "dry-feet",
      "Dry Feet",
      "Be standing inside the Blood Tide's final ring at the very moment it rises.",
      "deed-dry-feet",
      { x: -150, y: TIDE_Y + 345 },
      (s, p) => (s.stats[p]?.eyeOfStorm ?? 0) > 0,
    ),
    rewards: [{ kind: "title" }],
  },
  tideFeat(
    "taken-by-the-tide",
    "Taken by the Tide",
    "Die to the Blood Tide three times in one match.",
    "deed-taken-by-tide",
    { x: -265, y: TIDE_Y + 345 },
    (s, p) => (s.stats[p]?.tideDeaths ?? 0) >= 3,
  ),
  tideFeat(
    "watching-the-sand-fall",
    "Watching the Sand Fall",
    "Win a match of three rounds or more where the Blood Tide rose in every one.",
    "deed-sand-fall",
    { x: -380, y: TIDE_Y + 345 },
    (s, p) => {
      const st = s.stats[p];
      return wonMatch(s, p) && st !== undefined && st.roundsPlayed >= 3 && st.tideRounds === st.roundsPlayed;
    },
  ),
];

/** The capstone: every skill feat + the chain's top → the title and the
 * ONLY way to hold Call the Tide (a deed-gated spell, items.ts). */
export const TIDECALLER: BitsAchievementDef = {
  id: "tidecaller",
  board: RANKED_BOARD,
  title: "Tidecaller",
  description: "Master the Blood Tide every way it can be mastered.",
  icon: "deed-tidecaller",
  parent: tideKills[tideKills.length - 1]!.id,
  pos: { x: 150 + 115 * tideKills.length, y: TIDE_Y },
  rewards: [{ kind: "title" }, { kind: "entitlement", itemId: "ability:call-the-tide" }],
  trigger: {
    kind: "capstone",
    requires: [...tideFeats.map((d) => d.id), tideKills[tideKills.length - 1]!.id],
  },
};

const tide: BitsAchievementDef[] = [tideHorn, ...tideKills, ...tideFeats, ...tideJokes, TIDECALLER];

/** The jokes' ids — the tests hold them to titles-or-nothing and off the
 * capstone's requisite list. */
export const TIDE_JOKE_IDS: readonly string[] = tideJokes.map((d) => d.id);

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
  ...tide,
  ...ACHIEVEMENT_DEFS_2V2,
  ...ACHIEVEMENT_DEFS_SKIRMISH,
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
  ...CHAPTERS_SKIRMISH,
  { title: "The Kill", ids: [...idsOf(kills), "killer-instinct", ...idsOf(damage), "carnage"] },
  { title: "The Arsenal", ids: [...idsOf(weaponRounds), "the-old-ways"] },
  // Slice bounds = 3 tiers × chains per category cluster (offensive grew
  // to 4 chains with the sinkhole, support to 4 with the tar pit —
  // 2026-08-10; offensive to 6 with Call the Tide — 2026-09-09).
  { title: "Offensive Arts", ids: idsOf(abilityCasts.slice(0, 18)) },
  { title: "Defensive Arts", ids: [...idsOf(abilityCasts.slice(18, 33)), "return-to-sender"] },
  { title: "Support Arts", ids: idsOf(abilityCasts.slice(33)) },
  { title: "Glory", ids: idsOf(glory) },
  { title: "Blood & Mercy", ids: [...idsOf(healing), "lifeblood"] },
  { title: "The Blood Tide", ids: idsOf(tide) },
];
