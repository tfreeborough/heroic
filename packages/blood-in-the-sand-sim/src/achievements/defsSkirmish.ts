/**
 * The skirmish board (bits-skirmish-deeds.md, 2026-09-09) — deeds for the
 * players who never queue ranked: playing with friends, the 6-way brawl,
 * and coordinated silliness. Three Chronicle chapters, ONE board.
 *
 * The board is SEALED and pays NOTHING material — no Glory, no items, one
 * title (Doppelganger) — which is what lets the 2026-08-08 "deeds are
 * ranked-only" reasons both stand: ranked keeps its reward gravity, and
 * the rule stays one sentence (ranked deeds from ranked, skirmish deeds
 * from skirmish, practice pays nothing). Every milestone here reads a
 * `skirmish:` counter that only skirmish summaries write (counters.ts), so
 * the `accepts` gate is sound without exempting milestones (the crossing
 * trap, achievements.md § M4 retired). Test-enforced in achievements.test.ts.
 *
 * Anti-farm posture is two rules: humans must face humans (the gate below —
 * one human and seven bots is practice with extra steps), and nothing paid
 * is worth staging. Everything else a scripted lobby can do is accepted.
 *
 * Titles are placeholders in the house voice — Tom's naming pass, as ever.
 * Board positions live in their own coordinate space (x ≥ 2700, east of
 * the 2v2 board) — the overlap test is global.
 */
import { milestoneChain, type BoardDef } from "@heroic/achievements";
import { COUNTERS } from "./counters";
import { summaryTeamOf, wonMatch, type MatchSummary, type MatchSummaryPlayer } from "./summary";
import type { BitsAchievementDef } from "./defs";

export const SKIRMISH_BOARD = "skirmish";

const humans = (s: Pick<MatchSummary, "players">): MatchSummaryPlayer[] => s.players.filter((p) => !p.bot);

/** Humans on at least two distinct teams — the board's whole gate. A brawl
 * is six teams of one, so any two humans anywhere satisfy it. Takes just
 * the roster so the adapter can ask before it builds a summary. */
export const humansOnTwoTeams = (s: Pick<MatchSummary, "players">): boolean =>
  new Set(humans(s).map((p) => p.team)).size >= 2;

export const SKIRMISH_BOARD_DEF: BoardDef<MatchSummary> = {
  id: SKIRMISH_BOARD,
  accepts: (s) => !s.ranked && humansOnTwoTeams(s),
};

const noBots = (s: MatchSummary): boolean => s.players.every((p) => !p.bot);
const isBrawl = (s: MatchSummary): boolean => s.teamCount > 2;
const isTeamRoom = (s: MatchSummary): boolean => s.teamCount === 2;
const sideOf = (s: MatchSummary, p: number): MatchSummaryPlayer[] => {
  const team = summaryTeamOf(s, p);
  return s.players.filter((q) => q.team === team);
};
/** The one weapon a group shares, or null if they differ (or any is unpicked). */
const sharedWeapon = (group: readonly MatchSummaryPlayer[]): string | null => {
  const first = group[0]?.weapon ?? null;
  if (first === null) return null;
  return group.every((q) => q.weapon === first) ? first : null;
};
const sortedHand = (p: MatchSummaryPlayer | undefined): string => [...(p?.abilities ?? [])].sort().join(",");

/** The board's origin — everything below is laid out relative to it. */
const OX = 3000;

// ── Chapter: Good Company — playing with friends ───────────────────────────

const WELL_MET: BitsAchievementDef = {
  id: "well-met",
  board: SKIRMISH_BOARD,
  title: "Well Met",
  description: "Fight your first skirmish match against another player.",
  icon: "deed-well-met",
  parent: null,
  pos: { x: OX, y: 0 },
  trigger: { kind: "milestone", counter: COUNTERS.skirmishMatches, threshold: 1 },
};

