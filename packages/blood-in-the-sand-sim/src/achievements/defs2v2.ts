/**
 * The 2v2 board — Wave-3 content (achievements.md § Wave-3, 2026-08-24;
 * Tom: "a special set of 2v2-only achievements, more interesting than the
 * ones so far"). Where the Season I board counts things, this board marks
 * MOMENTS between two players: the assist, the avenged partner, the round
 * won alone against two, the kill landed in concert. Every stat here is
 * derived from the ordered event stream inside a round (summary.ts § Wave 3)
 * and is structurally zero in a 1v1 — which is what keeps this board's
 * `accepts` gate sound (a 1v1 match can never move a counter these
 * milestones read; achievements.md § M4 retired, the crossing trap).
 *
 * Titles are PLACEHOLDERS in the right voice — Tom's naming pass, as ever.
 * Rewards deliberately sparse pending the economy pass; the two joke deeds
 * (Along for the Ride, Nobody's Hero) may only ever carry TITLES — one is a
 * loss and neither is a thing to farm (the loss-streak rule, test-enforced).
 *
 * Board positions live in their own coordinate space east of the Season I
 * board (x ≥ 1400) — the overlap test is global, and nothing persisted
 * cares about `pos` (the Chronicle replaced the map).
 */
import { milestoneChain, type BoardDef } from "@heroic/achievements";
import { COUNTERS } from "./counters";
import { SWIFT_REVENGE_SEC, summaryTeamOf, wonMatch, type MatchSummary } from "./summary";
import type { BitsAchievementDef } from "./defs";

export const RANKED_2V2_BOARD = "ranked-2v2";
const BRACKET = "2v2";

export const RANKED_2V2_BOARD_DEF: BoardDef<MatchSummary> = {
  id: RANKED_2V2_BOARD,
  accepts: (s) => s.ranked && s.bracket === BRACKET,
};

/** The board's origin — everything below is laid out relative to it. */
const OX = 1400;

const FIRST_2V2: BitsAchievementDef = {
  id: "two-blades",
  board: RANKED_2V2_BOARD,
  title: "Two Blades, One Sand",
  description: "Fight in your first 2v2 ranked match.",
  icon: "deed-two-blades",
  rewards: [{ kind: "title" }],
  parent: null,
  pos: { x: OX, y: 0 },
  trigger: { kind: "milestone", counter: COUNTERS.rankedMatchesIn(BRACKET), threshold: 1 },
};

/** The spine: 2v2 wins, running NORTH. Castor and Pollux at the summit. */
const duoWins = milestoneChain<MatchSummary>({
  board: RANKED_2V2_BOARD,
  idBase: "duo-wins",
  counter: COUNTERS.rankedWinsIn(BRACKET),
  icon: "deed-duo-wins",
  parent: FIRST_2V2.id,
  origin: { x: OX, y: -130 },
  step: { x: 0, y: -115 },
  tiers: [
    { threshold: 5, title: "Sworn Brothers", description: "Win 5 ranked 2v2 matches." },
    { threshold: 25, title: "The Twin Lions", description: "Win 25 ranked 2v2 matches." },
    { threshold: 100, title: "Blood Brothers", description: "Win 100 ranked 2v2 matches.", rewards: [{ kind: "title" }] },
    { threshold: 250, title: "The Dioscuri", description: "Win 250 ranked 2v2 matches.", rewards: [{ kind: "title" }] },
  ],
});

/** EAST ribs off the root — the four partnership tallies, one row each. */
const rib = (row: number) => ({ origin: { x: OX + 140, y: 115 + row * 115 }, step: { x: 115, y: 0 } });

const assists = milestoneChain<MatchSummary>({
  board: RANKED_2V2_BOARD,
  idBase: "assists",
  counter: COUNTERS.assists,
  icon: "deed-assists",
  parent: FIRST_2V2.id,
  ...rib(0),
  tiers: [
    { threshold: 10, title: "Wingman", description: "Soften 10 foes your partner then finishes." },
    { threshold: 50, title: "The Setup Man", description: "Soften 50 foes your partner then finishes." },
    { threshold: 250, title: "The Second Blade", description: "Soften 250 foes your partner then finishes.", rewards: [{ kind: "title" }] },
  ],
});

