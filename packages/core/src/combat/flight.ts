import { distance, rotate, type Vec2 } from "../math/vec2";
import { spawnProjectile, type ProjectileState } from "./projectile";

/**
 * The flight-pattern bank: named, reusable projectile movement logic.
 *
 * Weapons stay pure data — an attack config says `flight: "pincer"` and the
 * pattern's math lives here exactly once, shared by every weapon (and later,
 * every modifier) that references it. Same data-refs-code pattern as enemy
 * brains and effect hooks (see docs/design/modifiers-and-effects.md).
 *
 * A pattern is resolved entirely at spawn-time into plain projectile state
 * (initial direction + the turnRate/turnLeft fields stepProjectile already
 * understands), so stepping stays one generic integrator and patterns are
 * deterministic, serialisable data. Patterns that must react mid-flight
 * (homing) will need a per-step hook added here — deliberately not built yet.
 *
 * To add a pattern: extend `FlightId`, handle it in `armOffsets`, test it.
 */
export type FlightId = "straight" | "pincer";

export interface VolleyConfig {
  speed: number;
  radius: number;
  maxRange: number;
  pierce?: number;
  /** Projectiles per volley. Default 1. */
  count?: number;
  /** Pattern from the bank. Default "straight". */
  flight?: FlightId;
  /** Pincer: how far off the aim line the outermost arms start, radians. */
  curveAngle?: number;
}

export const DEFAULT_CURVE_ANGLE = Math.PI / 4;

/**
 * Initial angular offsets from the aim line, one per projectile.
 * Offsets spread evenly across [-curve, +curve]: a 2-volley is the classic
 * two-arm pincer, odd counts gain a straight centre shot, bigger counts fan —
 * so "+1 projectile" upgrades compose with any pattern for free.
 */
const armOffsets = (flight: FlightId, count: number, curveAngle: number): number[] => {
  if (flight === "straight" || count === 1) return Array(count).fill(0);
  return Array.from({ length: count }, (_, i) => (i * (2 * curveAngle)) / (count - 1) - curveAngle);
};

/**
 * Spawn one strike's worth of projectiles, aimed at the target's position at
 * fire-time, shaped by the config's flight pattern.
 *
 * Curved arms fly a circular arc that converges exactly on the aim point: an
 * arc leaving its chord (length D) at angle θ sweeps 2θ around a radius of
 * D / 2·sin θ. After converging the arms straighten and scissor onward along
 * their final tangents (they do NOT keep curving into orbits), and each
 * projectile damages independently — landing both pincer arms on one victim
 * is double damage by design, the reward for lining the pinch up.
 */
export const spawnVolley = (
  origin: Vec2,
  targetPos: Vec2,
  config: VolleyConfig,
): ProjectileState[] => {
  const count = Math.max(1, Math.round(config.count ?? 1));
  const chord = distance(origin, targetPos);
  const offsets = armOffsets(config.flight ?? "straight", count, config.curveAngle ?? DEFAULT_CURVE_ANGLE);

  return offsets.map((offset) => {
    const p = spawnProjectile(origin, targetPos, config);
    // Degenerate chords (point-blank) and zero offsets fly straight.
    if (offset !== 0 && chord > 1e-6) {
      p.dir = rotate(p.dir, offset);
      const arcRadius = chord / (2 * Math.sin(Math.abs(offset)));
      // Turn back toward the aim line, i.e. against the offset's sign.
      p.turnRate = -Math.sign(offset) * (config.speed / arcRadius);
      p.turnLeft = 2 * Math.abs(offset);
    }
    return p;
  });
};