/** The board's one chain, running NORTH: matches shared with one fighter. */
const regulars = milestoneChain<MatchSummary>({
  board: SKIRMISH_BOARD,
  idBase: "regulars",
  counter: COUNTERS.skirmishCompanionBest,
  icon: "deed-regulars",
  parent: WELL_MET.id,
  origin: { x: OX, y: -130 },
  step: { x: 0, y: -115 },
  tiers: [
    { threshold: 5, title: "Regulars", description: "Share a room with the same fighter for 5 matches." },
    { threshold: 25, title: "Old Friends", description: "Share a room with the same fighter for 25 matches." },
    { threshold: 100, title: "Thick as Thieves", description: "Share a room with the same fighter for 100 matches." },
  ],
});

/** EAST ribs off the root — the friends moments. */
const gc = (col: number, row: number) => ({ x: OX + 140 + col * 115, y: 115 + row * 115 });

const GOOD_COMPANY: BitsAchievementDef[] = [
  {
    id: "both-sides-now",
    board: SKIRMISH_BOARD,
    title: "Both Sides Now",
    description: "Fight both beside and against the same fighter.",
    icon: "deed-both-sides",
    parent: WELL_MET.id,
    pos: gc(0, 0),
    trigger: { kind: "feat", test: (s, p) => s.room?.bothSidesSeats.includes(p) === true },
  },
  {
    id: "grudge-match",
    board: SKIRMISH_BOARD,
    title: "Grudge Match",
    description: "Beat a fighter who beat you in this room's last match.",
    icon: "deed-grudge",
    parent: WELL_MET.id,
    pos: gc(1, 0),
    trigger: { kind: "feat", test: (s, p) => wonMatch(s, p) && s.room?.grudgeSeats.includes(p) === true },
  },
  {
    id: "one-more",
    board: SKIRMISH_BOARD,
    title: "One More",
    description: "Play a third match in a row in the same room with the same people.",
    icon: "deed-one-more",
    parent: WELL_MET.id,
    pos: gc(0, 1),
    trigger: { kind: "feat", test: (s) => (s.room?.matchIndex ?? 0) >= 3 },
  },
  {
    id: "behind-closed-doors",
    board: SKIRMISH_BOARD,
    title: "Behind Closed Doors",
    description: "Win a match in a room locked with a passcode.",
    icon: "deed-closed-doors",
    parent: WELL_MET.id,
    pos: gc(1, 1),
    trigger: { kind: "feat", test: (s, p) => wonMatch(s, p) && s.room?.locked === true },
  },
  {
    id: "open-house",
    board: SKIRMISH_BOARD,
    title: "Open House",
    description: "Host a room of four or more that plays to the end with every seat taken by a person.",
    icon: "deed-open-house",
    parent: WELL_MET.id,
    pos: gc(0, 2),
    trigger: { kind: "feat", test: (s, p) => s.room?.hostSeat === p && s.players.length >= 4 && noBots(s) },
  },
  {
    id: "full-house",
    board: SKIRMISH_BOARD,
    title: "Full House",
    description: "Fight a 4v4 with eight people and not a single bot.",
    icon: "deed-full-house",
    parent: WELL_MET.id,
    pos: gc(1, 2),
    trigger: { kind: "feat", test: (s) => isTeamRoom(s) && s.teamSize === 4 && noBots(s) },
  },
];

// ── Chapter: Six Enter — the brawl ─────────────────────────────────────────
// Every predicate requires a brawl-shaped room; the root's counter is
// structurally zero in team rooms, so one board covers both chapters.

const SIX_ENTER: BitsAchievementDef = {
  id: "six-enter",
  board: SKIRMISH_BOARD,
  title: "Six Enter",
  description: "Fight a 6-way brawl.",
  icon: "deed-six-enter",
  parent: WELL_MET.id,
  pos: { x: OX + 700, y: 0 },
  trigger: { kind: "milestone", counter: COUNTERS.skirmishBrawlMatches, threshold: 1 },
};

const br = (col: number, row: number) => ({ x: OX + 700 - 115 + col * 115, y: 130 + row * 115 });

