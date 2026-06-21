import { angleDiff, angleTo, distance, type Vec2 } from "../math/vec2";
import { closestPointOnAabb, distanceToAabb, type Aabb } from "../physics/crowd";

/**
 * A hurtbox: the region on a body that can be hit. Most entities are circles, so
 * a hurtbox is just position + radius (see combat.md). Breakable blockers are
 * rectangular, so the same hit detection also accepts an axis-aligned box —
 * hence `HurtTarget`, the union both `hitsInArc` and `stepProjectile` take.
 */
export interface HurtCircle {
  id: number;
  pos: Vec2;
  radius: number;
}

/** A rectangular hurtbox (a breakable's footprint doubles as its hit target). */
export interface HurtBox {
  id: number;
  box: Aabb;
}

export type HurtTarget = HurtCircle | HurtBox;

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
  targets: readonly HurtTarget[],
): number[] => {
  const halfArc = arcWidth / 2;
  const hits: number[] = [];
  for (const t of targets) {
    if ("box" in t) {
      // Rectangular target (a breakable): range is to its nearest point, and the
      // angle is measured to that same point — so facing a wall dead-on cleaves
      // it while a swing that glances past its edge misses, mirroring the circle
      // rule. Standing inside the box (nearest point == origin) is an unambiguous
      // hit with no direction to test.
      if (distanceToAabb(origin, t.box) > reach) continue;
      const near = closestPointOnAabb(origin, t.box);
      if (near.x === origin.x && near.y === origin.y) {
        hits.push(t.id);
        continue;
      }
      if (Math.abs(angleDiff(angleTo(origin, near), facing)) > halfArc) continue;
      hits.push(t.id);
    } else {
      if (distance(origin, t.pos) - t.radius > reach) continue;
      if (Math.abs(angleDiff(angleTo(origin, t.pos), facing)) > halfArc) continue;
      hits.push(t.id);
    }
  }
  return hits;
};