const revenge = milestoneChain<MatchSummary>({
  board: RANKED_2V2_BOARD,
  idBase: "revenge-kills",
  counter: COUNTERS.revengeKills,
  icon: "deed-revenge",
  parent: FIRST_2V2.id,
  ...rib(1),
  tiers: [
    { threshold: 5, title: "An Eye for an Eye", description: "Slay 5 foes who had just killed your partner." },
    { threshold: 25, title: "Vendetta", description: "Slay 25 foes who had just killed your partner." },
    { threshold: 100, title: "Nemesis", description: "Slay 100 foes who had just killed your partner.", rewards: [{ kind: "title" }] },
  ],
});

const clutch = milestoneChain<MatchSummary>({
  board: RANKED_2V2_BOARD,
  idBase: "clutch-rounds",
  counter: COUNTERS.clutchRounds,
  icon: "deed-clutch",
  parent: FIRST_2V2.id,
  ...rib(2),
  tiers: [
    { threshold: 1, title: "Against the Odds", description: "Win a round alone against both foes after your partner falls." },
    { threshold: 10, title: "One Against Two", description: "Win 10 rounds alone against both foes." },
    { threshold: 50, title: "The Last Man Standing", description: "Win 50 rounds alone against both foes.", rewards: [{ kind: "title" }] },
  ],
});

const doubleKills = milestoneChain<MatchSummary>({
  board: RANKED_2V2_BOARD,
  idBase: "double-kills",
  counter: COUNTERS.doubleKills,
  icon: "deed-double-kill",
  parent: FIRST_2V2.id,
  ...rib(3),
  tiers: [
    { threshold: 1, title: "Two for One", description: "Strike the killing blow on both foes in a single round." },
    { threshold: 25, title: "Reaper's Pair", description: "Strike both killing blows in 25 rounds." },
    { threshold: 100, title: "Both Barrels", description: "Strike both killing blows in 100 rounds.", rewards: [{ kind: "title" }] },
  ],
});

/** The one teammate in a 2v2 (null in any other shape). */
const partnerOf = (s: MatchSummary, p: number): number | null => {
  const team = summaryTeamOf(s, p);
  const mates = s.players.filter((q) => q.id !== p && q.team === team);
  return mates.length === 1 ? mates[0]!.id : null;
};

/** WEST feats, laid out on a 2-column grid off the spine. */
const feat = (col: number, row: number) => ({ x: OX - 140 - col * 115, y: -130 - row * 115 });

