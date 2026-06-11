import { distanceSq, type Vec2 } from "../math/vec2";

/**
 * Auto-targeting (see docs/design/player-movement-and-targeting.md): the
 * player never aims — the game picks the nearest hostile inside the
 * engagement radius, with hysteresis so two near-equidistant enemies don't
 * cause target flip-flop. Candidates are hostiles only; NPCs and
 * interactables never enter this set.
 */
export interface TargetCandidate {
  id: number;
  pos: Vec2;
}

/**
 * Keep the current target unless a challenger is *meaningfully* closer —
 * by default it must beat the current distance by 15%.
 */
export const TARGET_HYSTERESIS = 0.15;

/**
 * Nearest-hostile-with-hysteresis selection. Returns the id of the target to
 * face/attack, or null when nothing is inside the engagement radius.
 *
 * Closest-first is the starting heuristic; threat/low-HP weighting can slot
 * in here later without touching callers.
 */
export const selectTarget = (
  candidates: readonly TargetCandidate[],
  origin: Vec2,
  engagementRadius: number,
  currentId: number | null,
  hysteresis: number = TARGET_HYSTERESIS,
): number | null => {
  const radiusSq = engagementRadius * engagementRadius;

  let nearest: TargetCandidate | null = null;
  let nearestDistSq = Infinity;
  let currentDistSq: number | null = null;

  for (const c of candidates) {
    const dSq = distanceSq(origin, c.pos);
    if (dSq > radiusSq) continue;
    if (c.id === currentId) currentDistSq = dSq;
    if (dSq < nearestDistSq) {
      nearest = c;
      nearestDistSq = dSq;
    }
  }

  if (nearest === null) return null;
  // Current target gone (dead / out of range) → snap to the nearest.
  if (currentDistSq === null) return nearest.id;
  if (nearest.id === currentId) return currentId;

  // The challenger must be meaningfully closer to steal the lock. Hysteresis
  // is specified on distance, so compare against the squared shrunk distance.
  const threshold = 1 - hysteresis;
  return nearestDistSq < currentDistSq * threshold * threshold ? nearest.id : currentId;
};
