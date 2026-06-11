import { angleDiff, angleTo, distance, type Vec2 } from "../math/vec2";

/**
 * A hurtbox: the region on a body that can be hit. For us every entity is a
 * circle, so a hurtbox is just its position + radius (see combat.md).
 */
export interface HurtCircle {
  id: number;
  pos: Vec2;
  radius: number;
}

/**
 * Melee arc (cleave) hit detection — pure cone geometry, per combat.md:
 * an `arc` attack damages *every* hostile within `reach` of the attacker and
 * within `arcWidth` of the facing direction.
 *
 * - Range is measured to the target's *edge* (distance minus its radius), so
 *   fat targets aren't harder to clip than thin ones.
 * - The angle test uses the target's centre; the forgiveness knob is
 *   `arcWidth` itself (see the whiff rules in the movement doc).
 */
export const hitsInArc = (
  origin: Vec2,
  facing: number,
  reach: number,
  arcWidth: number,
  targets: readonly HurtCircle[],
): number[] => {
  const halfArc = arcWidth / 2;
  const hits: number[] = [];
  for (const t of targets) {
    if (distance(origin, t.pos) - t.radius > reach) continue;
    if (Math.abs(angleDiff(angleTo(origin, t.pos), facing)) > halfArc) continue;
    hits.push(t.id);
  }
  return hits;
};
