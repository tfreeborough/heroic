/**
 * Blood in the Sand's HQ-side constants and decoders. The sim owns names
 * and packs; this file holds only what the game deliberately doesn't (US
 * list prices, bits-store.md § S3 — the consoles localise them, HQ
 * estimates in USD) and the words HQ puts on ledger sources, which are an
 * open namespace the sim never reads back.
 */
import {
  ABILITIES,
  ACHIEVEMENT_CHAPTERS,
  ACHIEVEMENT_DEFS,
  ARENAS,
  CHALLENGES,
  CHALLENGE_COUNTERS,
  SIGNET_PACKS,
  WEAPONS,
  bountyOf,
  itemDisplayName,
  type ChallengeTier,
} from "@heroic/blood-in-the-sand-sim";

export const SEASON = 1;
export const BRACKETS = ["1v1", "2v2"] as const;

export const SKU_USD: Record<string, number> = {
  signet_pack_1: 1.89,
  signet_pack_3: 4.49,
  signet_pack_6: 7.99,
};

/** `iap:<platform>:<sku>` → estimated USD at list price. */
export const iapUsd = (source: string): number => SKU_USD[source.split(":")[2] ?? ""] ?? 0;

export const weaponName = (id: string | null | undefined): string =>
  id ? ((WEAPONS as Record<string, { name: string } | undefined>)[id]?.name ?? id) : "–";
export const abilityName = (id: string): string =>
  (ABILITIES as Record<string, { name: string } | undefined>)[id]?.name ?? id;
export const itemName = (id: string): string => itemDisplayName(id);
export const arenaName = (id: string | null | undefined): string => (id ? (ARENAS[id]?.name ?? id) : "–");

export interface DeedInfo {
  id: string;
  board: string;
  title: string;
  description: string;
  secret: boolean;
  /** Glory the deed pays on unlock — 0 for most (bits-deed-glory.md). */
  bounty: number;
  /** Milestone deeds only: the counter and the line to cross. */
  milestone: { counter: string; threshold: number } | null;
}

export const deeds = (): DeedInfo[] =>
  ACHIEVEMENT_DEFS.map((d) => ({
    id: d.id,
    board: d.board,
    title: d.title,
    description: d.description,
    secret: d.secret === true,
    bounty: bountyOf(d),
    milestone: d.trigger.kind === "milestone" ? { counter: d.trigger.counter, threshold: d.trigger.threshold } : null,
  }));

export const deedTitle = (id: string): string => ACHIEVEMENT_DEFS.find((d) => d.id === id)?.title ?? id;

export interface ChallengeInfo {
  id: string;
  tier: ChallengeTier;
  name: string;
  premise: string;
  clearsCounter: string;
  attemptsCounter: string;
}

export const challenges = (): ChallengeInfo[] =>
  CHALLENGES.map((c) => ({
    id: c.id,
    tier: c.tier,
    name: c.name,
    premise: c.premise,
    clearsCounter: CHALLENGE_COUNTERS.clears(c.id),
    attemptsCounter: CHALLENGE_COUNTERS.attempts(c.id),
  }));

const packWords = (sku: string): string => {
  const n = SIGNET_PACKS[sku];
  return n === undefined ? sku : n === 1 ? "a single Signet" : `a pack of ${n} Signets`;
};

/**
 * A ledger source in words. Sources: ranked:<match> · achievement:<deed> ·
 * store:exchange · store:unlock · iap:<platform>:<sku> · code:<kind> ·
 * merge:<fromId> · hq:<note> · anything else verbatim.
 */
export const describeSource = (source: string, ledger: "glory" | "signet", amount: number): string => {
  const [ns, ...rest] = source.split(":");
  const tail = rest.join(":");
  switch (ns) {
    case "ranked":
      return amount >= 0 ? "ranked match pay" : "ranked match";
    case "achievement":
      return `deed: ${deedTitle(tail)}`;
    case "store":
      if (tail === "exchange") return ledger === "glory" ? "exchanged for a Signet" : "exchanged from Glory";
      if (tail === "unlock") return "spent on an unlock";
      return source;
    case "iap":
      return `bought ${packWords(rest[1] ?? "")} · ${rest[0] ?? "store"}`;
    case "code":
      return `${tail || "promo"} code`;
    case "merge":
      return "merged from another device";
    case "hq":
      return `HQ: ${tail}`;
    case "dev-grant":
    case "dev":
      return "dev grant";
    default:
      return source;
  }
};

/** An entitlement source in words: purchase:signet · achievement:<deed> · dev… */
export const describeGrant = (source: string): string => {
  const [ns, ...rest] = source.split(":");
  if (ns === "purchase") return "bought with a Signet";
  if (ns === "achievement") return `deed: ${deedTitle(rest.join(":"))}`;
  return source;
};

export interface ChapterInfo {
  id: string;
  title: string;
  ids: string[];
}

/** The Chronicle's chapters, in the order the player sees them, plus an
 * "Other" tail for any deed no chapter claims. */
export const chapters = (): ChapterInfo[] => {
  const list: ChapterInfo[] = ACHIEVEMENT_CHAPTERS.map((c) => ({ id: c.id, title: c.title, ids: [...c.ids] }));
  const claimed = new Set(list.flatMap((c) => c.ids));
  const rest = ACHIEVEMENT_DEFS.filter((d) => !claimed.has(d.id)).map((d) => d.id);
  if (rest.length > 0) list.push({ id: "other", title: "Other", ids: rest });
  return list;
};

export const packName = (sku: string): string => {
  const n = SIGNET_PACKS[sku];
  return n === undefined ? sku : n === 1 ? "1 Signet" : `${n} Signets`;
};