const FEATS_2V2: BitsAchievementDef[] = [
  {
    id: "in-concert",
    board: RANKED_2V2_BOARD,
    title: "In Concert",
    description: "You and your partner each fell a foe within two seconds of one another.",
    icon: "deed-concert",
    parent: FIRST_2V2.id,
    pos: feat(0, 0),
    trigger: { kind: "feat", test: (s, p) => (s.stats[p]?.concertKills ?? 0) >= 1 },
  },
  {
    id: "the-ambush",
    board: RANKED_2V2_BOARD,
    title: "The Ambush",
    description: "Strike a killing blow within five seconds of the fight starting.",
    icon: "deed-ambush",
    parent: FIRST_2V2.id,
    pos: feat(1, 0),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const sec = s.stats[p]?.fastestKillSec;
        return sec !== null && sec !== undefined && sec <= 5;
      },
    },
  },
  {
    id: "swift-vengeance",
    board: RANKED_2V2_BOARD,
    title: "Swift Vengeance",
    description: `Avenge your fallen partner within ${SWIFT_REVENGE_SEC} seconds.`,
    icon: "deed-swift-vengeance",
    parent: revenge[0]!.id,
    pos: feat(0, 1),
    trigger: { kind: "feat", test: (s, p) => (s.stats[p]?.swiftRevenges ?? 0) >= 1 },
  },
  {
    id: "the-last-word",
    board: RANKED_2V2_BOARD,
    title: "The Last Word",
    description: "Win the deciding round alone against both foes.",
    icon: "deed-last-word",
    parent: clutch[0]!.id,
    pos: feat(1, 1),
    trigger: {
      kind: "feat",
      // A decider = both sides took a round; the clutch flag is the FINAL
      // round's (overwritten every roundEnd).
      test: (s, p) => wonMatch(s, p) && s.roundWins[0] > 0 && s.roundWins[1] > 0 && s.stats[p]?.lastRoundClutch === true,
    },
  },
  {
    id: "shieldwall",
    board: RANKED_2V2_BOARD,
    title: "Shieldwall",
    description: "Win a ranked 2v2 match in which neither you nor your partner dies.",
    icon: "deed-shieldwall",
    parent: duoWins[0]!.id,
    pos: feat(0, 2),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const mate = partnerOf(s, p);
        return mate !== null && wonMatch(s, p) && s.stats[p]?.deaths === 0 && s.stats[mate]?.deaths === 0;
      },
    },
  },
  {
    id: "matching-set",
    board: RANKED_2V2_BOARD,
    title: "Matching Set",
    description: "Win a ranked 2v2 match wielding the same weapon as your partner.",
    icon: "deed-matching-set",
    parent: duoWins[0]!.id,
    pos: feat(1, 2),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const mate = partnerOf(s, p);
        const mine = s.players.find((q) => q.id === p)?.weapon ?? null;
        const theirs = mate === null ? null : (s.players.find((q) => q.id === mate)?.weapon ?? null);
        return mate !== null && wonMatch(s, p) && mine !== null && mine === theirs;
      },
    },
  },
  {
    id: "selfless",
    board: RANKED_2V2_BOARD,
    title: "Selfless",
    description: "Restore 150 of your partner's health in a single ranked 2v2 match.",
    icon: "deed-selfless",
    parent: FIRST_2V2.id,
    pos: feat(0, 3),
    trigger: { kind: "feat", test: (s, p) => (s.stats[p]?.alliedHealing ?? 0) >= 150 },
  },
  {
    id: "even-split",
    board: RANKED_2V2_BOARD,
    title: "Even Split",
    description: "Win a ranked 2v2 match with you and your partner striking exactly the same number of killing blows — at least two each.",
    icon: "deed-even-split",
    parent: duoWins[0]!.id,
    pos: feat(1, 3),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const mate = partnerOf(s, p);
        if (mate === null || !wonMatch(s, p)) return false;
        const mine = s.stats[p]?.kills ?? 0;
        return mine >= 2 && mine === (s.stats[mate]?.kills ?? 0);
      },
    },
  },
  {
    id: "the-meat-shield",
    board: RANKED_2V2_BOARD,
    title: "The Meat Shield",
    description: "Win a ranked 2v2 match having soaked three quarters of the damage your side took.",
    icon: "deed-meat-shield",
    parent: duoWins[0]!.id,
    pos: feat(0, 4),
    rewards: [{ kind: "title" }],
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const mate = partnerOf(s, p);
        if (mate === null || !wonMatch(s, p)) return false;
        const mine = s.stats[p]?.damageTaken ?? 0;
        const total = mine + (s.stats[mate]?.damageTaken ?? 0);
        return total > 0 && mine / total >= 0.75;
      },
    },
  },
  // The two jokes — wearable punchlines, never material rewards (one is a
  // loss, and "win while contributing nothing" is not a thing to farm).
  {
    id: "along-for-the-ride",
    board: RANKED_2V2_BOARD,
    title: "Along for the Ride",
    description: "Win a ranked 2v2 match without dealing a single point of damage. Your partner says hi.",
    icon: "deed-along-for-the-ride",
    parent: duoWins[0]!.id,
    pos: feat(1, 4),
    rewards: [{ kind: "title" }],
    trigger: { kind: "feat", test: (s, p) => wonMatch(s, p) && (s.stats[p]?.damageDealt ?? 0) === 0 && partnerOf(s, p) !== null },
  },
  {
    id: "nobodys-hero",
    board: RANKED_2V2_BOARD,
    title: "Nobody's Hero",
    description: "Lose a ranked 2v2 match having dealt more damage than the other three fighters combined.",
    icon: "deed-nobodys-hero",
    parent: FIRST_2V2.id,
    pos: feat(0, 5),
    rewards: [{ kind: "title" }],
    trigger: {
      kind: "feat",
      test: (s, p) => {
        if (wonMatch(s, p) || partnerOf(s, p) === null) return false;
        const mine = s.stats[p]?.damageDealt ?? 0;
        const rest = s.players.filter((q) => q.id !== p).reduce((sum, q) => sum + (s.stats[q.id]?.damageDealt ?? 0), 0);
        return mine > 0 && mine > rest;
      },
    },
  },
];

export const ACHIEVEMENT_DEFS_2V2: readonly BitsAchievementDef[] = [
  FIRST_2V2,
  ...duoWins,
  ...assists,
  ...revenge,
  ...clutch,
  ...doubleKills,
  ...FEATS_2V2,
];

/** Ids that may only ever carry TITLES (the joke deeds — see the header). */
export const TITLE_ONLY_2V2 = new Set(["along-for-the-ride", "nobodys-hero"]);

/** The Chronicle chapter — reading order: the pair, then the moments. */
export const CHAPTER_2V2 = {
  title: "Brothers in Arms",
  ids: ACHIEVEMENT_DEFS_2V2.map((d) => d.id),
};