const BRAWL_FEATS: BitsAchievementDef[] = [
  {
    id: "one-leaves",
    board: SKIRMISH_BOARD,
    title: "One Leaves",
    description: "Win a 6-way brawl.",
    icon: "deed-one-leaves",
    parent: SIX_ENTER.id,
    pos: br(0, 0),
    trigger: { kind: "feat", test: (s, p) => isBrawl(s) && wonMatch(s, p) },
  },
  {
    id: "six-strangers",
    board: SKIRMISH_BOARD,
    title: "Six Strangers",
    description: "Fight a brawl with six people and no bots.",
    icon: "deed-six-strangers",
    parent: SIX_ENTER.id,
    pos: br(1, 0),
    trigger: { kind: "feat", test: (s) => isBrawl(s) && noBots(s) },
  },
  {
    id: "clean-house",
    board: SKIRMISH_BOARD,
    title: "Clean House",
    description: "Land the killing blow on all five other fighters in one brawl round.",
    icon: "deed-clean-house",
    parent: SIX_ENTER.id,
    pos: br(2, 0),
    trigger: { kind: "feat", test: (s, p) => isBrawl(s) && (s.stats[p]?.bestRoundKills ?? 0) >= 5 },
  },
  {
    id: "the-vulture",
    board: SKIRMISH_BOARD,
    title: "The Vulture",
    description: "Win a brawl round without landing a killing blow. They did your work for you.",
    icon: "deed-vulture",
    parent: SIX_ENTER.id,
    pos: br(0, 1),
    trigger: { kind: "feat", test: (s, p) => isBrawl(s) && (s.stats[p]?.roundsWonWithoutKilling ?? 0) >= 1 },
  },
  {
    id: "untouchable",
    board: SKIRMISH_BOARD,
    title: "Untouchable",
    description: "Win a brawl round without taking a single point of damage.",
    icon: "deed-untouchable",
    parent: SIX_ENTER.id,
    pos: br(1, 1),
    trigger: { kind: "feat", test: (s, p) => isBrawl(s) && (s.stats[p]?.untouchedRoundWins ?? 0) >= 1 },
  },
  {
    id: "not-today",
    board: SKIRMISH_BOARD,
    title: "Not Today",
    description: "In a brawl, kill a fighter one round from taking the match while you are not.",
    icon: "deed-not-today",
    parent: SIX_ENTER.id,
    pos: br(2, 1),
    trigger: { kind: "feat", test: (s, p) => isBrawl(s) && (s.stats[p]?.matchPointKills ?? 0) >= 1 },
  },
  {
    // The chapter's joke — pays nothing, not even a title (Tom: no titles).
    id: "always-the-bridesmaid",
    board: SKIRMISH_BOARD,
    title: "Always the Bridesmaid",
    description: "Finish a brawl of three or more rounds as the second-to-last standing in every one of them, without winning a round.",
    icon: "deed-bridesmaid",
    parent: SIX_ENTER.id,
    pos: br(0, 2),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        const me = s.stats[p];
        const rounds = s.roundWinners.length;
        return isBrawl(s) && me !== undefined && rounds >= 3 && me.roundsWon === 0 && me.runnerUpRounds === rounds;
      },
    },
  },
];

// ── Chapter: Party Tricks — coordinated silliness ──────────────────────────

const pt = (col: number, row: number) => ({ x: OX - 140 - col * 115, y: 115 + row * 115 });

export const DOPPELGANGER_ID = "doppelganger";

