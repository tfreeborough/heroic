/**
 * The shared achievement engine (achievements.md): pure types + evaluation,
 * game-agnostic by construction. A game supplies its own match-summary shape
 * `S` (the generic below), its own definitions, and its own adapter deciding
 * where evaluation runs and where state persists — BITS evaluates server-side
 * into Turso; an offline game may run the same engine against local storage.
 * Nothing in this package may ever import a database, a socket, or React.
 */

/** Lifetime counter values, keyed by an open counter namespace the game owns
 * (e.g. `ranked_wins`, `cast:sandtrap`). Absent = 0. */
export type Counters = Readonly<Record<string, number>>;

export type AchievementReward =
  | { kind: "glory"; amount: number }
  /** A hidden item (weapon/ability/cosmetic) — granted as an entitlement,
   * never purchasable, unknown until the unlock (achievements.md § secret
   * items). */
  | { kind: "entitlement"; itemId: string }
  /** The deed's OWN title becomes a wearable player title (Tom,
   * 2026-08-04) — no separate name, the deed IS the title; the adapter
   * grants the entitlement `title:<deed-id>`. The wearing UX is the
   * game's. */
  | { kind: "title" };

export type AchievementTrigger<S> =
  /** Fires when the counter CROSSES the threshold this evaluation
   * (before < threshold ≤ after) — exactly once by construction. */
  | { kind: "milestone"; counter: string; threshold: number }
  /** A single-match predicate over the finished summary — where all the
   * interesting ones live. Runs only while still locked. */
  | { kind: "feat"; test: (summary: S, playerKey: number) => boolean };

export interface AchievementDef<S> {
  /** Stable forever once shipped — it's the persistence key. */
  id: string;
  /** Which tabbed map this deed lives on — a content/presentation grouping;
   * storage never sees it. */
  board: string;
  /** Visible from the silhouette (frontier) stage. */
  title: string;
  /** Hidden until unlocked — the "how" is part of the reveal. */
  description: string;
  /** Forge asset key for the map icon. */
  icon: string;
  /** Frontier edge: children of an unlocked node show as silhouettes; null =
   * a board root, always visible. Also draws the map's connecting line. */
  parent: string | null;
  /** Authored board position (no auto-layout). */
  pos: { x: number; y: number };
  /** What unlocking pays — any mix of kinds (Tom, 2026-08-04: a deed can
   * pay Glory AND crown its title AND drop a secret item). Absent/empty =
   * the unlock is its own reward. */
  rewards?: readonly AchievementReward[];
  trigger: AchievementTrigger<S>;
}

export interface BoardDef<S> {
  id: string;
  /** The board-level context gate: definitions on this board evaluate only
   * against summaries the board accepts (e.g. the ranked board only accepts
   * ranked matches) — closes the authoring slip where an off-mode match pops
   * an on-board deed. Absent = accepts everything. */
  accepts?: (summary: S) => boolean;
}

export type NodeVisibility = "unlocked" | "frontier" | "hidden";
