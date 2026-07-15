/**
 * Cracked-earth decals — Tremor's mark on the arena, the blood-trail pattern
 * exactly (docs/design/pvp-abilities.md): client-derived from cast events,
 * never networked, persisting on the floor and fading out. Each crack is a
 * burst of jagged radial polylines generated once at spawn (no per-frame
 * randomness), drawn in the floor pass under the blood.
 */
import type { Vec2 } from "@heroic/core";

/** How long a crack stays on the sand before it's fully faded. */
export const CRACK_TTL_MS = 30_000;
const MAX_CRACKS = 24; // oldest-evict cap — tremor spam can't grow the record cost

export interface CrackDecal {
  x: number;
  y: number;
  bornMs: number;
  /** Pre-generated jagged polylines, world coords (absolute). */
  paths: Vec2[][];
}

/** 0..1 draw alpha: holds strong briefly, then a long linear fade. */
export const crackAlpha = (c: CrackDecal, nowMs: number): number => {
  const t = (nowMs - c.bornMs) / CRACK_TTL_MS;
  if (t >= 1) return 0;
  return t < 0.1 ? 1 : 1 - (t - 0.1) / 0.9;
};

/** One jagged radial line: outward from the centre with lateral jitter. */
const jaggedLine = (x: number, y: number, angle: number, length: number): Vec2[] => {
  const segments = 3 + Math.floor(Math.random() * 2);
  const points: Vec2[] = [{ x, y }];
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  for (let s = 1; s <= segments; s++) {
    const along = (length * s) / segments;
    const jitter = (Math.random() - 0.5) * 14;
    points.push({
      x: x + dirX * along - dirY * jitter,
      y: y + dirY * along + dirX * jitter,
    });
  }
  return points;
};

export class CrackField {
  readonly decals: CrackDecal[] = [];

  /** Fracture the ground at a slam point. `radius` scales the burst. */
  add(x: number, y: number, radius: number, nowMs: number): void {
    const paths: Vec2[][] = [];
    const arms = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < arms; i++) {
      const angle = ((i + 0.2 + Math.random() * 0.6) / arms) * Math.PI * 2;
      const length = radius * (0.35 + Math.random() * 0.4);
      const arm = jaggedLine(x, y, angle, length);
      paths.push(arm);
      // Half the arms fork near their tip — reads as fracture, not asterisk.
      if (Math.random() < 0.5) {
        const from = arm[arm.length - 2]!;
        paths.push(jaggedLine(from.x, from.y, angle + (Math.random() - 0.5) * 1.6, length * 0.4));
      }
    }
    this.decals.push({ x, y, bornMs: nowMs, paths });
    if (this.decals.length > MAX_CRACKS) this.decals.splice(0, this.decals.length - MAX_CRACKS);
  }

  /** Drop fully-faded decals. Once per frame, like BloodField.update. */
  update(nowMs: number): void {
    let write = 0;
    for (let read = 0; read < this.decals.length; read++) {
      const c = this.decals[read]!;
      if (nowMs - c.bornMs < CRACK_TTL_MS) this.decals[write++] = c;
    }
    this.decals.length = write;
  }
}
