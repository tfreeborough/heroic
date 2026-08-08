/**
 * The tiered-chain builder: one counter, N tiers, N defs linked parent→child
 * and spaced along an authored direction — so "win 5/25/…/1000" is a spec,
 * not eight hand-written objects. Each tier is a plain object carrying its
 * own title/description/reward (Tom, 2026-08-03 — authoring lives WITH the
 * threshold, never in functions reverse-engineering which tier they're on).
 * Tiers share one icon by design (the map renders bronze/silver/gold tier
 * frames over it; achievements.md § icon economics).
 */
import type { AchievementDef, AchievementReward } from "./types";

export interface ChainTier {
  threshold: number;
  title: string;
  description: string;
  rewards?: readonly AchievementReward[];
}

export interface ChainSpec {
  board: string;
  /** Tier ids become `<idBase>-<threshold>` — stable as long as the
   * thresholds are (and thresholds are content, frozen once shipped). */
  idBase: string;
  counter: string;
  /** Ascending by threshold. */
  tiers: readonly ChainTier[];
  icon: string;
  /** What the FIRST tier hangs off (null = a board root). Later tiers chain
   * off their predecessor automatically. */
  parent?: string | null;
  origin: { x: number; y: number };
  /** Spacing between consecutive tiers on the board. */
  step: { x: number; y: number };
}

export const milestoneChain = <S>(spec: ChainSpec): AchievementDef<S>[] => {
  let parent = spec.parent ?? null;
  return spec.tiers.map((tier, i) => {
    const def: AchievementDef<S> = {
      id: `${spec.idBase}-${tier.threshold}`,
      board: spec.board,
      title: tier.title,
      description: tier.description,
      icon: spec.icon,
      parent,
      pos: { x: spec.origin.x + spec.step.x * i, y: spec.origin.y + spec.step.y * i },
      trigger: { kind: "milestone", counter: spec.counter, threshold: tier.threshold },
      ...(tier.rewards && tier.rewards.length > 0 ? { rewards: tier.rewards } : {}),
    };
    parent = def.id;
    return def;
  });
};