const PARTY_TRICKS: BitsAchievementDef[] = [
  {
    // The board's ONE title: eight people agreeing on a joke is the deed.
    id: DOPPELGANGER_ID,
    board: SKIRMISH_BOARD,
    title: "Doppelganger",
    description: "Fight a 4v4 with eight people in which every single fighter carries the same weapon.",
    icon: "deed-doppelganger",
    parent: "full-house",
    pos: pt(0, 0),
    rewards: [{ kind: "title" }],
    trigger: {
      kind: "feat",
      test: (s) => isTeamRoom(s) && s.teamSize === 4 && noBots(s) && sharedWeapon(s.players) !== null,
    },
  },
  {
    id: "uniform",
    board: SKIRMISH_BOARD,
    title: "Uniform",
    description: "Win a 3v3 or 4v4 with everyone on your side carrying the same weapon.",
    icon: "deed-uniform",
    parent: WELL_MET.id,
    pos: pt(1, 0),
    trigger: {
      kind: "feat",
      test: (s, p) => isTeamRoom(s) && s.teamSize >= 3 && wonMatch(s, p) && sharedWeapon(sideOf(s, p)) !== null,
    },
  },
  {
    id: "the-full-set",
    board: SKIRMISH_BOARD,
    title: "The Full Set",
    description: "Win a 4v4 with four different weapons on your side.",
    icon: "deed-full-set",
    parent: WELL_MET.id,
    pos: pt(0, 1),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        if (!isTeamRoom(s) || s.teamSize !== 4 || !wonMatch(s, p)) return false;
        const side = sideOf(s, p);
        return side.every((q) => q.weapon !== null) && new Set(side.map((q) => q.weapon)).size === 4;
      },
    },
  },
  {
    id: "mirror-mirror",
    board: SKIRMISH_BOARD,
    title: "Mirror, Mirror",
    description: "Fight a 1v1 against a person carrying your exact loadout: weapon and all three abilities.",
    icon: "deed-mirror",
    parent: WELL_MET.id,
    pos: pt(1, 1),
    trigger: {
      kind: "feat",
      test: (s, p) => {
        if (!isTeamRoom(s) || s.teamSize !== 1) return false;
        const me = s.players.find((q) => q.id === p);
        const foe = s.players.find((q) => q.id !== p);
        if (!me || !foe || foe.bot || me.weapon === null) return false;
        return me.weapon === foe.weapon && (me.abilities?.length ?? 0) > 0 && sortedHand(me) === sortedHand(foe);
      },
    },
  },
  {
    id: "gentlemens-agreement",
    board: SKIRMISH_BOARD,
    title: "Gentlemen's Agreement",
    description: "Finish a match of four or more fighters in which nobody casts a single ability.",
    icon: "deed-gentlemen",
    parent: WELL_MET.id,
    pos: pt(0, 2),
    trigger: {
      kind: "feat",
      test: (s) =>
        s.players.length >= 4 && s.players.every((q) => Object.values(s.stats[q.id]?.casts ?? {}).every((n) => !n)),
    },
  },
  {
    id: "nobody-wins",
    board: SKIRMISH_BOARD,
    title: "Nobody Wins",
    description: "Be there for a round where the last fighters standing all fell on the same tick.",
    icon: "deed-nobody-wins",
    parent: WELL_MET.id,
    pos: pt(1, 2),
    trigger: { kind: "feat", test: (s) => s.roundWinners.includes(0) },
  },
];

export const ACHIEVEMENT_DEFS_SKIRMISH: readonly BitsAchievementDef[] = [
  WELL_MET,
  ...regulars,
  ...GOOD_COMPANY,
  SIX_ENTER,
  ...BRAWL_FEATS,
  ...PARTY_TRICKS,
];

/** The only ids on this board allowed to carry a reward at all — and that
 * reward is a title. Nothing here may ever pay Glory or items (the zero-pay
 * rule the whole board rests on; test-enforced). */
export const SKIRMISH_TITLE_IDS: ReadonlySet<string> = new Set([DOPPELGANGER_ID]);

/** The Chronicle chapters — reading order: friends, the brawl, the tricks. */
export const CHAPTERS_SKIRMISH = [
  { title: "Good Company", ids: [WELL_MET.id, ...regulars.map((d) => d.id), ...GOOD_COMPANY.map((d) => d.id)] },
  { title: "Six Enter", ids: [SIX_ENTER.id, ...BRAWL_FEATS.map((d) => d.id)] },
  { title: "Party Tricks", ids: PARTY_TRICKS.map((d) => d.id) },
] as const;
