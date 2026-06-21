import { distance, normalize, rotate, scale, sub, type Vec2 } from "../math/vec2";
import { distanceToAabb } from "../physics/crowd";
import type { HurtTarget } from "./hitbox";

/**
 * Projectile simulation (the `projectile` attack shape from combat.md): a
 * small circle spawned toward the target's position at fire-time, travelling
 * in a straight line, damaging the first hostile it overlaps — optionally
 * piercing through more.
 *
 * This is the pure kinematic core. Wall collisions live with the caller
 * (the engine/app layer owns the physics world and level geometry).
 */
export interface ProjectileState {
  pos: Vec2;
  /** Unit direction; aimed at fire-time, then evolved only by the turn fields. */
  dir: Vec2;
  /** px/s. */
  speed: number;
  /** Collision radius of the projectile itself. */
  radius: number;
  traveled: number;
  /** Expires (vanishes) once `traveled` exceeds this (arc length, not displacement). */
  maxRange: number;
  /** How many *more* hostiles it may pass through after the next hit. */
  pierceLeft: number;
  /** Hostiles already damaged — a piercing shot must not re-hit them. */
  hitIds: number[];
  /**
   * Curved flight (set by flight patterns — see flight.ts): `dir` rotates at
   * `turnRate` rad/s until `turnLeft` radians have been swept, then the
   * projectile straightens out and flies its final tangent. 0/0 = straight.
   */
  turnRate: number;
  turnLeft: number;
}

export const spawnProjectile = (
  origin: Vec2,
  targetPos: Vec2,
  config: { speed: number; radius: number; maxRange: number; pierce?: number },
): ProjectileState => ({
  pos: { ...origin },
  dir: normalize(sub(targetPos, origin)),
  speed: config.speed,
  radius: config.radius,
  traveled: 0,
  maxRange: config.maxRange,
  pierceLeft: config.pierce ?? 0,
  hitIds: [],
  turnRate: 0,
  turnLeft: 0,
});

export interface ProjectileStepResult {
  /** Hostiles damaged this step (in hit order — nearest first). */
  hits: number[];
  /** True when the projectile is spent (range exhausted or out of pierce). */
  expired: boolean;
}

/**
 * Advance one fixed step and resolve overlaps. Mutates `p` (projectiles are
 * short-lived per-frame state; the caller owns the array).
 *
 * Overlap is circle-vs-circle after the move. At our speeds and step size a
 * projectile moves well under a body diameter per step, so tunneling isn't a
 * concern yet — swept tests can replace this if speeds outgrow it.
 */
export const stepProjectile = (
  p: ProjectileState,
  dt: number,
  targets: readonly HurtTarget[],
): ProjectileStepResult => {
  if (p.turnLeft > 0) {
    const turn = Math.min(Math.abs(p.turnRate) * dt, p.turnLeft);
    p.dir = rotate(p.dir, Math.sign(p.turnRate) * turn);
    p.turnLeft -= turn;
  }
  const moved = p.speed * dt;
  p.pos = { x: p.pos.x + p.dir.x * moved, y: p.pos.y + p.dir.y * moved };
  p.traveled += moved;

  // Collect fresh overlaps, nearest first, consuming pierce as we go. Overlap is
  // circle-vs-circle for bodies, circle-vs-box for breakables (distance to the
  // box's nearest point ≤ the projectile's radius).
  const overlaps: { id: number; d: number }[] = [];
  for (const t of targets) {
    if (p.hitIds.includes(t.id)) continue;
    const d = "box" in t ? distanceToAabb(p.pos, t.box) : distance(p.pos, t.pos);
    const reach = "box" in t ? p.radius : p.radius + t.radius;
    if (d <= reach) overlaps.push({ id: t.id, d });
  }
  overlaps.sort((a, b) => a.d - b.d);

  const hits: number[] = [];
  let expired = p.traveled >= p.maxRange;
  for (const o of overlaps) {
    hits.push(o.id);
    p.hitIds.push(o.id);
    if (p.pierceLeft === 0) {
      expired = true;
      break;
    }
    p.pierceLeft -= 1;
  }

  return { hits, expired };
};

/** Apply an impulse along the projectile's travel direction — knockback helper. */
export const projectileKnockback = (p: ProjectileState, knockback: number): Vec2 =>
  scale(p.dir, knockback);
